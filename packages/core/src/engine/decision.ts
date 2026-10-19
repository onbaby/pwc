import type { Day } from "../calendar.ts";
import { DECISION } from "../constants.ts";
import type { Forecast } from "./forecast.ts";

export type Direction = "later" | "sooner" | "none";

export interface Eligibility {
  payAsYouGo: boolean;
  completedDeliveries: number;
  inDecemberFreeze: boolean;
  /** the number has replied in the last two cycles and the first proposal shows a delivery receipt */
  replyHistoryOk: boolean;
  /** days between the proposal text going out and the original delivery date */
  textLeadDays: number;
}

export interface DecisionInput {
  today: Day;
  currentArrival: Day;
  /** most recent actual delivery (anchors the [21, 84] day gap rule) */
  lastDelivery: Day;
  forecast: Forecast;
  graceDays?: number;
  /** earliest feasible new arrival (e.g. today + processing days) */
  minArrival: Day;
  eligibility: Eligibility;
}

export type DecisionAction = "hold_off" | "keep" | "propose";

export interface Decision {
  action: DecisionAction;
  /** "We hold off and ask": no fresh reply this cycle */
  abstain: boolean;
  direction: Direction;
  /** signed days actually applied (multiple of 7) */
  stepDays: number;
  /** signed days the service-level rule asked for before rounding and clamping */
  rawShiftDays: number;
  currentArrival: Day;
  newArrival: Day;
  /** a sooner move, or a later move that does not meet every default-accept guardrail, needs an explicit YES */
  requiresYes: boolean;
  /** a later move that goes ahead unless the customer replies OLD */
  defaultAccept: boolean;
  /** why the move is not allowed at all (pilot eligibility), if so */
  blocked?: "prepaid_or_gift" | "too_few_deliveries" | "december_freeze";
  /** which default-accept guardrails failed (empty when defaultAccept) */
  failedGuardrails: string[];
}

function eligibilityBlock(e: Eligibility): Decision["blocked"] | undefined {
  if (!e.payAsYouGo) return "prepaid_or_gift";
  if (e.completedDeliveries < DECISION.minCompletedDeliveries) return "too_few_deliveries";
  if (e.inDecemberFreeze) return "december_freeze";
  return undefined;
}

/**
 * Service-level rule (spec 6.3):
 *   target = today + Q_q(days left) + grace; step = round((target - current arrival)/7)*7, clamped to +/-14 days,
 *   resulting gap between deliveries inside [21, 84]. Moves only on a fresh reply this cycle.
 */
export function decide(input: DecisionInput): Decision {
  const { today, currentArrival, lastDelivery, forecast: fc, eligibility: el } = input;
  const grace = input.graceDays ?? DECISION.graceDays;
  const base: Decision = {
    action: "hold_off",
    abstain: false,
    direction: "none",
    stepDays: 0,
    rawShiftDays: 0,
    currentArrival,
    newArrival: currentArrival,
    requiresYes: false,
    defaultAccept: false,
    failedGuardrails: [],
  };

  const target = today + fc.qService + grace;
  const raw = target - currentArrival;
  base.rawShiftDays = Math.round(raw * 10) / 10;

  // Evidence gate: no fresh reply, no change.
  if (!fc.freshReply) return { ...base, action: "hold_off", abstain: true };

  const blocked = eligibilityBlock(el);
  if (blocked) return { ...base, action: "keep", blocked };

  let steps = Math.round(raw / 7);
  steps = Math.max(-DECISION.maxStepDays / 7, Math.min(DECISION.maxStepDays / 7, steps));
  let newArrival = currentArrival + steps * 7;
  const lo = lastDelivery + DECISION.gapMinDays;
  const hi = lastDelivery + DECISION.gapMaxDays;
  if (steps > 0) {
    newArrival = Math.min(newArrival, Math.max(hi, currentArrival));
  } else if (steps < 0) {
    newArrival = Math.max(newArrival, Math.min(lo, currentArrival));
    if (newArrival < input.minArrival) {
      // Pull forward only as far as is feasible, in whole weeks.
      const weeksNeeded = Math.ceil((input.minArrival - newArrival) / 7);
      newArrival += weeksNeeded * 7;
    }
    newArrival = Math.min(newArrival, currentArrival);
  }
  const step = newArrival - currentArrival;
  if (step === 0) return { ...base, action: "keep" };

  const direction: Direction = step > 0 ? "later" : "sooner";
  if (direction === "sooner") {
    return { ...base, action: "propose", direction, stepDays: step, newArrival, requiresYes: true };
  }

  // Later move: default-accept only when every guardrail holds (spec 6.3 a-f).
  const failed: string[] = [];
  if (fc.confidence === "Not yet sure") failed.push("confidence below Medium");
  if (el.textLeadDays < DECISION.defaultAcceptLeadDays) failed.push("proposal text under 7 days before the original date");
  if (!el.replyHistoryOk) failed.push("no reply history / delivery receipt");
  const defaultAccept = failed.length === 0;
  return {
    ...base,
    action: "propose",
    direction,
    stepDays: step,
    newArrival,
    defaultAccept,
    requiresYes: !defaultAccept,
    failedGuardrails: failed,
  };
}

/** A LOW or 0-weeks reply that implies running out well before the next delivery gets a same-day expedite offer. */
export function expediteOffer(weeks: number, daysToArrival: number): boolean {
  return weeks <= 1 && weeks * 7 + DECISION.lateDays < daysToArrival;
}
