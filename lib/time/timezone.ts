export function localTimeToUtc(date: string, time: string, timezone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isInteger)) return null;
  const target = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const checkedDate = new Date(Date.UTC(year! , month! - 1, day!));
  if (checkedDate.getUTCFullYear() !== year || checkedDate.getUTCMonth() !== month! - 1 || checkedDate.getUTCDate() !== day) return null;
  let guess = target;
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      const represented = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute));
      const adjustment = target - represented;
      if (adjustment === 0) return new Date(guess);
      guess += adjustment;
    }
  } catch { return null; }
  return null;
}

export function localDateKey(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function safeLocalDateKey(value: Date, timezone: string): string | null {
  try {
    return localDateKey(value, timezone);
  } catch {
    return null;
  }
}

function nextDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + 1)).toISOString().slice(0, 10);
}

export function localDateRangeToUtc(from: string, to: string, timezone: string): { start: Date; end: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return null;
  const start = localTimeToUtc(from, "00:00", timezone);
  const end = localTimeToUtc(nextDate(to), "00:00", timezone);
  if (!start || !end || end.getTime() <= start.getTime() || end.getTime() - start.getTime() > 367 * 86_400_000) return null;
  return { start, end };
}
