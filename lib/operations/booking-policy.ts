export type BookingPolicy = {
  cancellationLeadMinutes: number;
  maxReschedules: number;
  depositRequired: boolean;
  depositPercentBps: number;
};

export const DEFAULT_BOOKING_POLICY: Readonly<BookingPolicy> = Object.freeze({
  cancellationLeadMinutes: 120,
  maxReschedules: 3,
  depositRequired: false,
  depositPercentBps: 0,
});

export function normalizeBookingPolicy(value: Partial<BookingPolicy> | null | undefined): BookingPolicy {
  const cancellationLeadMinutes = value?.cancellationLeadMinutes;
  const maxReschedules = value?.maxReschedules;
  const depositPercentBps = value?.depositPercentBps;
  const validDepositPercent = Number.isInteger(depositPercentBps) && depositPercentBps! >= 0 && depositPercentBps! <= 10_000;
  return {
    cancellationLeadMinutes: Number.isInteger(cancellationLeadMinutes) && cancellationLeadMinutes! >= 0 && cancellationLeadMinutes! <= 10_080 ? cancellationLeadMinutes! : DEFAULT_BOOKING_POLICY.cancellationLeadMinutes,
    maxReschedules: Number.isInteger(maxReschedules) && maxReschedules! >= 0 && maxReschedules! <= 10 ? maxReschedules! : DEFAULT_BOOKING_POLICY.maxReschedules,
    depositRequired: value?.depositRequired === true && validDepositPercent && depositPercentBps! > 0,
    depositPercentBps: validDepositPercent ? depositPercentBps! : DEFAULT_BOOKING_POLICY.depositPercentBps,
  };
}

export function isWithinBookingChangeWindow(startsAt: Date | number, now: Date | number, leadMinutes: number): boolean {
  const startMs = startsAt instanceof Date ? startsAt.getTime() : startsAt;
  const nowMs = now instanceof Date ? now.getTime() : now;
  return startMs >= nowMs + Math.max(0, leadMinutes) * 60_000;
}

export function isRescheduleAllowed(rescheduleCount: number, maxReschedules: number): boolean {
  return Number.isInteger(rescheduleCount) && Number.isInteger(maxReschedules) && rescheduleCount >= 0 && maxReschedules >= 0 && rescheduleCount < maxReschedules;
}

export function calculateDepositMinor(totalMinor: number, depositPercentBps: number): number {
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0 || !Number.isInteger(depositPercentBps) || depositPercentBps < 0 || depositPercentBps > 10_000) {
    throw new RangeError("Invalid invoice total or deposit percentage");
  }
  return Math.ceil((totalMinor * depositPercentBps) / 10_000);
}
