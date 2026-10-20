import { ENGINE, EXHIBITS, GROSS_MARGIN, WORLD, type Source } from "../shared/constants.ts";
import { H } from "./world.ts";
import { MAXD, type PathSet } from "./policies.ts";

/**
 * Churn (spec 7.5). Daily hazard for customer i on day t:
 *   h(t) = h0[segment] x [(1 - phi) + phi x u_i(t)] x [1 + lambda x ranOut30_i(t)]
 * u = min(pile on the latest arrival / P_ref, 3): stockpiles drive the phi share of the hazard; running out adds a
 * penalty for 30 days. A customer's consumption path does not depend on whether they cancel (cancelling only truncates
 * it), so each path is simulated once with no churn and survival is applied analytically: S(t) = exp(-cumulative hazard).
 * h0 is solved by scalar bisection so that, under Fixed, mean survival at day 90 and day 365 equals Exhibit C. That
 * calibration is exactly identified: a code check, not validation.
 */
export interface Exposure {
  /** a_t = 1 + lambda x ranOut30 */
  mult: Float32Array;
  /** u_t */
  u: Float32Array;
}

export function meanArrivalPile(p: PathSet): number {
  let s = 0;
  let k = 0;
  for (let i = 0; i < p.n; i++) {
    const nd = p.nDeliveries[i]!;
    for (let j = 1; j < nd; j++) {
      s += p.pile[i * MAXD + j]!;
      k++;
    }
  }
  return Math.max(k ? s / k : 1, 1);
}

export function buildExposure(p: PathSet, pref: number, lambda = WORLD.lambda): Exposure {
  const n = p.n;
  const mult = new Float32Array(n * H);
  const u = new Float32Array(n * H);
  for (let i = 0; i < n; i++) {
    const b = i * H;
    const nd = p.nDeliveries[i]!;
    let j = 0;
    let run = 0;
    let ro = 0;
    for (let t = 0; t < H; t++) {
      while (j + 1 < nd && p.deliveryDay[i * MAXD + j + 1]! <= t) j++;
      const pile = p.pile[i * MAXD + j]!;
      u[b + t] = pile < 0 ? 1 : Math.min(pile / pref, 3);
      if (p.stock[b + t]! <= 0) run++;
      else run = 0;
      if (run === 3) ro = 30;
      mult[b + t] = 1 + lambda * (ro > 0 ? 1 : 0);
      if (ro > 0) ro--;
    }
  }
  return { mult, u };
}

export interface Hazards {
  h1: number;
  h2: number;
}

function segSums(e: Exposure, n: number, phi: number): { x1: Float64Array; x2: Float64Array } {
  const x1 = new Float64Array(n);
  const x2 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const b = i * H;
    let a = 0;
    let c = 0;
    for (let t = 0; t < 90; t++) a += e.mult[b + t]! * (1 - phi + phi * e.u[b + t]!);
    for (let t = 90; t < H; t++) c += e.mult[b + t]! * (1 - phi + phi * e.u[b + t]!);
    x1[i] = a;
    x2[i] = c;
  }
  return { x1, x2 };
}

