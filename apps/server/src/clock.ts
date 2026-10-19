import type { Day } from "@rot/core";

/** Virtual clock (spec 3). Minutes since 1970-01-01 00:00, treated as recipient-local time. Never uses setTimeout. */
export const MIN_PER_DAY = 1440;

export class DemoClock {
  private m: number;
  constructor(startMinute: number) {
    this.m = startMinute;
  }
  get minute(): number {
    return this.m;
  }
  get day(): Day {
    return Math.floor(this.m / MIN_PER_DAY);
  }
  get minuteOfDay(): number {
    return this.m - this.day * MIN_PER_DAY;
  }
  get hour(): number {
    return Math.floor(this.minuteOfDay / 60);
  }
  hhmm(minute = this.m): string {
    const mod = minute - Math.floor(minute / MIN_PER_DAY) * MIN_PER_DAY;
    return `${String(Math.floor(mod / 60)).padStart(2, "0")}:${String(mod % 60).padStart(2, "0")}`;
  }
  /** Set the time without processing anything (internal; the world processes due items itself). */
  set(minute: number): void {
    this.m = minute;
  }
}

export function minuteOf(day: Day, hhmm: string): number {
  const [h, mm] = hhmm.split(":").map(Number);
  return day * MIN_PER_DAY + h! * 60 + mm!;
}

/** Quiet hours: none 9 pm - 8 am recipient time. */
export function inQuietHours(minute: number): boolean {
  const mod = minute - Math.floor(minute / MIN_PER_DAY) * MIN_PER_DAY;
  return mod < 8 * 60 || mod >= 21 * 60;
}

/** The next minute at 08:00 on or after `minute` when it falls in quiet hours (else `minute`). */
export function nextSendableMinute(minute: number): number {
  if (!inQuietHours(minute)) return minute;
  const day = Math.floor(minute / MIN_PER_DAY);
  const mod = minute - day * MIN_PER_DAY;
  return mod < 8 * 60 ? day * MIN_PER_DAY + 8 * 60 : (day + 1) * MIN_PER_DAY + 8 * 60;
}
