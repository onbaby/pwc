import { fnv1a32 } from "./hash.ts";
import { Stream } from "../../shared/rng.ts";
import { mean, median, quantileSorted } from "../../shared/stats.ts";
import { K_GROUPS, kGroup, predictionsOf, type Prediction, type Series } from "./data.ts";
import { conformalScales, fitPooling, forecastQuantile, type Fit } from "./model.ts";

/** PROTOCOL.md in code. Constants here must match that file. */
export const CUTOFF_DAY = 365;
export const BOOTSTRAP_RESAMPLES = 2000;
export const BOOTSTRAP_SEED = 20_261_018;
export const QS = [0.1, 0.5, 0.9] as const;

export const customerSplit = (customer: string): "fit" | "calibration" => (fnv1a32(customer) % 10 < 7 ? "fit" : "calibration");
export const pinball = (y: number, f: number, q: number): number => (y >= f ? q * (y - f) : (1 - q) * (f - y));

export interface BacktestRow {
  k: string;
  n: number;
  customers: number;
  pinballMean: { model: number; bc: number };
  pinballByQ: Array<{ q: number; model: number; bc: number }>;
  mae: { model: number; bc: number; b0: number; b2: number };
  coverage80: { model: number; bc: number };
  medianWidthDays: { model: number; bc: number };
  diff: { mean: number; lo: number; hi: number };
}

export interface BacktestResult {
  protocol: { path: string; commit: string; committedAt: string; committedBeforeRun: boolean; cutoffDay: number };
  dataset: { name: string; citation: string; license: string; gapsSha256: string; counts: Record<string, number> };
  splits: {
    fitCustomers: number;
    calibrationCustomers: number;
    testCustomers: number;
    fitSeries: number;
    calibrationSeries: number;
    testSeries: number;
    fitGaps: number;
    calibrationPredictions: number;
    testPredictions: number;
    censoredTestPredictions: number;
  };
  model: { mu: number; sigmaW: number; tau: number; rho: number; p1Days: number; p99Days: number; conformalScale: Record<string, number>; bcMultipliers: Record<string, number> };
  rows: BacktestRow[];
  pooledCoverage80: number;
  success: { beatsAtK1: boolean; beatsAtK2: boolean; coverageWithinBand: Array<{ k: string; coverage: number; ok: boolean }>; passed: boolean; line: string };
}

interface PerPred {
  customer: string;
  g: string;
  lossModel: number[];
  lossBc: number[];
  aeModel: number;
  aeBc: number;
  aeB0: number;
  aeB2: number;
  covModel: boolean;
  covBc: boolean;
  wModel: number;
  wBc: number;
}

export interface Meta {
  protocol: BacktestResult["protocol"];
  dataset: BacktestResult["dataset"];
}

