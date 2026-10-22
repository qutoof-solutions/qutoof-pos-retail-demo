import { and, eq, isNull, or } from "drizzle-orm";
import type { OperationContext } from "@/lib/server/operations";
import { scheduleExceptions, schedules } from "@/lib/db/schema";
import { checkStaffShiftAvailability } from "@/lib/operations/staff-shifts";

export interface LocalSlot {
  date: string;
  weekday: number;
  start: string;
  end: string;
}

/** Roles whose schedules may be used for public appointment booking. Keep this list in sync with public availability. */
export const APPOINTMENT_CAPABLE_ROLES = ["provider", "doctor", "specialist"] as const;
/** All active branch staff that an administrator may schedule. Non-clinical staff remain internal-only. */
export const SCHEDULE_PERSON_ROLES = ["provider", "doctor", "specialist", "reception", "receptionist", "storekeeper", "nurse", "admin", "owner"] as const;
export type SchedulePersonRole = typeof SCHEDULE_PERSON_ROLES[number];

export function isAppointmentCapableRole(role: string): boolean {
  return (APPOINTMENT_CAPABLE_ROLES as readonly string[]).includes(role);
}

/** Translation keys are coordinated with i18n owners; callers should provide a localized fallback until keys land. */
export function schedulePersonRoleTranslationKey(role: string): string {
  if (role === "provider" || role === "doctor" || role === "specialist") return `roles.${role}`;
  return "roles.employee";
}

export function isValidScheduleDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function getLocalSlot(start: Date, end: Date, timeZone: string): LocalSlot {
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error("وقت الموعد غير صالح");
  const dateParts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(start);
  const get = (parts: Intl.DateTimeFormatPart[], type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const date = `${get(dateParts, "year")}-${get(dateParts, "month")}-${get(dateParts, "day")}`;
  const timeParts = (value: Date) => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(value);
  const weekdayText = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(start);
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdays[weekdayText];
  if (!date || weekday === undefined) throw new Error("تعذر تحديد المنطقة الزمنية لمساحة العمل");
  return { date, weekday, start: timeParts(start), end: timeParts(end) };
}

export function isValidClock(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function intervalsOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return startA < endB && endA > startB;
}

export async function checkSlotAvailability(context: OperationContext, input: { branchId: string; providerId: string | null; start: Date; end: Date }): Promise<{ ok: true } | { ok: false; reason: string }> {
  const slot = getLocalSlot(input.start, input.end, context.tenant.timezone);
  if (input.providerId) {
    const shiftAvailability = await checkStaffShiftAvailability(context, { branchId: input.branchId, staffId: input.providerId, start: input.start, end: input.end });
    if (!shiftAvailability.ok) return shiftAvailability;
  }
  const candidates = await context.db.select().from(schedules).where(and(
    eq(schedules.tenantId, context.tenantId), eq(schedules.weekday, slot.weekday), eq(schedules.isAvailable, true),
    or(eq(schedules.branchId, input.branchId), isNull(schedules.branchId)),
    input.providerId ? or(eq(schedules.providerId, input.providerId), isNull(schedules.providerId)) : isNull(schedules.providerId),
  ));
  const matching = candidates.filter((row) => (!row.effectiveFrom || row.effectiveFrom <= slot.date) && (!row.effectiveTo || row.effectiveTo >= slot.date))
    .sort((a, b) => Number(Boolean(b.branchId)) - Number(Boolean(a.branchId)) + Number(Boolean(b.providerId)) - Number(Boolean(a.providerId)));
  const schedule = matching[0];
  if (!schedule || slot.start < schedule.startsAt || slot.end > schedule.endsAt) return { ok: false, reason: "الموعد خارج ساعات العمل؛ راجع جدول الفرع ومقدم الخدمة" };
  let breaks: Array<{ start: string; end: string }>;
  try {
    breaks = JSON.parse(schedule.breaksJson) as Array<{ start: string; end: string }>;
  } catch {
    return { ok: false, reason: "تعذر قراءة فترات الاستراحة في جدول العمل" };
  }
  if (breaks.some((item) => isValidClock(item.start) && isValidClock(item.end) && intervalsOverlap(slot.start, slot.end, item.start, item.end))) return { ok: false, reason: "الموعد يتعارض مع فترة استراحة" };
  const exceptions = await context.db.select().from(scheduleExceptions).where(and(
    eq(scheduleExceptions.tenantId, context.tenantId), eq(scheduleExceptions.date, slot.date),
    or(eq(scheduleExceptions.branchId, input.branchId), isNull(scheduleExceptions.branchId)),
    input.providerId ? or(eq(scheduleExceptions.providerId, input.providerId), isNull(scheduleExceptions.providerId)) : isNull(scheduleExceptions.providerId),
  ));
  const exception = exceptions.find((row) => !row.startsAt || !row.endsAt || intervalsOverlap(slot.start, slot.end, row.startsAt, row.endsAt));
  if (exception) return { ok: false, reason: exception.isEmergency ? `إغلاق طارئ: ${exception.reason}` : `لا يتوفر الموعد بسبب استثناء جدول: ${exception.reason}` };
  return { ok: true };
}
