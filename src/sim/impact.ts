import type { PriorModel } from "../engine/prior.ts";
import { ENGINE, EXHIBITS, GROSS_MARGIN, SOURCES, STOCKPILE_SOURCES, WORLD, type Source } from "../shared/constants.ts";
import { Stream } from "../shared/rng.ts";
import { quantileSorted } from "../shared/stats.ts";
import { buildExposure, calibrate, meanArrivalPile, requiredRetention, scoreCustomers, summarise, type Exposure, type Hazards, type PerCustomer, type Summary } from "./churn.ts";
import { DEFAULT_SETTINGS, allocatePaths, simulateCustomer, type PathSet, type PolicyName, type PolicySettings } from "./policies.ts";
import { trainPrior } from "./prior.ts";
import { SIM_SEED, makeCustomer, type WorldOverrides } from "./world.ts";

/** The default "placeholder" marker on the slider: of every 100 cancellations, how many are caused by too much coffee. */
export const DEFAULT_PHI = 0.4;
export const PHI_GRID = Array.from({ length: 21 }, (_, i) => i / 20);

export interface PolicyCurve {
  /** 12-month retention gain vs Fixed, cafe + website, percentage points, per phi */
  gainPP: number[];
  /** paired bootstrap 95% interval of the gain */
  gainCI: Array<[number, number]>;
  lateShare: number[];
  stockpileShare: number[];
  deliveriesPerActiveYear: number[];
  profitPerSignUp: number[];
  /** profit per sign-up minus Fixed, with a paired bootstrap 95% interval */
  profitDelta: number[];
  profitDeltaCI: Array<[number, number]>;
  /** model-free break-even: retention gain needed (net of program cost), pp */
  requiredPP: number[];
  requiredGrossPP: number[];
  deliveriesFewerShare: number[];
  freshnessDays: number[];
  /** smallest phi at which the gain reaches the requirement (interpolated); null if never within 0..1 */
  breakEvenPhi: number | null;
}

export interface ImpactArtifact {
  meta: {
    seed: number;
    customersPerSource: number;
    particles: number;
    phiGrid: number[];
    defaultPhi: number;
    group: string;
    bootstrapDraws: number;
    engineVersion: string;
    priorLabel: string;
    note: string;
  };
  fixed: { lateShare: number[]; stockpileShare: number[]; deliveriesPerActiveYear: number[]; profitPerSignUp: number[]; freshnessDays: number[] };
  paced: PolicyCurve;
  ceiling: PolicyCurve;
  rule: PolicyCurve;
  /** paced under different reply rates and accuracies (one at a time) */
  better: Array<{ label: string; replyBase: number; replyAccuracySd: number; gainAtDefaultPP: number; requiredAtDefaultPP: number; breakEvenPhi: number | null; replyRate: number; holdOffShare: number }>;
  diag: { checkInsPer100: number; replyRate: number; holdOffShare: number; autoSentShare: number; needApprovalShare: number; soonerAppliedWithoutYes: number };
  calibration: Array<{ source: Source; ret90Target: number; ret90Sim: number; ret12Target: number; ret12Sim: number }>;
  /** Layer B: 80% run-out range vs the simulator's true days on hand */
  coverage: Array<{ deliveriesCompleted: string; replyState: string; inside: number; total: number; share: number }>;
  cohort: { newSubsPerYear: number; pacedProfitDeltaUSDAtDefault: number; ceilingProfitDeltaUSDAtDefault: number };
  warnings: string[];
}

interface SourceRun {
  paths: Record<string, PathSet>;
  exposure: Record<string, Exposure>;
  hazards: Map<string, Hazards>;
  pref: number;
}

interface Config {
  n: number;
  seed: number;
  bootstrap: number;
  prior: PriorModel;
  onProgress?: (msg: string) => void;
}

