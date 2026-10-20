/**
 * Dates. A "day" is an integer count of days since 1970-01-01 (no time zone). An "instant" is epoch milliseconds.
 * The sandbox lives in America/New_York (spec 6, 11.5): local times come from Intl, never from the machine's zone.
 */
export type Day = number;
export const TZ = "America/New_York";
export const MS_DAY = 86_400_000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const WEDNESDAY = 3;

export function dayOf(year: number, month1: number, date: number): Day {
  return Math.round(Date.UTC(year, month1 - 1, date) / MS_DAY);
}

export function dayFromISO(iso: string): Day {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new Error(`bad ISO date: ${iso}`);
  return dayOf(Number(m[1]), Number(m[2]), Number(m[3]));
}

export function isoFromDay(day: Day): string {
  return new Date(day * MS_DAY).toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday */
export function weekday(day: Day): number {
  return (((day + 4) % 7) + 7) % 7;
}

export function ymd(day: Day): { year: number; month: number; date: number } {
  const d = new Date(day * MS_DAY);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, date: d.getUTCDate() };
}

/** "Wed Nov 11" */
export function fmtDay(day: Day): string {
  const p = ymd(day);
  return `${WEEKDAYS[weekday(day)]} ${MONTHS[p.month - 1]} ${p.date}`;
}

/** "Nov 11" */
export function fmtMonthDay(day: Day): string {
  const p = ymd(day);
  return `${MONTHS[p.month - 1]} ${p.date}`;
}

export function fmtWeekdayLong(day: Day): string {
  return WEEKDAYS_LONG[weekday(day)]!;
}

export function fmtMonthYear(day: Day): string {
  const p = ymd(day);
  return `${MONTHS[p.month - 1]} ${p.year}`;
}

/** Latest Wednesday on or before `day`. */
export function latestWednesdayOnOrBefore(day: Day): Day {
  return day - ((weekday(day) - WEDNESDAY + 7) % 7);
}

/** First Wednesday on or after `day`. */
export function nextWednesdayOnOrAfter(day: Day): Day {
  return day + ((WEDNESDAY - weekday(day) + 7) % 7);
}

export const addDays = (day: Day, n: number): Day => day + n;
export const between = (day: Day, from: Day, to: Day): boolean => day >= from && day <= to;

// ---- instants in America/New_York ----------------------------------------------------------------------------

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

export interface EtParts {
  day: Day;
  hour: number;
  minute: number;
  minuteOfDay: number;
}

export function etParts(ms: number): EtParts {
  const o: Record<string, number> = {};
  for (const p of partsFmt.formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { day: dayOf(o.year!, o.month!, o.day!), hour: o.hour!, minute: o.minute!, minuteOfDay: o.hour! * 60 + o.minute! };
}

/** Epoch ms for a local New York wall-clock time on `day` (handles the November change to standard time). */
export function etInstant(day: Day, hour: number, minute = 0): number {
  const naive = day * MS_DAY + (hour * 60 + minute) * 60_000;
  let guess = naive + 5 * 3_600_000;
  for (let i = 0; i < 3; i++) {
    const p = etParts(guess);
    const diff = (p.day - day) * 1440 + (p.minuteOfDay - (hour * 60 + minute));
    if (diff === 0) return guess;
    guess -= diff * 60_000;
  }
  return guess;
}

/** "10:02 am" */
export function fmtTime(ms: number): string {
  const p = etParts(ms);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}:${String(p.minute).padStart(2, "0")} ${p.hour < 12 ? "am" : "pm"}`;
}

/** "Sun Oct 18, 10:02 am" */
export function fmtDateTime(ms: number): string {
  return `${fmtDay(etParts(ms).day)}, ${fmtTime(ms)}`;
}

/** Relative to the sandbox clock: "just now", "12 min ago", "3 h ago", "yesterday", "Oct 12". */
export function relativeTime(ms: number, nowMs: number): string {
  const diff = nowMs - ms;
  if (diff < 0) {
    const mins = Math.round(-diff / 60_000);
    if (mins < 60) return `in ${mins} min`;
    if (etParts(ms).day === etParts(nowMs).day) return `today ${fmtTime(ms)}`;
    return fmtDateTime(ms);
  }
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  const a = etParts(ms).day;
  const b = etParts(nowMs).day;
  if (a === b) return `${Math.floor(diff / 3_600_000)} h ago`;
  if (b - a === 1) return `yesterday, ${fmtTime(ms)}`;
  return fmtMonthDay(a);
}

/** Quiet hours: none 9 pm - 8 am local (spec 7.3). */
export function inQuietHours(ms: number): boolean {
  const p = etParts(ms);
  return p.hour < 8 || p.hour >= 21;
}

/** The next instant at 8:00 local on or after `ms` if it falls in quiet hours, else `ms`. */
export function nextSendable(ms: number): number {
  if (!inQuietHours(ms)) return ms;
  const p = etParts(ms);
  return etInstant(p.hour < 8 ? p.day : p.day + 1, 8, 0);
}
