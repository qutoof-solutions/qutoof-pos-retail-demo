const DAY_MS = 86_400_000;

export function getRemainingTrialDays(endsAt: string | number | Date | null | undefined, now: number = Date.now()): number | null {
  if (endsAt == null) return null;
  const endTime = endsAt instanceof Date ? endsAt.getTime() : new Date(endsAt).getTime();
  if (!Number.isFinite(endTime) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.ceil((endTime - now) / DAY_MS));
}
