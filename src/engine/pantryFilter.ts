import { ENGINE } from "../shared/constants.ts";
import type { Day } from "../shared/dates.ts";
import { hash32, uN, zN } from "../shared/rng.ts";
import { normCdf } from "../shared/stats.ts";

/**
 * Layer B: the pantry tracker (spec 7.1, 7.2). "We keep 500 what-if versions of each customer's pantry and keep the
 * ones that agree with what the customer told us." Each hypothesis is (theta, R): theta = ln(days one delivery lasts at
 * the customer's usual pace), R = days of coffee on hand. Pure, deterministic, no network, no Math.random.
 */

export type FilterEvent =
  | { type: "delivery"; day: Day }
  | { type: "reply"; day: Day; weeks: number }
  /** the customer skipped a delivery while holding at least 21 days of coffee */
  | { type: "skip"; day: Day }
  /** staff "Hold until...": consumption is paused between the dates */
  | { type: "hold"; from: Day; to: Day };

export interface ThetaPrior {
  mu: number;
  tau: number;
}

export interface FilterOptions {
  particles?: number;
  sigmaObs?: number;
  garbage?: number;
  nu?: number;
  sigmaB?: number;
}

export interface FilterResult {
  asOf: Day;
  R: Float64Array;
  theta: Float64Array;
  /** normalised weights */
  w: Float64Array;
  ess: number;
  resamples: number;
  /** weighted quantile of days on hand (first hypothesis whose cumulative weight reaches q) */
  quantile(q: number): number;
  quantiles(qs: readonly number[]): number[];
  meanR(): number;
}

/** P(reply = w | R): the reply is round(R e^z / 7) with z ~ N(0, sigma^2), mixed with a flat garbage term (spec 7.2). */
export function replyLikelihood(w: number, R: number, sigmaObs: number = ENGINE.sigmaObs, garbage: number = ENGINE.garbage): number {
  const Rp = Math.max(R, ENGINE.rMinForLikelihood);
  const lnR = Math.log(Rp);
  const hi = w >= 12 ? 1 : normCdf((Math.log(7 * (w + 0.5)) - lnR) / sigmaObs);
  const lo = w <= 0 ? 0 : normCdf((Math.log(7 * (w - 0.5)) - lnR) / sigmaObs);
  return (1 - garbage) * (hi - lo) + garbage / 13;
}

const RANK = { delivery: 0, skip: 1, reply: 2, hold: 3 } as const;

/** Sort events into the order the filter consumes them (by day; deliveries first, then skips, then replies). */
export type PointEvent = Exclude<FilterEvent, { type: "hold" }>;

export function orderEvents(events: readonly FilterEvent[]): PointEvent[] {
  return events.filter((e): e is PointEvent => e.type !== "hold").sort((a, b) => a.day - b.day || RANK[a.type] - RANK[b.type]);
}

function holdWindows(events: readonly FilterEvent[]): Array<{ from: Day; to: Day }> {
  return events.filter((e): e is Extract<FilterEvent, { type: "hold" }> => e.type === "hold").map((e) => ({ from: e.from, to: e.to }));
}

export interface RunInput {
  prior: ThetaPrior;
  /** pre-hashed customer seed (hash32(globalSeed, customerId)) */
  seed: number;
  events: readonly FilterEvent[];
  asOf: Day;
  options?: FilterOptions;
}

