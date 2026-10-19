import { ENGINE, REPLY } from "../constants.ts";
import type { Day } from "../calendar.ts";
import { Rng } from "../rng.ts";

/** Prior on theta = ln(days one delivery lasts at the customer's usual pace). */
export interface ThetaPrior {
  mu: number;
  tau: number;
}

export interface FilterOptions {
  particles: number;
  sigmaB: number;
  nu: number;
  sigmaObs: number;
  garbageShare: number;
}

export const DEFAULT_FILTER_OPTIONS: FilterOptions = {
  particles: ENGINE.particles,
  sigmaB: ENGINE.sigmaB,
  nu: ENGINE.nu,
  sigmaObs: REPLY.noiseSd,
  garbageShare: REPLY.garbageShare,
};

export interface AwayWindow {
  from: Day;
  to: Day;
}

const SQRT_2PI = Math.sqrt(2 * Math.PI);

/**
 * Likelihood of a "weeks left" reply given `R` days on hand: (1-eps) LogNormal(ln max(7w,2); ln max(R,2), sigma_obs^2)
 * + eps (1/90). A density per day, comparable across particles.
 */
export function replyLikelihood(weeks: number, R: number, sigmaObs: number = REPLY.noiseSd, garbageShare: number = REPLY.garbageShare): number {
  const x = Math.max(weeks * 7, ENGINE.logFloorDays);
  const Rr = Math.max(R, ENGINE.logFloorDays);
  const z = (Math.log(x) - Math.log(Rr)) / sigmaObs;
  const pdf = Math.exp(-0.5 * z * z) / (x * sigmaObs * SQRT_2PI);
  return (1 - garbageShare) * pdf + garbageShare * REPLY.garbageDensityPerDay;
}

/**
 * Layer B: the pantry filter (spec 6.2).
 * Hidden state per particle m: (theta_m, R_m) = (log days a delivery lasts, days of coffee on hand now).
 * Pure given its Rng; no I/O.
 */
export class PantryFilter {
  readonly M: number;
  readonly opts: FilterOptions;
  theta: Float64Array;
  R: Float64Array;
  /** log-weights (unnormalised); reset to 0 on resample. */
  logw: Float64Array;
  /** normalised weights, kept in sync after every observation. */
  w: Float64Array;
  t: number;
  private rng: Rng;

  constructor(prior: ThetaPrior, rng: Rng, opts: Partial<FilterOptions> = {}, startDay: Day = 0) {
    this.opts = { ...DEFAULT_FILTER_OPTIONS, ...opts };
    this.M = this.opts.particles;
    this.rng = rng;
    this.theta = new Float64Array(this.M);
    this.R = new Float64Array(this.M);
    this.logw = new Float64Array(this.M);
    this.w = new Float64Array(this.M).fill(1 / this.M);
    for (let i = 0; i < this.M; i++) this.theta[i] = prior.mu + prior.tau * rng.normal();
    this.t = startDay;
  }

  clone(): PantryFilter {
    const f = Object.create(PantryFilter.prototype) as PantryFilter;
    (f as { M: number }).M = this.M;
    (f as { opts: FilterOptions }).opts = this.opts;
    f.theta = this.theta.slice();
    f.R = this.R.slice();
    f.logw = this.logw.slice();
    f.w = this.w.slice();
    f.t = this.t;
    (f as unknown as { rng: Rng }).rng = this.rng.clone();
    return f;
  }

  /** Move the clock to day `t`, depleting the pantry. `away` windows pause consumption and widen the range. */
  advance(t: Day, away: readonly AwayWindow[] = []): void {
    if (t <= this.t) return;
    const segments: Array<{ len: number; away: boolean }> = [];
    let cur = this.t;
    const windows = away
      .map((a) => ({ from: Math.max(a.from, this.t), to: Math.min(a.to, t) }))
      .filter((a) => a.to > a.from)
      .sort((a, b) => a.from - b.from);
    for (const a of windows) {
      if (a.from < cur) a.from = cur;
      if (a.to <= a.from) continue;
      if (a.from > cur) segments.push({ len: a.from - cur, away: false });
      segments.push({ len: a.to - a.from, away: true });
      cur = a.to;
    }
    if (t > cur) segments.push({ len: t - cur, away: false });
    for (const seg of segments) this.depleteSegment(seg.len, seg.away);
    this.t = t;
  }

