/**
 * One constants file shared by the engine and the simulator (spec 6.2: "the same numbers the simulator uses").
 * Anything labelled ASSUMPTION is listed, with range and source, in the ledger (sim/ledger.ts).
 */

/** Reply noise: what the simulated customer does, and what the engine assumes. */
export const REPLY = {
  /** log-sd of the customer's estimate of weeks left (simulator default; engine assumes this too). */
  noiseSd: 0.35,
  /** share of replies that are garbage (uniform 0-12 weeks). */
  garbageShare: 0.1,
  /** density of a garbage reply in days (uniform over ~90 days). */
  garbageDensityPerDay: 1 / 90,
  maxWeeks: 12,
} as const;

export const ENGINE = {
  particles: 500,
  /** delivery-to-delivery variation of days a delivery lasts (log scale). */
  sigmaB: 0.15,
  /** pantry-drift volatility per sqrt(month); the engine assumes this, the simulator is misspecified on purpose. */
  nu: 0.1,
  /** away stretch: pause consumption and widen the pantry uncertainty by this factor on nu. */
  awayNuMult: 1.5,
  skipThresholdDays: 21,
  skipWeightTrue: 0.95,
  skipWeightFalse: 0.05,
  resampleFraction: 0.5,
  thetaJitter: 0.01,
  /** share of posterior mass that is flat across particles, so weights can never collapse to NaN. */
  weightFloor: 0.01,
  /** lower clamp (days) inside log-normal comparisons. */
  logFloorDays: 2,
} as const;

export const DECISION = {
  /** Balanced: at most 1 delivery in 10 arrives more than `graceDays` after the customer runs out. */
  serviceQ: 0.1,
  graceDays: 3,
  maxStepDays: 14,
  gapMinDays: 21,
  gapMaxDays: 84,
  /** confidence thresholds on (q90+1)/(q10+1) with a fresh reply this cycle. */
  ratioHigh: 1.6,
  ratioMedium: 2.6,
  /** a "late" delivery: customer is without coffee at least this many days before it arrives. */
  lateDays: 3,
  /** a "stockpile": two weeks or more of coffee still on hand when a delivery arrives. */
  stockpileDays: 14,
  /** later moves default-accept only when the text goes out at least this many days before the old date. */
  defaultAcceptLeadDays: 7,
  minCompletedDeliveries: 2,
  cautiousness: { Cautious: 0.05, Balanced: 0.1, Aggressive: 0.2 },
} as const;

export const SIM = {
  horizonDays: 365,
  cadenceMenu: [28, 42, 56, 84] as const,
  /** Fixed seed for every artifact. */
  seed: 20_261_018,
  grossMargin: 0.61,
  roastToDoorDays: 5,
  checkInDaysBefore: 10,
  replyWindowDays: 5,
  programCostPerSubYear: 2,
} as const;

export type CautiousnessName = keyof typeof DECISION.cautiousness;
