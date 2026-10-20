import { mean, normPpf, quantileSorted } from "../../shared/stats.ts";
import { kGroup, type Prediction } from "./data.ts";

/** The method under test (PROTOCOL.md section 4): normal model on ln(gap) with partial pooling and Mondrian-by-k conformal scales. */
export interface FitInput {
  product: string;
  logGaps: number[];
}

export interface Fit {
  mu: number;
  sigmaW: number;
  tau: number;
  rho: number;
  p1: number;
  p99: number;
  productMean: Map<string, number>;
  productGaps: Map<string, number[]>;
  allGaps: number[];
}

export function fitPooling(series: FitInput[]): Fit {
  const all: number[] = [];
  const byProduct = new Map<string, number[]>();
  const seriesByProduct = new Map<string, Array<{ mean: number; n: number }>>();
  const productGaps = new Map<string, number[]>();
  let withinSS = 0;
  let withinDf = 0;
  for (const s of series) {
    if (!s.logGaps.length) continue;
    all.push(...s.logGaps);
    byProduct.set(s.product, [...(byProduct.get(s.product) ?? []), ...s.logGaps]);
    productGaps.set(s.product, [...(productGaps.get(s.product) ?? []), ...s.logGaps.map(Math.exp)]);
    const m = mean(s.logGaps);
    seriesByProduct.set(s.product, [...(seriesByProduct.get(s.product) ?? []), { mean: m, n: s.logGaps.length }]);
    if (s.logGaps.length >= 2) {
      for (const g of s.logGaps) withinSS += (g - m) ** 2;
      withinDf += s.logGaps.length - 1;
    }
  }
  const mu = mean(all);
  const sw2 = withinSS / Math.max(withinDf, 1);

  let ss = 0;
  let df = 0;
  let invN = 0;
  let cnt = 0;
  for (const arr of seriesByProduct.values()) {
    if (arr.length < 2) continue;
    const pm = mean(arr.map((a) => a.mean));
    for (const a of arr) {
      ss += (a.mean - pm) ** 2;
      invN += 1 / a.n;
      cnt++;
    }
    df += arr.length - 1;
  }
  const tau2 = Math.max(0.01, ss / Math.max(df, 1) - sw2 * (cnt ? invN / cnt : 0));

  const prods = [...byProduct.entries()].map(([p, a]) => ({ p, mean: mean(a), n: a.length }));
  const big = prods.filter((x) => x.n >= 10);
  const bigMean = mean(big.map((b) => b.mean));
  const vp = big.length > 1 ? big.reduce((a, x) => a + (x.mean - bigMean) ** 2, 0) / (big.length - 1) : 0.01;
  const rho2 = Math.max(0.01, vp - (big.length ? mean(big.map((x) => (tau2 + sw2) / x.n)) : 0));

  const productMean = new Map<string, number>();
  for (const x of prods) {
    const B = rho2 / (rho2 + (tau2 + sw2) / x.n);
    productMean.set(x.p, mu + B * (x.mean - mu));
  }
  const sortedDays = Float64Array.from(all.map(Math.exp)).sort();
  return {
    mu,
    sigmaW: Math.sqrt(sw2),
    tau: Math.sqrt(tau2),
    rho: Math.sqrt(rho2),
    p1: quantileSorted(sortedDays, 0.01),
    p99: quantileSorted(sortedDays, 0.99),
    productMean,
    productGaps,
    allGaps: Array.from(sortedDays),
  };
}

export function posterior(f: Fit, product: string, historyDays: number[]): { mu: number; sd: number } {
  const mp = f.productMean.get(product) ?? f.mu;
  const k = historyDays.length;
  const gbar = mean(historyDays.map(Math.log));
  const t2 = f.tau ** 2;
  const w2 = f.sigmaW ** 2;
  const prec = 1 / t2 + k / w2;
  return { mu: (mp / t2 + (k * gbar) / w2) / prec, sd: Math.sqrt(1 / prec + w2) };
}

const Z90 = normPpf(0.9);

export function conformalScales(f: Fit, calibration: Prediction[]): Map<string, number> {
  const groups = new Map<string, number[]>();
  for (const p of calibration) {
    if (p.y === undefined) continue;
    const po = posterior(f, p.product, p.history);
    const r = Math.abs(Math.log(p.y) - po.mu) / po.sd;
    groups.set(kGroup(p.k), [...(groups.get(kGroup(p.k)) ?? []), r]);
  }
  const out = new Map<string, number>();
  for (const [g, arr] of groups) {
    arr.sort((a, b) => a - b);
    out.set(g, arr[Math.min(arr.length - 1, Math.ceil((arr.length + 1) * 0.8) - 1)]!);
  }
  return out;
}

export function forecastQuantile(f: Fit, scale: Map<string, number>, p: Prediction, q: number): number {
  const po = posterior(f, p.product, p.history);
  const c = scale.get(kGroup(p.k)) ?? Z90;
  return Math.min(f.p99, Math.max(f.p1, Math.exp(po.mu + normPpf(q) * ((po.sd * c) / Z90))));
}