export function calibrate(fixed: Exposure, n: number, phi: number, ret90: number, ret12: number): Hazards {
  const { x1, x2 } = segSums(fixed, n, phi);
  const solve = (f: (h: number) => number, target: number): number => {
    let lo = 1e-9;
    let hi = 1;
    for (let it = 0; it < 70; it++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const h1 = solve((h) => {
    let m = 0;
    for (let i = 0; i < n; i++) m += Math.exp(-h * x1[i]!);
    return m / n;
  }, ret90);
  const h2 = solve((h) => {
    let m = 0;
    for (let i = 0; i < n; i++) m += Math.exp(-h1 * x1[i]! - h * x2[i]!);
    return m / n;
  }, ret12);
  return { h1, h2 };
}

/** Per-customer expected values (survival-weighted), kept per customer so paired bootstraps are possible. */
export interface PerCustomer {
  ret90: Float64Array;
  ret12: Float64Array;
  /** expected active days in the year (sum of survival at the start of each day) */
  activeDays: Float64Array;
  deliveries: Float64Array;
  /** deliveries after the first */
  nonFirst: Float64Array;
  late: Float64Array;
  stockpile: Float64Array;
  /** sum of (days on hand x survival) */
  stockWeighted: Float64Array;
}

export function scoreCustomers(p: PathSet, e: Exposure, hz: Hazards, phi: number): PerCustomer {
  const n = p.n;
  const out: PerCustomer = {
    ret90: new Float64Array(n),
    ret12: new Float64Array(n),
    activeDays: new Float64Array(n),
    deliveries: new Float64Array(n),
    nonFirst: new Float64Array(n),
    late: new Float64Array(n),
    stockpile: new Float64Array(n),
    stockWeighted: new Float64Array(n),
  };
  const sStart = new Float64Array(H);
  for (let i = 0; i < n; i++) {
    const b = i * H;
    let cum = 0;
    for (let t = 0; t < H; t++) {
      sStart[t] = Math.exp(-cum);
      cum += (t < 90 ? hz.h1 : hz.h2) * e.mult[b + t]! * (1 - phi + phi * e.u[b + t]!);
      if (t === 89) out.ret90[i] = Math.exp(-cum);
    }
    out.ret12[i] = Math.exp(-cum);
    let act = 0;
    let stk = 0;
    for (let t = 0; t < H; t++) {
      act += sStart[t]!;
      stk += p.stock[b + t]! * sStart[t]!;
    }
    out.activeDays[i] = act;
    out.stockWeighted[i] = stk;
    const nd = p.nDeliveries[i]!;
    for (let j = 0; j < nd; j++) {
      const w = sStart[p.deliveryDay[i * MAXD + j]!]!;
      out.deliveries[i]! += w;
      if (j > 0) {
        out.nonFirst[i]! += w;
        if (p.late[i * MAXD + j]) out.late[i]! += w;
        if (p.pile[i * MAXD + j]! >= ENGINE.stockpileDays) out.stockpile[i]! += w;
      }
    }
  }
  return out;
}

export interface Summary {
  ret90: number;
  ret12: number;
  deliveriesPerActiveYear: number;
  lateShare: number;
  stockpileShare: number;
  meanDaysOnHand: number;
  /** mean days on hand + roast-to-door: the age of the coffee at the last cup (Little's law) */
  freshnessDays: number;
  /** gross profit per sign-up (shipped view), after the cost of coffee; net of the program cost when `charged` */
  profitPerSignUp: number;
}

const sum = (a: Float64Array, idx?: ArrayLike<number>): number => {
  let s = 0;
  if (idx) for (let k = 0; k < idx.length; k++) s += a[idx[k]!]!;
  else for (let i = 0; i < a.length; i++) s += a[i]!;
  return s;
};

/** Summaries for a set of customers (all, or a bootstrap resample given by indices). */
export function summarise(pc: PerCustomer, source: Source, charged: boolean, idx?: ArrayLike<number>): Summary {
  const n = idx ? idx.length : pc.ret12.length;
  const act = sum(pc.activeDays, idx);
  const del = sum(pc.deliveries, idx);
  const nf = sum(pc.nonFirst, idx);
  const years = act / H;
  const gp = (del * EXHIBITS.sources[source].aov * GROSS_MARGIN - (charged ? WORLD.programCostPerActiveYear * years : 0)) / n;
  const stockDays = sum(pc.stockWeighted, idx) / Math.max(act, 1e-9);
  return {
    ret90: sum(pc.ret90, idx) / n,
    ret12: sum(pc.ret12, idx) / n,
    deliveriesPerActiveYear: years > 0 ? del / years : 0,
    lateShare: nf > 0 ? sum(pc.late, idx) / nf : 0,
    stockpileShare: nf > 0 ? sum(pc.stockpile, idx) / nf : 0,
    meanDaysOnHand: stockDays,
    freshnessDays: stockDays + WORLD.roastToDoorDays,
    profitPerSignUp: gp,
  };
}

/**
 * Model-free break-even (spec 10): if a policy ships a share x fewer deliveries per active subscriber-year, how much
 * 12-month retention must the group keep to match Fixed on year-one gross profit, net of the program cost?
 * Piecewise-constant hazards fitted to the two Exhibit C points; find the scaling s of the hazard from day 90 on with
 *   (1 - x - c) SubYears(s) = SubYears(1),  c = program cost / gross profit per active year.
 * Only the hazard from day 90 on is scaled: nothing is ever moved before a customer's second completed delivery, so the
 * first 90 days cannot change. (Scaling them too understated the retention needed, and the bars then disagreed with the
 * profit line.)
 */
export function requiredRetention(
  x: number,
  base: { ret90: number; ret12: number },
  net?: { programCostPerYear: number; grossProfitPerActiveYear: number },
): { requiredRet12: number; requiredGainPP: number } {
  const h1 = -Math.log(base.ret90) / 90;
  const h2 = -Math.log(base.ret12 / base.ret90) / (H - 90);
  const subYears = (s: number): number => {
    let cum = 0;
    let acc = 0;
    for (let t = 0; t < H; t++) {
      acc += Math.exp(-cum);
      cum += t < 90 ? h1 : s * h2;
    }
    return acc / H;
  };
  const costShare = net ? net.programCostPerYear / net.grossProfitPerActiveYear : 0;
  const factor = 1 - x - costShare;
  const target = factor > 0 ? subYears(1) / factor : Infinity;
  let scale = 0;
  if (Number.isFinite(target) && target < subYears(0)) {
    let lo = 0;
    let hi = 6;
    for (let it = 0; it < 80; it++) {
      const mid = (lo + hi) / 2;
      if (subYears(mid) > target) lo = mid;
      else hi = mid;
    }
    scale = (lo + hi) / 2;
  }
  const requiredRet12 = base.ret90 * Math.exp(-scale * h2 * (H - 90));
  return { requiredRet12, requiredGainPP: (requiredRet12 - base.ret12) * 100 };
}
