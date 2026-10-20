import { ENGINE } from "../shared/constants.ts";
import { fmtMonthDay, type Day } from "../shared/dates.ts";
import { decide, confidenceOf, ratioOf, type Confidence, type DecisionOut, type Direction, type ProposalOut, type RuleTraceItem, type RunOut } from "./decision.ts";
import { checkLines, evidenceText, startingPointText, whatWouldChange, type CheckLine, type WhatIfRow } from "./explain.ts";
import { runFilter, type FilterEvent } from "./pantryFilter.ts";
import { priorFor, type PriorModel } from "./prior.ts";
import type { Source } from "../shared/constants.ts";

/** What the model needs to know about one customer (read from the event log). */
export interface CustomerContext {
  id: string;
  name: string;
  source: Source;
  planType: "payg" | "prepaid" | "gift";
  rhythmDays: number;
  cups: number;
  people: number;
  brew?: string;
  deliveredDays: Day[];
  replies: Array<{ day: Day; weeks: number }>;
  skips: Day[];
  holds: Array<{ from: Day; to: Day }>;
  /** the original arrival date this cycle */
  baseArrival: Day;
  proposalCount: number;
  deliveredReceipt: boolean;
  repliedInPreviousTwoCycles: boolean;
}

export interface EngineEnv {
  prior: PriorModel;
  /** global seed */
  seed: number;
  freeze: { from: Day; to: Day };
  cautiousness?: keyof typeof ENGINE.cautiousness;
  particles?: number;
}

export interface ProjectionExplanation {
  startingPoint: string;
  startingPointTag: string;
  evidence: string;
  whatWouldChange: string;
  howSure: string;
  checks: CheckLine[];
}

/** Written to the `projections` table (spec 7.4). Days are absolute day numbers; runOut quantiles are days from asOfDay. */
export interface Projection {
  computedAt: number;
  engineVersion: string;
  asOfDay: Day;
  runOut: RunOut;
  runOutDates: { lo: Day; mid: Day; hi: Day };
  medianOnHand: number;
  confidence: Confidence;
  ratio: number;
  holdingOff: boolean;
  freshReply: boolean;
  lastReply?: { day: Day; weeks: number };
  proposal: ProposalOut;
  explanation: ProjectionExplanation;
  ruleTrace: RuleTraceItem[];
  whatIf?: WhatIfRow[];
}

