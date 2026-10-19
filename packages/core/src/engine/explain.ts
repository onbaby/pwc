import { fmtMonthDay, fmtShort, type Day } from "../calendar.ts";
import type { Decision, DecisionInput } from "./decision.ts";
import { decide } from "./decision.ts";
import { forecastFromFilter, type Forecast } from "./forecast.ts";
import type { PantryFilter, ThetaPrior } from "./pantry.ts";

export interface WhatIfRow {
  weeks: number;
  stepDays: number;
  newArrival: Day;
  action: Decision["action"];
}

/** What would each possible reply (0..12 weeks) do? Uses clones of the filter, never the live one. */
export function whatIfReplies(
  filterBeforeReply: PantryFilter,
  base: Omit<DecisionInput, "forecast">,
  serviceQ: number,
  weeksList: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12],
): WhatIfRow[] {
  return weeksList.map((weeks) => {
    const f = filterBeforeReply.clone();
    f.observeWeeks(weeks);
    const fc = forecastFromFilter(f, base.today, true, serviceQ);
    const d = decide({ ...base, forecast: fc });
    return { weeks, stepDays: d.stepDays, newArrival: d.newArrival, action: d.action };
  });
}

export interface ExplanationInput {
  name: string;
  /** e.g. "2-person home, pour-over, in-cafe signup, 4-week deliveries" */
  descriptor: string;
  prior: ThetaPrior;
  replyWeeks?: number;
  replyDay?: Day;
  forecast: Forecast;
  decision: Decision;
  oldArrival: Day;
  whatIf: WhatIfRow[];
}

export interface ExplanationCard {
  startingPoint: { text: string; tag: string };
  evidence: { text: string };
  whatChangesIt: { text: string };
  /** "When will X run out of coffee? Most likely Nov 11; very likely between Nov 5 and Nov 18" */
  rangeTitle: string;
}

function weeksWord(n: number): string {
  return n === 1 ? "1 week" : `${n} weeks`;
}

/** Template explanation card; every number comes from the engine (spec 6.5). */
export function explain(input: ExplanationInput): ExplanationCard {
  const { name, forecast: fc, decision, prior, whatIf } = input;
  const priorWeeks = Math.round(Math.exp(prior.mu) / 7);
  const asOf = fc.asOf;
  const keep = whatIf.filter((w) => w.stepDays === 0 && w.action !== "hold_off").map((w) => w.weeks);
  let whatChanges: string;
  if (keep.length === 0) {
    whatChanges = `Any answer from 0 to 12 weeks would move ${name}'s date.`;
  } else if (keep.length === 1) {
    whatChanges = `If ${name} says ${weeksWord(keep[0]!)}, we would keep the date.`;
  } else {
    whatChanges = `If ${name} says ${keep[0]} to ${weeksWord(keep[keep.length - 1]!)}, we would keep the date.`;
  }
  const evidence =
    input.replyWeeks !== undefined && input.replyDay !== undefined
      ? `On ${fmtMonthDay(input.replyDay)}, ${name} said about ${weeksWord(input.replyWeeks)} left.`
      : `No reply from ${name} this cycle, so there is no change.`;
  const mid = asOf + fc.runOutDays.q50;
  const lo = asOf + fc.runOutDays.q10;
  const hi = asOf + fc.runOutDays.q90;
  const rangeTitle = `When will ${name} run out of coffee? Most likely ${fmtMonthDay(Math.round(mid))}; very likely between ${fmtMonthDay(Math.round(lo))} and ${fmtMonthDay(Math.round(hi))}`;
  void decision;
  return {
    startingPoint: {
      text: `People like ${name} (${input.descriptor}) usually take about ${priorWeeks} weeks per delivery.`,
      tag: "assumed prior, synthetic",
    },
    evidence: { text: evidence },
    whatChangesIt: { text: whatChanges },
    rangeTitle,
  };
}

export function describeMove(d: Decision): string {
  if (d.direction === "none") return "No change";
  const dir = d.direction === "later" ? "later" : "sooner";
  return `${fmtShort(d.currentArrival)} to ${fmtShort(d.newArrival)} (${Math.abs(d.stepDays / 7)} week${Math.abs(d.stepDays) === 7 ? "" : "s"} ${dir})`;
}
