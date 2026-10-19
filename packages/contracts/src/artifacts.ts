import { z } from "zod";
import { PolicySchema, SourceSchema } from "./common.ts";

/** artifacts/exhibits.json (spec 5.1) */
export const ExhibitsArtifactSchema = z.object({
  dtc: z.object({
    revenueUSD: z.number(),
    grossMargin: z.number(),
    growth: z.number(),
    grossProfitUSD: z.number(),
    newSubsPerYear: z.number(),
  }),
  sources: z.record(
    SourceSchema,
    z.object({ newSubs: z.number(), ret90: z.number(), ret12: z.number(), aov: z.number() }),
  ),
  notes: z.string(),
});
export type ExhibitsArtifact = z.infer<typeof ExhibitsArtifactSchema>;

/** artifacts/priors.json: Layer A fitted on a synthetic training split (spec 6.1). */
export const PriorsArtifactSchema = z.object({
  model: z.object({
    sources: z.array(SourceSchema),
    beta: z.array(z.number()),
    tau: z.number(),
    sigmaB: z.number(),
  }),
  trainedOn: z.object({ subscribers: z.number().int(), seed: z.number().int(), note: z.string() }),
});
export type PriorsArtifact = z.infer<typeof PriorsArtifactSchema>;

/** One policy x one source-or-aggregate x one phi. All survival-weighted, per new subscriber unless noted. */
export const MetricsSchema = z.object({
  ret90: z.number(),
  ret12: z.number(),
  deliveriesPerActiveYear: z.number(),
  deliveriesPerSub: z.number(),
  subYearsPerSub: z.number(),
  /** share of deliveries (after the first) arriving with >= 14 days of coffee on hand */
  stockpileShare: z.number(),
  /** share of deliveries (after the first) arriving >= 3 days after the customer ran out */
  lateShare: z.number(),
  meanStockDays: z.number(),
  /** mean days on hand + roast-to-door days (Little's law) */
  freshnessDays: z.number(),
  gpShippedPerSub: z.number(),
  gpConsumedPerSub: z.number(),
  gpShippedNetPerSub: z.number(),
  gpConsumedNetPerSub: z.number(),
});
export type Metrics = z.infer<typeof MetricsSchema>;

export const DiagSchema = z.object({
  /** check-in texts sent per 100 subscribers over the year (not survival weighted) */
  checkIns: z.number(),
  /** share of check-ins that received a counted reply */
  replyRate: z.number(),
  /** share of check-ins ending with no change because no reply (we hold off and ask) */
  holdOffShare: z.number(),
  /** share of check-ins that proposed a later date */
  movedLaterShare: z.number(),
  movedSoonerShare: z.number(),
  /** moves that were applied */
  appliedShare: z.number(),
  /** sooner moves applied without a recorded YES (must be 0) */
  soonerAppliedWithoutYes: z.number().int(),
});
export type Diag = z.infer<typeof DiagSchema>;

export const VsFixedSchema = z.object({
  /** policy 12-month retention minus Fixed, percentage points, in-cafe + website group */
  retention12GainPP: z.number(),
  retention90GainPP: z.number(),
  /** share fewer deliveries per active subscriber-year than Fixed (group) */
  deliveriesFewerShare: z.number(),
  /** model-free: gain in 12-month retention (pp) the group needs for break-even on year-one shipped gross profit */
  requiredGainPP: z.number(),
  requiredRet12: z.number(),
  /** same, but the program cost is charged too */
  requiredGainNetOfCostPP: z.number(),
  gpShippedNetDeltaPerSub: z.number(),
  gpConsumedNetDeltaPerSub: z.number(),
  /** cohort-scaled (x 8,670 by source weights), USD, shipped view, net of program cost */
  cohortDeltaShippedNetUSD: z.number(),
  cohortDeltaConsumedNetUSD: z.number(),
});
export type VsFixed = z.infer<typeof VsFixedSchema>;

export const PhiResultSchema = z.object({
  phi: z.number(),
  bySource: z.record(SourceSchema, MetricsSchema),
  group: MetricsSchema,
  blended: MetricsSchema,
  /** absent for Fixed */
  vsFixed: VsFixedSchema.optional(),
});
export type PhiResult = z.infer<typeof PhiResultSchema>;

export const PolicyResultSchema = z.object({
  policy: PolicySchema,
  diag: DiagSchema,
  results: z.array(PhiResultSchema),
});
export type PolicyResult = z.infer<typeof PolicyResultSchema>;

export const CellKeySchema = z.object({
  replyBase: z.number(),
  replyAccuracySd: z.number(),
  cautiousness: z.number(),
});
export type CellKey = z.infer<typeof CellKeySchema>;

export const HistogramSchema = z.object({
  /** upper-inclusive labels, in days of coffee on hand when a delivery arrives */
  binLabels: z.array(z.string()),
  /** per 100 deliveries (after the first), group = in-cafe + website, if nobody cancelled */
  per100: z.record(PolicySchema, z.array(z.number())),
  stockpilePer100: z.record(PolicySchema, z.number()),
  latePer100: z.record(PolicySchema, z.number()),
});
export type Histogram = z.infer<typeof HistogramSchema>;

