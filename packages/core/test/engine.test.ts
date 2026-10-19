import { describe, expect, it } from "vitest";
import { dayOf, type Day } from "../src/calendar.ts";
import { DECISION } from "../src/constants.ts";
import {
  PantryFilter,
  decide,
  explain,
  forecast,
  forecastFromFilter,
  replayFilter,
  replyLikelihood,
  whatIfReplies,
  type Eligibility,
  type Forecast,
  type SubscriberHistory,
} from "../src/engine/index.ts";
import { Rng } from "../src/rng.ts";

const today = dayOf(2026, 10, 18);
const mayaPrior = { mu: Math.log(40), tau: 0.2 };
const devPrior = { mu: Math.log(45), tau: 0.25 };
const maya = (weeks?: number): SubscriberHistory => ({
  id: "maya",
  deliveries: [dayOf(2026, 8, 5), dayOf(2026, 9, 2), dayOf(2026, 9, 30)],
  replies: weeks === undefined ? [] : [{ day: today, weeks }],
  skips: [],
  away: [],
});
const dev = (weeks?: number): SubscriberHistory => ({ id: "dev", deliveries: [dayOf(2026, 10, 14)], replies: weeks === undefined ? [] : [{ day: today, weeks }], skips: [], away: [] });
const okEligibility: Eligibility = { payAsYouGo: true, completedDeliveries: 3, inDecemberFreeze: false, replyHistoryOk: true, textLeadDays: 10 };

function mayaDecision(weeks?: number, seed = "maya") {
  const fc = forecast(mayaPrior, maya(weeks), today, today - 1, seed);
  const d = decide({ today, currentArrival: dayOf(2026, 10, 28), lastDelivery: dayOf(2026, 9, 30), forecast: fc, minArrival: today + 3, eligibility: okEligibility });
  return { fc, d };
}
const within = (v: number, target: number, tol = 0.2) => Math.abs(v - target) <= tol * target;

describe("Appendix A fixtures", () => {
  it("S1: Maya says 6 weeks -> later, +14 days to Wed Nov 11, Medium", () => {
    const { fc, d } = mayaDecision(6);
    expect(within(fc.runOutDays.q10, 29)).toBe(true);
    expect(within(fc.runOutDays.q33, 39)).toBe(true);
    expect(within(fc.runOutDays.q50, 45)).toBe(true);
    expect(within(fc.runOutDays.q90, 67)).toBe(true);
    expect(fc.ratio).toBeGreaterThan(1.7);
    expect(fc.ratio).toBeLessThan(2.6);
    expect(fc.confidence).toBe("Medium");
    expect(d.action).toBe("propose");
    expect(d.direction).toBe("later");
    expect(d.stepDays).toBe(14);
    expect(d.newArrival).toBe(dayOf(2026, 11, 11));
    expect(d.defaultAccept).toBe(true);
    expect(d.requiresYes).toBe(false);
  });
  it("S1: no reply -> Not yet sure and no change (evidence gate)", () => {
    const { fc, d } = mayaDecision(undefined);
    expect(within(fc.runOutDays.q10, 18)).toBe(true);
    expect(within(fc.runOutDays.q90, 85)).toBe(true);
    expect(fc.confidence).toBe("Not yet sure");
    expect(d.action).toBe("hold_off");
    expect(d.abstain).toBe(true);
    expect(d.stepDays).toBe(0);
  });
  it("S1: reply 4 -> +14, reply 2 -> +7, reply 0 -> -7 and needs a YES", () => {
    expect(mayaDecision(4).d.stepDays).toBe(14);
    expect(mayaDecision(2).d.stepDays).toBe(7);
    const zero = mayaDecision(0).d;
    expect(zero.stepDays).toBe(-7);
    expect(zero.direction).toBe("sooner");
    expect(zero.requiresYes).toBe(true);
    expect(zero.defaultAccept).toBe(false);
  });
  it("S3: Dev, day 4, no history -> Not yet sure, hold off, no change", () => {
    const fc = forecast(devPrior, dev(), today, today - 1, "dev");
    expect(within(fc.runOutDays.q10, 25, 0.25)).toBe(true);
    expect(within(fc.runOutDays.q50, 39, 0.25)).toBe(true);
    expect(fc.confidence).toBe("Not yet sure");
    const d = decide({ today, currentArrival: today + 31, lastDelivery: dayOf(2026, 10, 14), forecast: fc, minArrival: today + 3, eligibility: { ...okEligibility, completedDeliveries: 1 } });
    expect(d.action).toBe("hold_off");
    expect(d.abstain).toBe(true);
  });
  it("S3: Dev with a 5-week reply is Medium but, with one delivery, still not moved (pilot eligibility)", () => {
    const fc = forecast(devPrior, dev(5), today, today - 1, "dev");
    expect(fc.confidence).toBe("Medium");
    const d = decide({ today, currentArrival: today + 31, lastDelivery: dayOf(2026, 10, 14), forecast: fc, minArrival: today + 3, eligibility: { ...okEligibility, completedDeliveries: 1 } });
    expect(d.stepDays).toBe(0);
    expect(d.blocked).toBe("too_few_deliveries");
  });
  it("decisions are robust across particle seeds", () => {
    for (let s = 1; s <= 12; s++) {
      const d6 = mayaDecision(6, "seed" + s);
      expect(d6.d.stepDays).toBe(14);
      expect(mayaDecision(undefined, "seed" + s).d.stepDays).toBe(0);
    }
  });
});