export function eventsOf(ctx: CustomerContext): FilterEvent[] {
  return [
    ...ctx.deliveredDays.map((day): FilterEvent => ({ type: "delivery", day })),
    ...ctx.replies.map((r): FilterEvent => ({ type: "reply", day: r.day, weeks: r.weeks })),
    ...ctx.skips.map((day): FilterEvent => ({ type: "skip", day })),
    ...ctx.holds.map((h): FilterEvent => ({ type: "hold", from: h.from, to: h.to })),
  ];
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export interface ComputeOptions {
  /** also evaluate every possible reply 0..12 (a dozen extra filter runs; use for one customer, not the whole base) */
  whatIf?: boolean;
  /** override the seed hash (tests) */
  seedOverride?: number;
}

export function customerSeedOf(globalSeed: number, id: string, hash: (...p: Array<number | string>) => number): number {
  return hash(globalSeed, id);
}

/**
 * The projection: a pure function of (customer event log, today). Runs the pantry filter, applies the decision rule and
 * writes plain-English explanations. No network, no randomness outside the counter-based hash.
 */
export function computeProjection(ctx: CustomerContext, env: EngineEnv, today: Day, nowMs: number, seed: number, opts: ComputeOptions = {}): Projection {
  const prior = priorFor(env.prior, { source: ctx.source, cups: ctx.cups, people: ctx.people, rhythmDays: ctx.rhythmDays });
  const events = eventsOf(ctx);
  const lastDelivery = ctx.deliveredDays.length ? Math.max(...ctx.deliveredDays.filter((d) => d <= today)) : today;
  const fr = (extra: FilterEvent[] = []) => runFilter({ prior, seed, events: [...events, ...extra], asOf: today, options: { particles: env.particles } });
  const lastReply = ctx.replies.filter((r) => r.day >= lastDelivery && r.day <= today).sort((a, b) => b.day - a.day)[0];
  const fresh = lastReply !== undefined;
  const qCaut = ENGINE.cautiousness[env.cautiousness ?? ENGINE.defaultCautiousness];

  const f = fr();
  const [q05, q10, q33, q50, q90, qService] = f.quantiles([0.05, 0.1, 0.33, 0.5, 0.9, qCaut]) as [number, number, number, number, number, number];
  const runOut: RunOut = { q05, q10, q33, q50, q90 };
  const confidence = confidenceOf(q10, q90, fresh);

  const decideFor = (rOut: RunOut, conf: Confidence, qSvc: number, replyFresh: boolean): DecisionOut =>
    decide({
      today,
      baseArrival: ctx.baseArrival,
      lastDelivery,
      runOut: rOut,
      confidence: conf,
      trigger: replyFresh ? "reply" : "none",
      serviceQuantile: qSvc,
      plan: { payAsYouGo: ctx.planType === "payg", completedDeliveries: ctx.deliveredDays.filter((d) => d <= today).length },
      freeze: env.freeze,
      proposalCount: ctx.proposalCount,
      deliveredReceipt: ctx.deliveredReceipt,
      repliedInPreviousTwoCycles: ctx.repliedInPreviousTwoCycles,
    });
  const decision = decideFor(runOut, confidence, qService, fresh);

  let whatIf: WhatIfRow[] | undefined;
  if (opts.whatIf) {
    whatIf = [];
    for (let w = 0; w <= 12; w++) {
      const g = fr([{ type: "reply", day: today, weeks: w }]);
      const [a, b, c, d, e, s] = g.quantiles([0.05, 0.1, 0.33, 0.5, 0.9, qCaut]) as [number, number, number, number, number, number];
      const dec = decideFor({ q05: a, q10: b, q33: c, q50: d, q90: e }, confidenceOf(b, e, true), s, true);
      whatIf.push({ weeks: w, direction: dec.proposal.direction, to: dec.proposal.to, autoSend: dec.proposal.autoSend });
    }
  }

  const descriptor = `${ctx.people}-person home${ctx.brew ? `, ${ctx.brew}` : ""}, ${ctx.source.replace("_", "-")} sign-up, every ${Math.round(ctx.rhythmDays / 7)} weeks`;
  const first = ctx.name.split(" ")[0]!;
  const explanation: ProjectionExplanation = {
    startingPoint: startingPointText(first, descriptor, Math.exp(prior.mu)),
    startingPointTag: env.prior.label,
    evidence: evidenceText(first, lastReply ? { dayText: fmtMonthDay(lastReply.day), weeks: lastReply.weeks } : undefined),
    whatWouldChange: whatIf ? whatWouldChange(first, ctx.baseArrival, whatIf) : "",
    howSure: confidence,
    checks: checkLines(decision.trace),
  };

  return {
    computedAt: nowMs,
    engineVersion: ENGINE.version,
    asOfDay: today,
    runOut: { q05: round1(q05), q10: round1(q10), q33: round1(q33), q50: round1(q50), q90: round1(q90) },
    runOutDates: { lo: today + Math.round(q10), mid: today + Math.round(q50), hi: today + Math.round(q90) },
    medianOnHand: round1(q50),
    confidence,
    ratio: Math.round(ratioOf(q10, q90) * 100) / 100,
    holdingOff: decision.holdingOff,
    freshReply: fresh,
    lastReply,
    proposal: decision.proposal,
    explanation,
    ruleTrace: decision.trace,
    whatIf,
  };
}

export type { Direction };
