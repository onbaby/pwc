import { describe, expect, it } from "vitest";
import { computeOutlook, hazardPerDay, monthIndex, type OutlookCustomer } from "../src/engine/outlook.ts";
import { dayOf, weekday } from "../src/shared/dates.ts";

const today = dayOf(2026, 10, 18);
const mk = (n: number): OutlookCustomer[] =>
  Array.from({ length: n }, (_, i) => ({ source: i % 2 ? "website" : "in_cafe", nextDelivery: dayOf(2026, 10, 21) + 7 * (i % 6), rhythmDays: 28 + 14 * (i % 3), tenureDays: 100 + i, skipProb: 0.05 }));

describe("roast outlook", () => {
  it("is deterministic, ordered P10 <= P50 <= P90, and starts on a Wednesday", () => {
    const a = computeOutlook(mk(600), today, "s");
    const b = computeOutlook(mk(600), today, "s");
    expect(a).toEqual(b);
    expect(a.weeks).toHaveLength(6);
    expect(weekday(a.weeks[0]!.wednesday)).toBe(3);
    for (const w of a.weeks) {
      expect(w.deliveries.p10).toBeLessThanOrEqual(w.deliveries.p50);
      expect(w.deliveries.p50).toBeLessThanOrEqual(w.deliveries.p90);
      expect(w.pounds.p50).toBeCloseTo(w.deliveries.p50 * 0.75, 0);
      expect(w.poundsTwoBag.p50).toBeCloseTo(w.deliveries.p50 * 1.5, 0);
    }
  });
  it("includes new sign-ups and rate uncertainty: even with no customers there are first deliveries and a band", () => {
    const o = computeOutlook([], today, "s");
    expect(o.weeks[0]!.deliveries.p50).toBeGreaterThan(100);
    expect(o.weeks[0]!.deliveries.p90).toBeGreaterThan(o.weeks[0]!.deliveries.p10);
  });
  it("scheduled deliveries bound the median from above (cancellations and skips only remove)", () => {
    const c = mk(300);
    const o = computeOutlook(c, today, "s");
    const scheduledWeek0 = c.filter((x) => x.nextDelivery === o.weeks[0]!.wednesday).length;
    // new sign-ups add about 8,670/52 per week, so compare the customers' own part: median <= scheduled + signups upper bound
    expect(o.weeks[0]!.deliveries.p50).toBeLessThanOrEqual(scheduledWeek0 + 250);
  });
  it("hazards come from Exhibit C and the December index is the peak", () => {
    expect(hazardPerDay("social", 10)).toBeGreaterThan(hazardPerDay("referral", 10));
    expect(hazardPerDay("in_cafe", 10)).toBeGreaterThan(hazardPerDay("in_cafe", 200));
    expect(monthIndex(dayOf(2026, 12, 9))).toBe(141);
  });
});