describe("reply likelihood", () => {
  it("integrates to 1 over reply size (numerical integration) and matches the formula", () => {
    const R = 40;
    // density in days; integrate the log-normal part with the trapezoid rule in log space
    let total = 0;
    const n = 40_000;
    const lo = Math.log(0.01);
    const hi = Math.log(100_000);
    for (let i = 0; i <= n; i++) {
      const lx = lo + ((hi - lo) * i) / n;
      const x = Math.exp(lx);
      const f = replyLikelihood(x / 7, R, 0.35, 0) * x; // d x = x d(ln x)
      total += (i === 0 || i === n ? 0.5 : 1) * f * ((hi - lo) / n);
    }
    // the log-normal density is per day of x = 7w, and replyLikelihood is evaluated at weeks = x/7
    expect(total).toBeCloseTo(1, 3);
    const manual = (0.9 * Math.exp(-0.5 * ((Math.log(42) - Math.log(40)) / 0.35) ** 2)) / (42 * 0.35 * Math.sqrt(2 * Math.PI)) + 0.1 / 90;
    expect(replyLikelihood(6, 40, 0.35, 0.1)).toBeCloseTo(manual, 12);
  });
});

describe("filter behaviour", () => {
  it("is robust to one garbage 0 after a good reply", () => {
    const f = new PantryFilter(mayaPrior, new Rng("garbage"), { particles: 1000 }, 0);
    f.deliver();
    f.advance(10);
    f.observeWeeks(5);
    const before = f.quantiles([0.5])[0]!;
    f.advance(15);
    f.observeWeeks(0); // wrong "0" at day 15
    const after = f.quantiles([0.5])[0]!;
    expect(before).toBeGreaterThan(15);
    expect(after).toBeGreaterThan(10);
    expect(f.quantiles([0.9])[0]!).toBeGreaterThan(20);
  });
  it("never produces NaN under extreme contradictory evidence", () => {
    const f = new PantryFilter(mayaPrior, new Rng("extreme"), { particles: 300 }, 0);
    f.deliver();
    for (let i = 0; i < 30; i++) {
      f.advance(i + 1);
      f.observeWeeks(i % 2 ? 12 : 0);
      if (i % 5 === 0) f.observeSkip();
    }
    const q = f.quantiles([0.05, 0.5, 0.95]);
    for (const v of q) expect(Number.isFinite(v)).toBe(true);
    expect(Array.from(f.w).every((w) => Number.isFinite(w) && w > 0)).toBe(true);
    expect(Array.from(f.w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });
  it("is deterministic given a seed and idempotent when evidence is unchanged", () => {
    const a = forecast(mayaPrior, maya(6), today, today - 1, "same");
    const b = forecast(mayaPrior, maya(6), today, today - 1, "same");
    expect(a).toEqual(b);
    const c = forecast(mayaPrior, maya(6), today, today - 1, "other");
    expect(c.runOutDays.q50).not.toBe(a.runOutDays.q50);
  });
  it("clone leaves the original untouched (what-if is side-effect free)", () => {
    const f = replayFilter(mayaPrior, maya(), today, "clone");
    const before = f.quantiles([0.1, 0.5, 0.9]);
    const g = f.clone();
    g.observeWeeks(1);
    expect(f.quantiles([0.1, 0.5, 0.9])).toEqual(before);
    expect(g.quantiles([0.5])[0]).not.toBe(before[1]);
  });
  it("away windows pause consumption", () => {
    const f1 = new PantryFilter(mayaPrior, new Rng("away"), { particles: 400 }, 0);
    f1.deliver();
    const f2 = f1.clone();
    f1.advance(20);
    f2.advance(20, [{ from: 5, to: 15 }]);
    expect(f2.meanR()).toBeGreaterThan(f1.meanR() + 5);
  });
});

describe("monotone response", () => {
  it("larger reported weeks move the date later or equal; absent reply never moves it", () => {
    let prev = -Infinity;
    for (let w = 0; w <= 12; w++) {
      const { d } = mayaDecision(w);
      expect(d.newArrival).toBeGreaterThanOrEqual(prev);
      prev = d.newArrival;
    }
    expect(mayaDecision(undefined).d.newArrival).toBe(dayOf(2026, 10, 28));
  });
  it("what-if table is consistent with decisions and the explanation card renders every field", () => {
    const f = replayFilter(mayaPrior, maya(), today, "maya");
    const base = { today, currentArrival: dayOf(2026, 10, 28), lastDelivery: dayOf(2026, 9, 30), minArrival: today + 3, eligibility: okEligibility };
    const table = whatIfReplies(f, base, DECISION.serviceQ);
    expect(table.find((r) => r.weeks === 6)!.stepDays).toBe(14);
    const { fc, d } = mayaDecision(6);
    const card = explain({ name: "Maya", descriptor: "2-person home, pour-over, in-cafe signup, 4-week deliveries", prior: mayaPrior, replyWeeks: 6, replyDay: today, forecast: fc, decision: d, oldArrival: dayOf(2026, 10, 28), whatIf: table });
    expect(card.startingPoint.text).toContain("about 6 weeks per delivery");
    expect(card.startingPoint.tag).toBe("assumed prior, synthetic");
    expect(card.evidence.text).toBe("On Oct 18, Maya said about 6 weeks left.");
    expect(card.whatChangesIt.text).toMatch(/If Maya says .* we would keep the date\./);
    expect(card.rangeTitle).toMatch(/^When will Maya run out of coffee\? Most likely [A-Z][a-z]{2} \d+; very likely between [A-Z][a-z]{2} \d+ and [A-Z][a-z]{2} \d+$/);
    expect(JSON.stringify(card)).not.toMatch(/undefined|NaN/);
  });
});

describe("decision property tests", () => {
  function randomForecast(r: Rng, fresh: boolean): Forecast {
    const q10 = r.next() * 60;
    const q90 = q10 + r.next() * 120;
    const q = q10 + r.next() * (q90 - q10) * 0.2;
    const ratio = (q90 + 1) / (q10 + 1);
    return {
      asOf: 0,
      runOutDays: { q05: q10 * 0.8, q10, q33: q10 + (q90 - q10) * 0.3, q50: q10 + (q90 - q10) * 0.5, q90 },
      qService: q,
      serviceQ: 0.1,
      ratio,
      confidence: !fresh ? "Not yet sure" : ratio <= 1.6 ? "High" : ratio <= 2.6 ? "Medium" : "Not yet sure",
      freshReply: fresh,
    };
  }
  it("respects the +/-14 day clamp, the [21, 84] gap, whole-week steps, and the YES rules", () => {
    const r = new Rng("property");
    for (let i = 0; i < 4000; i++) {
      const lastDelivery = r.int(0, 100);
      const currentArrival = lastDelivery + 7 * r.int(3, 12);
      const el: Eligibility = {
        payAsYouGo: r.next() > 0.2,
        completedDeliveries: r.int(0, 5),
        inDecemberFreeze: r.next() < 0.2,
        replyHistoryOk: r.next() > 0.2,
        textLeadDays: r.int(0, 14),
      };
      const fc = randomForecast(r, r.next() > 0.3);
      const t = currentArrival - r.int(5, 12);
      const d = decide({ today: t, currentArrival, lastDelivery, forecast: fc, minArrival: t + 3, eligibility: el });
      if (d.action === "propose") {
        expect(Math.abs(d.stepDays)).toBeLessThanOrEqual(14);
        expect(Math.abs(d.stepDays) % 7).toBe(0);
        expect(d.newArrival - lastDelivery).toBeGreaterThanOrEqual(21);
        expect(d.newArrival - lastDelivery).toBeLessThanOrEqual(84);
        expect(d.stepDays).not.toBe(0);
        if (d.direction === "sooner") {
          expect(d.requiresYes).toBe(true);
          expect(d.defaultAccept).toBe(false);
          expect(d.newArrival).toBeGreaterThanOrEqual(t + 3);
        }
        expect(d.defaultAccept).toBe(!d.requiresYes);
        // a fresh reply, pay-as-you-go, >= 2 deliveries, not in the freeze, always
        expect(fc.freshReply).toBe(true);
        expect(el.payAsYouGo).toBe(true);
        expect(el.completedDeliveries).toBeGreaterThanOrEqual(2);
        expect(el.inDecemberFreeze).toBe(false);
        if (d.defaultAccept) {
          expect(fc.confidence).not.toBe("Not yet sure");
          expect(el.textLeadDays).toBeGreaterThanOrEqual(7);
          expect(el.replyHistoryOk).toBe(true);
        }
      } else {
        expect(d.stepDays).toBe(0);
        expect(d.newArrival).toBe(currentArrival);
        expect(d.defaultAccept).toBe(false);
      }
      if (!fc.freshReply) expect(d.action).toBe("hold_off");
    }
  });
});

describe("forecast helpers", () => {
  it("forecastFromFilter reports the service quantile and a coherent ratio", () => {
    const f = replayFilter(mayaPrior, maya(6), today, "q");
    const fc: Forecast = forecastFromFilter(f, today, true, 0.2);
    expect(fc.serviceQ).toBe(0.2);
    expect(fc.qService).toBeGreaterThanOrEqual(fc.runOutDays.q10);
    expect(fc.ratio).toBeCloseTo((fc.runOutDays.q90 + 1) / (fc.runOutDays.q10 + 1), 9);
  });
  it("an unused Day type import stays a number", () => {
    const d: Day = today;
    expect(typeof d).toBe("number");
  });
});
