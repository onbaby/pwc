import type { CellKey, Diag, Histogram, Metrics, PhiResult, PolicyName, PolicyResult, SimGridArtifact, TornadoRow, VsFixed } from "@rot/contracts";
import { SIM } from "../constants.ts";
import { EXHIBITS, groupBaseline, SOURCES, STOCKPILE_SOURCES, type SourceName } from "../exhibits.ts";
import { round } from "../stats.ts";
import { requiredRetention } from "./breakeven.ts";
import { DISCLOSURE } from "./ledger.ts";
import { CAUTIOUSNESS_LEVELS, DEFAULT_PARAMS, DEFAULT_PHI, PHI_GRID, REPLY_ACCURACY_SDS, REPLY_BASES, withParams } from "./params.ts";
import { runTasks } from "./pool.ts";
import { combineSums, deriveMetrics, type Sums } from "./score.ts";
import { HIST_BINS, type TaskResult, type TaskSpec } from "./tasks.ts";
import type { Counters, SimPolicy } from "./run.ts";

export interface GridOptions {
  subscribersPerSource: number;
  workers: number;
  seed?: number;
  onProgress?: (done: number, total: number) => void;
}

export const DEFAULT_CELL: CellKey = { replyBase: 0.45, replyAccuracySd: 0.35, cautiousness: 0.1 };
const phiList = [...PHI_GRID] as number[];

function spec(partial: Partial<TaskSpec> & Pick<TaskSpec, "policy" | "source" | "paramsKey" | "subscribers" | "seed">): TaskSpec {
  return { world: {}, settings: {}, phis: phiList, uniformPhi: false, ...partial };
}

function cellSettings(cell: CellKey) {
  return { replyBase: cell.replyBase, replyAccuracySd: cell.replyAccuracySd, serviceQ: cell.cautiousness };
}

const cellId = (c: CellKey) => `${c.replyBase}|${c.replyAccuracySd}|${c.cautiousness}`;
const weight = (s: SourceName) => EXHIBITS.sources[s].newSubs;

type BySource = Record<SourceName, TaskResult>;

function indexResults(results: TaskResult[], tasks: TaskSpec[]): Map<string, BySource> {
  const m = new Map<string, Partial<BySource>>();
  results.forEach((r, i) => {
    const t = tasks[i]!;
    const key = taskKey(t);
    const e = m.get(key) ?? {};
    e[t.source] = r;
    m.set(key, e);
  });
  return m as Map<string, BySource>;
}

function taskKey(t: Pick<TaskSpec, "paramsKey" | "policy" | "settings" | "uniformPhi">): string {
  return `${t.paramsKey}|${t.policy}|${JSON.stringify(t.settings)}|${t.uniformPhi}`;
}

function metricsOf(sums: Sums, policy: PolicyName, params = DEFAULT_PARAMS): Metrics {
  return deriveMetrics(sums, params, policy !== "fixed");
}

function sumsAt(r: TaskResult, phi: number): Sums {
  const e = r.sums.find((x) => Math.abs(x.phi - phi) < 1e-9);
  if (!e) throw new Error(`phi ${phi} missing`);
  return e.sums;
}

function buildPhiResult(by: BySource, phi: number, policy: PolicyName, params = DEFAULT_PARAMS): PhiResult & { _sums: { group: Sums; blended: Sums } } {
  const bySource = {} as Record<SourceName, Metrics>;
  const parts: Array<{ sums: Sums; weight: number }> = [];
  const groupParts: Array<{ sums: Sums; weight: number }> = [];
  for (const s of SOURCES) {
    const sums = sumsAt(by[s], phi);
    bySource[s] = metricsOf(sums, policy, params);
    parts.push({ sums, weight: weight(s) });
    if ((STOCKPILE_SOURCES as readonly string[]).includes(s)) groupParts.push({ sums, weight: weight(s) });
  }
  const groupSums = combineSums(groupParts);
  const blendedSums = combineSums(parts);
  return { phi, bySource, group: metricsOf(groupSums, policy, params), blended: metricsOf(blendedSums, policy, params), _sums: { group: groupSums, blended: blendedSums } };
}

