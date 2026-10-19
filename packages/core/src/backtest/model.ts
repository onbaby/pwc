import { mean, median, normPpf, quantileSorted } from "../stats.ts";
import { kGroup, type Prediction, type Series } from "./data.ts";

/** Engine Layer A on real reorder gaps (PROTOCOL.md section 6). */
export interface LayerA {
  mu: number;
  sigmaW: number;
  tau: number;
  rho: number;
  p1: number;
  p99: number;
  productMean: Map<string, number>;
  productGaps: Map<string, number[]>;
  globalGaps: number[];
  /** Mondrian-by-k scale: c_k so that the standardised 80% range covers 80% on the calibration set */
  scale: Map<string, number>;
}

export function fitLayerA(fitGapsBySeries: Array<{ product: string; logGaps: number[] }>): Omit<LayerA, "scale"> {
  const all: number[] = [];
  const byProduct = new Map<string, number[]>();
  const productGaps = new Map<string, number[]>();
  let withinSS = 0;
  let withinDf = 0;
  const seriesMeans: Array<{ product: string; mean: number; n: number }> = [];
  for (const s of fitGapsBySeries) {
    if (s.logGaps.length === 0) continue;
    all.push(...s.logGaps);
    const arr = byProduct.get(s.product) ?? [];
    arr.push(...s.logGaps);
    byProduct.set(s.product, arr);
    const pg = productGaps.get(s.product) ?? [];
    pg.push(...s.logGaps.map(Math.exp));
    productGaps.set(s.product, pg);
    const m = mean(s.logGaps);
    seriesMeans.push({ product: s.product, mean: m, n: s.logGaps.length });
    if (s.logGaps.length >= 2) {
      for (const g of s.logGaps) withinSS += (g - m) ** 2;
      withinDf += s.logGaps.length - 1;
    }
  }
  const mu = mean(all);
  const sigmaW2 = withinSS / Math.max(withinDf, 1);

  // between-series variance within a product, method of moments
  const bySeriesProduct = new Map<string, Array<{ mean: number; n: number }>>();
  for (const sm of seriesMeans) {
    const a = bySeriesProduct.get(sm.product) ?? [];
    a.push({ mean: sm.mean, n: sm.n });
    bySeriesProduct.set(sm.product, a);
  }
  let ss = 0;
  let df = 0;
  let invN = 0;
  let cnt = 0;
  for (const arr of bySeriesProduct.values()) {
    if (arr.length < 2) continue;
    const pm = mean(arr.map((a) => a.mean));
    for (const a of arr) {
      ss += (a.mean - pm) ** 2;
      invN += 1 / a.n;
      cnt++;
    }
    df += arr.length - 1;
  }
  const vBetween = ss / Math.max(df, 1);
  const tau2 = Math.max(0.01, vBetween - sigmaW2 * (cnt ? invN / cnt : 0));

  const productMeansRaw: Array<{ p: string; mean: number; n: number }> = [];
  for (const [p, arr] of byProduct) productMeansRaw.push({ p, mean: mean(arr), n: arr.length });
  const big = productMeansRaw.filter((x) => x.n >= 10);
  const vp = big.length > 1 ? big.reduce((a, x) => a + (x.mean - mean(big.map((b) => b.mean))) ** 2, 0) / (big.length - 1) : 0.01;
  const samp = big.length ? mean(big.map((x) => (tau2 + sigmaW2) / x.n)) : 0;
  const rho2 = Math.max(0.01, vp - samp);

  const productMean = new Map<string, number>();
  for (const x of productMeansRaw) {
    const B = rho2 / (rho2 + (tau2 + sigmaW2) / x.n);
    productMean.set(x.p, mu + B * (x.mean - mu));
  }
  const allDays = Float64Array.from(all.map(Math.exp)).sort();
  return {
    mu,
    sigmaW: Math.sqrt(sigmaW2),
    tau: Math.sqrt(tau2),
    rho: Math.sqrt(rho2),
    p1: quantileSorted(allDays, 0.01),
    p99: quantileSorted(allDays, 0.99),
    productMean,
    productGaps,
    globalGaps: Array.from(allDays),
  };
}

export interface Posterior {
  mu: number;
  sd: number;
}

/** Normal posterior-predictive for the next log-gap (before conformal scaling). */
export function posterior(m: Omit<LayerA, "scale">, product: string, history: number[]): Posterior {
  const mp = m.productMean.get(product) ?? m.mu;
  const k = history.length;
  const gbar = mean(history.map(Math.log));
  const tau2 = m.tau ** 2;
  const sw2 = m.sigmaW ** 2;
  const prec = 1 / tau2 + k / sw2;
  const pm = (mp / tau2 + (k * gbar) / sw2) / prec;
  return { mu: pm, sd: Math.sqrt(1 / prec + sw2) };
}

const Z90 = normPpf(0.9);

export function conformalScales(m: Omit<LayerA, "scale">, calibration: Prediction[]): Map<string, number> {
  const groups = new Map<string, number[]>();
  for (const p of calibration) {
    if (p.y === undefined) continue;
    const po = posterior(m, p.product, p.history);
    const r = Math.abs(Math.log(p.y) - po.mu) / po.sd;
    const g = kGroup(p.k);
    const a = groups.get(g) ?? [];
    a.push(r);
    groups.set(g, a);
  }
  const out = new Map<string, number>();
  for (const [g, arr] of groups) {
    arr.sort((a, b) => a - b);
    const idx = Math.min(arr.length - 1, Math.ceil((arr.length + 1) * 0.8) - 1);
    out.set(g, arr[idx]!);
  }
  return out;
}

export function modelQuantile(m: LayerA, p: Prediction, q: number): number {
  const po = posterior(m, p.product, p.history);
  const c = m.scale.get(kGroup(p.k)) ?? Z90;
  const sd = (po.sd * c) / Z90;
  const days = Math.exp(po.mu + normPpf(q) * sd);
  return Math.min(m.p99, Math.max(m.p1, days));
}

/** Median of the last <= 3 gaps (B1). */
export function lastMedian3(history: number[]): number {
  return median(history.slice(-3));
}

export type { Series };
