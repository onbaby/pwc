import { SIM } from "../constants.ts";
import { EXHIBITS, SOURCES, STOCKPILE_SOURCES, type SourceName } from "../exhibits.ts";
import type { PriorModel } from "../engine/prior.ts";
import { DEFAULT_PARAMS, withParams, type SimParams } from "./params.ts";
import { trainPrior } from "./prior.ts";
import { allocatePaths, MAXD, simulateSubscriber, type Counters, type SimPolicy, type SourcePaths } from "./run.ts";
import { buildExposure, calibrate, meanArrivalPile, scoreRun, type Exposure, type Hazards, type Sums } from "./score.ts";
import { makeSubscriber } from "./world.ts";

/** One unit of simulation work: a (parameter set, policy, source) run scored at several phi values. */
export interface TaskSpec {
  /** names a world (everything that changes Fixed, the prior or the calibration); equal keys must carry equal `world` */
  paramsKey: string;
  world: Partial<SimParams>;
  /** reply base, reply accuracy and service level: applied to the policy run only, never to Fixed or the prior */
  settings: Partial<SimParams>;
  policy: SimPolicy;
  source: SourceName;
  subscribers: number;
  seed: number;
  phis: number[];
  /** apply phi to this source even if it is not one of the stockpile sources */
  uniformPhi: boolean;
}

export interface HistogramCounts {
  /** counts of arrivals (after the first) by pile bin; bins of 7 days, last bin open */
  bins: number[];
  nonFirst: number;
  stockpile: number;
  late: number;
}

export interface TaskResult {
  spec: Pick<TaskSpec, "paramsKey" | "policy" | "source" | "subscribers" | "uniformPhi">;
  /** phi -> sums, one entry per requested phi (copied if the source ignores phi) */
  sums: Array<{ phi: number; sums: Sums }>;
  counters: Counters;
  histogram: HistogramCounts;
  /** calibration check under Fixed: simulated retention at the phi values */
  calibration?: Array<{ phi: number; ret90: number; ret12: number }>;
}

export const HIST_BINS = 13;

export function phiForSource(source: SourceName, phi: number, uniform: boolean): number {
  return uniform || (STOCKPILE_SOURCES as readonly string[]).includes(source) ? phi : 0;
}

interface FixedCache {
  pref: number;
  exposure: Exposure;
  n: number;
  hazards: Map<number, Hazards>;
}

const fixedCache = new Map<string, FixedCache>();
const priorCache = new Map<string, PriorModel>();

function worldParams(spec: TaskSpec): SimParams {
  return withParams(spec.world);
}

function policyParams(spec: TaskSpec): SimParams {
  return withParams({ ...spec.world, ...spec.settings });
}

function priorFor(spec: TaskSpec): PriorModel {
  // The prior is trained on the *world* parameters, never on reply settings, so one prior serves a whole parameter set.
  const key = `${spec.paramsKey}|${spec.seed}|world`;
  let m = priorCache.get(key);
  if (!m) {
    m = trainPrior(worldParams(spec), spec.seed, 4000);
    priorCache.set(key, m);
  }
  return m;
}

export function simulatePaths(spec: TaskSpec, policy: SimPolicy): SourcePaths {
  const params = policy === "fixed" ? worldParams(spec) : policyParams(spec);
  const ctx = { params, seed: spec.seed, prior: policy === "fixed" || policy === "rule" || policy === "naive" || policy === "ceiling" ? undefined : priorFor(spec) };
  const out = allocatePaths(spec.subscribers);
  for (let i = 0; i < spec.subscribers; i++) simulateSubscriber(makeSubscriber(params, spec.seed, spec.source, i), policy, ctx, out, i);
  return out;
}

function getFixed(spec: TaskSpec): FixedCache {
  const key = `${spec.paramsKey}|${spec.seed}|${spec.subscribers}|${spec.source}`;
  let c = fixedCache.get(key);
  if (!c) {
    const paths = simulatePaths({ ...spec, policy: "fixed", settings: {} }, "fixed");
    const params = worldParams(spec);
    const pref = meanArrivalPile(paths);
    c = { pref, exposure: buildExposure(paths, pref, params.lambda), n: spec.subscribers, hazards: new Map() };
    fixedCache.set(key, c);
  }
  return c;
}

function hazardsFor(c: FixedCache, source: SourceName, phi: number): Hazards {
  const key = Math.round(phi * 1e6);
  let h = c.hazards.get(key);
  if (!h) {
    const e = EXHIBITS.sources[source];
    h = calibrate(c.exposure, c.n, phi, e.ret90, e.ret12);
    c.hazards.set(key, h);
  }
  return h;
}

function histogramOf(paths: SourcePaths): HistogramCounts {
  const bins = new Array<number>(HIST_BINS).fill(0);
  let nonFirst = 0;
  let stockpile = 0;
  let late = 0;
  for (let i = 0; i < paths.n; i++) {
    const nd = paths.nDeliveries[i]!;
    for (let j = 1; j < nd; j++) {
      const pile = paths.pile[i * MAXD + j]!;
      const b = Math.min(HIST_BINS - 1, Math.floor(pile / 7));
      bins[b]!++;
      nonFirst++;
      if (pile >= 14) stockpile++;
      if (paths.late[i * MAXD + j]) late++;
    }
  }
  return { bins, nonFirst, stockpile, late };
}

export function runTask(spec: TaskSpec): TaskResult {
  const fixed = getFixed(spec);
  const paths = spec.policy === "fixed" ? simulatePaths(spec, "fixed") : simulatePaths(spec, spec.policy);
  const aov = EXHIBITS.sources[spec.source].aov;
  // Churn exposure comes from the policy's own path (stock-outs and piles), scaled by the Fixed world's P_ref.
  const exposure = spec.policy === "fixed" ? fixed.exposure : buildExposure(paths, fixed.pref, policyParams(spec).lambda);
  const sums: TaskResult["sums"] = [];
  const memo = new Map<number, Sums>();
  const calibration: NonNullable<TaskResult["calibration"]> = [];
  for (const phi of spec.phis) {
    const eff = phiForSource(spec.source, phi, spec.uniformPhi);
    let s = memo.get(eff);
    if (!s) {
      const hz = hazardsFor(fixed, spec.source, eff);
      s = scoreRun(paths, exposure, hz, eff, aov);
      memo.set(eff, s);
    }
    sums.push({ phi, sums: s });
    if (spec.policy === "fixed") calibration.push({ phi, ret90: s.ret90, ret12: s.ret12 });
  }
  return {
    spec: { paramsKey: spec.paramsKey, policy: spec.policy, source: spec.source, subscribers: spec.subscribers, uniformPhi: spec.uniformPhi },
    sums,
    counters: paths.counters,
    histogram: histogramOf(paths),
    calibration: spec.policy === "fixed" ? calibration : undefined,
  };
}

export const ALL_SOURCES = SOURCES;
export const SEED = SIM.seed;
export { DEFAULT_PARAMS };