  private depleteSegment(len: number, away: boolean): void {
    const { nu } = this.opts;
    const R = this.R;
    for (let i = 0; i < this.M; i++) {
      if (away) {
        // Consumption paused; the pantry level itself becomes less certain (nu widened).
        const f = Math.exp(ENGINE.awayNuMult * nu * Math.sqrt(len / 30) * this.rng.normal());
        R[i] = R[i]! * f;
      } else {
        const pace = Math.exp(nu * Math.sqrt(len / 30) * this.rng.normal());
        R[i] = Math.max(R[i]! - len * pace, 0);
      }
    }
  }

  /** A delivery lands: a delivery gives about exp(theta) days of coffee. */
  deliver(): void {
    const { sigmaB } = this.opts;
    for (let i = 0; i < this.M; i++) this.R[i] = this.R[i]! + Math.exp(this.theta[i]! + sigmaB * this.rng.normal());
  }

  /** "About how many weeks of coffee do you have left?" reply (0-12). */
  observeWeeks(weeks: number): void {
    const { sigmaObs, garbageShare } = this.opts;
    for (let i = 0; i < this.M; i++) {
      this.logw[i] = this.logw[i]! + Math.log(replyLikelihood(weeks, this.R[i]!, sigmaObs, garbageShare));
    }
    this.finishObservation();
  }

  /** The customer skipped a delivery that would have arrived with >= 21 days on hand (implicit evidence). */
  observeSkip(): void {
    for (let i = 0; i < this.M; i++) {
      const lik = this.R[i]! > ENGINE.skipThresholdDays ? ENGINE.skipWeightTrue : ENGINE.skipWeightFalse;
      this.logw[i] = this.logw[i]! + Math.log(lik);
    }
    this.finishObservation();
  }

  private finishObservation(): void {
    const M = this.M;
    let max = -Infinity;
    for (let i = 0; i < M; i++) if (this.logw[i]! > max) max = this.logw[i]!;
    let sum = 0;
    for (let i = 0; i < M; i++) {
      const e = Math.exp(this.logw[i]! - max);
      this.w[i] = e;
      sum += e;
    }
    // Normalise and mix in a 1% flat floor so the posterior can never collapse.
    const floor = ENGINE.weightFloor;
    let s2 = 0;
    for (let i = 0; i < M; i++) {
      const wi = (1 - floor) * (this.w[i]! / sum) + floor / M;
      this.w[i] = wi;
      s2 += wi * wi;
    }
    for (let i = 0; i < M; i++) this.logw[i] = Math.log(this.w[i]!);
    const ess = 1 / s2;
    if (ess < M * ENGINE.resampleFraction) this.resample();
  }

  /** Systematic resampling with a small jitter on theta. */
  private resample(): void {
    const M = this.M;
    const cum = new Float64Array(M);
    let acc = 0;
    for (let i = 0; i < M; i++) {
      acc += this.w[i]!;
      cum[i] = acc;
    }
    const u0 = this.rng.next();
    const newTheta = new Float64Array(M);
    const newR = new Float64Array(M);
    let j = 0;
    for (let i = 0; i < M; i++) {
      const u = (u0 + i) / M;
      while (j < M - 1 && cum[j]! < u * acc) j++;
      newTheta[i] = this.theta[j]! + ENGINE.thetaJitter * this.rng.normal();
      newR[i] = this.R[j]!;
    }
    this.theta = newTheta;
    this.R = newR;
    this.w.fill(1 / M);
    this.logw.fill(0);
  }

  /** Weighted quantiles of days of coffee on hand now (first particle whose cumulative weight reaches q). */
  quantiles(qs: readonly number[]): number[] {
    const M = this.M;
    const order = Array.from({ length: M }, (_, i) => i).sort((a, b) => this.R[a]! - this.R[b]!);
    const cw = new Float64Array(M);
    let acc = 0;
    for (let k = 0; k < M; k++) {
      acc += this.w[order[k]!]!;
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
      return this.R[order[lo]!]!;
    });
  }

  /** Posterior mean of days on hand (diagnostics). */
  meanR(): number {
    let s = 0;
    for (let i = 0; i < this.M; i++) s += this.w[i]! * this.R[i]!;
    return s;
  }
}
