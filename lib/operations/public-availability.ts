import { and, asc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import { appointments, branchMemberships, branches, scheduleExceptions, schedules, staffShifts, users } from "@/lib/db/schema";
import type { getDb } from "@/lib/db/client";
import { intervalsOverlap, isValidClock } from "@/lib/operations/scheduling";
import { localDateKey, localTimeToUtc } from "@/lib/time/timezone";

type Db = ReturnType<typeof getDb>;
const activeStatuses = ["pending", "confirmed", "waiting", "in_progress"] as const;
export const PUBLIC_PROVIDER_ROLES = ["provider", "doctor", "specialist"] as const;

export interface PublicProvider { id: string; fullName: string; }
export interface PublicSlot { startsAt: string; endsAt: string; providerId: string; }

/** Return active clinical staff who belong to an active branch in this tenant. */
export async function getPublicBookingProviders(input: { db: Db; tenantId: string; branchId?: string }): Promise<PublicProvider[]> {
  const conditions = [
    eq(users.tenantId, input.tenantId),
    eq(users.isActive, true),
    inArray(users.role, [...PUBLIC_PROVIDER_ROLES]),
    eq(branchMemberships.tenantId, input.tenantId),
    eq(branches.tenantId, input.tenantId),
    eq(branches.isActive, true),
    ...(input.branchId ? [eq(branchMemberships.branchId, input.branchId)] : []),
  ];
  return input.db.selectDistinct({ id: users.id, fullName: users.fullName })
    .from(users)
    .innerJoin(branchMemberships, and(eq(branchMemberships.userId, users.id), eq(branchMemberships.tenantId, input.tenantId)))
    .innerJoin(branches, and(eq(branches.id, branchMemberships.branchId), eq(branches.tenantId, input.tenantId)))
    .where(and(...conditions))
    .orderBy(asc(users.fullName));
}

export async function getPublicAvailableSlots(input: { db: Db; tenantId: string; timezone: string; date: string; branchId: string; durationMinutes: number; providerIds: Array<{ id: string }>; requestedProviderId?: string | null }): Promise<PublicSlot[]> {
  const day = new Date(`${input.date}T00:00:00.000Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== input.date) return [];
  const weekday = day.getUTCDay();
  const branchProviders = await getPublicBookingProviders({ db: input.db, tenantId: input.tenantId, branchId: input.branchId });
  const eligibleIds = new Set(branchProviders.map((provider) => provider.id));
  const candidateIds = (input.requestedProviderId
    ? input.providerIds.filter((provider) => provider.id === input.requestedProviderId)
    : input.providerIds
  ).map((provider) => provider.id).filter((providerId) => eligibleIds.has(providerId));
  if (!candidateIds.length) return [];
  const [scheduleRows, exceptions, staffShiftsRows, existing] = await Promise.all([
    input.db.select().from(schedules).where(and(eq(schedules.tenantId, input.tenantId), eq(schedules.weekday, weekday), eq(schedules.isAvailable, true), or(eq(schedules.branchId, input.branchId), isNull(schedules.branchId)), or(inArray(schedules.providerId, candidateIds), isNull(schedules.providerId)))),
    input.db.select().from(scheduleExceptions).where(and(eq(scheduleExceptions.tenantId, input.tenantId), eq(scheduleExceptions.date, input.date), or(eq(scheduleExceptions.branchId, input.branchId), isNull(scheduleExceptions.branchId)), or(inArray(scheduleExceptions.providerId, candidateIds), isNull(scheduleExceptions.providerId)))),
    input.db.select().from(staffShifts).where(and(eq(staffShifts.tenantId, input.tenantId), eq(staffShifts.branchId, input.branchId), eq(staffShifts.isActive, true), inArray(staffShifts.staffId, candidateIds), lt(staffShifts.startsAt, localTimeToUtc(input.date, "23:59", input.timezone) ?? new Date(0)), gt(staffShifts.endsAt, localTimeToUtc(input.date, "00:00", input.timezone) ?? new Date(0)))),
    (async () => {
      const start = localTimeToUtc(input.date, "00:00", input.timezone);
      const nextDate = new Date(day.getTime() + 86_400_000).toISOString().slice(0, 10);
      const end = localTimeToUtc(nextDate, "00:00", input.timezone);
      if (!start || !end) return [];
      return input.db.select({ providerId: appointments.providerId, startsAt: appointments.startsAt, endsAt: appointments.endsAt }).from(appointments).where(and(eq(appointments.tenantId, input.tenantId), inArray(appointments.providerId, candidateIds), inArray(appointments.status, [...activeStatuses]), lt(appointments.startsAt, end), gt(appointments.endsAt, start)));
    })(),
  ]);

  const configuredShiftStaff = new Set(staffShiftsRows.map((row) => row.staffId));
  const slotResults: PublicSlot[] = [];
  const now = Date.now() + 15 * 60_000;
  for (let minute = 6 * 60; minute <= 22 * 60; minute += 15) {
    const startClock = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    const endMinute = minute + input.durationMinutes;
    const endClock = `${String(Math.floor(endMinute / 60)).padStart(2, "0")}:${String(endMinute % 60).padStart(2, "0")}`;
    if (endMinute > 24 * 60) continue;
    const start = localTimeToUtc(input.date, startClock, input.timezone);
    const end = endMinute === 24 * 60 ? localTimeToUtc(new Date(day.getTime() + 86_400_000).toISOString().slice(0, 10), "00:00", input.timezone) : localTimeToUtc(input.date, endClock, input.timezone);
    if (!start || !end || start.getTime() < now) continue;

    for (const providerId of candidateIds) {
      const matchingSchedules = scheduleRows.filter((row) => (row.providerId === null || row.providerId === providerId) && (!row.effectiveFrom || row.effectiveFrom <= input.date) && (!row.effectiveTo || row.effectiveTo >= input.date))
        .sort((a, b) => (Number(Boolean(b.branchId)) * 2 + Number(Boolean(b.providerId))) - (Number(Boolean(a.branchId)) * 2 + Number(Boolean(a.providerId))));
      const workSchedule = matchingSchedules[0];
      if (!workSchedule || startClock < workSchedule.startsAt || endClock > workSchedule.endsAt) continue;
      const shiftRows = staffShiftsRows.filter((row) => row.staffId === providerId);
      if (configuredShiftStaff.has(providerId)) {
        const matchingShift = shiftRows.find((row) => row.startsAt <= start && row.endsAt >= end);
        if (!matchingShift) continue;
        if (matchingShift.maxAppointments > 0 && existing.filter((item) => item.providerId === providerId && item.startsAt >= matchingShift.startsAt && item.endsAt <= matchingShift.endsAt).length >= matchingShift.maxAppointments) continue;
      }
      let breaks: Array<{ start: string; end: string }>;
      try { breaks = JSON.parse(workSchedule.breaksJson) as Array<{ start: string; end: string }>; }
      catch { continue; }
      if (breaks.some((item) => isValidClock(item.start) && isValidClock(item.end) && intervalsOverlap(startClock, endClock, item.start, item.end))) continue;
      const blocked = exceptions.some((item) => (item.providerId === null || item.providerId === providerId) && (!item.startsAt || !item.endsAt || intervalsOverlap(startClock, endClock, item.startsAt, item.endsAt)));
      if (blocked) continue;
      const conflict = existing.some((item) => item.providerId === providerId && item.startsAt < end && item.endsAt > start);
      if (conflict) continue;
      slotResults.push({ startsAt: start.toISOString(), endsAt: end.toISOString(), providerId });
      break;
    }
  }
  return slotResults;
}

export function isLocalDateWithinBookingWindow(date: string, timezone: string, now = new Date()): boolean {
  const today = localDateKey(now, timezone);
  const selected = new Date(`${date}T00:00:00.000Z`);
  const start = new Date(`${today}T00:00:00.000Z`);
  if (!Number.isFinite(selected.getTime()) || selected.toISOString().slice(0, 10) !== date) return false;
  const days = Math.floor((selected.getTime() - start.getTime()) / 86_400_000);
  return days >= 0 && days <= 90;
}
