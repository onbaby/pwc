import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BacktestArtifactSchema } from "@rot/contracts";
import { parseSeriesCsv, predictionsOf } from "../src/backtest/data.ts";
import { conformalScales, fitLayerA, lastMedian3, modelQuantile, posterior } from "../src/backtest/model.ts";
import { CUTOFF_DAY, customerSplit, pinball, runBacktest } from "../src/backtest/run.ts";
import { Rng } from "../src/rng.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const protocolRel = "packages/core/src/backtest/PROTOCOL.md";

describe("backtest building blocks", () => {
  it("pinball loss", () => {
    expect(pinball(10, 6, 0.33)).toBeCloseTo(0.33 * 4, 9);
    expect(pinball(6, 10, 0.33)).toBeCloseTo(0.67 * 4, 9);
  });
  it("splits customers about 70/30 and deterministically", () => {
    let fit = 0;
    for (let i = 0; i < 5000; i++) if (customerSplit("c" + String(i).padStart(5, "0")) === "fit") fit++;
    expect(fit / 5000).toBeGreaterThan(0.66);
    expect(fit / 5000).toBeLessThan(0.74);
    expect(customerSplit("c00001")).toBe(customerSplit("c00001"));
  });
  it("builds predictions without look-ahead: history holds only earlier gaps", () => {
    const [s] = parseSeriesCsv("customer,stockcode,days\nc1,85123,0 10 30 60 100\n");
    const preds = predictionsOf(s!);
    expect(preds.map((p) => p.k)).toEqual([1, 2, 3, 4]);
    expect(preds[0]!.history).toEqual([10]);
    expect(preds[0]!.y).toBe(20);
    expect(preds[2]!.history).toEqual([10, 20, 30]);
    expect(preds[3]!.y).toBeUndefined(); // last purchase: censored
    expect(lastMedian3([5, 8, 20, 9])).toBe(9);
  });
  it("posterior shrinks toward the product mean for few observations and toward the data for many", () => {
    const fit = fitLayerA([
      { product: "a", logGaps: [Math.log(30), Math.log(32), Math.log(28)] },
      { product: "a", logGaps: [Math.log(31), Math.log(29)] },
      { product: "b", logGaps: [Math.log(90), Math.log(95)] },
      { product: "b", logGaps: [Math.log(88), Math.log(92), Math.log(91)] },
    ]);
    const one = posterior(fit, "a", [60]);
    const many = posterior(fit, "a", Array(8).fill(60));
    expect(many.mu).toBeGreaterThan(one.mu);
    expect(many.sd).toBeLessThan(one.sd);
  });
  it("runs end to end on a synthetic world with a known truth and reports coverage near 80%", () => {
    const rng = new Rng("synthetic-backtest");
    const lines = ["customer,stockcode,days"];
    for (let c = 0; c < 900; c++) {
      const level = Math.log(25 + rng.next() * 80);
      let day = rng.int(0, 500);
      const days = [day];
      while (day < 735 && days.length < 16) {
        day += Math.max(7, Math.round(Math.exp(level + 0.25 * rng.normal())));
        if (day <= 738) days.push(day);
      }
      if (days.length >= 3) lines.push(`c${String(c).padStart(5, "0")},${10000 + (c % 5)},${days.join(" ")}`);
    }
    const series = parseSeriesCsv(lines.join("\n") + "\n");
    const out = runBacktest({
      series,
      protocol: { path: protocolRel, commit: "test", committedBeforeRun: true, cutoffDay: CUTOFF_DAY },
      dataset: { name: "synthetic", citation: "n/a", license: "n/a", seriesSha256: "n/a" },
    });
    BacktestArtifactSchema.parse(JSON.parse(JSON.stringify(out)));
    expect(out.rows).toHaveLength(5);
    const k1 = out.rows.find((r) => r.k === "1")!;
    expect(k1.n).toBeGreaterThan(100);
    expect(Math.abs(k1.coverage80.model - 0.8)).toBeLessThan(0.1);
    expect(k1.diffVsB3.hi).toBeLessThan(0);
    expect(out.splits.testPredictions).toBeGreaterThan(0);
  });
  it("conformal scale achieves its coverage on its own calibration data", () => {
    const rng = new Rng("conformal");
    const base = fitLayerA([{ product: "p", logGaps: Array.from({ length: 200 }, () => Math.log(40) + 0.3 * rng.normal()) }]);
    const cal = Array.from({ length: 800 }, () => ({ customer: "c", product: "p", k: 1, history: [40], predDay: 100, y: Math.exp(Math.log(40) + 0.3 * rng.normal()), targetEnd: 140 }));
    const scale = conformalScales(base, cal);
    const model = { ...base, scale };
    const cov = cal.filter((p) => p.y >= modelQuantile(model, p, 0.1) && p.y <= modelQuantile(model, p, 0.9)).length / cal.length;
    expect(cov).toBeGreaterThan(0.76);
    expect(cov).toBeLessThan(0.86);
  });
});

describe("committed backtest.json", () => {
  const art = BacktestArtifactSchema.parse(JSON.parse(readFileSync(resolve(root, "artifacts/backtest.json"), "utf8")));
  it("records a protocol commit that exists and is the latest commit touching PROTOCOL.md", () => {
    const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
    expect(art.protocol.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(git("cat-file", "-t", art.protocol.commit)).toBe("commit");
    expect(git("log", "-1", "--format=%H", "--", protocolRel)).toBe(art.protocol.commit);
    expect(art.protocol.committedBeforeRun).toBe(true);
  });
  it("matches the committed derived data", () => {
    const meta = JSON.parse(readFileSync(resolve(root, "data/derived/meta.json"), "utf8"));
    expect(art.dataset.seriesSha256).toBe(meta.series_csv_sha256);
    expect(art.dataset.license).toBe("CC BY 4.0");
  });
  it("evaluates the written-down success rule honestly", () => {
    const k = (s: string) => art.rows.find((r) => r.k === s)!;
    const beats = k("1").diffVsB3.hi < 0 && k("2").diffVsB3.hi < 0;
    const cov = ["1", "2", "3", "4"].every((s) => Math.abs(k(s).coverage80.model - 0.8) <= 0.05);
    expect(art.success.passed).toBe(beats && cov);
    expect(art.rows.map((r) => r.k)).toEqual(["1", "2", "3", "4", "5+"]);
  });
});