const VARIANTS: Array<{ key: string; label: string; settings: Partial<PolicySettings> }> = [
  { key: "paced", label: "Our model as built (45% reply, ±35% accuracy)", settings: {} },
  { key: "paced-reply20", label: "Reply rate 20%", settings: { replyBase: 0.2 } },
  { key: "paced-reply70", label: "Reply rate 70%", settings: { replyBase: 0.7 } },
  { key: "paced-acc25", label: "Replies accurate to ±25%", settings: { replyAccuracySd: 0.25 } },
  { key: "paced-acc50", label: "Replies accurate only to ±50%", settings: { replyAccuracySd: 0.5 } },
];

function runSource(source: Source, cfg: Config, world: WorldOverrides = {}): SourceRun {
  const customers = Array.from({ length: cfg.n }, (_, i) => makeCustomer(`${source}-${i}`, source, world, cfg.seed));
  const simulate = (policy: PolicyName, settings: PolicySettings): PathSet => {
    const out = allocatePaths(cfg.n);
    for (let i = 0; i < cfg.n; i++) simulateCustomer(customers[i]!, policy, { prior: cfg.prior, settings }, out, i);
    return out;
  };
  const paths: Record<string, PathSet> = { fixed: simulate("fixed", DEFAULT_SETTINGS), rule: simulate("rule", DEFAULT_SETTINGS), ceiling: simulate("ceiling", DEFAULT_SETTINGS) };
  for (const v of VARIANTS) paths[v.key] = simulate("paced", { ...DEFAULT_SETTINGS, ...v.settings });
  const pref = meanArrivalPile(paths.fixed!);
  const exposure: Record<string, Exposure> = {};
  for (const k of Object.keys(paths)) exposure[k] = buildExposure(paths[k]!, pref);
  return { paths, exposure, hazards: new Map(), pref };
}

const phiFor = (source: Source, phi: number): number => ((STOCKPILE_SOURCES as readonly string[]).includes(source) ? phi : 0);

function hazardsAt(run: SourceRun, source: Source, phi: number): Hazards {
  const key = phi.toFixed(4);
  let h = run.hazards.get(key);
  if (!h) {
    const e = EXHIBITS.sources[source];
    h = calibrate(run.exposure.fixed!, run.paths.fixed!.n, phi, e.ret90, e.ret12);
    run.hazards.set(key, h);
  }
  return h;
}

/** Raw sums for one policy at one phi for the stockpile group (in-cafe + website) as expected values per sign-up. */
interface GroupParts {
  perSource: Array<{ source: Source; pc: PerCustomer; weight: number }>;
}

function groupSummary(parts: GroupParts, charged: boolean, resample?: Map<Source, Int32Array>): Summary {
  // weight each source by its Exhibit C sign-ups; combine expected values per customer
  let wTot = 0;
  const acc = { ret90: 0, ret12: 0, years: 0, del: 0, nf: 0, late: 0, stk: 0, stockW: 0, act: 0, gp: 0 };
  for (const { source, pc, weight } of parts.perSource) {
    const idx = resample?.get(source);
    const s = summarise(pc, source, charged, idx);
    const n = idx ? idx.length : pc.ret12.length;
    // recover sums from the summary: use per-customer arrays directly for shares
    let act = 0;
    let del = 0;
    let nf = 0;
    let late = 0;
    let stk = 0;
    let sw = 0;
    for (let k = 0; k < n; k++) {
      const i = idx ? idx[k]! : k;
      act += pc.activeDays[i]!;
      del += pc.deliveries[i]!;
      nf += pc.nonFirst[i]!;
      late += pc.late[i]!;
      stk += pc.stockpile[i]!;
      sw += pc.stockWeighted[i]!;
    }
    const scale = weight / n;
    acc.ret90 += s.ret90 * weight;
    acc.ret12 += s.ret12 * weight;
    acc.years += (act / 365) * scale;
    acc.del += del * scale;
    acc.nf += nf * scale;
    acc.late += late * scale;
    acc.stk += stk * scale;
    acc.stockW += sw * scale;
    acc.act += act * scale;
    acc.gp += s.profitPerSignUp * weight;
    wTot += weight;
  }
  const meanDays = acc.stockW / Math.max(acc.act, 1e-9);
  return {
    ret90: acc.ret90 / wTot,
    ret12: acc.ret12 / wTot,
    deliveriesPerActiveYear: acc.years > 0 ? acc.del / acc.years : 0,
    lateShare: acc.nf > 0 ? acc.late / acc.nf : 0,
    stockpileShare: acc.nf > 0 ? acc.stk / acc.nf : 0,
    meanDaysOnHand: meanDays,
    freshnessDays: meanDays + WORLD.roastToDoorDays,
    profitPerSignUp: acc.gp / wTot,
  };
}

