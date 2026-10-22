import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { branchMemberships, branches, schedules, users } from "@/lib/db/schema";
import { SCHEDULE_PERSON_ROLES } from "@/lib/operations/scheduling";
import { clockSchema, uuidSchema } from "@/lib/operations/validation";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { requireBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";
const breaksSchema = z.array(z.object({ start: clockSchema, end: clockSchema })).max(6).refine((items) => items.every((item) => item.start < item.end) && items.every((item, index) => items.slice(index + 1).every((other) => item.end <= other.start || other.end <= item.start)), "فترات الاستراحة متداخلة أو غير صالحة");
const rowSchema = z.object({ weekday: z.number().int().min(0).max(6), startsAt: clockSchema, endsAt: clockSchema, breaks: breaksSchema, isAvailable: z.boolean() }).refine((row) => row.startsAt < row.endsAt, "وقت نهاية الدوام يجب أن يأتي بعد بدايته");
const inputSchema = z.object({ branchId: uuidSchema, providerId: uuidSchema.nullable().optional().default(null), personId: uuidSchema.nullable().optional(), rows: z.array(rowSchema).length(7).refine((rows) => new Set(rows.map((row) => row.weekday)).size === 7, "يجب إرسال أيام الأسبوع السبعة مرة واحدة") }).superRefine((input, ctx) => {
  if (input.providerId && input.personId && input.providerId !== input.personId) ctx.addIssue({ code: "custom", path: ["personId"], message: "معرف الموظف غير متطابق" });
});

const personRoles = [...SCHEDULE_PERSON_ROLES];
const providerWhere = (personId: string | null) => personId ? eq(schedules.providerId, personId) : isNull(schedules.providerId);

async function requireSchedulePerson(context: Parameters<typeof requireBranchMembership>[0], branchId: string, personId: string | null): Promise<void> {
  if (!personId) return;
  const [person] = await context.db.select({ id: users.id }).from(users)
    .innerJoin(branchMemberships, and(eq(branchMemberships.userId, users.id), eq(branchMemberships.tenantId, users.tenantId), eq(branchMemberships.branchId, branchId)))
    .innerJoin(branches, and(eq(branches.id, branchId), eq(branches.tenantId, context.tenantId), eq(branches.isActive, true)))
    .where(and(eq(users.id, personId), eq(users.tenantId, context.tenantId), eq(users.isActive, true), inArray(users.role, personRoles)))
    .limit(1);
  if (!person) throw new ApiError("الموظف غير موجود أو غير مسند إلى هذا الفرع", 409);
}

function parseBreaks(value: string): Array<{ start: string; end: string }> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as Array<{ start: string; end: string }> : [];
  } catch { return []; }
}

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"], { allowOnboardingSetup: true });
  if (!access.ok) return access.response;
  const branchId = new URL(request.url).searchParams.get("branchId");
  if (!branchId || !uuidSchema.safeParse(branchId).success) return Response.json({ error: "حدد الفرع" }, { status: 400 });
  await requireBranchMembership(access.context, branchId);
  const [branch] = await access.context.db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, branchId), eq(branches.tenantId, access.context.tenantId))).limit(1);
  if (!branch) return Response.json({ error: "الفرع غير موجود" }, { status: 404 });
  const people = await access.context.db.select({ id: users.id, fullName: users.fullName, role: users.role })
    .from(users)
    .innerJoin(branchMemberships, and(eq(branchMemberships.userId, users.id), eq(branchMemberships.tenantId, users.tenantId)))
    .where(and(eq(users.tenantId, access.context.tenantId), eq(users.isActive, true), eq(branchMemberships.tenantId, access.context.tenantId), eq(branchMemberships.branchId, branchId), inArray(users.role, personRoles)));
  const providerId = new URL(request.url).searchParams.get("providerId") ?? new URL(request.url).searchParams.get("personId");
  if (providerId && !uuidSchema.safeParse(providerId).success) return Response.json({ error: "معرف الموظف غير صالح" }, { status: 400 });
  await requireSchedulePerson(access.context, branchId, providerId);
  const whereProvider = providerWhere(providerId);
  const rows = await access.context.db.select().from(schedules).where(and(eq(schedules.tenantId, access.context.tenantId), eq(schedules.branchId, branchId), whereProvider));
  return Response.json({ providers: people, people, schedules: rows.map((row) => ({ ...row, breaks: parseBreaks(row.breaksJson) })) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"], { allowOnboardingSetup: true });
  if (!access.ok) return access.response;
  try {
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("بيانات جدول العمل غير مكتملة أو غير صحيحة");
    const { branchId, rows } = parsed.data;
    const providerId = parsed.data.personId ?? parsed.data.providerId ?? null;
    await requireBranchMembership(access.context, branchId);
    const [branch] = await access.context.db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, branchId), eq(branches.tenantId, access.context.tenantId), eq(branches.isActive, true))).limit(1);
    if (!branch) throw new ApiError("الفرع غير موجود في مساحة العمل", 404);
    await requireSchedulePerson(access.context, branchId, providerId);
    // Validate every row before issuing any statement so malformed input cannot leave a partial week.
    for (const row of rows) for (const rest of row.breaks) if (rest.start < row.startsAt || rest.end > row.endsAt) throw new ApiError("يجب أن تقع فترات الاستراحة داخل ساعات العمل");
    const now = Date.now();
    const providerPredicate = providerId ? "provider_id = ?" : "provider_id IS NULL";
    const statements = rows.flatMap((row) => {
      const deterministicId = `schedule:${access.context.tenantId}:${branchId}:${providerId ?? "general"}:${row.weekday}`;
      const updateBindings: unknown[] = [row.startsAt, row.endsAt, JSON.stringify(row.breaks), row.isAvailable ? 1 : 0, now, access.context.tenantId, branchId];
      if (providerId) updateBindings.push(providerId);
      updateBindings.push(row.weekday);
      const insertBindings: unknown[] = [deterministicId, access.context.tenantId, branchId, providerId, row.weekday, row.startsAt, row.endsAt, JSON.stringify(row.breaks), row.isAvailable ? 1 : 0, now, now, access.context.tenantId, branchId];
      if (providerId) insertBindings.push(providerId);
      insertBindings.push(row.weekday);
      return [
        access.context.env.DB.prepare(`UPDATE schedules SET starts_at = ?, ends_at = ?, breaks_json = ?, is_available = ?, updated_at = ? WHERE tenant_id = ? AND branch_id = ? AND ${providerPredicate} AND weekday = ?`).bind(...updateBindings),
        access.context.env.DB.prepare(`INSERT OR IGNORE INTO schedules (id, tenant_id, branch_id, provider_id, weekday, starts_at, ends_at, breaks_json, is_available, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM schedules WHERE tenant_id = ? AND branch_id = ? AND ${providerPredicate} AND weekday = ?)`).bind(...insertBindings),
      ];
    });
    await access.context.env.DB.batch(statements);
    await writeAudit(access.context, request, "schedule.week_updated", "schedule", branchId, { providerId });
    return Response.json({ saved: rows.length });
  } catch (error) { return errorResponse(error); }
}