export const TornadoRowSchema = z.object({
  parameter: z.string(),
  lowLabel: z.string(),
  highLabel: z.string(),
  /** cohort-scaled Paced minus Fixed, shipped view, net of program cost, USD per year */
  lowUSD: z.number(),
  highUSD: z.number(),
  baseUSD: z.number(),
  /** Paced delivered minus Required 12-month retention gain (pp), group */
  lowGapPP: z.number(),
  highGapPP: z.number(),
  baseGapPP: z.number(),
});
export type TornadoRow = z.infer<typeof TornadoRowSchema>;

export const SimGridArtifactSchema = z.object({
  meta: z.object({
    seed: z.number().int(),
    subscribersPerSource: z.number().int(),
    particles: z.number().int(),
    phiGrid: z.array(z.number()),
    defaultCell: CellKeySchema,
    defaultPhi: z.number(),
    generatedFrom: z.string(),
    disclosure: z.string(),
    warnings: z.array(z.string()),
  }),
  fixed: PolicyResultSchema,
  quiz: PolicyResultSchema,
  rule: PolicyResultSchema,
  naive: PolicyResultSchema,
  ceiling: PolicyResultSchema,
  cells: z.array(z.object({ key: CellKeySchema, paced: PolicyResultSchema })),
  histogram: HistogramSchema,
  tornado: z.array(TornadoRowSchema),
  calibration: z.array(
    z.object({
      source: SourceSchema,
      ret90Target: z.number(),
      ret90Sim: z.number(),
      ret12Target: z.number(),
      ret12Sim: z.number(),
    }),
  ),
  /** Paced uniform-phi toggle (all five sources) at the default cell */
  uniformPhi: z.object({ phi: z.number(), paced: PhiResultSchema, fixed: PhiResultSchema }),
});
export type SimGridArtifact = z.infer<typeof SimGridArtifactSchema>;

export const LedgerEntrySchema = z.object({
  parameter: z.string(),
  value: z.string(),
  range: z.string(),
  source: z.string(),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

/** Real-data check (spec 5.4). */
export const BacktestRowSchema = z.object({
  /** "1".."4" and "5+" */
  k: z.string(),
  n: z.number().int(),
  customers: z.number().int(),
  pinball33: z.object({ model: z.number(), b0: z.number(), b1: z.number(), b2: z.number(), b3: z.number(), b4: z.number() }),
  mae: z.object({ model: z.number(), b0: z.number(), b1: z.number(), b2: z.number(), b3: z.number(), b4: z.number() }),
  coverage80: z.object({ model: z.number(), b3: z.number(), b4: z.number() }),
  medianWidthDays: z.object({ model: z.number(), b3: z.number(), b4: z.number() }),
  /** paired bootstrap 95% interval of (model - B3) mean pinball@0.33 */
  diffVsB3: z.object({ mean: z.number(), lo: z.number(), hi: z.number() }),
  decision: z.object({
    rule: z.object({ lateShare: z.number(), meanDaysEarly: z.number() }),
    b0: z.object({ lateShare: z.number(), meanDaysEarly: z.number() }),
    b1: z.object({ lateShare: z.number(), meanDaysEarly: z.number() }),
  }),
});
export type BacktestRow = z.infer<typeof BacktestRowSchema>;

export const BacktestArtifactSchema = z.object({
  protocol: z.object({ path: z.string(), commit: z.string(), committedAt: z.string().optional(), committedBeforeRun: z.boolean(), cutoffDay: z.number().int() }),
  dataset: z.object({ name: z.string(), citation: z.string(), license: z.string(), seriesSha256: z.string() }),
  splits: z.object({
    fitCustomers: z.number().int(),
    calibrationCustomers: z.number().int(),
    testCustomers: z.number().int(),
    fitSeries: z.number().int(),
    calibrationSeries: z.number().int(),
    testSeries: z.number().int(),
    fitGaps: z.number().int(),
    calibrationPredictions: z.number().int(),
    testPredictions: z.number().int(),
    censoredTestPredictions: z.number().int(),
  }),
  model: z.object({
    globalMeanLogGap: z.number(),
    sigmaW: z.number(),
    tau: z.number(),
    rho: z.number(),
    p1Days: z.number(),
    p99Days: z.number(),
    conformalScale: z.record(z.string(), z.number()),
    b3Multiplier33: z.number(),
  }),
  rows: z.array(BacktestRowSchema),
  pooledCoverage80: z.object({ model: z.number() }),
  success: z.object({
    pinballBeatsB3AtK1: z.boolean(),
    pinballBeatsB3AtK2: z.boolean(),
    coverageWithinBand: z.array(z.object({ k: z.string(), coverage: z.number(), ok: z.boolean() })),
    passed: z.boolean(),
    line: z.string(),
  }),
});
export type BacktestArtifact = z.infer<typeof BacktestArtifactSchema>;
