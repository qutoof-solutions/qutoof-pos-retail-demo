export type ReminderKind = "reminder" | "reminder_3h";

export function getReminderSchedule(startsAt: Date, now = new Date()): Array<{ eventKind: ReminderKind; scheduledAt: Date }> {
  if (startsAt.getTime() <= now.getTime()) return [];
  const untilStart = startsAt.getTime() - now.getTime();
  const dayOffset = 24 * 60 * 60_000;
  const threeHourOffset = 3 * 60 * 60_000;
  const reminders: Array<{ eventKind: ReminderKind; scheduledAt: Date }> = [];

  if (untilStart > threeHourOffset) {
    const dayReminder = new Date(startsAt.getTime() - dayOffset);
    reminders.push({ eventKind: "reminder", scheduledAt: new Date(Math.max(now.getTime(), dayReminder.getTime())) });
  }
  const threeHourReminder = new Date(startsAt.getTime() - threeHourOffset);
  reminders.push({ eventKind: "reminder_3h", scheduledAt: new Date(Math.max(now.getTime(), threeHourReminder.getTime())) });
  return reminders;
}
