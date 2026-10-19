import type { BacktestArtifact, BacktestRow } from "@rot/contracts";
import { fnv1a32, Rng } from "../rng.ts";
import { mean, median, normPpf, quantile } from "../stats.ts";
import { K_GROUPS, kGroup, predictionsOf, type Prediction, type Series } from "./data.ts";
import { conformalScales, fitLayerA, lastMedian3, modelQuantile, posterior, type LayerA } from "./model.ts";

/** The protocol (PROTOCOL.md) in code. Constants here must match that file. */
export const CUTOFF_DAY = 365; // 2010-12-01 from 2009-12-01
export const BOOTSTRAP_RESAMPLES = 2000;
export const BOOTSTRAP_SEED = 20_261_018;
export const Q_PINBALL = 0.33;
export const SERVICE_Q = 0.1;
export const GRACE_DAYS = 3;

export type Split = "fit" | "calibration";
export function customerSplit(customer: string): Split {
  return fnv1a32(customer) % 10 < 7 ? "fit" : "calibration";
}

export function pinball(y: number, f: number, q: number): number {
  const d = y - f;
  return d >= 0 ? q * d : (q - 1) * d;
}

interface PerPrediction {
  customer: string;
  g: string;
  y: number;
  lossModel: number;
  lossB0: number;
  lossB1: number;
  lossB2: number;
  lossB3: number;
  lossB4: number;
  aeModel: number;
  aeB0: number;
  aeB1: number;
  aeB2: number;
  aeB3: number;
  aeB4: number;
  covModel: boolean;
  covB3: boolean;
  covB4: boolean;
  widthModel: number;
  widthB3: number;
  widthB4: number;
  ruleArrival: number;
  b0: number;
  b1: number;
}

function sortedQuantiles(xs: number[], qs: number[]): number[] {
  const s = Float64Array.from(xs).sort();
  return qs.map((q) => quantile(s, q));
}

export interface BacktestInputs {
  series: Series[];
  protocol: BacktestArtifact["protocol"];
  dataset: BacktestArtifact["dataset"];
}

