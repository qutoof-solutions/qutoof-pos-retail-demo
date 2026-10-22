import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { appointments, staffShifts } from "@/lib/db/schema";
import type { OperationContext } from "@/lib/server/operations";

const activeAppointmentStatuses = ["pending", "confirmed", "waiting", "in_progress"] as const;
export type ShiftType = "morning" | "evening" | "night";

export async function checkStaffShiftAvailability(context: OperationContext, input: { branchId: string; staffId: string; start: Date; end: Date; excludeAppointmentId?: string }): Promise<{ ok: true; shiftId?: string } | { ok: false; reason: string }> {
  const configured = await context.db.select({ id: staffShifts.id }).from(staffShifts).where(and(eq(staffShifts.tenantId, context.tenantId), eq(staffShifts.branchId, input.branchId), eq(staffShifts.staffId, input.staffId), eq(staffShifts.isActive, true))).limit(1);
  if (!configured.length) return { ok: true };
  const shifts = await context.db.select().from(staffShifts).where(and(eq(staffShifts.tenantId, context.tenantId), eq(staffShifts.branchId, input.branchId), eq(staffShifts.staffId, input.staffId), eq(staffShifts.isActive, true), lt(staffShifts.startsAt, input.end), gte(staffShifts.endsAt, input.end))).limit(10);
  const shift = shifts.find((row) => row.startsAt <= input.start && row.endsAt >= input.end);
  if (!shift) return { ok: false, reason: "الموعد خارج الوردية الفعلية المسجلة لمقدم الخدمة" };
  if (shift.maxAppointments > 0) {
    const booked = await context.db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.tenantId, context.tenantId), eq(appointments.branchId, input.branchId), eq(appointments.providerId, input.staffId), gte(appointments.startsAt, shift.startsAt), lt(appointments.endsAt, shift.endsAt), inArray(appointments.status, [...activeAppointmentStatuses])));
    const count = booked.filter((row) => row.id !== input.excludeAppointmentId).length;
    if (count >= shift.maxAppointments) return { ok: false, reason: "اكتملت السعة القصوى للمواعيد في هذه الوردية" };
  }
  return { ok: true, shiftId: shift.id };
}
