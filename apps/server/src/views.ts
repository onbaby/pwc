import type { ForecastView, PantryView, PersonaSpec } from "@rot/contracts";
import { fmtShort, type Day, type Decision, type Forecast } from "@rot/core";

/** Pure view builders for the screens. Nothing here decides anything; it formats what the engine returned. */

export function forecastView(fc: Forecast, d: Decision, today: Day): ForecastView {
  return {
    asOfDay: today,
    runOut: { ...fc.runOutDays },
    windowLo: today + Math.round(fc.runOutDays.q10),
    windowMid: today + Math.round(fc.runOutDays.q50),
    windowHi: today + Math.round(fc.runOutDays.q90),
    ratio: fc.ratio,
    confidence: fc.confidence,
    freshReply: fc.freshReply,
    abstain: d.abstain,
    action: d.action,
    direction: d.direction,
    stepDays: d.stepDays,
    rawShiftDays: d.rawShiftDays,
    note: decisionNote(d),
  };
}

export function decisionNote(d: Decision): string {
  if (d.abstain) return "We hold off and ask. No answer, no change.";
  if (d.blocked === "too_few_deliveries") return "Not enough deliveries yet to change a date. Learning only.";
  if (d.blocked === "prepaid_or_gift") return "Prepaid and gift plans are never moved.";
  if (d.blocked === "december_freeze") return "December freeze: no date changes.";
  if (d.action === "keep") return "Keep the date.";
  const weeks = Math.abs(d.stepDays) / 7;
  const dir = d.direction === "later" ? "later" : "sooner";
  const cap = Math.abs(d.rawShiftDays) > Math.abs(d.stepDays) + 3.5 ? ` (${weeks === 2 ? "two" : weeks} weeks ${dir}: the most we move at once)` : ` (${weeks} week${weeks === 1 ? "" : "s"} ${dir})`;
  return `Was ${fmtShort(d.currentArrival)} → Now ${fmtShort(d.newArrival)}${cap}`;
}

/**
 * Synthetic truth for the pantry picture: days of coffee left, day by day, if the customer drinks one day of coffee per
 * day and one delivery lasts `truthDaysPerDelivery`. Never fed to the engine.
 */
export function pantryView(
  spec: PersonaSpec,
  deliveries: Day[],
  oldArrival: Day,
  currentArrival: Day,
  today: Day,
  cadence: number,
  endPadDays = 28,
): PantryView {
  const first = Math.min(...deliveries);
  const end = Math.max(oldArrival, currentArrival) + endPadDays;
  const fixedDeliveries = [...deliveries];
  for (let d = oldArrival; d <= end; d += cadence) fixedDeliveries.push(d);
  const currentDeliveries = [...deliveries];
  for (let d = currentArrival; d <= end; d += cadence) currentDeliveries.push(d);
  const T = spec.truthDaysPerDelivery;
  const run = (arrivals: Day[], from: Day, startR: number) => {
    const set = new Set(arrivals);
    const out = new Map<Day, number>();
    let R = startR;
    out.set(from, startR);
    for (let day = from + 1; day <= end; day++) {
      if (set.has(day)) R += T;
      R = Math.max(R - 1, 0);
      out.set(day, R);
    }
    return out;
  };
  const piles: Array<{ day: Day; days: number }> = [];
  // fixed schedule from the first delivery
  const fixedSet = new Set(fixedDeliveries);
  let R = T;
  const fixedOut = new Map<Day, number>();
  for (let day = first; day <= end; day++) {
    if (day > first && fixedSet.has(day)) {
      piles.push({ day, days: R });
      R += T;
    }
    R = Math.max(R - 1, 0);
    fixedOut.set(day, R);
  }
  // paced truth from today on, starting from the same pantry
  const startR = fixedOut.get(today) ?? 0;
  const pacedOut = run(currentDeliveries.filter((d) => d > today), today, startR);
  const points: PantryView["points"] = [];
  for (let day = first; day <= end; day++) {
    points.push({ day, fixed: round1(fixedOut.get(day) ?? 0), paced: day >= today ? round1(pacedOut.get(day) ?? 0) : undefined });
  }
  return { points, fixedDeliveries: dedupe(fixedDeliveries), currentDeliveries: dedupe(currentDeliveries), today, piles };
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const dedupe = (xs: Day[]) => [...new Set(xs)].sort((a, b) => a - b);
