/** Day-granular calendar. A "day" is an integer count of days since 1970-01-01 (UTC); no timezone maths anywhere. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MS_DAY = 86_400_000;

export type Day = number;

export function dayOf(year: number, month1: number, date: number): Day {
  return Math.round(Date.UTC(year, month1 - 1, date) / MS_DAY);
}

export function parseISO(iso: string): Day {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`bad ISO date: ${iso}`);
  return dayOf(Number(m[1]), Number(m[2]), Number(m[3]));
}

export function toISO(day: Day): string {
  return new Date(day * MS_DAY).toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekday(day: Day): number {
  return (((day + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
}

export function parts(day: Day): { year: number; month: number; date: number } {
  const d = new Date(day * MS_DAY);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, date: d.getUTCDate() };
}

/** "Wed Oct 28" */
export function fmtShort(day: Day): string {
  const p = parts(day);
  return `${WEEKDAYS[weekday(day)]} ${MONTHS[p.month - 1]} ${p.date}`;
}

/** "Oct 28" */
export function fmtMonthDay(day: Day): string {
  const p = parts(day);
  return `${MONTHS[p.month - 1]} ${p.date}`;
}

/** "Wednesday" */
export function fmtWeekdayLong(day: Day): string {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][weekday(day)]!;
}

export function addDays(day: Day, n: number): Day {
  return day + n;
}

/** First day on or after `from` that falls on `shipWeekday` (0-6). */
export function nextShipDay(from: Day, shipWeekday: number): Day {
  const delta = (shipWeekday - weekday(from) + 7) % 7;
  return from + delta;
}

/** True when `day` is within [from, to] inclusive. */
export function between(day: Day, from: Day, to: Day): boolean {
  return day >= from && day <= to;
}
