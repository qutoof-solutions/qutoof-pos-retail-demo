import { and, asc, eq, gte, gt, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { branchMemberships, branches, staffShifts, users } from "@/lib/db/schema";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { requireBranchMembership } from "@/lib/server/branch-access";
import { uuidSchema } from "@/lib/operations/validation";
export const runtime = "edge";
const inputSchema = z.object({ branchId: uuidSchema, staffId: uuidSchema, department: z.string().trim().max(120).nullable().optional(), shiftType: z.enum(["morning", "evening", "night"]), startsAt: z.coerce.date(), endsAt: z.coerce.date(), maxAppointments: z.number().int().min(0).max(1000).default(0), notes: z.string().trim().max(500).nullable().optional() }).refine((v) => v.endsAt > v.startsAt, "يجب أن تكون نهاية الوردية بعد بدايتها");
const staffRoles = ["provider", "doctor", "specialist", "nurse"] as const;
export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]); if (!access.ok) return access.response;
  const url = new URL(request.url); const from = new Date(url.searchParams.get("from") ?? new Date(Date.now() - 7 * 86400000).toISOString()); const to = new Date(url.searchParams.get("to") ?? new Date(Date.now() + 35 * 86400000).toISOString());
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) return Response.json({ error: "نطاق الورديات غير صالح" }, { status: 400 });
  const branchId = url.searchParams.get("branchId");
  if (branchId) await requireBranchMembership(access.context, branchId);
  const filters = [eq(staffShifts.tenantId, access.context.tenantId), eq(staffShifts.isActive, true), lt(staffShifts.startsAt, to), gte(staffShifts.endsAt, from)];
  if (branchId) filters.push(eq(staffShifts.branchId, branchId));
  const rows = await access.context.db.select({ id: staffShifts.id, branchId: staffShifts.branchId, branchName: branches.name, branchNameAr: branches.nameAr, branchNameEn: branches.nameEn, staffId: staffShifts.staffId, staffName: users.fullName, staffRole: users.role, department: staffShifts.department, shiftType: staffShifts.shiftType, startsAt: staffShifts.startsAt, endsAt: staffShifts.endsAt, maxAppointments: staffShifts.maxAppointments, notes: staffShifts.notes }).from(staffShifts).innerJoin(branches, and(eq(branches.id, staffShifts.branchId), eq(branches.tenantId, access.context.tenantId))).innerJoin(users, and(eq(users.id, staffShifts.staffId), eq(users.tenantId, access.context.tenantId))).where(and(...filters)).orderBy(asc(staffShifts.startsAt));
  return Response.json({ shifts: rows }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, ["business_admin"]); if (!access.ok) return access.response;
  try {
    const parsed = inputSchema.safeParse(await request.json()); if (!parsed.success) throw new ApiError(parsed.error.issues[0]?.message ?? "بيانات الوردية غير صحيحة");
    const input = parsed.data; await requireBranchMembership(access.context, input.branchId);
    const [staff] = await access.context.db.select({ id: users.id }).from(users).innerJoin(branchMemberships, and(eq(branchMemberships.userId, users.id), eq(branchMemberships.tenantId, access.context.tenantId), eq(branchMemberships.branchId, input.branchId))).where(and(eq(users.id, input.staffId), eq(users.tenantId, access.context.tenantId), inArray(users.role, [...staffRoles]), eq(users.isActive, true))).limit(1);
    if (!staff) throw new ApiError("الموظف غير نشط أو غير مسند إلى هذا الفرع", 409);
    const overlap = await access.context.db.select({ id: staffShifts.id }).from(staffShifts).where(and(eq(staffShifts.tenantId, access.context.tenantId), eq(staffShifts.branchId, input.branchId), eq(staffShifts.staffId, input.staffId), eq(staffShifts.isActive, true), lt(staffShifts.startsAt, input.endsAt), gt(staffShifts.endsAt, input.startsAt))).limit(1);
    if (overlap.length) throw new ApiError("توجد وردية أخرى متداخلة لهذا الموظف", 409);
    const now = new Date(); const id = crypto.randomUUID();
    const [shift] = await access.context.db.insert(staffShifts).values({ id, tenantId: access.context.tenantId, branchId: input.branchId, staffId: input.staffId, department: input.department ?? null, shiftType: input.shiftType, startsAt: input.startsAt, endsAt: input.endsAt, maxAppointments: input.maxAppointments, notes: input.notes ?? null, isActive: true, createdBy: access.context.user.id, createdAt: now, updatedAt: now }).returning();
    await writeAudit(access.context, request, "staff_shift.created", "staff_shift", id, { branchId: input.branchId, staffId: input.staffId, shiftType: input.shiftType });
    return Response.json({ shift }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
