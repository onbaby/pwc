import { DECISION, ENGINE, REPLY, SIM } from "../constants.ts";
import type { SourceName } from "../exhibits.ts";

/** Every simulator assumption in one object (all ASSUMPTIONS; see ledger.ts for ranges and sources). */
export interface SimParams {
  medianDays: Record<SourceName, number>;
  /** multiplies every source's median days (tornado: +/-20%) */
  medianScale: number;
  cupsEffect: number;
  householdEffect: number;
  tauPop: number;
  sigmaB: number;
  /** cadence choice: nearest menu item to exp(theta + eps) in log distance, eps ~ N(bias, sd^2) */
  cadenceBias: number;
  cadenceSd: number;
  misreportShare: number;
  paceSd: number;
  eventProbPerMonth: number;
  eventMinDays: number;
  eventMaxDays: number;
  eventPaceMult: number;
  skipProb: number;
  skipThresholdDays: number;
  replyBase: number;
  replyMultFar: number;
  replyMultMid: number;
  replyMultNear: number;
  replyCap: number;
  replyAccuracySd: number;
  replyGarbageShare: number;
  soonerAccept: number;
  laterRevert: number;
  /** extra churn hazard multiplier (1 + lambda) in the 30 days after a stock-out */
  lambda: number;
  serviceQ: number;
  graceDays: number;
  particles: number;
  programCostPerSubYear: number;
}

export const DEFAULT_PARAMS: SimParams = {
  medianDays: { in_cafe: 64, website: 66, social: 78, gift: 74, referral: 60 },
  medianScale: 1,
  cupsEffect: -0.25,
  householdEffect: -0.15,
  tauPop: 0.3,
  sigmaB: ENGINE.sigmaB,
  cadenceBias: -0.1,
  cadenceSd: 0.15,
  misreportShare: 0.25,
  paceSd: 0.02,
  eventProbPerMonth: 0.08,
  eventMinDays: 14,
  eventMaxDays: 35,
  eventPaceMult: 0.4,
  skipProb: 0.25,
  skipThresholdDays: 21,
  replyBase: 0.45,
  replyMultFar: 0.8,
  replyMultMid: 1.2,
  replyMultNear: 1.5,
  replyCap: 0.9,
  replyAccuracySd: REPLY.noiseSd,
  replyGarbageShare: REPLY.garbageShare,
  soonerAccept: 0.6,
  laterRevert: 0.05,
  lambda: 0.5,
  serviceQ: DECISION.serviceQ,
  graceDays: DECISION.graceDays,
  particles: ENGINE.particles,
  programCostPerSubYear: SIM.programCostPerSubYear,
};

export function withParams(over: Partial<SimParams>): SimParams {
  return { ...DEFAULT_PARAMS, ...over, medianDays: { ...DEFAULT_PARAMS.medianDays, ...(over.medianDays ?? {}) } };
}

/** Grid axes (spec 5.2.5). phi grid is a refinement of the spec's {0,.2,...,1}: every spec point is included. */
export const PHI_GRID = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0] as const;
export const REPLY_BASES = [0.2, 0.45, 0.7] as const;
export const REPLY_ACCURACY_SDS = [0.25, 0.35, 0.5] as const;
export const CAUTIOUSNESS_LEVELS = [0.05, 0.1, 0.2] as const;
export const DEFAULT_PHI = 0.4;
