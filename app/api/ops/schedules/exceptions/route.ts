import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { branchMemberships, branches, scheduleExceptions, users } from "@/lib/db/schema";
import { isValidScheduleDate, SCHEDULE_PERSON_ROLES } from "@/lib/operations/scheduling";
import { clockSchema, uuidSchema } from "@/lib/operations/validation";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { requireAllActiveBranchMemberships, requireBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";
const exceptionInput = z.object({ branchId: uuidSchema, providerId: uuidSchema.nullable().optional().default(null), personId: uuidSchema.nullable().optional(), date: z.string().refine(isValidScheduleDate, "التاريخ غير صالح"), startsAt: clockSchema.nullable().default(null), endsAt: clockSchema.nullable().default(null), reason: z.string().trim().min(3).max(300), isEmergency: z.boolean().default(false) }).superRefine((row, ctx) => {
  if (row.providerId && row.personId && row.providerId !== row.personId) ctx.addIssue({ code: "custom", path: ["personId"], message: "معرف الموظف غير متطابق" });
  if ((row.startsAt === null) !== (row.endsAt === null) || (!!row.startsAt && !!row.endsAt && row.startsAt >= row.endsAt)) ctx.addIssue({ code: "custom", path: ["startsAt"], message: "حدد بداية ونهاية الاستثناء أو اجعله إغلاقاً لليوم كاملاً" });
});
const personRoles = [...SCHEDULE_PERSON_ROLES];
const exceptionIdSchema = z.union([uuidSchema, z.string().regex(/^schedule-exception:.{1,480}$/)]);

async function requireSchedulePerson(context: Parameters<typeof requireBranchMembership>[0], branchId: string, personId: string | null): Promise<void> {
  if (!personId) return;
  const [person] = await context.db.select({ id: users.id }).from(users)
    .innerJoin(branchMemberships, and(eq(branchMemberships.userId, users.id), eq(branchMemberships.tenantId, users.tenantId), eq(branchMemberships.branchId, branchId)))
    .where(and(eq(users.id, personId), eq(users.tenantId, context.tenantId), eq(users.isActive, true), inArray(users.role, personRoles)))
    .limit(1);
  if (!person) throw new ApiError("الموظف غير موجود أو غير مسند إلى هذا الفرع", 409);
}

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request);
  if (!access.ok) return access.response;
  const branchId = new URL(request.url).searchParams.get("branchId");
  if (!branchId || !uuidSchema.safeParse(branchId).success) return Response.json({ error: "حدد الفرع" }, { status: 400 });
  const [branch] = await access.context.db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, branchId), eq(branches.tenantId, access.context.tenantId))).limit(1);
  if (!branch) return Response.json({ error: "الفرع غير موجود" }, { status: 404 });
  await requireBranchMembership(access.context, branchId);
  const personId = new URL(request.url).searchParams.get("providerId") ?? new URL(request.url).searchParams.get("personId");
  if (personId && !uuidSchema.safeParse(personId).success) return Response.json({ error: "معرف الموظف غير صالح" }, { status: 400 });
  await requireSchedulePerson(access.context, branchId, personId);
  const personFilter = personId ? or(isNull(scheduleExceptions.providerId), eq(scheduleExceptions.providerId, personId)) : undefined;
  const rows = await access.context.db.select().from(scheduleExceptions).where(and(eq(scheduleExceptions.tenantId, access.context.tenantId), or(eq(scheduleExceptions.branchId, branchId), isNull(scheduleExceptions.branchId)), ...(personFilter ? [personFilter] : []))).orderBy(asc(scheduleExceptions.date));
  return Response.json({ exceptions: rows }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  try {
    const parsed = exceptionInput.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("تحقق من تاريخ وبيانات الإغلاق");
    const input = parsed.data;
    const providerId = input.personId ?? input.providerId ?? null;
    await requireBranchMembership(access.context, input.branchId);
    const [branch] = await access.context.db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, input.branchId), eq(branches.tenantId, access.context.tenantId), eq(branches.isActive, true))).limit(1);
    if (!branch) throw new ApiError("الفرع غير موجود في مساحة العمل", 404);
    await requireSchedulePerson(access.context, input.branchId, providerId);
    const id = `schedule-exception:${access.context.tenantId}:${input.branchId}:${providerId ?? "general"}:${input.date}:${input.startsAt ?? ""}:${input.endsAt ?? ""}:${input.reason}`;
    await access.context.env.DB.prepare("INSERT OR IGNORE INTO schedule_exceptions (id, tenant_id, branch_id, provider_id, date, starts_at, ends_at, reason, is_emergency, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, access.context.tenantId, input.branchId, providerId, input.date, input.startsAt, input.endsAt, input.reason, input.isEmergency ? 1 : 0, access.context.user.id, Date.now()).run();
    const [created] = await access.context.db.select().from(scheduleExceptions).where(and(eq(scheduleExceptions.id, id), eq(scheduleExceptions.tenantId, access.context.tenantId))).limit(1);
    if (!created) throw new ApiError("تعذر حفظ الاستثناء", 500);
    await writeAudit(access.context, request, input.isEmergency ? "schedule.emergency_closed" : "schedule.exception_created", "schedule_exception", id, { date: input.date, branchId: input.branchId });
    return Response.json({ exception: created }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]);
  if (!access.ok) return access.response;
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !exceptionIdSchema.safeParse(id).success) return Response.json({ error: "معرف الاستثناء غير صالح" }, { status: 400 });
  const [existing] = await access.context.db.select({ branchId: scheduleExceptions.branchId }).from(scheduleExceptions).where(and(eq(scheduleExceptions.id, id), eq(scheduleExceptions.tenantId, access.context.tenantId))).limit(1);
  if (!existing) return Response.json({ error: "الاستثناء غير موجود" }, { status: 404 });
  if (existing.branchId) await requireBranchMembership(access.context, existing.branchId);
  else await requireAllActiveBranchMemberships(access.context);
  const [removed] = await access.context.db.delete(scheduleExceptions).where(and(eq(scheduleExceptions.id, id), eq(scheduleExceptions.tenantId, access.context.tenantId))).returning({ id: scheduleExceptions.id });
  if (!removed) return Response.json({ error: "الاستثناء غير موجود" }, { status: 404 });
  await writeAudit(access.context, request, "schedule.exception_removed", "schedule_exception", id);
  return Response.json({ deleted: true });
}
