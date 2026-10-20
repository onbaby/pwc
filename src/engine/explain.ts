import { fmtDay, fmtMonthDay, type Day } from "../shared/dates.ts";
import type { CheckCode, Confidence, Direction, RuleTraceItem, TraceCode } from "./decision.ts";

/** Plain-English sentences for every rule code (spec 7.4, 11.6). No Greek letters, particles or quantile names. */

export const HOW_SURE_KEY: Record<Confidence, string> = {
  High: "High ≈ the range is within ±25%",
  Medium: "Medium ≈ the range is within ±50%",
  "Not yet sure": "Not yet sure: no reply this cycle, or the range is too wide",
};

export function checkSentence(code: TraceCode, ok: boolean | null, value?: number): string {
  switch (code) {
    case "REPLIED_THIS_CYCLE":
      return ok ? "replied this cycle" : "no reply this cycle";
    case "CONFIDENCE_OK":
      return ok ? "how sure is Medium or better" : "how sure is below Medium";
    case "NOTICE_7_DAYS":
      return ok ? `${value} days' notice` : `only ${value} days' notice (7 needed)`;
    case "REMINDER_SCHEDULED":
      return ok ? "reminder set 3 days before the new date" : "no room for a reminder 3 days before the new date";
    case "DELIVERED_RECEIPT":
      return ok ? "earlier texts were delivered" : "earlier texts not confirmed delivered, or no recent replies";
    case "PAYG_ELIGIBLE":
      return ok ? "pay-as-you-go with 2+ deliveries" : "not pay-as-you-go, or fewer than 2 deliveries";
    case "NOT_IN_FREEZE":
      return ok ? "not in the holiday freeze" : "falls in the holiday freeze";
    case "SOONER_NEEDS_YES":
      return "a sooner delivery always needs the customer's YES (and staff approval first)";
    case "NO_ANSWER_NO_CHANGE":
      return "no answer, no change";
    case "TOO_FEW_DELIVERIES":
      return `only ${value ?? 0} completed deliver${value === 1 ? "y" : "ies"}: too early to change a date`;
    case "STEP_CLAMPED":
      return "limited to two weeks at a time";
    case "GAP_CLAMPED":
      return "kept between 3 and 12 weeks after the last delivery";
    case "ALREADY_ON_TARGET":
      return "the date already fits";
  }
}

export interface CheckLine {
  ok: boolean;
  text: string;
}

/** The guardrail checks that apply to a later move, as lines for "Why this date" and "Why we sent this". */
export function checkLines(trace: readonly RuleTraceItem[]): CheckLine[] {
  const gate: TraceCode[] = ["REPLIED_THIS_CYCLE", "CONFIDENCE_OK", "NOTICE_7_DAYS", "REMINDER_SCHEDULED", "DELIVERED_RECEIPT", "PAYG_ELIGIBLE", "NOT_IN_FREEZE"];
  return trace.filter((t) => gate.includes(t.code) && t.ok !== null).map((t) => ({ ok: t.ok === true, text: checkSentence(t.code, t.ok, t.value) }));
}

export interface WhatIfRow {
  weeks: number;
  direction: Direction;
  to: Day;
  autoSend: boolean;
}

/** "If Maya says 2 weeks, we'd keep Wed Oct 28 (or offer sooner for approval); 4 weeks: Wed Nov 4 ..." */
export function whatWouldChange(name: string, base: Day, rows: readonly WhatIfRow[]): string {
  if (rows.length === 0) return `Any reply from ${name} would be checked against the same rules.`;
  const pick = (w: number) => rows.find((r) => r.weeks === w);
  const label = (r: WhatIfRow) => (r.direction === "none" ? `keep ${fmtDay(base)}` : r.direction === "later" ? `move to ${fmtDay(r.to)}` : `offer ${fmtDay(r.to)} for approval`);
  const parts: string[] = [];
  for (const w of [0, 1, 2, 4, 6, 8]) {
    const r = pick(w);
    if (r) parts.push(`${w} week${w === 1 ? "" : "s"}: ${label(r)}`);
  }
  return `If ${name} replies differently: ${parts.join("; ")}.`;
}

export interface WhySentInput {
  runOutLo: Day;
  runOutMid: Day;
  runOutHi: Day;
  confidence: Confidence;
  checks: readonly CheckLine[];
  atText: string;
}

/** "Runs out around Dec 2 (likely Nov 16 – Dec 24) · How sure: Medium · Checks passed: ... · Sun Oct 18, 10:02 am" */
export function whySentSentence(i: WhySentInput): string {
  const passed = i.checks.filter((c) => c.ok).map((c) => `${c.text} ✓`);
  const failed = i.checks.filter((c) => !c.ok).map((c) => `${c.text} ✗`);
  const checks = [...passed, ...failed].join(", ");
  return `Runs out around ${fmtMonthDay(i.runOutMid)} (likely ${fmtMonthDay(i.runOutLo)} – ${fmtMonthDay(i.runOutHi)}) · How sure: ${i.confidence}${checks ? ` · Checks: ${checks}` : ""} · ${i.atText}`;
}

/** Title generated from the model: "Most likely runs out around Dec 2 (likely between Nov 16 and Dec 24)". */
export function pantryTitle(mid: Day, lo: Day, hi: Day): string {
  return `Most likely runs out around ${fmtMonthDay(mid)} (likely between ${fmtMonthDay(lo)} and ${fmtMonthDay(hi)})`;
}

export function startingPointText(name: string, descriptor: string, priorMedianDays: number): string {
  const weeks = Math.round(priorMedianDays / 7);
  return `People like ${name} (${descriptor}) usually take about ${weeks} weeks per delivery.`;
}

export function evidenceText(name: string, reply?: { dayText: string; weeks: number }): string {
  return reply ? `On ${reply.dayText}, ${name} said about ${reply.weeks} week${reply.weeks === 1 ? "" : "s"} left.` : `No reply from ${name} yet: projection based on similar customers.`;
}