const pctl = (xs: number[], q: number) => quantileSorted(Float64Array.from(xs).sort(), q);

export function crossing(phis: readonly number[], gain: readonly number[], required: readonly number[]): number | null {
  for (let i = 0; i < phis.length; i++) {
    const d = gain[i]! - required[i]!;
    if (d >= 0) {
      if (i === 0) return phis[0]!;
      const prev = gain[i - 1]! - required[i - 1]!;
      return phis[i - 1]! + ((0 - prev) / (d - prev)) * (phis[i]! - phis[i - 1]!);
    }
  }
  return null;
}

export function computeImpact(cfg: Config): ImpactArtifact {
  const runs = new Map<Source, SourceRun>();
  for (const s of SOURCES) {
    cfg.onProgress?.(`simulating ${s}`);
    runs.set(s, runSource(s, cfg));
  }
  const stockpile = STOCKPILE_SOURCES;
  const groupBase = (() => {
    let n = 0;
    let r90 = 0;
    let r12 = 0;
    for (const s of stockpile) {
      const e = EXHIBITS.sources[s];
      n += e.newSubs;
      r90 += e.newSubs * e.ret90;
      r12 += e.newSubs * e.ret12;
    }
    return { ret90: r90 / n, ret12: r12 / n };
  })();

  const parts = (policy: string, phi: number): GroupParts => ({
    perSource: stockpile.map((source) => {
      const run = runs.get(source)!;
      const eff = phiFor(source, phi);
      return { source, pc: scoreCustomers(run.paths[policy]!, run.exposure[policy]!, hazardsAt(run, source, eff), eff), weight: EXHIBITS.sources[source].newSubs };
    }),
  });

  const boot = new Stream("bootstrap", cfg.seed);
  const resamples: Array<Map<Source, Int32Array>> = Array.from({ length: cfg.bootstrap }, () => {
    const m = new Map<Source, Int32Array>();
    for (const s of stockpile) {
      const idx = new Int32Array(cfg.n);
      for (let i = 0; i < cfg.n; i++) idx[i] = boot.int(0, cfg.n - 1);
      m.set(s, idx);
    }
    return m;
  });

  const curveFor = (policy: string): { curve: PolicyCurve; fixedCurve: ImpactArtifact["fixed"] } => {
    const c: PolicyCurve = { gainPP: [], gainCI: [], lateShare: [], stockpileShare: [], deliveriesPerActiveYear: [], profitPerSignUp: [], profitDelta: [], profitDeltaCI: [], requiredPP: [], requiredGrossPP: [], deliveriesFewerShare: [], freshnessDays: [], breakEvenPhi: null };
    const f: ImpactArtifact["fixed"] = { lateShare: [], stockpileShare: [], deliveriesPerActiveYear: [], profitPerSignUp: [], freshnessDays: [] };
    for (const phi of PHI_GRID) {
      cfg.onProgress?.(`scoring ${policy} at ${phi}`);
      const pp = parts(policy, phi);
      const fp = parts("fixed", phi);
      const ps = groupSummary(pp, true);
      const fs = groupSummary(fp, false);
      const x = 1 - ps.deliveriesPerActiveYear / fs.deliveriesPerActiveYear;
      // gross profit per active year of Fixed (before program cost)
      const gpActive = fs.profitPerSignUp / Math.max(groupYears(fp), 1e-9);
      const need = requiredRetention(x, groupBase, { programCostPerYear: WORLD.programCostPerActiveYear, grossProfitPerActiveYear: gpActive });
      const needGross = requiredRetention(x, groupBase);
      // paired bootstrap of gain and profit difference
      const gains: number[] = [];
      const deltas: number[] = [];
      for (const rs of resamples) {
        const a = groupSummary(pp, true, rs);
        const b = groupSummary(fp, false, rs);
        gains.push((a.ret12 - b.ret12) * 100);
        deltas.push(a.profitPerSignUp - b.profitPerSignUp);
      }
      c.gainPP.push((ps.ret12 - fs.ret12) * 100);
      c.gainCI.push([pctl(gains, 0.025), pctl(gains, 0.975)]);
      c.lateShare.push(ps.lateShare);
      c.stockpileShare.push(ps.stockpileShare);
      c.deliveriesPerActiveYear.push(ps.deliveriesPerActiveYear);
      c.profitPerSignUp.push(ps.profitPerSignUp);
      c.profitDelta.push(ps.profitPerSignUp - fs.profitPerSignUp);
      c.profitDeltaCI.push([pctl(deltas, 0.025), pctl(deltas, 0.975)]);
      c.requiredPP.push(need.requiredGainPP);
      c.requiredGrossPP.push(needGross.requiredGainPP);
      c.deliveriesFewerShare.push(x);
      c.freshnessDays.push(ps.freshnessDays);
      f.lateShare.push(fs.lateShare);
      f.stockpileShare.push(fs.stockpileShare);
      f.deliveriesPerActiveYear.push(fs.deliveriesPerActiveYear);
      f.profitPerSignUp.push(fs.profitPerSignUp);
      f.freshnessDays.push(fs.freshnessDays);
    }
    c.breakEvenPhi = crossing(PHI_GRID, c.gainPP, c.requiredPP);
    return { curve: c, fixedCurve: f };
  };

  const pacedRes = curveFor("paced");
  const ceilRes = curveFor("ceiling");
  const ruleRes = curveFor("rule");

  const di = PHI_GRID.indexOf(DEFAULT_PHI);
  const better: ImpactArtifact["better"] = [];
  for (const v of VARIANTS) {
    const gains: number[] = [];
    const reqs: number[] = [];
    for (const phi of PHI_GRID) {
      const pp = parts(v.key, phi);
      const fp = parts("fixed", phi);
      const ps = groupSummary(pp, true);
      const fs = groupSummary(fp, false);
      const x = 1 - ps.deliveriesPerActiveYear / fs.deliveriesPerActiveYear;
      gains.push((ps.ret12 - fs.ret12) * 100);
      reqs.push(requiredRetention(x, groupBase, { programCostPerYear: WORLD.programCostPerActiveYear, grossProfitPerActiveYear: fs.profitPerSignUp / Math.max(groupYears(fp), 1e-9) }).requiredGainPP);
    }
    const cn = aggCounters(runs, v.key);
    better.push({ label: v.label, replyBase: v.settings.replyBase ?? DEFAULT_SETTINGS.replyBase, replyAccuracySd: v.settings.replyAccuracySd ?? DEFAULT_SETTINGS.replyAccuracySd, gainAtDefaultPP: gains[di]!, requiredAtDefaultPP: reqs[di]!, breakEvenPhi: crossing(PHI_GRID, gains, reqs), replyRate: cn.replyRate, holdOffShare: cn.holdOffShare });
  }

  const cn = aggCounters(runs, "paced");
  const calibration: ImpactArtifact["calibration"] = SOURCES.map((s) => {
    const run = runs.get(s)!;
    const eff = phiFor(s, DEFAULT_PHI);
    const pc = scoreCustomers(run.paths.fixed!, run.exposure.fixed!, hazardsAt(run, s, eff), eff);
    const sm = summarise(pc, s, false);
    return { source: s, ret90Target: EXHIBITS.sources[s].ret90, ret90Sim: sm.ret90, ret12Target: EXHIBITS.sources[s].ret12, ret12Sim: sm.ret12 };
  });

  // Layer B coverage (default paced run)
  const cov = new Map<string, [number, number]>();
  for (const s of SOURCES) for (const [k, v] of runs.get(s)!.paths.paced!.coverage.byKey) {
    const e = cov.get(k) ?? [0, 0];
    e[0] += v[0];
    e[1] += v[1];
    cov.set(k, e);
  }
  const coverage = [...cov.entries()]
    .map(([k, [inside, total]]) => {
      const [d, state] = k.split("|") as [string, string];
      return { deliveriesCompleted: d === "4" ? "4+" : d, replyState: state === "none" ? "no reply yet" : "replied this cycle", inside, total, share: total ? inside / total : 0 };
    })
    .sort((a, b) => a.deliveriesCompleted.localeCompare(b.deliveriesCompleted) || a.replyState.localeCompare(b.replyState));

  const total = EXHIBITS.dtc.newSubsPerYear;
  // cohort scale: group effect applied to the whole cohort by Exhibit C weights is approximated by the group's delta x group sign-ups
  const groupSubs = stockpile.reduce((a, s) => a + EXHIBITS.sources[s].newSubs, 0);
  const warnings: string[] = [];
  const fixedPerYear = pacedRes.fixedCurve.deliveriesPerActiveYear[di]!;
  if (fixedPerYear < 5 || fixedPerYear > 9) warnings.push(`Fixed ships ${fixedPerYear.toFixed(2)} deliveries per active subscriber-year, outside [5, 9].`);
  void total;
  return {
    meta: {
      seed: cfg.seed,
      customersPerSource: cfg.n,
      particles: ENGINE.particles,
      phiGrid: [...PHI_GRID],
      defaultPhi: DEFAULT_PHI,
      group: "in-cafe + website sign-ups",
      bootstrapDraws: cfg.bootstrap,
      engineVersion: ENGINE.version,
      priorLabel: cfg.prior.label,
      note: "Projection from simulation · sample data. Synthetic customers calibrated only to Exhibit C's retention by source; every other parameter is a labelled assumption.",
    },
    fixed: pacedRes.fixedCurve,
    paced: pacedRes.curve,
    ceiling: ceilRes.curve,
    rule: ruleRes.curve,
    better,
    diag: { checkInsPer100: cn.checkInsPer100, replyRate: cn.replyRate, holdOffShare: cn.holdOffShare, autoSentShare: cn.autoSentShare, needApprovalShare: cn.needApprovalShare, soonerAppliedWithoutYes: cn.soonerWithoutYes },
    calibration,
    coverage,
    cohort: { newSubsPerYear: EXHIBITS.dtc.newSubsPerYear, pacedProfitDeltaUSDAtDefault: pacedRes.curve.profitDelta[di]! * groupSubs, ceilingProfitDeltaUSDAtDefault: ceilRes.curve.profitDelta[di]! * groupSubs },
    warnings,
  };
}

