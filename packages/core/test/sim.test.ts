import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SimGridArtifact } from "@rot/contracts";
import { SimGridArtifactSchema } from "@rot/contracts";
import { EXHIBITS, SOURCES, groupBaseline, STOCKPILE_SOURCES } from "../src/exhibits.ts";
import { requiredRetention } from "../src/sim/breakeven.ts";
import { computeGrid, roundDeep } from "../src/sim/grid.ts";
import { meanArrivalPile } from "../src/sim/score.ts";
import { simulatePaths } from "../src/sim/tasks.ts";
import type { TaskSpec } from "../src/sim/tasks.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const grid: SimGridArtifact = SimGridArtifactSchema.parse(JSON.parse(readFileSync(resolve(root, "artifacts/sim_grid.json"), "utf8")));
const phiIdx = grid.meta.phiGrid.indexOf(grid.meta.defaultPhi);
const defaultCell = grid.cells.find((c) => c.key.replyBase === 0.45 && c.key.replyAccuracySd === 0.35 && c.key.cautiousness === 0.1)!;

describe("committed sim_grid.json: calibration and sanity (spec 5.2.6)", () => {
  it("Fixed reproduces Exhibit C's retention by source (code check, not validation)", () => {
    for (const row of grid.calibration) {
      expect(Math.abs(row.ret90Sim - row.ret90Target)).toBeLessThan(1e-5);
      expect(Math.abs(row.ret12Sim - row.ret12Target)).toBeLessThan(1e-5);
    }
    const blended = grid.fixed.results[phiIdx]!.blended;
    expect(blended.ret90).toBeCloseTo(0.54, 2);
    expect(blended.ret12).toBeCloseTo(0.236, 2);
  });
  it("Fixed ships between 5 and 9 deliveries per active subscriber-year", () => {
    for (const r of grid.fixed.results) {
      expect(r.blended.deliveriesPerActiveYear).toBeGreaterThanOrEqual(5);
      expect(r.blended.deliveriesPerActiveYear).toBeLessThanOrEqual(9);
    }
  });
  it("covers the full grid: 27 reply/accuracy/cautiousness cells x 11 phi values", () => {
    expect(grid.cells).toHaveLength(27);
    for (const c of grid.cells) expect(c.paced.results).toHaveLength(11);
    expect(grid.meta.subscribersPerSource).toBeGreaterThanOrEqual(8000);
  });
});

describe("mechanism tests (the sanity test is on mechanism, not dollars)", () => {
  it("(b) Paced ships no more deliveries per active year than Fixed in every cell", () => {
    for (const c of grid.cells) for (const r of c.paced.results) expect(r.vsFixed!.deliveriesFewerShare).toBeGreaterThanOrEqual(-1e-9);
  });
  it("(c) the retention gain never decreases as more cancellations are stockpile-driven", () => {
    for (const c of grid.cells) {
      let prev = -Infinity;
      for (const r of c.paced.results) {
        expect(r.vsFixed!.retention12GainPP).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = r.vsFixed!.retention12GainPP;
      }
    }
    let prev = -Infinity;
    for (const r of grid.ceiling.results) {
      expect(r.vsFixed!.retention12GainPP).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = r.vsFixed!.retention12GainPP;
    }
  });
  it("(d) at phi = 0 the shipped-view gross-profit delta of Paced is not positive", () => {
    for (const c of grid.cells) expect(c.paced.results[0]!.vsFixed!.gpShippedNetDeltaPerSub).toBeLessThanOrEqual(0);
  });
  it("(e) Ceiling beats Paced on late and stockpile shares", () => {
    const p = defaultCell.paced.results[phiIdx]!.group;
    const c = grid.ceiling.results[phiIdx]!.group;
    expect(c.lateShare).toBeLessThanOrEqual(p.lateShare);
    expect(c.stockpileShare).toBeLessThanOrEqual(p.stockpileShare);
  });
  it("(f) no policy ever applied a sooner date without a recorded YES", () => {
    const all = [grid.fixed, grid.quiz, grid.rule, grid.naive, grid.ceiling, ...grid.cells.map((c) => c.paced)];
    for (const pr of all) expect(pr.diag.soonerAppliedWithoutYes).toBe(0);
  });
  it("Paced cuts stockpiles relative to Fixed at the default cell", () => {
    const p = defaultCell.paced.results[phiIdx]!.group;
    const f = grid.fixed.results[phiIdx]!.group;
    expect(p.stockpileShare).toBeLessThan(f.stockpileShare);
    expect(p.meanStockDays).toBeLessThan(f.meanStockDays);
  });
  it("the bars agree with the profit line: Paced clears 'Required' only where net shipped profit is non-negative (within one grid step)", () => {
    for (const c of [defaultCell.paced, grid.ceiling]) {
      for (let i = 0; i < c.results.length; i++) {
        const v = c.results[i]!.vsFixed!;
        const barPays = v.retention12GainPP >= v.requiredGainNetOfCostPP;
        const profitPays = v.gpShippedNetDeltaPerSub >= 0;
        if (barPays !== profitPays) {
          // allow a disagreement only right at the crossing
          const nb = [c.results[i - 1], c.results[i + 1]].filter(Boolean).map((r) => r!.vsFixed!);
          const crosses = nb.some((n) => n.retention12GainPP >= n.requiredGainNetOfCostPP !== barPays || n.gpShippedNetDeltaPerSub >= 0 !== profitPays);
          expect(crosses).toBe(true);
        }
      }
    }
  });
  it("histogram bins sum to about 100 per 100 deliveries", () => {
    for (const pol of ["fixed", "paced", "ceiling", "rule", "naive", "quiz"] as const) {
      const sum = grid.histogram.per100[pol]!.reduce((a, b) => a + b, 0);
      expect(sum).toBeGreaterThan(99.9);
      expect(sum).toBeLessThan(100.1);
    }
  });
});