export function runBacktest(series: Series[], meta: Meta): BacktestResult {
  const fitCust = new Set<string>();
  const calCust = new Set<string>();
  const testCust = new Set<string>();
  const fitSeries = new Set<string>();
  const calSeries = new Set<string>();
  const testSeries = new Set<string>();

  // fit: completed gaps of fit customers that end before the cutoff
  const fitInput: Array<{ product: string; logGaps: number[] }> = [];
  let fitGaps = 0;
  for (const s of series) {
    if (customerSplit(s.customer) !== "fit") continue;
    const logGaps: number[] = [];
    for (let i = 0; i < s.gaps.length; i++) if (s.days[i + 1]! < CUTOFF_DAY) logGaps.push(Math.log(s.gaps[i]!));
    if (logGaps.length) {
      fitInput.push({ product: s.product, logGaps });
      fitGaps += logGaps.length;
      fitCust.add(s.customer);
      fitSeries.add(`${s.customer}|${s.product}`);
    }
  }
  const fit: Fit = fitPooling(fitInput);

  const cal: Prediction[] = [];
  const test: Prediction[] = [];
  let censored = 0;
  for (const s of series) {
    const isCal = customerSplit(s.customer) === "calibration";
    for (const p of predictionsOf(s)) {
      if (isCal && p.y !== undefined && p.targetEnd! < CUTOFF_DAY) {
        cal.push(p);
        calCust.add(s.customer);
        calSeries.add(`${s.customer}|${s.product}`);
      }
      if (p.day >= CUTOFF_DAY) {
        if (p.y === undefined) censored++;
        else {
          test.push(p);
          testCust.add(s.customer);
          testSeries.add(`${s.customer}|${s.product}`);
        }
      }
    }
  }
  const scale = conformalScales(fit, cal);

  // calibrated last gap: multipliers m_q = q-quantile of y / lastGap on the calibration set
  const ratios = Float64Array.from(cal.map((p) => p.y! / p.history[p.history.length - 1]!)).sort();
  const m = QS.map((q) => quantileSorted(ratios, q));
  const globalMedian = median(fit.allGaps);

  const rows: PerPred[] = test.map((p) => {
    const y = p.y!;
    const last = p.history[p.history.length - 1]!;
    const fm = QS.map((q) => forecastQuantile(fit, scale, p, q));
    const bc = m.map((x) => x * last);
    const b2 = fit.productGaps.has(p.product) ? median(fit.productGaps.get(p.product)!) : globalMedian;
    return {
      customer: p.customer,
      g: kGroup(p.k),
      lossModel: QS.map((q, i) => pinball(y, fm[i]!, q)),
      lossBc: QS.map((q, i) => pinball(y, bc[i]!, q)),
      aeModel: Math.abs(y - fm[1]!),
      aeBc: Math.abs(y - bc[1]!),
      aeB0: Math.abs(y - last),
      aeB2: Math.abs(y - b2),
      covModel: y >= fm[0]! && y <= fm[2]!,
      covBc: y >= bc[0]! && y <= bc[2]!,
      wModel: fm[2]! - fm[0]!,
      wBc: bc[2]! - bc[0]!,
    };
  });

  // paired bootstrap over customers of (model - Bc) mean pinball, per k
  const custIdx = new Map<string, number>();
  for (const r of rows) if (!custIdx.has(r.customer)) custIdx.set(r.customer, custIdx.size);
  const nC = custIdx.size;
  const boots = new Map<string, { mean: number; lo: number; hi: number }>();
  for (const g of K_GROUPS) {
    const sums = new Float64Array(nC);
    const counts = new Float64Array(nC);
    let tot = 0;
    let n = 0;
    for (const r of rows) {
      if (r.g !== g) continue;
      const d = mean(r.lossModel) - mean(r.lossBc);
      const c = custIdx.get(r.customer)!;
      sums[c] = sums[c]! + d;
      counts[c] = counts[c]! + 1;
      tot += d;
      n++;
    }
    if (!n) {
      boots.set(g, { mean: NaN, lo: NaN, hi: NaN });
      continue;
    }
    const rng = new Stream("backtest-bootstrap", BOOTSTRAP_SEED, g);
    const means = new Float64Array(BOOTSTRAP_RESAMPLES);
    for (let b = 0; b < BOOTSTRAP_RESAMPLES; b++) {
      let s = 0;
      let c = 0;
      for (let i = 0; i < nC; i++) {
        const j = rng.int(0, nC - 1);
        s += sums[j]!;
        c += counts[j]!;
      }
      means[b] = c ? s / c : 0;
    }
    means.sort();
    boots.set(g, { mean: tot / n, lo: means[Math.floor(0.025 * BOOTSTRAP_RESAMPLES)]!, hi: means[Math.ceil(0.975 * BOOTSTRAP_RESAMPLES) - 1]! });
  }

  const out: BacktestRow[] = K_GROUPS.map((g) => {
    const rs = rows.filter((r) => r.g === g);
    const avg = (f: (r: PerPred) => number) => (rs.length ? mean(rs.map(f)) : 0);
    return {
      k: g,
      n: rs.length,
      customers: new Set(rs.map((r) => r.customer)).size,
      pinballMean: { model: avg((r) => mean(r.lossModel)), bc: avg((r) => mean(r.lossBc)) },
      pinballByQ: QS.map((q, i) => ({ q, model: avg((r) => r.lossModel[i]!), bc: avg((r) => r.lossBc[i]!) })),
      mae: { model: avg((r) => r.aeModel), bc: avg((r) => r.aeBc), b0: avg((r) => r.aeB0), b2: avg((r) => r.aeB2) },
      coverage80: { model: avg((r) => (r.covModel ? 1 : 0)), bc: avg((r) => (r.covBc ? 1 : 0)) },
      medianWidthDays: { model: rs.length ? median(rs.map((r) => r.wModel)) : 0, bc: rs.length ? median(rs.map((r) => r.wBc)) : 0 },
      diff: boots.get(g)!,
    };
  });

  const row = (k: string) => out.find((r) => r.k === k)!;
  const beats1 = row("1").diff.hi < 0;
  const beats2 = row("2").diff.hi < 0;
  const cov = ["1", "2", "3", "4"].map((k) => ({ k, coverage: row(k).coverage80.model, ok: Math.abs(row(k).coverage80.model - 0.8) <= 0.05 }));
  const passed = beats1 && beats2 && cov.every((c) => c.ok);
  const laterBeat = ["3", "4"].every((k) => row(k).diff.hi < 0);
  let line: string;
  if (passed) {
    line = "On real data the method beat a calibrated last-gap baseline at the first two reorders, and its 80% ranges held within 5 points at each of the first four. The pilot still has to test replies and consumption.";
  } else if (beats1 && beats2 && !laterBeat) {
    line = "On real data the method beat last-gap for the first reorders but not the later ones; that is why the pilot starts with a text-only arm and no schedule changes.";
  } else {
    const why: string[] = [];
    if (!beats1) why.push("it did not beat the calibrated last-gap baseline at the first reorder");
    if (!beats2) why.push("it did not beat the calibrated last-gap baseline at the second reorder");
    for (const c of cov) if (!c.ok) why.push(`its 80% ranges covered ${(c.coverage * 100).toFixed(0)}% at reorder ${c.k}`);
    line = `The written-down success rule failed: ${why.join("; ")}. That is why the pilot starts with a text-only arm and no schedule changes.`;
  }
  return {
    protocol: meta.protocol,
    dataset: meta.dataset,
    splits: {
      fitCustomers: fitCust.size,
      calibrationCustomers: calCust.size,
      testCustomers: testCust.size,
      fitSeries: fitSeries.size,
      calibrationSeries: calSeries.size,
      testSeries: testSeries.size,
      fitGaps,
      calibrationPredictions: cal.length,
      testPredictions: test.length,
      censoredTestPredictions: censored,
    },
    model: { mu: fit.mu, sigmaW: fit.sigmaW, tau: fit.tau, rho: fit.rho, p1Days: fit.p1, p99Days: fit.p99, conformalScale: Object.fromEntries([...scale.entries()].sort()), bcMultipliers: { q10: m[0]!, q50: m[1]!, q90: m[2]! } },
    rows: out,
    pooledCoverage80: mean(rows.map((r) => (r.covModel ? 1 : 0))),
    success: { beatsAtK1: beats1, beatsAtK2: beats2, coverageWithinBand: cov, passed, line },
  };
}
