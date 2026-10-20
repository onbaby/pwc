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

/**
 * The incremental tracker behind runFilter. Events must be fed in chronological order (deliveries before skips before
 * replies on the same day). The simulator uses it directly; runFilter replays a whole log through it, so both give
 * identical numbers for the same log (tested).
 */
export class PantryTracker {
  readonly M: number;
  private readonly sigmaObs: number;
  private readonly garbage: number;
  private readonly nu: number;
  private readonly sigmaB: number;
  private readonly seed: number;
  private theta: Float64Array;
  private R: Float64Array;
  private logw: Float64Array;
  private w: Float64Array;
  private t: Day;
  private advanceCount = 0;
  private evIndex = 0;
  private holds: Array<{ from: Day; to: Day }> = [];
  ess: number;
  resamples = 0;

  constructor(prior: ThetaPrior, seed: number, startDay: Day, options: FilterOptions = {}) {
    this.M = options.particles ?? ENGINE.particles;
    this.sigmaObs = options.sigmaObs ?? ENGINE.sigmaObs;
    this.garbage = options.garbage ?? ENGINE.garbage;
    this.nu = options.nu ?? ENGINE.nu;
    this.sigmaB = options.sigmaB ?? ENGINE.sigmaB;
    this.seed = seed;
    this.t = startDay;
    this.theta = new Float64Array(this.M);
    this.R = new Float64Array(this.M);
    this.logw = new Float64Array(this.M);
    this.w = new Float64Array(this.M).fill(1 / this.M);
    this.ess = this.M;
    for (let m = 0; m < this.M; m++) this.theta[m] = prior.mu + prior.tau * zN(seed, 1, m, 0);
  }

  get day(): Day {
    return this.t;
  }

  setHolds(holds: ReadonlyArray<{ from: Day; to: Day }>): void {
    this.holds = holds.map((h) => ({ ...h }));
  }

  private deplete(len: number, held: boolean, counter: number): void {
    if (len <= 0) return;
    const spread = this.nu * Math.sqrt(len / 30);
    const { M, R, seed } = this;
    for (let m = 0; m < M; m++) {
      const z = zN(seed, 3, counter, m);
      if (held) R[m] = R[m]! * Math.exp(ENGINE.holdNuMultiplier * spread * z);
      else R[m] = Math.max(R[m]! - len * Math.exp(spread * z), 0);
    }
  }

  /** Move to `to`, removing coffee at about one day per day (paused inside staff holds, with the range widened). */
  advance(to: Day): void {
    if (to <= this.t) return;
    const segs: Array<{ len: number; held: boolean }> = [];
    let cur = this.t;
    const wins = this.holds
      .map((h) => ({ from: Math.max(h.from, this.t), to: Math.min(h.to, to) }))
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
    for (const s of segs) this.deplete(s.len, s.held, this.advanceCount++);
    this.t = to;
  }

  /** A delivery lands: it adds about exp(theta) days of coffee. */
  deliver(): void {
    const { M, R, theta, seed } = this;
    for (let m = 0; m < M; m++) R[m] = R[m]! + Math.exp(theta[m]! + this.sigmaB * zN(seed, 2, this.evIndex, m));
    this.evIndex++;
  }

  /** "About how many weeks of coffee do you have left?" (0-12). */
  reply(weeks: number): void {
    const wk = Math.max(0, Math.min(12, Math.round(weeks)));
    for (let m = 0; m < this.M; m++) this.logw[m] = this.logw[m]! + Math.log(replyLikelihood(wk, this.R[m]!, this.sigmaObs, this.garbage));
    this.evIndex++;
    this.finishObservation();
  }

  /** The customer skipped a delivery while holding 21+ days of coffee (soft constraint R > 21). */
  skip(): void {
    for (let m = 0; m < this.M; m++) this.logw[m] = this.logw[m]! + Math.log(this.R[m]! > ENGINE.skipThresholdDays ? ENGINE.skipWeightHigh : ENGINE.skipWeightLow);
    this.evIndex++;
    this.finishObservation();
  }

  private finishObservation(): void {
    const { M, logw, w, seed } = this;
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
    this.ess = 1 / s2;
    if (this.ess >= M * ENGINE.resampleFraction) return;
    // systematic resampling with jitter on theta and R
    const cum = new Float64Array(M);
    let acc = 0;
    for (let m = 0; m < M; m++) {
      acc += w[m]!;
      cum[m] = acc;
    }
    const u0 = uN(seed, 4, this.resamples, 0);
    const nt = new Float64Array(M);
    const nr = new Float64Array(M);
    let j = 0;
    for (let m = 0; m < M; m++) {
      const u = ((u0 + m) / M) * acc;
      while (j < M - 1 && cum[j]! < u) j++;
      nt[m] = this.theta[j]! + ENGINE.thetaJitter * zN(seed, 5, this.resamples, m);
      nr[m] = Math.max(this.R[j]! + ENGINE.rJitterDays * zN(seed, 6, this.resamples, m), 0);
    }
    this.theta = nt;
    this.R = nr;
    w.fill(1 / M);
    logw.fill(0);
    this.resamples++;
    this.ess = M;
  }

  /** Weighted quantiles of days on hand (the first hypothesis whose cumulative weight reaches q). */
  quantiles(qs: readonly number[]): number[] {
    const { M, R, w } = this;
    const order = Uint32Array.from({ length: M }, (_, i) => i).sort((a, b) => R[a]! - R[b]!);
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
  }

  quantile(q: number): number {
    return this.quantiles([q])[0]!;
  }

  meanR(): number {
    let s = 0;
    for (let m = 0; m < this.M; m++) s += this.w[m]! * this.R[m]!;
    return s;
  }

  /** Raw state for diagnostics and tests. */
  state(): { R: Float64Array; theta: Float64Array; w: Float64Array } {
    return { R: this.R, theta: this.theta, w: this.w };
  }
}

export interface FilterResult {
  asOf: Day;
  ess: number;
  resamples: number;
  quantile(q: number): number;
  quantiles(qs: readonly number[]): number[];
  meanR(): number;
  state(): { R: Float64Array; theta: Float64Array; w: Float64Array };
}

/** Run the filter over an event log. The result is a pure function of the log (counter-based randomness). */
export function runFilter(input: RunInput): FilterResult {
  const ordered = orderEvents(input.events);
  const tracker = new PantryTracker(input.prior, input.seed, ordered.length ? ordered[0]!.day : input.asOf, input.options);
  tracker.setHolds(holdWindows(input.events));
  for (const e of ordered) {
    if (e.day > input.asOf) break;
    tracker.advance(e.day);
    if (e.type === "delivery") tracker.deliver();
    else if (e.type === "skip") tracker.skip();
    else tracker.reply(e.weeks);
  }
  tracker.advance(input.asOf);
  return {
    asOf: input.asOf,
    ess: tracker.ess,
    resamples: tracker.resamples,
    quantile: (q) => tracker.quantile(q),
    quantiles: (qs) => tracker.quantiles(qs),
    meanR: () => tracker.meanR(),
    state: () => tracker.state(),
  };
}

/** A stable customer seed: hash of the global seed and the customer id. */
export function customerSeed(globalSeed: number, customerId: string): number {
  return hash32(globalSeed, customerId);
}