export function runBacktest(inp: BacktestInputs): BacktestArtifact {
  const { series } = inp;
  const fitCustomers = new Set<string>();
  const calCustomers = new Set<string>();
  const testCustomers = new Set<string>();
  const fitSeriesSet = new Set<string>();
  const calSeriesSet = new Set<string>();
  const testSeriesSet = new Set<string>();

  // ---- fit set: completed gaps of fit customers that end before the cutoff
  const fitInput: Array<{ product: string; logGaps: number[] }> = [];
  let fitGaps = 0;
  for (const s of series) {
    if (customerSplit(s.customer) !== "fit") continue;
    const logGaps: number[] = [];
    for (let i = 1; i < s.days.length; i++) {
      if (s.days[i]! < CUTOFF_DAY) logGaps.push(Math.log(s.days[i]! - s.days[i - 1]!));
    }
    if (logGaps.length) {
      fitInput.push({ product: s.product, logGaps });
      fitGaps += logGaps.length;
      fitCustomers.add(s.customer);
      fitSeriesSet.add(s.customer + "|" + s.product);
    }
  }
  const base = fitLayerA(fitInput);

  // ---- calibration predictions (calibration customers, target ends before the cutoff)
  const cal: Prediction[] = [];
  const test: Prediction[] = [];
  let censoredTest = 0;
  for (const s of series) {
    const split = customerSplit(s.customer);
    for (const p of predictionsOf(s)) {
      if (split === "calibration" && p.y !== undefined && p.targetEnd! < CUTOFF_DAY) {
        cal.push(p);
        calCustomers.add(s.customer);
        calSeriesSet.add(s.customer + "|" + s.product);
      }
      if (p.predDay >= CUTOFF_DAY) {
        if (p.y === undefined) censoredTest++;
        else {
          test.push(p);
          testCustomers.add(s.customer);
          testSeriesSet.add(s.customer + "|" + s.product);
        }
      }
    }
  }
  const scale = conformalScales(base, cal);
  const model: LayerA = { ...base, scale };

  // ---- baselines fitted on calibration (B3) or fit (B2, B4)
  const ratios = cal.map((p) => p.y! / lastMedian3(p.history));
  const [m33, m50, m10, m90] = sortedQuantiles(ratios, [Q_PINBALL, 0.5, 0.1, 0.9]) as [number, number, number, number];
  const globalMedian = median(base.globalGaps);
  const productQ = (product: string, q: number): number => {
    const arr = base.productGaps.get(product);
    if (!arr || arr.length === 0) return quantile(base.globalGaps, q);
    return quantile(arr, q);
  };

  // ---- evaluate on the test set
  const rows: PerPrediction[] = test.map((p) => {
    const y = p.y!;
    const f33 = modelQuantile(model, p, Q_PINBALL);
    const f50 = modelQuantile(model, p, 0.5);
    const f10 = modelQuantile(model, p, 0.1);
    const f90 = modelQuantile(model, p, 0.9);
    const b0 = p.history[p.history.length - 1]!;
    const b1 = lastMedian3(p.history);
    const b2 = base.productGaps.has(p.product) ? median(base.productGaps.get(p.product)!) : globalMedian;
    const b3q = b1 * m33;
    const b3Med = b1 * m50;
    const b3lo = b1 * m10;
    const b3hi = b1 * m90;
    const b4q = productQ(p.product, Q_PINBALL);
    const b4Med = productQ(p.product, 0.5);
    const b4lo = productQ(p.product, 0.1);
    const b4hi = productQ(p.product, 0.9);
    const ruleArrival = Math.round(modelQuantile(model, p, SERVICE_Q)) + GRACE_DAYS;
    return {
      customer: p.customer,
      g: kGroup(p.k),
      y,
      lossModel: pinball(y, f33, Q_PINBALL),
      lossB0: pinball(y, b0, Q_PINBALL),
      lossB1: pinball(y, b1, Q_PINBALL),
      lossB2: pinball(y, b2, Q_PINBALL),
      lossB3: pinball(y, b3q, Q_PINBALL),
      lossB4: pinball(y, b4q, Q_PINBALL),
      aeModel: Math.abs(y - f50),
      aeB0: Math.abs(y - b0),
      aeB1: Math.abs(y - b1),
      aeB2: Math.abs(y - b2),
      aeB3: Math.abs(y - b3Med),
      aeB4: Math.abs(y - b4Med),
      covModel: y >= f10 && y <= f90,
      covB3: y >= b3lo && y <= b3hi,
      covB4: y >= b4lo && y <= b4hi,
      widthModel: f90 - f10,
      widthB3: b3hi - b3lo,
      widthB4: b4hi - b4lo,
      ruleArrival,
      b0,
      b1,
    };
  });

  // ---- paired bootstrap over customers (difference model - B3 in pinball@0.33)
  const custIndex = new Map<string, number>();
  for (const r of rows) if (!custIndex.has(r.customer)) custIndex.set(r.customer, custIndex.size);
  const nC = custIndex.size;
  const bootstrapByK = new Map<string, { mean: number; lo: number; hi: number }>();
  for (const g of K_GROUPS) {
    const sums = new Float64Array(nC);
    const counts = new Float64Array(nC);
    let total = 0;
    let n = 0;
    for (const r of rows) {
      if (r.g !== g) continue;
      const c = custIndex.get(r.customer)!;
      sums[c] = sums[c]! + (r.lossModel - r.lossB3);
      counts[c] = counts[c]! + 1;
      total += r.lossModel - r.lossB3;
      n++;
    }
    if (n === 0) {
      bootstrapByK.set(g, { mean: NaN, lo: NaN, hi: NaN });
      continue;
    }
    const rng = new Rng("bootstrap", BOOTSTRAP_SEED, g);
    const means = new Float64Array(BOOTSTRAP_RESAMPLES);
    for (let b = 0; b < BOOTSTRAP_RESAMPLES; b++) {
      let s = 0;
      let c = 0;
      for (let i = 0; i < nC; i++) {
        const j = rng.int(0, nC - 1);
        s += sums[j]!;
        c += counts[j]!;
      }
      means[b] = c > 0 ? s / c : 0;
    }
    means.sort();
    bootstrapByK.set(g, { mean: total / n, lo: means[Math.floor(0.025 * BOOTSTRAP_RESAMPLES)]!, hi: means[Math.ceil(0.975 * BOOTSTRAP_RESAMPLES) - 1]! });
  }

  const outRows: BacktestRow[] = K_GROUPS.map((g) => {
    const rs = rows.filter((r) => r.g === g);
    const m = (f: (r: PerPrediction) => number) => (rs.length ? mean(rs.map(f)) : NaN);
    const decide = (arrival: (r: PerPrediction) => number, grace = false) => {
      void grace;
      const late = rs.filter((r) => arrival(r) - r.y >= GRACE_DAYS).length / Math.max(rs.length, 1);
      const early = rs.length ? mean(rs.map((r) => Math.max(r.y - arrival(r), 0))) : NaN;
      return { lateShare: late, meanDaysEarly: early };
    };
    return {
      k: g,
      n: rs.length,
      customers: new Set(rs.map((r) => r.customer)).size,
      pinball33: { model: m((r) => r.lossModel), b0: m((r) => r.lossB0), b1: m((r) => r.lossB1), b2: m((r) => r.lossB2), b3: m((r) => r.lossB3), b4: m((r) => r.lossB4) },
      mae: { model: m((r) => r.aeModel), b0: m((r) => r.aeB0), b1: m((r) => r.aeB1), b2: m((r) => r.aeB2), b3: m((r) => r.aeB3), b4: m((r) => r.aeB4) },
      coverage80: { model: m((r) => (r.covModel ? 1 : 0)), b3: m((r) => (r.covB3 ? 1 : 0)), b4: m((r) => (r.covB4 ? 1 : 0)) },
      medianWidthDays: { model: rs.length ? median(rs.map((r) => r.widthModel)) : NaN, b3: rs.length ? median(rs.map((r) => r.widthB3)) : NaN, b4: rs.length ? median(rs.map((r) => r.widthB4)) : NaN },
      diffVsB3: bootstrapByK.get(g)!,
      decision: { rule: decide((r) => r.ruleArrival), b0: decide((r) => r.b0), b1: decide((r) => r.b1) },
    };
  });

  // ---- success rule (PROTOCOL.md section 9)
  const rowK = (k: string) => outRows.find((r) => r.k === k)!;
  const beats1 = rowK("1").diffVsB3.hi < 0;
  const beats2 = rowK("2").diffVsB3.hi < 0;
  const coverageWithinBand = ["1", "2", "3", "4"].map((k) => {
    const c = rowK(k).coverage80.model;
    return { k, coverage: c, ok: Math.abs(c - 0.8) <= 0.05 };
  });
  const passed = beats1 && beats2 && coverageWithinBand.every((c) => c.ok);
  const laterBeat = ["3", "4"].every((k) => rowK(k).diffVsB3.hi < 0);
  let line: string;
  if (passed) {
    line = "On real data the method beat a calibrated last-gap rule at the first two reorders, and its 80% ranges held within 5 points at each of the first four. The pilot still has to test replies and consumption.";
  } else if (beats1 && beats2 && !laterBeat) {
    line = "On real data the method beat last-gap for the first reorders but not the later ones; that is why the pilot starts with a text-only arm and no schedule changes.";
  } else {
    const reasons: string[] = [];
    if (!beats1) reasons.push("it did not beat the calibrated last-gap rule at the first reorder");
    if (!beats2) reasons.push("it did not beat the calibrated last-gap rule at the second reorder");
    for (const c of coverageWithinBand) if (!c.ok) reasons.push(`its 80% ranges covered ${(c.coverage * 100).toFixed(0)}% at reorder ${c.k}`);
    line = `The written-down success rule failed: ${reasons.join("; ")}. That is why the pilot starts with a text-only arm and no schedule changes.`;
  }
  void normPpf;
  const pooled = mean(rows.map((r) => (r.covModel ? 1 : 0)));

  return {
    protocol: inp.protocol,
    dataset: inp.dataset,
    splits: {
      fitCustomers: fitCustomers.size,
      calibrationCustomers: calCustomers.size,
      testCustomers: testCustomers.size,
      fitSeries: fitSeriesSet.size,
      calibrationSeries: calSeriesSet.size,
      testSeries: testSeriesSet.size,
      fitGaps,
      calibrationPredictions: cal.length,
      testPredictions: test.length,
      censoredTestPredictions: censoredTest,
    },
    model: {
      globalMeanLogGap: base.mu,
      sigmaW: base.sigmaW,
      tau: base.tau,
      rho: base.rho,
      p1Days: base.p1,
      p99Days: base.p99,
      conformalScale: Object.fromEntries([...scale.entries()].sort()),
      b3Multiplier33: m33,
    },
    rows: outRows,
    pooledCoverage80: { model: pooled },
    success: { pinballBeatsB3AtK1: beats1, pinballBeatsB3AtK2: beats2, coverageWithinBand, passed, line },
  };
}

void posterior;
