import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { requiredRetention } from "../src/sim/churn.ts";
import { crossing, type ImpactArtifact } from "../src/sim/impact.ts";
import { trainPrior } from "../src/sim/prior.ts";
import { makeCustomer, nearestRhythm } from "../src/sim/world.ts";
import { allocatePaths, simulateCustomer, DEFAULT_SETTINGS } from "../src/sim/policies.ts";
import { buildExposure, calibrate, meanArrivalPile, scoreCustomers, summarise } from "../src/sim/churn.ts";
import { EXHIBITS, STOCKPILE_SOURCES } from "../src/shared/constants.ts";
import { parseGapsCsv } from "../src/sim/backtest/data.ts";
import { runBacktest, customerSplit, pinball, CUTOFF_DAY } from "../src/sim/backtest/run.ts";
import { fitPooling, posterior } from "../src/sim/backtest/model.ts";
import { Stream } from "../src/shared/rng.ts";

const root = resolve(import.meta.dirname, "..");
const impact = JSON.parse(readFileSync(resolve(root, "artifacts/impact.json"), "utf8")) as ImpactArtifact;
const backtest = JSON.parse(readFileSync(resolve(root, "artifacts/backtest.json"), "utf8"));
const di = impact.meta.phiGrid.indexOf(impact.meta.defaultPhi);

describe("simulator: calibration and sanity (spec 14)", () => {
  it("Fixed reproduces Exhibit C's retention by source (a code check, not validation)", () => {
    for (const c of impact.calibration) {
      expect(Math.abs(c.ret90Sim - c.ret90Target)).toBeLessThan(1e-3);
      expect(Math.abs(c.ret12Sim - c.ret12Target)).toBeLessThan(1e-3);
    }
  });
  it("Fixed ships between 5 and 9 deliveries per active subscriber-year", () => {
    for (const v of impact.fixed.deliveriesPerActiveYear) {
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(9);
    }
    expect(impact.warnings).toEqual([]);
  });
  it("mechanism: Paced has fewer stockpiles and no more deliveries than Fixed; Ceiling dominates Paced on late and stockpile shares", () => {
    expect(impact.paced.stockpileShare[di]!).toBeLessThan(impact.fixed.stockpileShare[di]!);
    expect(impact.paced.deliveriesFewerShare[di]!).toBeGreaterThanOrEqual(0);
    expect(impact.ceiling.lateShare[di]!).toBeLessThanOrEqual(impact.paced.lateShare[di]!);
    expect(impact.ceiling.stockpileShare[di]!).toBeLessThanOrEqual(impact.paced.stockpileShare[di]!);
  });
  it("the retention gain never decreases as more cancellations are stockpile-driven; at phi = 0 pacing cannot add profit", () => {
    for (const c of [impact.paced, impact.ceiling, impact.rule]) {
      for (let i = 1; i < c.gainPP.length; i++) expect(c.gainPP[i]!).toBeGreaterThanOrEqual(c.gainPP[i - 1]! - 0.05);
      expect(c.profitDelta[0]!).toBeLessThanOrEqual(0);
    }
  });
  it("paired bootstrap intervals bracket the point estimate and are tight at this sample size", () => {
    for (let i = 0; i < impact.meta.phiGrid.length; i++) {
      const [lo, hi] = impact.paced.gainCI[i]!;
      expect(lo).toBeLessThanOrEqual(impact.paced.gainPP[i]! + 1e-6);
      expect(hi).toBeGreaterThanOrEqual(impact.paced.gainPP[i]! - 1e-6);
    }
  });
  it("the bars agree with the profit line: the break-even crossing in retention points sits within 0.1 of where profit crosses zero", () => {
    for (const c of [impact.ceiling, impact.rule]) {
      const byBars = c.breakEvenPhi;
      const byProfit = crossing(impact.meta.phiGrid, c.profitDelta, c.profitDelta.map(() => 0));
      expect(byBars).not.toBeNull();
      expect(byProfit).not.toBeNull();
      expect(Math.abs(byBars! - byProfit!)).toBeLessThan(0.12);
    }
    // Paced never breaks even in this world: both measures say so
    expect(impact.paced.breakEvenPhi).toBeNull();
    expect(Math.max(...impact.paced.profitDelta)).toBeLessThan(0);
  });
  it("never applies a sooner date without a recorded YES; Layer B coverage is reported by deliveries completed and reply state", () => {
    expect(impact.diag.soonerAppliedWithoutYes).toBe(0);
    expect(impact.coverage.length).toBeGreaterThanOrEqual(8);
    for (const c of impact.coverage) {
      expect(c.total).toBeGreaterThan(1000);
      expect(c.share).toBeGreaterThan(0.7); // reported, not tuned
    }
  });
  it("reply rate is the biggest lever among the settings we vary", () => {
    const at = (label: string) => impact.better.find((b) => b.label.startsWith(label))!.gainAtDefaultPP;
    const reply = Math.abs(at("Reply rate 70%") - at("Reply rate 20%"));
    const acc = Math.abs(at("Replies accurate to") - at("Replies accurate only"));
    expect(reply).toBeGreaterThan(acc);
  });
  it("the model-free requirement: nothing to make up when nothing is cut; more as more is cut; costs raise it", () => {
    const base = { ret90: 0.631, ret12: 0.3056 };
    expect(requiredRetention(0, base).requiredGainPP).toBeCloseTo(0, 6);
    expect(requiredRetention(0.03, base).requiredGainPP).toBeGreaterThan(requiredRetention(0.01, base).requiredGainPP);
    expect(requiredRetention(0.01, base, { programCostPerYear: 2, grossProfitPerActiveYear: 160 }).requiredGainPP).toBeGreaterThan(requiredRetention(0.01, base).requiredGainPP);
  });
});

