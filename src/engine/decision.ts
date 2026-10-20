import { ENGINE } from "../shared/constants.ts";
import { latestWednesdayOnOrBefore, nextWednesdayOnOrAfter, type Day } from "../shared/dates.ts";

export type Confidence = "High" | "Medium" | "Not yet sure";
export type Direction = "later" | "sooner" | "none";

export interface RunOut {
  q05: number;
  q10: number;
  q33: number;
  q50: number;
  q90: number;
}

/** "How sure": ratio = (q90 + 7) / (q10 + 7); High needs a fresh reply and ratio <= 1.6, Medium <= 3.0 (spec 7.3). */
export function confidenceOf(q10: number, q90: number, freshReply: boolean): Confidence {
  if (!freshReply) return "Not yet sure";
  const ratio = (q90 + ENGINE.ratioOffset) / (q10 + ENGINE.ratioOffset);
  if (ratio <= ENGINE.ratioHigh) return "High";
  if (ratio <= ENGINE.ratioMedium) return "Medium";
  return "Not yet sure";
}

export const ratioOf = (q10: number, q90: number): number => (q90 + ENGINE.ratioOffset) / (q10 + ENGINE.ratioOffset);

export type CheckCode =
  | "REPLIED_THIS_CYCLE"
  | "CONFIDENCE_OK"
  | "NOTICE_7_DAYS"
  | "REMINDER_SCHEDULED"
  | "DELIVERED_RECEIPT"
  | "PAYG_ELIGIBLE"
  | "NOT_IN_FREEZE"
  | "SOONER_NEEDS_YES";

export type TraceCode = CheckCode | "NO_ANSWER_NO_CHANGE" | "TOO_FEW_DELIVERIES" | "STEP_CLAMPED" | "GAP_CLAMPED" | "ALREADY_ON_TARGET";

export interface RuleTraceItem {
  code: TraceCode;
  /** true = passed, false = failed, null = informational */
  ok: boolean | null;
  /** days, counts etc. for the sentence */
  value?: number;
}

export interface DecisionInput {
  today: Day;
  /** the arrival date at the start of this cycle (the "original date") */
  baseArrival: Day;
  lastDelivery: Day;
  runOut: RunOut;
  confidence: Confidence;
  /** a customer reply this cycle, a staff action or the customer's own request triggered the evaluation */
  trigger: "reply" | "staff" | "customer" | "none";
  /** days-left quantile at the cautiousness level in use (Balanced = q10); defaults to q10 */
  serviceQuantile?: number;
  plan: { payAsYouGo: boolean; completedDeliveries: number };
  freeze: { from: Day; to: Day };
  /** the proposal text shows delivered; from the third proposal on, also a reply in the previous two cycles */
  proposalCount: number;
  deliveredReceipt: boolean;
  repliedInPreviousTwoCycles: boolean;
}

export interface ProposalOut {
  from: Day;
  to: Day;
  direction: Direction;
  step: number;
  autoSend: boolean;
  blockedBy: CheckCode[];
}

export interface DecisionOut {
  proposal: ProposalOut;
  trace: RuleTraceItem[];
  holdingOff: boolean;
}

const inWindow = (d: Day, w: { from: Day; to: Day }) => d >= w.from && d <= w.to;

/**
 * Decision rule (spec 7.3). target = today + Q(run-out) + 3-day grace; new arrival = the latest Wednesday on or before
 * the target; at most 14 days either way from the original date; gap between deliveries inside [21, 84] days.
 * No answer, no change. Later moves go automatically only if every guardrail passes; everything else waits for a person.
 */
export function decide(input: DecisionInput): DecisionOut {
  const { today, baseArrival, lastDelivery } = input;
  const trace: RuleTraceItem[] = [];
  const none = (): ProposalOut => ({ from: baseArrival, to: baseArrival, direction: "none", step: 0, autoSend: false, blockedBy: [] });
  const fresh = input.trigger === "reply";

  if (input.plan.completedDeliveries < ENGINE.minCompletedDeliveries) {
    trace.push({ code: "TOO_FEW_DELIVERIES", ok: false, value: input.plan.completedDeliveries });
    return { proposal: none(), trace, holdingOff: !fresh };
  }
  if (input.trigger === "none") {
    trace.push({ code: "NO_ANSWER_NO_CHANGE", ok: null });
    return { proposal: none(), trace, holdingOff: true };
  }

  const qRun = input.serviceQuantile ?? input.runOut.q10;
  const target = today + qRun + ENGINE.graceDays;
  let to = latestWednesdayOnOrBefore(target);
  let step = to - baseArrival;
  const clamped = Math.max(-ENGINE.maxStepDays, Math.min(ENGINE.maxStepDays, step));
  if (clamped !== step) trace.push({ code: "STEP_CLAMPED", ok: null, value: clamped });
  step = clamped;
  to = baseArrival + step;

  // gap between deliveries stays inside [21, 84] days
  const lo = lastDelivery + ENGINE.gapMinDays;
  const hi = lastDelivery + ENGINE.gapMaxDays;
  const before = to;
  if (step > 0) to = Math.min(to, Math.max(hi, baseArrival));
  else if (step < 0) {
    to = Math.max(to, Math.min(lo, baseArrival));
    const minArrival = nextWednesdayOnOrAfter(today + ENGINE.minLeadDays);
    to = Math.max(to, Math.min(minArrival, baseArrival));
  }
  if (to !== before) trace.push({ code: "GAP_CLAMPED", ok: null, value: to - baseArrival });
  step = to - baseArrival;

  if (step === 0) {
    trace.push({ code: "ALREADY_ON_TARGET", ok: null });
    return { proposal: { ...none(), to: baseArrival }, trace, holdingOff: false };
  }

  const direction: Direction = step > 0 ? "later" : "sooner";
  const blocked: CheckCode[] = [];
  const check = (code: CheckCode, ok: boolean, value?: number): void => {
    trace.push({ code, ok, value });
    if (!ok) blocked.push(code);
  };

  if (direction === "sooner") {
    trace.push({ code: "SOONER_NEEDS_YES", ok: null });
    return { proposal: { from: baseArrival, to, direction, step, autoSend: false, blockedBy: ["SOONER_NEEDS_YES"] }, trace, holdingOff: false };
  }

  // later move: the guardrails (a) - (f)
  check("REPLIED_THIS_CYCLE", fresh);
  check("CONFIDENCE_OK", input.confidence !== "Not yet sure");
  check("NOTICE_7_DAYS", baseArrival - today >= ENGINE.autoLeadDays, baseArrival - today);
  check("REMINDER_SCHEDULED", to - ENGINE.reminderDaysBefore > today);
  const receiptOk = input.deliveredReceipt && (input.proposalCount < 2 || input.repliedInPreviousTwoCycles);
  check("DELIVERED_RECEIPT", receiptOk);
  check("PAYG_ELIGIBLE", input.plan.payAsYouGo && input.plan.completedDeliveries >= ENGINE.minCompletedDeliveries);
  check("NOT_IN_FREEZE", !inWindow(today, input.freeze) && !inWindow(to, input.freeze));
  return { proposal: { from: baseArrival, to, direction, step, autoSend: blocked.length === 0, blockedBy: blocked }, trace, holdingOff: false };
}
