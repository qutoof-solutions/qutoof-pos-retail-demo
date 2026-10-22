import { serverMessage } from "@/lib/i18n/p1-server-messages";
import { and, asc, eq, gte, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { branchMemberships, branches, staffAttendance, staffShifts } from "@/lib/db/schema";
import { calculateAttendanceMetrics, canCloseAttendanceForScope } from "@/lib/operations/attendance";
import { localDateKey } from "@/lib/time/timezone";
import { ApiError, errorResponse, requireOperationAccess, writeAudit } from "@/lib/server/operations";
import { requireBranchMembership } from "@/lib/server/branch-access";

export const runtime = "edge";
const staffRoles = ["business_admin", "owner", "admin", "reception", "receptionist", "provider", "doctor", "specialist", "storekeeper", "nurse"] as const;
const actionSchema = z.object({ action: z.enum(["clock_in", "clock_out"]), branchId: z.string().uuid(), shiftId: z.string().uuid().nullable().optional() });

function todayInTimezone(timezone: string): string {
  return localDateKey(new Date(), timezone);
}

export async function GET(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, staffRoles);
  if (!access.ok) return access.response;
  const workDate = todayInTimezone(access.context.tenant.timezone);
  const [branchesRows, attendanceRows, shifts] = await Promise.all([
    access.context.db.select({ id: branches.id, name: branches.name, nameAr: branches.nameAr, nameEn: branches.nameEn }).from(branches).innerJoin(branchMemberships, and(eq(branchMemberships.branchId, branches.id), eq(branchMemberships.userId, access.context.user.id), eq(branchMemberships.tenantId, access.context.tenantId))).where(and(eq(branches.tenantId, access.context.tenantId), eq(branches.isActive, true))).orderBy(asc(branches.name)),
    access.context.db.select().from(staffAttendance).where(and(eq(staffAttendance.tenantId, access.context.tenantId), eq(staffAttendance.staffId, access.context.user.id), eq(staffAttendance.workDate, workDate))).limit(1),
    access.context.db.select({ id: staffShifts.id, branchId: staffShifts.branchId, startsAt: staffShifts.startsAt, endsAt: staffShifts.endsAt, shiftType: staffShifts.shiftType, department: staffShifts.department }).from(staffShifts).where(and(eq(staffShifts.tenantId, access.context.tenantId), eq(staffShifts.staffId, access.context.user.id), eq(staffShifts.isActive, true), gte(staffShifts.endsAt, new Date()), lt(staffShifts.startsAt, new Date(Date.now() + 24 * 60 * 60 * 1000)))).orderBy(asc(staffShifts.startsAt)),
  ]);
  return Response.json({ workDate, branches: branchesRows, attendance: attendanceRows[0] ?? null, shifts }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireOperationAccess(request, staffRoles);
  if (!access.ok) return access.response;
  try {
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(serverMessage(request, "p1Server.attendance.invalidInput"));
    const input = parsed.data;
    await requireBranchMembership(access.context, input.branchId);
    const now = new Date();
    const workDate = todayInTimezone(access.context.tenant.timezone);
    const [existing] = await access.context.db.select().from(staffAttendance).where(and(eq(staffAttendance.tenantId, access.context.tenantId), eq(staffAttendance.staffId, access.context.user.id), eq(staffAttendance.workDate, workDate))).limit(1);
    if (input.action === "clock_in") {
      if (existing) throw new ApiError(existing.status === "open" ? serverMessage(request, "p1Server.attendance.alreadyCheckedIn") : serverMessage(request, "p1Server.attendance.dayClosed"), 409);
      let shift = null;
      if (input.shiftId) {
        [shift] = await access.context.db.select().from(staffShifts).where(and(eq(staffShifts.id, input.shiftId), eq(staffShifts.tenantId, access.context.tenantId), eq(staffShifts.staffId, access.context.user.id), eq(staffShifts.branchId, input.branchId), eq(staffShifts.isActive, true))).limit(1);
        if (!shift) throw new ApiError(serverMessage(request, "p1Server.attendance.invalidShift"), 400);
      } else {
        const candidates = await access.context.db.select().from(staffShifts).where(and(eq(staffShifts.tenantId, access.context.tenantId), eq(staffShifts.staffId, access.context.user.id), eq(staffShifts.branchId, input.branchId), eq(staffShifts.isActive, true), lt(staffShifts.startsAt, new Date(now.getTime() + 12 * 60 * 60 * 1000)), gte(staffShifts.endsAt, now))).orderBy(asc(staffShifts.startsAt)).limit(5);
        shift = candidates[0] ?? null;
      }
      const lateMinutes = shift ? calculateAttendanceMetrics(now, now, shift.startsAt).lateMinutes : 0;
      const id = crypto.randomUUID();
      const [created] = await access.context.db.insert(staffAttendance).values({ id, tenantId: access.context.tenantId, branchId: input.branchId, staffId: access.context.user.id, shiftId: shift?.id ?? null, workDate, clockIn: now, clockOut: null, totalMinutes: 0, lateMinutes, status: "open", createdAt: now, updatedAt: now }).returning();
      await writeAudit(access.context, request, "staff_attendance.clocked_in", "staff_attendance", id, { branchId: input.branchId, shiftId: shift?.id ?? null, workDate });
      return Response.json({ attendance: created }, { status: 201 });
    }
    if (!existing) throw new ApiError(serverMessage(request, "p1Server.attendance.notCheckedIn"), 409);
    if (existing.branchId !== input.branchId) throw new ApiError(serverMessage(request, "p1Server.attendance.branchMismatch"), 409);
    if (existing.status === "closed" || existing.clockOut) throw new ApiError(serverMessage(request, "p1Server.attendance.alreadyCheckedOut"), 409);
    const metrics = calculateAttendanceMetrics(existing.clockIn, now);
    if (!canCloseAttendanceForScope(existing, { tenantId: access.context.tenantId, staffId: access.context.user.id, branchId: input.branchId })) {
      throw new ApiError(serverMessage(request, "p1Server.attendance.checkoutNotAllowed"), 409);
    }
    const [updated] = await access.context.db.update(staffAttendance).set({ clockOut: now, status: "closed", totalMinutes: metrics.totalMinutes, updatedAt: now }).where(and(
      eq(staffAttendance.id, existing.id),
      eq(staffAttendance.tenantId, access.context.tenantId),
      eq(staffAttendance.staffId, access.context.user.id),
      eq(staffAttendance.branchId, existing.branchId),
      eq(staffAttendance.branchId, input.branchId),
      eq(staffAttendance.status, "open"),
      isNull(staffAttendance.clockOut),
    )).returning();
    if (!updated) throw new ApiError(serverMessage(request, "p1Server.attendance.checkoutFailed"), 409);
    await writeAudit(access.context, request, "staff_attendance.clocked_out", "staff_attendance", existing.id, { branchId: existing.branchId, workDate, totalMinutes: metrics.totalMinutes });
    return Response.json({ attendance: updated });
  } catch (error) { return errorResponse(error); }
}