describe("simulator: live checks at small scale", () => {
  const prior = trainPrior(1500);
  it("the world is deterministic from the seed", () => {
    const a = makeCustomer("x-1", "in_cafe");
    const b = makeCustomer("x-1", "in_cafe");
    expect(a.theta).toBe(b.theta);
    expect(Array.from(a.pace.slice(0, 50))).toEqual(Array.from(b.pace.slice(0, 50)));
    expect(nearestRhythm(Math.log(30))).toBe(28);
    expect(nearestRhythm(Math.log(100))).toBe(84);
  });
  it("paths and scores are reproducible, Fixed calibrates to Exhibit C, Paced leaves less coffee piled up", () => {
    const n = 250;
    const src = "in_cafe" as const;
    const cs = Array.from({ length: n }, (_, i) => makeCustomer(`t-${i}`, src));
    const run = (policy: "fixed" | "paced") => {
      const out = allocatePaths(n);
      cs.forEach((c, i) => simulateCustomer(c, policy, { prior, settings: DEFAULT_SETTINGS }, out, i));
      return out;
    };
    const fixed = run("fixed");
    const fixed2 = run("fixed");
    expect(Array.from(fixed.stock.slice(0, 2000))).toEqual(Array.from(fixed2.stock.slice(0, 2000)));
    const pref = meanArrivalPile(fixed);
    const e = EXHIBITS.sources[src];
    const expo = buildExposure(fixed, pref);
    const hz = calibrate(expo, n, 0.4, e.ret90, e.ret12);
    const s = summarise(scoreCustomers(fixed, expo, hz, 0.4), src, false);
    expect(s.ret90).toBeCloseTo(e.ret90, 4);
    expect(s.ret12).toBeCloseTo(e.ret12, 4);
    const paced = run("paced");
    expect(meanArrivalPile(paced)).toBeLessThan(pref);
    expect(paced.counters.soonerAppliedWithoutYes).toBe(0);
  });
  it("the stockpile sources are the two Exhibit C 'too much coffee' sources", () => {
    expect([...STOCKPILE_SOURCES]).toEqual(["in_cafe", "website"]);
  });
});

