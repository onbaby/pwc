import { fmtDateTime, fmtDay, fmtMonthDay, fmtTime, etParts, relativeTime, type Day } from "../shared/dates.ts";

export { fmtDateTime, fmtDay, fmtMonthDay, fmtTime, relativeTime, etParts };
export type { Day };

export const nf = (n: number, d = 0): string => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const usd = (n: number, d = 0): string => `${n < 0 ? "−" : ""}$${nf(Math.abs(n), d)}`;
export const pct = (x: number, d = 0): string => `${nf(x * 100, d)}%`;
export const signed = (n: number, d = 0): string => `${n > 0 ? "+" : n < 0 ? "−" : ""}${nf(Math.abs(n), d)}`;

export function range(lo: Day, hi: Day): string {
  return `${fmtMonthDay(lo)} – ${fmtMonthDay(hi)}`;
}
