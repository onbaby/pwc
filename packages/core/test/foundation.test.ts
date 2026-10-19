import { describe, expect, it } from "vitest";
import { Rng, fnv1a32, hashSeed } from "../src/rng.ts";
import { mean, ols, normCdf, normPpf, quantile, sd, solveLinear } from "../src/stats.ts";
import { dayOf, fmtMonthDay, fmtShort, nextShipDay, parseISO, toISO, weekday } from "../src/calendar.ts";

describe("rng", () => {
  it("is deterministic and seed-sensitive", () => {
    const a = new Rng("x", 1);
    const b = new Rng("x", 1);
    const c = new Rng("x", 2);
    const xs = Array.from({ length: 20 }, () => a.next());
    expect(xs).toEqual(Array.from({ length: 20 }, () => b.next()));
    expect(xs).not.toEqual(Array.from({ length: 20 }, () => c.next()));
  });
  it("produces uniform [0,1) and standard normal draws", () => {
    const r = new Rng("moments");
    const u = Array.from({ length: 50_000 }, () => r.next());
    expect(Math.min(...u)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...u)).toBeLessThan(1);
    expect(mean(u)).toBeCloseTo(0.5, 2);
    const z = Array.from({ length: 50_000 }, () => r.normal());
    expect(mean(z)).toBeCloseTo(0, 1);
    expect(sd(z)).toBeCloseTo(1, 1);
  });
  it("clone continues the same stream", () => {
    const a = new Rng("clone");
    a.normal();
    const b = a.clone();
    expect([a.normal(), a.next(), a.int(0, 9)]).toEqual([b.normal(), b.next(), b.int(0, 9)]);
  });
  it("hashSeed and fnv1a32 are stable", () => {
    expect(hashSeed("a", 1)).toBe(hashSeed("a", 1));
    expect(hashSeed("a", 1)).not.toBe(hashSeed("a", 2));
    expect(fnv1a32("c00001")).toBe(fnv1a32("c00001"));
  });
  it("weighted picks follow the weights", () => {
    const r = new Rng("w");
    const counts = [0, 0, 0];
    for (let i = 0; i < 30_000; i++) counts[r.weighted([1, 2, 7])]!++;
    expect(counts[2]! / 30_000).toBeCloseTo(0.7, 1);
  });
});

describe("stats", () => {
  it("normal cdf and ppf invert each other", () => {
    for (const p of [0.001, 0.05, 0.1, 0.33, 0.5, 0.9, 0.975, 0.999]) expect(normCdf(normPpf(p))).toBeCloseTo(p, 5);
    expect(normPpf(0.9)).toBeCloseTo(1.2815516, 5);
  });
  it("quantile interpolates", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([5], 0.9)).toBe(5);
  });
  it("solves linear systems and OLS recovers coefficients", () => {
    expect(solveLinear([[2, 1], [1, 3]], [3, 5]).map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0.8, 1.4]);
    const r = new Rng("ols");
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const a = r.normal();
      const b = r.normal();
      X.push([1, a, b]);
      y.push(2 + 3 * a - 1.5 * b + 0.1 * r.normal());
    }
    const { beta, residualSd } = ols(X, y);
    expect(beta[0]).toBeCloseTo(2, 1);
    expect(beta[1]).toBeCloseTo(3, 1);
    expect(beta[2]).toBeCloseTo(-1.5, 1);
    expect(residualSd).toBeCloseTo(0.1, 1);
  });
});

describe("calendar (spec calendar check, 2026)", () => {
  it("has the weekdays the scenario relies on", () => {
    expect(weekday(dayOf(2026, 10, 18))).toBe(0); // Sun
    expect(weekday(dayOf(2026, 10, 28))).toBe(3); // Wed
    expect(weekday(dayOf(2026, 11, 2))).toBe(1); // Mon
    expect(weekday(dayOf(2026, 11, 4))).toBe(3); // Wed
    expect(weekday(dayOf(2026, 11, 11))).toBe(3); // Wed
  });
  it("formats and parses", () => {
    expect(fmtShort(dayOf(2026, 10, 28))).toBe("Wed Oct 28");
    expect(fmtMonthDay(dayOf(2026, 11, 11))).toBe("Nov 11");
    expect(toISO(parseISO("2026-10-18"))).toBe("2026-10-18");
    expect(nextShipDay(dayOf(2026, 11, 2), 3)).toBe(dayOf(2026, 11, 4));
    expect(nextShipDay(dayOf(2026, 11, 4), 3)).toBe(dayOf(2026, 11, 4));
  });
});