describe("real-data model check: protocol, artifact and method", () => {
  it("the protocol was committed before the run, and nothing has touched it since", () => {
    const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
    const rel = "src/sim/backtest/PROTOCOL.md";
    expect(backtest.protocol.committedBeforeRun).toBe(true);
    expect(git("cat-file", "-t", backtest.protocol.commit)).toBe("commit");
    expect(git("log", "-1", "--format=%H", "--", rel)).toBe(backtest.protocol.commit);
    expect(git("status", "--porcelain", "--", rel)).toBe("");
  });
  it("is consistent with the committed derived table and reports its verdict honestly", () => {
    const meta = JSON.parse(readFileSync(resolve(root, "data/derived/online_retail_gaps.meta.json"), "utf8"));
    expect(backtest.dataset.gapsSha256).toBe(meta.gapsCsvSha256);
    expect(backtest.dataset.license).toBe("CC BY 4.0");
    const k = (s: string) => backtest.rows.find((r: { k: string }) => r.k === s);
    const beats = k("1").diff.hi < 0 && k("2").diff.hi < 0;
    const cov = ["1", "2", "3", "4"].every((s) => Math.abs(k(s).coverage80.model - 0.8) <= 0.05);
    expect(backtest.success.passed).toBe(beats && cov);
    expect(backtest.rows.map((r: { k: string }) => r.k)).toEqual(["1", "2", "3", "4", "5+"]);
  });
  it("pinball loss, the customer split and the pooling posterior behave", () => {
    expect(pinball(10, 6, 0.9)).toBeCloseTo(3.6, 9);
    expect(pinball(6, 10, 0.9)).toBeCloseTo(0.4, 9);
    let fit = 0;
    for (let i = 0; i < 5000; i++) if (customerSplit("c" + i) === "fit") fit++;
    expect(fit / 5000).toBeGreaterThan(0.66);
    expect(fit / 5000).toBeLessThan(0.74);
    const f = fitPooling([
      { product: "a", logGaps: [Math.log(30), Math.log(32), Math.log(28)] },
      { product: "a", logGaps: [Math.log(31), Math.log(29)] },
      { product: "b", logGaps: [Math.log(90), Math.log(95)] },
      { product: "b", logGaps: [Math.log(88), Math.log(92), Math.log(91)] },
    ]);
    const few = posterior(f, "a", [60]);
    const many = posterior(f, "a", Array(8).fill(60));
    expect(many.mu).toBeGreaterThan(few.mu);
    expect(many.sd).toBeLessThan(few.sd);
  });
  it("runs end to end on a synthetic world with known truth and reports sensible coverage", () => {
    const r = new Stream("synthetic-backtest");
    const lines = ["customer,product,firstDay,gaps"];
    for (let c = 0; c < 700; c++) {
      const level = Math.log(25 + r.next() * 80);
      let day = r.int(0, 500);
      const first = day;
      const gaps: number[] = [];
      while (gaps.length < 10) {
        const g = Math.max(7, Math.round(Math.exp(level + 0.25 * r.normal())));
        if (day + g > 738 || g > 180) break;
        gaps.push(g);
        day += g;
      }
      if (gaps.length >= 2) lines.push(`c${String(c).padStart(5, "0")},${10000 + (c % 5)},${first},${gaps.join(" ")}`);
    }
    const series = parseGapsCsv(lines.join("\r\n") + "\r\n");
    const out = runBacktest(series, { protocol: { path: "x", commit: "test", committedAt: "2026-01-01", committedBeforeRun: true, cutoffDay: CUTOFF_DAY }, dataset: { name: "synthetic", citation: "n/a", license: "n/a", gapsSha256: "n/a", counts: {} } });
    const k1 = out.rows.find((x) => x.k === "1")!;
    expect(k1.n).toBeGreaterThan(100);
    expect(Math.abs(k1.coverage80.model - 0.8)).toBeLessThan(0.1);
    expect(k1.diff.hi).toBeLessThan(0);
  });
});