function vsFixed(p: PhiResult, f: PhiResult): VsFixed {
  const base = groupBaseline(STOCKPILE_SOURCES);
  const x = 1 - p.group.deliveriesPerActiveYear / f.group.deliveriesPerActiveYear;
  const gpPerActiveYear = f.group.gpShippedPerSub / f.group.subYearsPerSub;
  const req = requiredRetention(x, base);
  const reqNet = requiredRetention(x, base, { programCostPerSubYear: DEFAULT_PARAMS.programCostPerSubYear, gpPerActiveYearUSD: gpPerActiveYear });
  const total = EXHIBITS.dtc.newSubsPerYear;
  return {
    retention12GainPP: (p.group.ret12 - f.group.ret12) * 100,
    retention90GainPP: (p.group.ret90 - f.group.ret90) * 100,
    deliveriesFewerShare: x,
    requiredGainPP: req.requiredGainPP,
    requiredRet12: req.requiredRet12,
    requiredGainNetOfCostPP: reqNet.requiredGainPP,
    gpShippedNetDeltaPerSub: p.group.gpShippedNetPerSub - f.group.gpShippedNetPerSub,
    gpConsumedNetDeltaPerSub: p.group.gpConsumedNetPerSub - f.group.gpConsumedNetPerSub,
    cohortDeltaShippedNetUSD: (p.blended.gpShippedNetPerSub - f.blended.gpShippedNetPerSub) * total,
    cohortDeltaConsumedNetUSD: (p.blended.gpConsumedNetPerSub - f.blended.gpConsumedNetPerSub) * total,
  };
}

function diagOf(by: BySource, n: number): Diag {
  const rate = (pick: (c: Counters) => number, denom: (c: Counters) => number) => {
    let num = 0;
    let den = 0;
    for (const s of SOURCES) {
      const c = by[s].counters;
      num += pick(c);
      den += denom(c);
    }
    return den ? num / den : 0;
  };
  let checkIns = 0;
  let wsum = 0;
  let sooner = 0;
  for (const s of SOURCES) {
    checkIns += (by[s].counters.checkIns / n) * weight(s);
    wsum += weight(s);
    sooner += by[s].counters.soonerAppliedWithoutYes;
  }
  return {
    checkIns: (checkIns / wsum) * 100,
    replyRate: rate((c) => c.replies, (c) => c.checkIns),
    holdOffShare: rate((c) => c.holdOffs, (c) => c.checkIns),
    movedLaterShare: rate((c) => c.movedLater, (c) => c.checkIns),
    movedSoonerShare: rate((c) => c.movedSooner, (c) => c.checkIns),
    appliedShare: rate((c) => c.applied, (c) => c.checkIns),
    soonerAppliedWithoutYes: sooner,
  };
}

function policyResult(by: BySource, policy: PolicyName, fixedResults: PhiResult[] | null, n: number): { pr: PolicyResult; phiResults: PhiResult[] } {
  const phiResults = phiList.map((phi, i) => {
    const r = buildPhiResult(by, phi, policy);
    const { _sums, ...clean } = r;
    void _sums;
    if (fixedResults) clean.vsFixed = vsFixed(clean, fixedResults[i]!);
    return clean as PhiResult;
  });
  return { pr: { policy, diag: diagOf(by, n), results: phiResults }, phiResults };
}

function histogramFor(by: BySource): { per100: number[]; stockpile: number; late: number } {
  const per = new Array<number>(HIST_BINS).fill(0);
  let stock = 0;
  let late = 0;
  let wsum = 0;
  for (const s of STOCKPILE_SOURCES) {
    const h = by[s].histogram;
    const w = weight(s);
    wsum += w;
    for (let b = 0; b < HIST_BINS; b++) per[b]! += (h.bins[b]! / h.nonFirst) * w;
    stock += (h.stockpile / h.nonFirst) * w;
    late += (h.late / h.nonFirst) * w;
  }
  return { per100: per.map((v) => (v / wsum) * 100), stockpile: (stock / wsum) * 100, late: (late / wsum) * 100 };
}

export function binLabels(): string[] {
  const l: string[] = [];
  for (let b = 0; b < HIST_BINS - 1; b++) l.push(`${b * 7}-${b * 7 + 6}`);
  l.push(`${(HIST_BINS - 1) * 7}+`);
  return l;
}