/** Run the filter over an event log. The result is a pure function of the log (counter-based randomness). */
export function runFilter(input: RunInput): FilterResult {
  const M = input.options?.particles ?? ENGINE.particles;
  const sigmaObs = input.options?.sigmaObs ?? ENGINE.sigmaObs;
  const garbage = input.options?.garbage ?? ENGINE.garbage;
  const nu = input.options?.nu ?? ENGINE.nu;
  const sigmaB = input.options?.sigmaB ?? ENGINE.sigmaB;
  const seed = input.seed;

  const ordered = orderEvents(input.events);
  const holds = holdWindows(input.events);
  const theta = new Float64Array(M);
  let R = new Float64Array(M);
  const logw = new Float64Array(M);
  const w = new Float64Array(M).fill(1 / M);
  for (let m = 0; m < M; m++) theta[m] = input.prior.mu + input.prior.tau * zN(seed, 1, m, 0);

  let t: Day = ordered.length ? ordered[0]!.day : input.asOf;
  let advanceCount = 0;
  let resamples = 0;
  let thetaArr = theta;
  let ess = M;

  const deplete = (len: number, held: boolean, counter: number): void => {
    if (len <= 0) return;
    const spread = nu * Math.sqrt(len / 30);
    for (let m = 0; m < M; m++) {
      const z = zN(seed, 3, counter, m);
      if (held) R[m] = R[m]! * Math.exp(ENGINE.holdNuMultiplier * spread * z);
      else R[m] = Math.max(R[m]! - len * Math.exp(spread * z), 0);
    }
  };

  const advance = (to: Day): void => {
    if (to <= t) return;
    const segs: Array<{ len: number; held: boolean }> = [];
    let cur = t;
    const wins = holds
      .map((h) => ({ from: Math.max(h.from, t), to: Math.min(h.to, to) }))
      .filter((h) => h.to > h.from)
      .sort((a, b) => a.from - b.from);
    for (const h of wins) {
      const from = Math.max(h.from, cur);
      if (h.to <= from) continue;
      if (from > cur) segs.push({ len: from - cur, held: false });
      segs.push({ len: h.to - from, held: true });
      cur = h.to;
    }
    if (to > cur) segs.push({ len: to - cur, held: false });
    for (const s of segs) deplete(s.len, s.held, advanceCount++);
    t = to;
  };

  const finishObservation = (): void => {
    let max = -Infinity;
    for (let m = 0; m < M; m++) if (logw[m]! > max) max = logw[m]!;
    let sum = 0;
    for (let m = 0; m < M; m++) {
      const e = Math.exp(logw[m]! - max);
      w[m] = e;
      sum += e;
    }
    // floor w <- 0.99 w + 0.01/M keeps the posterior from ever collapsing
    let s2 = 0;
    for (let m = 0; m < M; m++) {
      const wi = (1 - ENGINE.weightFloor) * (w[m]! / sum) + ENGINE.weightFloor / M;
      w[m] = wi;
      logw[m] = Math.log(wi);
      s2 += wi * wi;
    }
    ess = 1 / s2;
    if (ess < M * ENGINE.resampleFraction) {
      // systematic resampling with jitter on theta and R
      const cum = new Float64Array(M);
      let acc = 0;
      for (let m = 0; m < M; m++) {
        acc += w[m]!;
        cum[m] = acc;
      }
      const u0 = uN(seed, 4, resamples, 0);
      const nt = new Float64Array(M);
      const nr = new Float64Array(M);
      let j = 0;
      for (let m = 0; m < M; m++) {
        const u = ((u0 + m) / M) * acc;
        while (j < M - 1 && cum[j]! < u) j++;
        nt[m] = thetaArr[j]! + ENGINE.thetaJitter * zN(seed, 5, resamples, m);
        nr[m] = Math.max(R[j]! + ENGINE.rJitterDays * zN(seed, 6, resamples, m), 0);
      }
      thetaArr = nt;
      R = nr;
      w.fill(1 / M);
      logw.fill(0);
      resamples++;
      ess = M;
    }
  };

  let evIndex = 0;
  for (const e of ordered) {
    if (e.day > input.asOf) break;
    advance(e.day);
    if (e.type === "delivery") {
      for (let m = 0; m < M; m++) R[m] = R[m]! + Math.exp(thetaArr[m]! + sigmaB * zN(seed, 2, evIndex, m));
    } else if (e.type === "skip") {
      for (let m = 0; m < M; m++) logw[m] = logw[m]! + Math.log(R[m]! > ENGINE.skipThresholdDays ? ENGINE.skipWeightHigh : ENGINE.skipWeightLow);
      finishObservation();
    } else {
      const wk = Math.max(0, Math.min(12, Math.round(e.weeks)));
      for (let m = 0; m < M; m++) logw[m] = logw[m]! + Math.log(replyLikelihood(wk, R[m]!, sigmaObs, garbage));
      finishObservation();
    }
    evIndex++;
  }
  advance(input.asOf);

  const sortedIdx = (): Uint32Array => Uint32Array.from({ length: M }, (_, i) => i).sort((a, b) => R[a]! - R[b]!);
  const quantiles = (qs: readonly number[]): number[] => {
    const order = sortedIdx();
    const cw = new Float64Array(M);
    let acc = 0;
    for (let k = 0; k < M; k++) {
      acc += w[order[k]!]!;
      cw[k] = acc;
    }
    return qs.map((q) => {
      const target = q * acc;
      let lo = 0;
      let hi = M - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cw[mid]! >= target) hi = mid;
        else lo = mid + 1;
      }
      return R[order[lo]!]!;
    });
  };
  return {
    asOf: input.asOf,
    R,
    theta: thetaArr,
    w,
    ess,
    resamples,
    quantile: (q) => quantiles([q])[0]!,
    quantiles,
    meanR: () => {
      let s = 0;
      for (let m = 0; m < M; m++) s += w[m]! * R[m]!;
      return s;
    },
  };
}

/** A stable customer seed: hash of the global seed and the customer id. */
export function customerSeed(globalSeed: number, customerId: string): number {
  return hash32(globalSeed, customerId);
}
