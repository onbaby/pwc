import { DECISION, SIM } from "../constants.ts";
import { EXHIBITS, type SourceName } from "../exhibits.ts";
import type { SimParams } from "./params.ts";
import { MAXD, type SourcePaths } from "./run.ts";
import { H } from "./world.ts";

/** Churn model (spec 5.2.3). Daily hazard: h0_seg x [(1-phi) a_t + phi b_t], a_t = 1 + lambda ro30_t, b_t = u_t a_t. */
export interface Exposure {
  /** a_t */
  mult: Float32Array;
  /** u_t = min(pile at the latest arrival / P_ref, 3); 1 before any pile is known */
  u: Float32Array;
}

/** Mean pile on arrival (days) over all deliveries after the first. */
export function meanArrivalPile(paths: SourcePaths): number {
  let s = 0;
  let k = 0;
  for (let i = 0; i < paths.n; i++) {
    const nd = paths.nDeliveries[i]!;
    for (let j = 1; j < nd; j++) {
      s += paths.pile[i * MAXD + j]!;
      k++;
    }
  }
  return Math.max(k ? s / k : 1, 1);
}

export function buildExposure(paths: SourcePaths, pref: number, lambda: number): Exposure {
  const n = paths.n;
  const mult = new Float32Array(n * H);
  const u = new Float32Array(n * H);
  for (let i = 0; i < n; i++) {
    const b = i * H;
    const nd = paths.nDeliveries[i]!;
    let j = 0; // index of latest delivery as of t
    let run = 0;
    let ro = 0;
    for (let t = 0; t < H; t++) {
      while (j + 1 < nd && paths.deliveryDay[i * MAXD + j + 1]! <= t) j++;
      const pile = paths.pile[i * MAXD + j]!;
      u[b + t] = pile < 0 ? 1 : Math.min(pile / pref, 3);
      if (paths.stock[b + t]! <= 0) run++;
      else run = 0;
      if (run === 3) ro = 30;
      mult[b + t] = 1 + lambda * (ro > 0 ? 1 : 0);
      if (ro > 0) ro--;
    }
  }
  return { mult, u };
}

/** Segment sums of the exposure per subscriber: days 0..89 and 90..364. */
function segmentSums(exp: Exposure, n: number, phi: number): { x1: Float64Array; x2: Float64Array } {
  const x1 = new Float64Array(n);
  const x2 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const b = i * H;
    let a = 0;
    let c = 0;
    for (let t = 0; t < 90; t++) a += exp.mult[b + t]! * (1 - phi + phi * exp.u[b + t]!);
    for (let t = 90; t < H; t++) c += exp.mult[b + t]! * (1 - phi + phi * exp.u[b + t]!);
    x1[i] = a;
    x2[i] = c;
  }
  return { x1, x2 };
}

export interface Hazards {
  h1: number;
  h2: number;
}

/** Scalar bisection so that, under Fixed, mean survival at day 90 and day 365 equals Exhibit C. */
export function calibrate(fixedExposure: Exposure, n: number, phi: number, ret90: number, ret12: number): Hazards {
  const { x1, x2 } = segmentSums(fixedExposure, n, phi);
  let lo = 1e-9;
  let hi = 1;
  for (let it = 0; it < 70; it++) {
    const mid = (lo + hi) / 2;
    let m = 0;
    for (let i = 0; i < n; i++) m += Math.exp(-mid * x1[i]!);
    m /= n;
    if (m > ret90) lo = mid;
    else hi = mid;
  }
  const h1 = (lo + hi) / 2;
  lo = 1e-9;
  hi = 1;
  for (let it = 0; it < 70; it++) {
    const mid = (lo + hi) / 2;
    let m = 0;
    for (let i = 0; i < n; i++) m += Math.exp(-h1 * x1[i]! - mid * x2[i]!);
    m /= n;
    if (m > ret12) lo = mid;
    else hi = mid;
  }
  return { h1, h2: (lo + hi) / 2 };
}

/** Raw survival-weighted sums per new subscriber (USD where noted). */
export interface Sums {
  ret90: number;
  ret12: number;
  activeDays: number;
  deliveries: number;
  nonFirst: number;
  late: number;
  stockpile: number;
  stockWeighted: number;
  consumed: number;
  gpShippedUSD: number;
  gpConsumedUSD: number;
}