export async function computeGrid(opts: GridOptions): Promise<SimGridArtifact> {
  const n = opts.subscribersPerSource;
  const seed = opts.seed ?? SIM.seed;
  const tasks: TaskSpec[] = [];
  const add = (t: TaskSpec) => tasks.push(t);

  // 1. policies at the default cell
  for (const policy of ["fixed", "quiz", "rule", "naive", "ceiling"] as SimPolicy[]) {
    for (const source of SOURCES) add(spec({ paramsKey: "base", policy, source, subscribers: n, seed, settings: {} }));
  }
  // 2. Paced over the 27-cell grid
  const cells: CellKey[] = [];
  for (const replyBase of REPLY_BASES)
    for (const replyAccuracySd of REPLY_ACCURACY_SDS)
      for (const cautiousness of CAUTIOUSNESS_LEVELS) cells.push({ replyBase, replyAccuracySd, cautiousness });
  for (const cell of cells) for (const source of SOURCES) add(spec({ paramsKey: "base", policy: "paced", source, subscribers: n, seed, settings: cellSettings(cell) }));
  // 3. uniform phi toggle (all five sources) at the default cell, phi = default
  for (const policy of ["fixed", "paced"] as SimPolicy[])
    for (const source of SOURCES)
      add(spec({ paramsKey: "base", policy, source, subscribers: n, seed, settings: policy === "paced" ? cellSettings(DEFAULT_CELL) : {}, phis: [DEFAULT_PHI], uniformPhi: true }));
  // 4. cadence-choice bias variants for the tornado (Fixed and Paced, default phi)
  const epsVariants = [
    { key: "eps-0.30", bias: -0.3 },
    { key: "eps+0.10", bias: 0.1 },
  ];
  for (const v of epsVariants)
    for (const policy of ["fixed", "paced"] as SimPolicy[])
      for (const source of SOURCES)
        add(spec({ paramsKey: v.key, world: { cadenceBias: v.bias }, policy, source, subscribers: n, seed, settings: policy === "paced" ? cellSettings(DEFAULT_CELL) : {}, phis: [DEFAULT_PHI] }));

  const results = await runTasks(tasks, opts.workers, opts.onProgress);
  const idx = indexResults(results, tasks);
  const get = (paramsKey: string, policy: SimPolicy, settings: object, uniform = false): BySource => {
    const r = idx.get(taskKey({ paramsKey, policy, settings, uniformPhi: uniform }));
    if (!r) throw new Error(`missing results for ${paramsKey}/${policy}`);
    return r;
  };

  const fixedBy = get("base", "fixed", {});
  const fixed = policyResult(fixedBy, "fixed", null, n);
  const other = (policy: SimPolicy) => policyResult(get("base", policy, {}), policy, fixed.phiResults, n).pr;
  const quiz = other("quiz");
  const rule = other("rule");
  const naive = other("naive");
  const ceilingBy = get("base", "ceiling", {});
  const ceiling = policyResult(ceilingBy, "ceiling", fixed.phiResults, n).pr;

  const cellResults = cells.map((key) => {
    const by = get("base", "paced", cellSettings(key));
    return { key, paced: policyResult(by, "paced", fixed.phiResults, n).pr, by };
  });
  const defaultCellResult = cellResults.find((c) => cellId(c.key) === cellId(DEFAULT_CELL))!;

  // histogram (default cell, group = in-cafe + website, if nobody cancelled)
  const hist: Histogram = { binLabels: binLabels(), per100: {} as Histogram["per100"], stockpilePer100: {} as Histogram["stockpilePer100"], latePer100: {} as Histogram["latePer100"] };
  const histSources: Array<[PolicyName, BySource]> = [
    ["fixed", fixedBy],
    ["quiz", get("base", "quiz", {})],
    ["rule", get("base", "rule", {})],
    ["naive", get("base", "naive", {})],
    ["paced", defaultCellResult.by],
    ["ceiling", ceilingBy],
  ];
  for (const [pol, by] of histSources) {
    const h = histogramFor(by);
    hist.per100[pol] = h.per100;
    hist.stockpilePer100[pol] = h.stockpile;
    hist.latePer100[pol] = h.late;
  }

  // calibration table (Fixed reproduces Exhibit C)
  const defaultFixed = fixed.phiResults.find((r) => Math.abs(r.phi - DEFAULT_PHI) < 1e-9)!;
  const calibration = SOURCES.map((s) => ({
    source: s,
    ret90Target: EXHIBITS.sources[s].ret90,
    ret90Sim: defaultFixed.bySource[s].ret90,
    ret12Target: EXHIBITS.sources[s].ret12,
    ret12Sim: defaultFixed.bySource[s].ret12,
  }));

  // uniform phi
  const uf = buildPhiResult(get("base", "fixed", {}, true), DEFAULT_PHI, "fixed");
  const up = buildPhiResult(get("base", "paced", cellSettings(DEFAULT_CELL), true), DEFAULT_PHI, "paced");
  const { _sums: _a, ...ufClean } = uf;
  const { _sums: _b, ...upClean } = up;
  void _a;
  void _b;
  upClean.vsFixed = vsFixed(upClean, ufClean);

  // tornado
  const at = (pr: PolicyResult, phi: number) => pr.results.find((r) => Math.abs(r.phi - phi) < 1e-9)!;
  const pacedAt = (cell: CellKey, phi = DEFAULT_PHI) => at(cellResults.find((c) => cellId(c.key) === cellId(cell))!.paced, phi);
  const usd = (r: PhiResult) => r.vsFixed!.cohortDeltaShippedNetUSD;
  const gap = (r: PhiResult) => r.vsFixed!.retention12GainPP - r.vsFixed!.requiredGainPP;
  const base = pacedAt(DEFAULT_CELL);
  const row = (parameter: string, lowLabel: string, highLabel: string, lo: PhiResult, hi: PhiResult): TornadoRow => ({
    parameter,
    lowLabel,
    highLabel,
    lowUSD: usd(lo),
    highUSD: usd(hi),
    baseUSD: usd(base),
    lowGapPP: gap(lo),
    highGapPP: gap(hi),
    baseGapPP: gap(base),
  });
  const epsRow = (key: string) => {
    const p = buildPhiResult(get(key, "paced", cellSettings(DEFAULT_CELL)), DEFAULT_PHI, "paced");
    const f = buildPhiResult(get(key, "fixed", {}), DEFAULT_PHI, "fixed");
    const { _sums: s1, ...pc } = p;
    const { _sums: s2, ...fc } = f;
    void s1;
    void s2;
    pc.vsFixed = vsFixed(pc, fc);
    return pc as PhiResult;
  };
  const tornado: TornadoRow[] = [
    row("Share of cancellations caused by too much coffee", "0 of 100", "100 of 100", pacedAt(DEFAULT_CELL, 0), pacedAt(DEFAULT_CELL, 1)),
    row("Cadence people choose today (log error vs true pace)", "cadence 26% too short (over-ordering)", "cadence 10% too long (under-ordering)", epsRow("eps-0.30"), epsRow("eps+0.10")),
    row("Reply rate", "20%", "70%", pacedAt({ ...DEFAULT_CELL, replyBase: 0.2 }), pacedAt({ ...DEFAULT_CELL, replyBase: 0.7 })),
    row("Reply accuracy", "very rough (50% spread)", "fairly good (25% spread)", pacedAt({ ...DEFAULT_CELL, replyAccuracySd: 0.5 }), pacedAt({ ...DEFAULT_CELL, replyAccuracySd: 0.25 })),
    row("How cautious the date move is", "Cautious (1 in 20)", "Aggressive (1 in 5)", pacedAt({ ...DEFAULT_CELL, cautiousness: 0.05 }), pacedAt({ ...DEFAULT_CELL, cautiousness: 0.2 })),
    row("Which sources have stockpile-driven cancellations", "in-cafe + website only", "all five sources", base, upClean as PhiResult),
  ];

  const warnings: string[] = [];
  const headline = base.vsFixed!.cohortDeltaShippedNetUSD;
  if (headline < -10_000 || headline > 120_000)
    warnings.push(`Headline (Paced vs Fixed, shipped view, net of program cost, cohort scale, phi=${DEFAULT_PHI}) is $${Math.round(headline).toLocaleString("en-US")} a year, outside the printed band [-$10K, +$120K]. This is a warning only; nothing is tuned.`);
  const fx = defaultFixed.blended.deliveriesPerActiveYear;
  if (fx < 5 || fx > 9) warnings.push(`Fixed ships ${fx.toFixed(2)} deliveries per active subscriber-year, outside [5, 9].`);

  return {
    meta: {
      seed,
      subscribersPerSource: n,
      particles: DEFAULT_PARAMS.particles,
      phiGrid: phiList,
      defaultCell: DEFAULT_CELL,
      defaultPhi: DEFAULT_PHI,
      generatedFrom: "packages/core/src/sim (pnpm sim)",
      disclosure: DISCLOSURE,
      warnings,
    },
    fixed: fixed.pr,
    quiz,
    rule,
    naive,
    ceiling,
    cells: cellResults.map(({ key, paced }) => ({ key, paced })),
    histogram: hist,
    tornado,
    calibration,
    uniformPhi: { phi: DEFAULT_PHI, paced: upClean as PhiResult, fixed: ufClean as PhiResult },
  };
}

/** Round every float to 6 decimals (artifact stability across machines). */
export function roundDeep<T>(v: T): T {
  if (typeof v === "number") return round(v, 6) as unknown as T;
  if (Array.isArray(v)) return v.map(roundDeep) as unknown as T;
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = roundDeep(x);
    return o as T;
  }
  return v;
}

void withParams;
