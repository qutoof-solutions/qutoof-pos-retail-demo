const DAY_MS = 24 * 60 * 60 * 1000;

export function extendMembershipEndAt(currentEndAt: Date, freezeDays: number): Date {
  if (!Number.isInteger(freezeDays) || freezeDays < 1 || freezeDays > 365) {
    throw new RangeError("Freeze duration must be an integer between 1 and 365 days");
  }
  return new Date(currentEndAt.getTime() + freezeDays * DAY_MS);
}