export function scoreRun(paths: SourcePaths, exp: Exposure, hz: Hazards, phi: number, aov: number): Sums {
  const n = paths.n;
  const s: Sums = { ret90: 0, ret12: 0, activeDays: 0, deliveries: 0, nonFirst: 0, late: 0, stockpile: 0, stockWeighted: 0, consumed: 0, gpShippedUSD: 0, gpConsumedUSD: 0 };
  const sStart = new Float64Array(H);
  for (let i = 0; i < n; i++) {
    const b = i * H;
    let cum = 0;
    for (let t = 0; t < H; t++) {
      sStart[t] = Math.exp(-cum);
      const h = (t < 90 ? hz.h1 : hz.h2) * exp.mult[b + t]! * (1 - phi + phi * exp.u[b + t]!);
      cum += h;
      if (t === 89) s.ret90 += Math.exp(-cum);
    }
    s.ret12 += Math.exp(-cum);
    let act = 0;
    let stk = 0;
    let con = 0;
    for (let t = 0; t < H; t++) {
      const w = sStart[t]!;
      act += w;
      stk += paths.stock[b + t]! * w;
      con += paths.cons[b + t]! * w;
    }
    s.activeDays += act;
    s.stockWeighted += stk;
    s.consumed += con;
    const nd = paths.nDeliveries[i]!;
    for (let j = 0; j < nd; j++) {
      const d = paths.deliveryDay[i * MAXD + j]!;
      const w = sStart[d]!;
      s.deliveries += w;
      if (j > 0) {
        s.nonFirst += w;
        if (paths.late[i * MAXD + j]) s.late += w;
        if (paths.pile[i * MAXD + j]! >= DECISION.stockpileDays) s.stockpile += w;
      }
    }
  }
  const inv = 1 / n;
  s.ret90 *= inv;
  s.ret12 *= inv;
  s.activeDays *= inv;
  s.deliveries *= inv;
  s.nonFirst *= inv;
  s.late *= inv;
  s.stockpile *= inv;
  s.stockWeighted *= inv;
  s.consumed *= inv;
  s.gpShippedUSD = s.deliveries * aov * SIM.grossMargin;
  s.gpConsumedUSD = s.consumed * aov * SIM.grossMargin;
  return s;
}

export const ZERO_SUMS: Sums = { ret90: 0, ret12: 0, activeDays: 0, deliveries: 0, nonFirst: 0, late: 0, stockpile: 0, stockWeighted: 0, consumed: 0, gpShippedUSD: 0, gpConsumedUSD: 0 };

export function combineSums(parts: Array<{ sums: Sums; weight: number }>): Sums {
  const total = parts.reduce((a, p) => a + p.weight, 0);
  const out: Sums = { ...ZERO_SUMS };
  for (const { sums, weight } of parts) {
    const w = weight / total;
    for (const k of Object.keys(out) as Array<keyof Sums>) out[k] += sums[k] * w;
  }
  return out;
}

export interface DerivedMetrics {
  ret90: number;
  ret12: number;
  deliveriesPerActiveYear: number;
  deliveriesPerSub: number;
  subYearsPerSub: number;
  stockpileShare: number;
  lateShare: number;
  meanStockDays: number;
  freshnessDays: number;
  gpShippedPerSub: number;
  gpConsumedPerSub: number;
  gpShippedNetPerSub: number;
  gpConsumedNetPerSub: number;
}

export function deriveMetrics(s: Sums, params: SimParams, chargeProgramCost: boolean): DerivedMetrics {
  const subYears = s.activeDays / H;
  const cost = chargeProgramCost ? params.programCostPerSubYear * subYears : 0;
  const meanStock = s.activeDays > 0 ? s.stockWeighted / s.activeDays : 0;
  return {
    ret90: s.ret90,
    ret12: s.ret12,
    deliveriesPerActiveYear: subYears > 0 ? s.deliveries / subYears : 0,
    deliveriesPerSub: s.deliveries,
    subYearsPerSub: subYears,
    stockpileShare: s.nonFirst > 0 ? s.stockpile / s.nonFirst : 0,
    lateShare: s.nonFirst > 0 ? s.late / s.nonFirst : 0,
    meanStockDays: meanStock,
    freshnessDays: meanStock + SIM.roastToDoorDays,
    gpShippedPerSub: s.gpShippedUSD,
    gpConsumedPerSub: s.gpConsumedUSD,
    gpShippedNetPerSub: s.gpShippedUSD - cost,
    gpConsumedNetPerSub: s.gpConsumedUSD - cost,
  };
}

export function sourceAov(source: SourceName): number {
  return EXHIBITS.sources[source].aov;
}
