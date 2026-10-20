import { describe, expect, it } from "vitest";
import { confidenceOf, decide, ratioOf, type DecisionInput } from "../src/engine/decision.ts";
import { checkLines, pantryTitle, whySentSentence } from "../src/engine/explain.ts";
import { PantryTracker, replyLikelihood, runFilter, type FilterEvent } from "../src/engine/pantryFilter.ts";
import { computeProjection, type CustomerContext, type EngineEnv } from "../src/engine/project.ts";
import type { PriorModel } from "../src/engine/prior.ts";
import { SOURCES } from "../src/shared/constants.ts";
import { dayFromISO, dayOf, fmtDay } from "../src/shared/dates.ts";
import { hash32, Stream } from "../src/shared/rng.ts";
import { normCdf } from "../src/shared/stats.ts";

const today = dayOf(2026, 10, 18);
const freeze = { from: dayFromISO("2026-11-15"), to: dayFromISO("2027-01-05") };
const mayaPrior = { mu: Math.log(40), tau: 0.2 };
const SEED = hash32(20261018);

/** A constant prior so the engine tests do not depend on any fit. */
const flatPrior = (mu: number, tau: number): PriorModel => ({ sources: SOURCES, beta: [mu, mu, mu, mu, mu, 0, 0, 0], tau, sigmaB: 0.15, label: "test prior", trainedOn: 0 });
const env = (mu: number, tau: number): EngineEnv => ({ prior: flatPrior(mu, tau), seed: 20261018, freeze });

const maya = (replies: Array<{ day: number; weeks: number }> = []): CustomerContext => ({
  id: "maya",
  name: "Maya Thompson",
  source: "in_cafe",
  planType: "payg",
  rhythmDays: 28,
  cups: 2,
  people: 2,
  brew: "pour-over",
  deliveredDays: [dayOf(2026, 8, 5), dayOf(2026, 9, 2), dayOf(2026, 9, 30)],
  replies,
  skips: [],
  holds: [],
  baseArrival: dayOf(2026, 10, 28),
  proposalCount: 0,
  deliveredReceipt: true,
  repliedInPreviousTwoCycles: false,
});
const dev = (replies: Array<{ day: number; weeks: number }> = []): CustomerContext => ({
  ...maya(replies),
  id: "dev",
  name: "Dev Patel",
  people: 1,
  cups: 1,
  brew: "drip",
  deliveredDays: [dayOf(2026, 9, 30)],
  baseArrival: dayOf(2026, 10, 28),
});
const within = (v: number, target: number, tol = 0.25) => Math.abs(v - target) <= tol * target;
const proj = (ctx: CustomerContext, mu = Math.log(40), tau = 0.2, whatIf = false) => computeProjection(ctx, env(mu, tau), today, 0, hash32(20261018, ctx.id), { whatIf });

describe("reply likelihood (spec 7.2)", () => {
  it("is a proper distribution over replies 0..12 (the garbage term is flat over 13 values)", () => {
    for (const R of [0, 0.3, 3, 14, 40, 90, 200]) {
      let total = 0;
      for (let w = 0; w <= 12; w++) total += replyLikelihood(w, R);
      expect(total).toBeCloseTo(1, 6);
    }
  });
  it("matches numerical integration of the generating process, including w = 0 and w = 12", () => {
    const R = 40;
    const sigma = 0.35;
    const pdf = (z: number) => Math.exp(-0.5 * (z / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI));
    for (const w of [0, 1, 6, 11, 12]) {
      let p = 0;
      const n = 200_000;
      for (let i = 0; i < n; i++) {
        const z = -6 * sigma + (12 * sigma * (i + 0.5)) / n;
        const reply = Math.min(12, Math.max(0, Math.round((R * Math.exp(z)) / 7)));
        if (reply === w) p += pdf(z) * ((12 * sigma) / n);
      }
      expect(replyLikelihood(w, R, sigma, 0)).toBeCloseTo(p, 4);
    }
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
  });
  it("w = 0 uses only the upper term; w = 12 is right-censored", () => {
    expect(replyLikelihood(0, 1000, 0.35, 0)).toBeLessThan(1e-9);
    expect(replyLikelihood(12, 1000, 0.35, 0)).toBeGreaterThan(0.9);
    expect(replyLikelihood(0, 0.2, 0.35, 0)).toBeGreaterThan(0.9);
  });
});