describe("break-even", () => {
  const base = groupBaseline(STOCKPILE_SOURCES);
  it("matches Exhibit C weighting for in-cafe + website", () => {
    expect(base.ret90).toBeCloseTo(0.631, 3);
    expect(base.ret12).toBeCloseTo(0.3056, 3);
    expect(base.newSubs).toBe(4000);
  });
  it("needs nothing when nothing is cut, and more as more is cut", () => {
    expect(requiredRetention(0, base).requiredGainPP).toBeCloseTo(0, 6);
    const a = requiredRetention(0.01, base).requiredGainPP;
    const b = requiredRetention(0.03, base).requiredGainPP;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(requiredRetention(-0.02, base).requiredGainPP).toBeLessThan(0);
    expect(requiredRetention(0.01, base, { programCostPerSubYear: 2, gpPerActiveYearUSD: 160 }).requiredGainPP).toBeGreaterThan(a);
  });
});

describe("live mechanism check at small scale", () => {
  const spec = (policy: TaskSpec["policy"]): TaskSpec => ({ paramsKey: "t", world: {}, settings: {}, policy, source: "in_cafe", subscribers: 600, seed: 20_261_018, phis: [0.4], uniformPhi: false });
  it("(a) Paced mean arrival pile is below Fixed; Ceiling lower still", () => {
    const fixed = meanArrivalPile(simulatePaths(spec("fixed"), "fixed"));
    const paced = meanArrivalPile(simulatePaths(spec("paced"), "paced"));
    const ceiling = meanArrivalPile(simulatePaths(spec("ceiling"), "ceiling"));
    expect(paced).toBeLessThan(fixed);
    expect(ceiling).toBeLessThan(paced);
  });
  it("paths are reproducible from the seed", () => {
    const a = simulatePaths(spec("paced"), "paced");
    const b = simulatePaths(spec("paced"), "paced");
    expect(Array.from(a.stock.slice(0, 4000))).toEqual(Array.from(b.stock.slice(0, 4000)));
    expect(a.counters).toEqual(b.counters);
  });
  it("same seed gives identical artifacts after rounding (tiny grid, inline workers)", async () => {
    const g1 = roundDeep(await computeGrid({ subscribersPerSource: 30, workers: 1 }));
    const g2 = roundDeep(await computeGrid({ subscribersPerSource: 30, workers: 1 }));
    expect(JSON.stringify(g1)).toBe(JSON.stringify(g2));
    SimGridArtifactSchema.parse(g1);
  });
});

describe("exhibit constants", () => {
  it("sum to 8,670 new subscribers a year", () => {
    expect(SOURCES.reduce((a, s) => a + EXHIBITS.sources[s].newSubs, 0)).toBe(EXHIBITS.dtc.newSubsPerYear);
  });
});