function groupYears(parts: GroupParts): number {
  let years = 0;
  let w = 0;
  for (const { pc, weight } of parts.perSource) {
    let act = 0;
    for (let i = 0; i < pc.activeDays.length; i++) act += pc.activeDays[i]!;
    years += (act / pc.activeDays.length / 365) * weight;
    w += weight;
  }
  return years / w;
}

function aggCounters(runs: Map<Source, SourceRun>, key: string) {
  let checkIns = 0;
  let replies = 0;
  let holdOffs = 0;
  let autoSent = 0;
  let needApproval = 0;
  let soonerWithoutYes = 0;
  let n = 0;
  for (const s of SOURCES) {
    const p = runs.get(s)!.paths[key]!;
    checkIns += p.counters.checkIns;
    replies += p.counters.replies;
    holdOffs += p.counters.holdOffs;
    autoSent += p.counters.autoSent;
    needApproval += p.counters.needApproval;
    soonerWithoutYes += p.counters.soonerAppliedWithoutYes;
    n += p.n;
  }
  return {
    checkInsPer100: (checkIns / n) * 100,
    replyRate: checkIns ? replies / checkIns : 0,
    holdOffShare: checkIns ? holdOffs / checkIns : 0,
    autoSentShare: replies ? autoSent / replies : 0,
    needApprovalShare: replies ? needApproval / replies : 0,
    soonerWithoutYes,
  };
}

export { trainPrior, SIM_SEED, GROSS_MARGIN };