describe("pantry filter", () => {
  it("is deterministic given the event log and seed, and different seeds differ", () => {
    const ev: FilterEvent[] = maya([{ day: today, weeks: 6 }]).deliveredDays.map((day) => ({ type: "delivery", day }));
    const a = runFilter({ prior: mayaPrior, seed: SEED, events: ev, asOf: today });
    const b = runFilter({ prior: mayaPrior, seed: SEED, events: ev, asOf: today });
    expect(a.quantiles([0.1, 0.5, 0.9])).toEqual(b.quantiles([0.1, 0.5, 0.9]));
    const c = runFilter({ prior: mayaPrior, seed: hash32("other"), events: ev, asOf: today });
    expect(c.quantile(0.5)).not.toBe(a.quantile(0.5));
  });
  it("is robust to event order in the input (it sorts by day)", () => {
    const ev: FilterEvent[] = [{ type: "reply", day: today, weeks: 6 }, ...maya().deliveredDays.map((day): FilterEvent => ({ type: "delivery", day }))];
    const a = runFilter({ prior: mayaPrior, seed: SEED, events: ev, asOf: today });
    const b = runFilter({ prior: mayaPrior, seed: SEED, events: [...ev].reverse(), asOf: today });
    expect(a.quantile(0.5)).toBe(b.quantile(0.5));
  });
  it("never produces NaN under extreme contradictory evidence, and weights stay normalised", () => {
    const ev: FilterEvent[] = [{ type: "delivery", day: today - 40 }];
    for (let i = 0; i < 30; i++) ev.push({ type: "reply", day: today - 39 + i, weeks: i % 2 ? 12 : 0 }, { type: "skip", day: today - 39 + i });
    const f = runFilter({ prior: mayaPrior, seed: SEED, events: ev, asOf: today });
    for (const q of f.quantiles([0.05, 0.5, 0.95])) expect(Number.isFinite(q)).toBe(true);
    expect(Array.from(f.state().w).every((x) => Number.isFinite(x) && x > 0)).toBe(true);
    expect(Array.from(f.state().w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });
  it("one wrong '0' after a good reply does not drive the posterior to the edge", () => {
    const ev: FilterEvent[] = [
      { type: "delivery", day: today - 10 },
      { type: "reply", day: today - 5, weeks: 5 },
      { type: "reply", day: today, weeks: 0 },
    ];
    const f = runFilter({ prior: mayaPrior, seed: SEED, events: ev, asOf: today });
    expect(f.quantile(0.5)).toBeGreaterThan(8);
    expect(f.quantile(0.9)).toBeGreaterThan(20);
  });
  it("median run-out is monotone in the reported weeks (fixed seeds, 1-day tolerance)", () => {
    // tau 0.3 is the sandbox prior's spread. With a much tighter prior (0.2) a lone "0" that contradicts a 40-day pantry
    // is partly read as a mis-tap (the 10% garbage term), so the median can sit above the one for "1 week": by design.
    for (const seedName of ["a", "b", "c"]) {
      let prev = -Infinity;
      for (let w = 0; w <= 12; w++) {
        const ctx = maya([{ day: today, weeks: w }]);
        const p = computeProjection(ctx, env(Math.log(40), 0.3), today, 0, hash32(seedName), {});
        expect(p.runOut.q50).toBeGreaterThanOrEqual(prev - 1);
        prev = p.runOut.q50;
      }
    }
  });
  it("the incremental tracker gives exactly the same answer as replaying the log", () => {
    const ev: FilterEvent[] = [
      { type: "delivery", day: today - 70 },
      { type: "delivery", day: today - 42 },
      { type: "reply", day: today - 32, weeks: 4 },
      { type: "delivery", day: today - 14 },
      { type: "skip", day: today - 3 },
      { type: "reply", day: today, weeks: 3 },
    ];
    const a = runFilter({ prior: mayaPrior, seed: SEED, events: ev, asOf: today });
    const tr = new PantryTracker(mayaPrior, SEED, today - 70);
    for (const e of ev) {
      tr.advance(e.type === "hold" ? e.from : e.day);
      if (e.type === "delivery") tr.deliver();
      else if (e.type === "reply") tr.reply(e.weeks);
      else if (e.type === "skip") tr.skip();
    }
    tr.advance(today);
    expect(tr.quantiles([0.05, 0.1, 0.5, 0.9])).toEqual(a.quantiles([0.05, 0.1, 0.5, 0.9]));
  });
  it("a staff hold pauses consumption", () => {
    const ev: FilterEvent[] = [{ type: "delivery", day: today - 5 }];
    const a = runFilter({ prior: mayaPrior, seed: SEED, events: ev, asOf: today + 20 });
    const b = runFilter({ prior: mayaPrior, seed: SEED, events: [...ev, { type: "hold", from: today, to: today + 20 }], asOf: today + 20 });
    expect(b.meanR()).toBeGreaterThan(a.meanR() + 10);
  });
});

describe("appendix A fixtures (±25%)", () => {
  it("Maya replies 6: run-out about 29/39/45/67 days, Medium, later move to Wed Nov 11 sent automatically", () => {
    const p = proj(maya([{ day: today, weeks: 6 }]));
    expect(within(p.runOut.q10, 29)).toBe(true);
    expect(within(p.runOut.q33, 39)).toBe(true);
    expect(within(p.runOut.q50, 45)).toBe(true);
    expect(within(p.runOut.q90, 67)).toBe(true);
    expect(within(p.ratio, 2.0)).toBe(true);
    expect(p.confidence).toBe("Medium");
    expect(p.proposal.direction).toBe("later");
    expect(p.proposal.step).toBe(14);
    expect(fmtDay(p.proposal.to)).toBe("Wed Nov 11");
    expect(p.proposal.autoSend).toBe(true);
    expect(p.proposal.blockedBy).toEqual([]);
    expect(p.holdingOff).toBe(false);
    // she still arrives with about 16 days on hand ("better, not fixed"): true pantry 40 days, arrival 24 days out
    expect(40 - (p.proposal.to - today)).toBeCloseTo(16, 0);
  });
  it("Maya before replying: holding off, no change, Not yet sure", () => {
    const p = proj(maya());
    expect(p.confidence).toBe("Not yet sure");
    expect(p.holdingOff).toBe(true);
    expect(p.proposal.direction).toBe("none");
    expect(p.explanation.evidence).toContain("No reply from Maya yet");
  });
  it("Maya's other replies: 4 weeks -> a later move of 1-2 weeks, 2 weeks -> smaller, 0 -> never automatic if sooner", () => {
    const four = proj(maya([{ day: today, weeks: 4 }])).proposal;
    expect(four.direction).toBe("later");
    expect(four.step).toBeGreaterThanOrEqual(7);
    expect(four.step).toBeLessThanOrEqual(14);
    const two = proj(maya([{ day: today, weeks: 2 }])).proposal;
    expect(two.step).toBeLessThanOrEqual(four.step);
    const zero = proj(maya([{ day: today, weeks: 0 }])).proposal;
    expect(zero.direction === "sooner" || zero.direction === "none").toBe(true);
    if (zero.direction === "sooner") expect(zero.autoSend).toBe(false);
  });
  it("Dev (one delivery, no reply): Not yet sure, holding off, not movable", () => {
    const p = proj(dev(), Math.log(45), 0.25);
    expect(p.confidence).toBe("Not yet sure");
    expect(p.holdingOff).toBe(true);
    expect(p.proposal.direction).toBe("none");
    expect(p.ruleTrace.some((t) => t.code === "TOO_FEW_DELIVERIES")).toBe(true);
    expect(within(p.runOut.q10, 13, 0.4)).toBe(true);
    expect(within(p.runOut.q50, 27, 0.35)).toBe(true);
  });
  it("Maya's next cycle falls in the holiday freeze", () => {
    const p = proj(maya([{ day: today, weeks: 6 }]));
    expect(p.proposal.to + 28).toBeGreaterThanOrEqual(freeze.from); // Dec 9
    expect(p.proposal.to + 28).toBeLessThanOrEqual(freeze.to);
  });
  it("is idempotent: recomputing with the same log gives the same projection", () => {
    const ctx = maya([{ day: today, weeks: 6 }]);
    const a = proj(ctx, Math.log(40), 0.2, true);
    const b = proj(ctx, Math.log(40), 0.2, true);
    expect(a).toEqual(b);
    expect(a.whatIf).toHaveLength(13);
    expect(a.explanation.whatWouldChange).toMatch(/^If Maya replies differently/);
  });
});

describe("confidence and the decision rule", () => {
  it("How sure uses (q90+7)/(q10+7): High <= 1.6, Medium <= 3.0, needs a fresh reply", () => {
    expect(ratioOf(29, 67)).toBeCloseTo(2.056, 2);
    expect(confidenceOf(29, 67, true)).toBe("Medium");
    expect(confidenceOf(29, 67, false)).toBe("Not yet sure");
    expect(confidenceOf(30, 50, true)).toBe("High");
    expect(confidenceOf(10, 80, true)).toBe("Not yet sure");
  });
  const base = (over: Partial<DecisionInput> = {}): DecisionInput => ({
    today,
    baseArrival: dayOf(2026, 10, 28),
    lastDelivery: dayOf(2026, 9, 30),
    runOut: { q05: 20, q10: 29, q33: 39, q50: 45, q90: 67 },
    confidence: "Medium",
    trigger: "reply",
    plan: { payAsYouGo: true, completedDeliveries: 3 },
    freeze,
    proposalCount: 0,
    deliveredReceipt: true,
    repliedInPreviousTwoCycles: true,
    ...over,
  });
  it("target is the latest Wednesday on or before today + q10 + 3, clamped to +14 days", () => {
    const d = decide(base());
    expect(fmtDay(d.proposal.to)).toBe("Wed Nov 11");
    expect(d.trace.some((t) => t.code === "STEP_CLAMPED")).toBe(true);
    const small = decide(base({ runOut: { q05: 5, q10: 14, q33: 20, q50: 24, q90: 40 } }));
    expect(fmtDay(small.proposal.to)).toBe("Wed Nov 4"); // 14 + 3 + Oct 18 = Nov 4 (a Wednesday)
  });
  it("no trigger, no change; a sooner move never goes automatically", () => {
    expect(decide(base({ trigger: "none" })).proposal.direction).toBe("none");
    const sooner = decide(base({ runOut: { q05: 0, q10: 2, q33: 3, q50: 4, q90: 9 } }));
    expect(sooner.proposal.direction).toBe("sooner");
    expect(sooner.proposal.autoSend).toBe(false);
    expect(sooner.proposal.blockedBy).toContain("SOONER_NEEDS_YES");
  });
  it("each guardrail blocks an automatic later move on its own", () => {
    const blockers: Array<[Partial<DecisionInput>, string]> = [
      [{ confidence: "Not yet sure" }, "CONFIDENCE_OK"],
      [{ today: dayOf(2026, 10, 25), baseArrival: dayOf(2026, 10, 28) }, "NOTICE_7_DAYS"],
      [{ plan: { payAsYouGo: false, completedDeliveries: 3 } }, "PAYG_ELIGIBLE"],
      [{ deliveredReceipt: false }, "DELIVERED_RECEIPT"],
      [{ proposalCount: 2, repliedInPreviousTwoCycles: false }, "DELIVERED_RECEIPT"],
      [{ today: dayOf(2026, 11, 20), baseArrival: dayOf(2026, 11, 25), lastDelivery: dayOf(2026, 10, 28), runOut: { q05: 20, q10: 29, q33: 39, q50: 45, q90: 67 } }, "NOT_IN_FREEZE"],
    ];
    for (const [over, code] of blockers) {
      const d = decide(base(over));
      expect(d.proposal.direction === "later" ? d.proposal.autoSend : false).toBe(false);
      if (d.proposal.direction === "later") expect(d.proposal.blockedBy).toContain(code);
    }
  });
  it("fewer than 2 completed deliveries: no proposal at all", () => {
    const d = decide(base({ plan: { payAsYouGo: true, completedDeliveries: 1 } }));
    expect(d.proposal.direction).toBe("none");
  });
  it("property: step within ±14, gap within [21, 84], whole weeks, no automatic sooner, no automatic move for prepaid/gift/freeze", () => {
    const r = new Stream("decision-property");
    for (let i = 0; i < 6000; i++) {
      const lastDelivery = dayOf(2026, 6, 3) + 7 * r.int(0, 20);
      const baseArrival = lastDelivery + 7 * r.int(3, 12);
      const t = baseArrival - r.int(3, 14);
      const q10 = r.next() * 60;
      const q90 = q10 + r.next() * 120;
      const conf = r.next() < 0.3 ? "Not yet sure" : r.next() < 0.5 ? "Medium" : "High";
      const d = decide({
        today: t,
        baseArrival,
        lastDelivery,
        runOut: { q05: q10 * 0.7, q10, q33: q10 + (q90 - q10) * 0.3, q50: q10 + (q90 - q10) * 0.5, q90 },
        confidence: conf,
        trigger: r.next() < 0.8 ? "reply" : "none",
        plan: { payAsYouGo: r.next() > 0.25, completedDeliveries: r.int(0, 5) },
        freeze,
        proposalCount: r.int(0, 4),
        deliveredReceipt: r.next() > 0.1,
        repliedInPreviousTwoCycles: r.next() > 0.3,
      });
      const p = d.proposal;
      if (p.direction !== "none") {
        expect(Math.abs(p.step)).toBeLessThanOrEqual(14);
        expect(Math.abs(p.step) % 7).toBe(0);
        expect(p.to - lastDelivery).toBeGreaterThanOrEqual(21);
        expect(p.to - lastDelivery).toBeLessThanOrEqual(84);
        if (p.direction === "sooner") expect(p.autoSend).toBe(false);
        expect(p.autoSend).toBe(p.blockedBy.length === 0 && p.direction === "later");
      } else expect(p.autoSend).toBe(false);
    }
  });
});

describe("explanations are plain English", () => {
  it("renders the title, the audit sentence and the check lines", () => {
    const p = proj(maya([{ day: today, weeks: 6 }]));
    expect(pantryTitle(dayOf(2026, 12, 2), dayOf(2026, 11, 16), dayOf(2026, 12, 24))).toBe("Most likely runs out around Dec 2 (likely between Nov 16 and Dec 24)");
    const lines = checkLines(p.ruleTrace);
    expect(lines.every((l) => l.ok)).toBe(true);
    const s = whySentSentence({ runOutLo: p.runOutDates.lo, runOutMid: p.runOutDates.mid, runOutHi: p.runOutDates.hi, confidence: p.confidence, checks: lines, atText: "Sun Oct 18, 10:02 am" });
    expect(s).toMatch(/^Runs out around \w{3} \d+ \(likely \w{3} \d+ – \w{3} \d+\) · How sure: Medium · Checks: replied this cycle ✓/);
    expect(s).toContain("not in the holiday freeze ✓");
    expect(s).toContain("Sun Oct 18, 10:02 am");
    expect(JSON.stringify(p.explanation)).not.toMatch(/particle|quantile|Greek|θ|τ|σ/);
  });
});
