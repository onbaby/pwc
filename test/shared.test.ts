import { describe, expect, it } from "vitest";
import { addDays, dayFromISO, dayOf, etInstant, etParts, fmtDateTime, fmtDay, inQuietHours, isoFromDay, latestWednesdayOnOrBefore, nextSendable, nextWednesdayOnOrAfter, relativeTime, weekday } from "../src/shared/dates.ts";
import { Stream, hash32, u01, uN, zN } from "../src/shared/rng.ts";
import { mean, normCdf, normPpf, ols, quantile, sd, solveLinear } from "../src/shared/stats.ts";

describe("dates (spec appendix A calendar check, 2026)", () => {
  it("has the weekdays the scenario relies on", () => {
    expect(weekday(dayOf(2026, 9, 30))).toBe(3);
    expect(weekday(dayOf(2026, 10, 14))).toBe(3);
    expect(weekday(dayOf(2026, 10, 18))).toBe(0);
    expect(weekday(dayOf(2026, 10, 28))).toBe(3);
    expect(weekday(dayOf(2026, 11, 4))).toBe(3);
    expect(weekday(dayOf(2026, 11, 11))).toBe(3);
    expect(weekday(dayOf(2026, 12, 9))).toBe(3);
  });
  it("formats and parses", () => {
    expect(fmtDay(dayOf(2026, 11, 11))).toBe("Wed Nov 11");
    expect(isoFromDay(dayFromISO("2026-10-18"))).toBe("2026-10-18");
    expect(addDays(dayOf(2026, 10, 18), 10)).toBe(dayOf(2026, 10, 28));
  });
  it("Wednesday helpers", () => {
    expect(latestWednesdayOnOrBefore(dayOf(2026, 11, 19))).toBe(dayOf(2026, 11, 18));
    expect(latestWednesdayOnOrBefore(dayOf(2026, 11, 18))).toBe(dayOf(2026, 11, 18));
    expect(latestWednesdayOnOrBefore(dayOf(2026, 11, 17))).toBe(dayOf(2026, 11, 11));
    expect(nextWednesdayOnOrAfter(dayOf(2026, 11, 2))).toBe(dayOf(2026, 11, 4));
    expect(nextWednesdayOnOrAfter(dayOf(2026, 11, 4))).toBe(dayOf(2026, 11, 4));
  });
  it("America/New_York instants, including the November change to standard time", () => {
    const oct18 = etInstant(dayOf(2026, 10, 18), 10, 0);
    expect(new Date(oct18).toISOString()).toBe("2026-10-18T14:00:00.000Z"); // EDT, UTC-4
    const nov15 = etInstant(dayOf(2026, 11, 15), 10, 0);
    expect(new Date(nov15).toISOString()).toBe("2026-11-15T15:00:00.000Z"); // EST, UTC-5
    expect(etParts(oct18)).toMatchObject({ day: dayOf(2026, 10, 18), hour: 10, minute: 0 });
    expect(fmtDateTime(etInstant(dayOf(2026, 10, 18), 10, 2))).toBe("Sun Oct 18, 10:02 am");
  });
  it("quiet hours are 9 pm to 8 am local", () => {
    const d = dayOf(2026, 10, 18);
    expect(inQuietHours(etInstant(d, 20, 59))).toBe(false);
    expect(inQuietHours(etInstant(d, 21, 0))).toBe(true);
    expect(inQuietHours(etInstant(d, 7, 59))).toBe(true);
    expect(inQuietHours(etInstant(d, 8, 0))).toBe(false);
    expect(nextSendable(etInstant(d, 22, 30))).toBe(etInstant(d + 1, 8, 0));
    expect(nextSendable(etInstant(d, 3, 0))).toBe(etInstant(d, 8, 0));
    expect(nextSendable(etInstant(d, 12, 0))).toBe(etInstant(d, 12, 0));
  });
  it("relative times use the sandbox clock", () => {
    const now = etInstant(dayOf(2026, 10, 18), 10, 0);
    expect(relativeTime(now - 30_000, now)).toBe("just now");
    expect(relativeTime(now - 12 * 60_000, now)).toBe("12 min ago");
    expect(relativeTime(etInstant(dayOf(2026, 10, 18), 7, 0), now)).toBe("3 h ago");
    expect(relativeTime(etInstant(dayOf(2026, 10, 17), 15, 0), now)).toBe("yesterday, 3:00 pm");
  });
});

describe("counter-based randomness", () => {
  it("is a pure function of its inputs", () => {
    expect(hash32("seed", "c1", 7)).toBe(hash32("seed", "c1", 7));
    expect(hash32("seed", "c1", 7)).not.toBe(hash32("seed", "c2", 7));
    const s = hash32(1, "x");
    expect(uN(s, 1, 2, 3)).toBe(uN(s, 1, 2, 3));
    expect(zN(s, 1, 2, 3)).toBe(zN(s, 1, 2, 3));
    expect(u01(5, 6)).toBe(u01(5, 6));
  });
  it("uniforms and normals have the right moments", () => {
    const s = hash32("moments");
    const u = Array.from({ length: 40_000 }, (_, i) => uN(s, 1, 0, i));
    expect(Math.min(...u)).toBeGreaterThan(0);
    expect(Math.max(...u)).toBeLessThan(1);
    expect(mean(u)).toBeCloseTo(0.5, 2);
    const z = Array.from({ length: 40_000 }, (_, i) => zN(s, 2, 0, i));
    expect(mean(z)).toBeCloseTo(0, 1);
    expect(sd(z)).toBeCloseTo(1, 1);
  });
  it("Stream is reproducible", () => {
    const a = new Stream("a", 1);
    const b = new Stream("a", 1);
    expect([a.next(), a.normal(), a.int(0, 9), a.poisson(3)]).toEqual([b.next(), b.normal(), b.int(0, 9), b.poisson(3)]);
    const c = new Stream("w");
    const counts = [0, 0, 0];
    for (let i = 0; i < 20_000; i++) counts[c.weighted([1, 2, 7])]!++;
    expect(counts[2]! / 20_000).toBeCloseTo(0.7, 1);
  });
});

describe("stats", () => {
  it("normal cdf and ppf invert each other", () => {
    for (const p of [0.001, 0.05, 0.1, 0.5, 0.9, 0.999]) expect(normCdf(normPpf(p))).toBeCloseTo(p, 5);
  });
  it("quantile, linear algebra and OLS", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(solveLinear([[2, 1], [1, 3]], [3, 5]).map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0.8, 1.4]);
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const a = zN(1, 0, 0, i);
      const b = zN(2, 0, 0, i);
      X.push([1, a, b]);
      y.push(2 + 3 * a - 1.5 * b + 0.1 * zN(3, 0, 0, i));
    }
    const fit = ols(X, y);
    expect(fit.beta[1]).toBeCloseTo(3, 1);
    expect(fit.residualSd).toBeCloseTo(0.1, 1);
  });
});
