import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { breakEven, evaluate, sampleSizePerGroup, validateAudience } from "../src/server/offers/eligibility.ts";
import { diffBounds, sensorCheck } from "../src/server/offers/guardrails.ts";
import { createOffer, offerResults, pauseOffer, previewOffer, runSensorChecks, scheduleOffer, approveOffer } from "../src/server/offers/lifecycle.ts";
import type { OfferDraft } from "../src/server/offers/types.ts";
import { all, get, run } from "../src/server/db.ts";
import { COPY } from "../src/server/copy.ts";
import { handleInbound } from "../src/server/flows/inbound.ts";
import { nowMs } from "../src/server/store.ts";
import { MS_DAY } from "../src/shared/dates.ts";
import { freshConsole, type TestConsole } from "./helpers.ts";

const rotation: OfferDraft = { name: "Athens roast rotation", type: "rotation", audience: { sources: ["social"], memberDaysMin: 30, memberDaysMax: 90, notStockpiled: true }, holdoutMode: "experiment", holdoutPct: 50, discountPct: 0, budget: 0, approvalRequired: false };

describe("offers: eligibility, exclusions and the preview", () => {
  let t: TestConsole;
  beforeAll(() => {
    t = freshConsole();
  });
  afterAll(() => t.cleanup());

  it("the demo offer previews eligible and excluded counts by reason, a sample message and the break-even", () => {
    const p = previewOffer(t.db, rotation);
    expect(p.matching).toBeGreaterThan(0);
    expect(p.eligible).toBeLessThanOrEqual(p.matching);
    expect(Object.keys(p.excluded)).toEqual(expect.arrayContaining(["no offer consent", "stockpiled", "no message to ride on", "had an offer in last 30 days", "in another experiment", "in pacing pilot"]));
    expect(p.treatment + p.holdout).toBe(p.eligible);
    expect(p.sample?.body).toContain("Reply ROTATE");
    expect(p.sample?.body).toContain("Reply NO OFFERS");
    expect(p.sampleSizePerGroup).toBe(sampleSizePerGroup());
    expect(p.errors).toEqual([]);
  });

  it("offer consent is always enforced: nobody without it is eligible or assigned", () => {
    const ev = evaluate(t.db, { type: "rotation", audience: {}, holdoutMode: "global", holdoutPct: 0 });
    for (const id of ev.eligible) expect(get<{ c: number }>(t.db, "SELECT consent_offers AS c FROM customers WHERE id = ?", id)!.c).toBe(1);
    expect(ev.excluded["no offer consent"]).toBeGreaterThan(0);
  });

  it("excludes pilot customers, recent recipients, other experiments and the standing holdout", () => {
    const base = evaluate(t.db, { type: "rotation", audience: {}, holdoutMode: "experiment", holdoutPct: 50 });
    expect(base.eligible.length).toBeGreaterThan(50);
    const [a, b, c] = base.eligible as [string, string, string];
    run(t.db, "UPDATE customers SET in_pilot = 1 WHERE id = ?", a);
    run(t.db, "INSERT INTO messages(customer_id, at, direction, body, kind, status, offer_id) VALUES (?,?,?,?,?,?,?)", b, nowMs(t.db) - 5 * MS_DAY, "out", "x", "reminder", "delivered", 999);
    run(t.db, "INSERT INTO experiment_membership(customer_id, offer_id, family, started_at, outcome_closes_at) VALUES (?,?,?,?,?)", c, 998, "smaller", nowMs(t.db), nowMs(t.db) + 30 * MS_DAY);
    const after = evaluate(t.db, { type: "rotation", audience: {}, holdoutMode: "experiment", holdoutPct: 50 });
    expect(after.eligible).not.toContain(a);
    expect(after.eligible).not.toContain(b);
    expect(after.eligible).not.toContain(c);
    expect(after.excluded["in pacing pilot"]).toBeGreaterThanOrEqual(1);
    expect(after.excluded["had an offer in last 30 days"]).toBeGreaterThanOrEqual(1);
    expect(after.excluded["in another experiment"]).toBeGreaterThanOrEqual(1);
    // the same family does not count as "another experiment"
    run(t.db, "UPDATE experiment_membership SET family = 'rotation' WHERE customer_id = ?", c);
    expect(evaluate(t.db, { type: "rotation", audience: {}, holdoutMode: "experiment", holdoutPct: 50 }).eligible).toContain(c);
    run(t.db, "UPDATE customers SET in_pilot = 0 WHERE id = ?", a);
    run(t.db, "DELETE FROM messages WHERE offer_id = 999");
    run(t.db, "DELETE FROM experiment_membership WHERE offer_id = 998");
  });

  it("assignment is sticky: the same customer gets the same arm every time and across offers of one family", () => {
    const a = evaluate(t.db, { type: "rotation", audience: {}, holdoutMode: "experiment", holdoutPct: 50 });
    const b = evaluate(t.db, { type: "rotation", audience: { sources: ["social"] }, holdoutMode: "experiment", holdoutPct: 50 });
    for (const id of b.holdout) if (a.eligible.includes(id)) expect(a.holdout).toContain(id);
    for (const id of b.treatment) if (a.eligible.includes(id)) expect(a.treatment).toContain(id);
    const share = a.holdout.length / a.eligible.length;
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.6);
  });

  it("discount audiences may use only source, gift status and tenure, and are capped at 10%", () => {
    expect(validateAudience({ type: "gift_to_own", audience: { sources: ["gift"], giftEndingWithinDays: 30 }, discountPct: 10 })).toEqual([]);
    expect(validateAudience({ type: "gift_to_own", audience: { onHand: "ge14" }, discountPct: 10 })[0]).toContain("onHand");
    expect(validateAudience({ type: "gift_to_own", audience: { sources: ["gift"] }, discountPct: 30 }).join(" ")).toContain("capped at 10%");
    expect(validateAudience({ type: "rotation", audience: { onHand: "ge14" }, discountPct: 0 })).toEqual([]);
  });
});

describe("offers: break-even, results and the sensor-protection rule", () => {
  it("break-even comes from the ledger: gift-to-own at 10% off a $46 order with 30% acceptance pays if it keeps about 8-11 of every 1,000", () => {
    const b = breakEven("gift_to_own", 10, 46, 0.3);
    expect(b.costPerAccept).toBeCloseTo(4.6, 6);
    expect(b.costPerRecipient).toBeCloseTo(1.38, 6);
    expect(b.valuePerSave[0]).toBeGreaterThan(128);
    expect(b.valuePerSave[0]).toBeLessThan(131);
    expect(b.valuePerSave[1]).toBeGreaterThan(168);
    expect(b.valuePerSave[1]).toBeLessThan(172);
    expect(b.keepPer1000[0]).toBeGreaterThan(7.9);
    expect(b.keepPer1000[0]).toBeLessThan(8.4);
    expect(b.keepPer1000[1]).toBeGreaterThan(10.4);
    expect(b.keepPer1000[1]).toBeLessThan(11);
    expect(breakEven("rotation", 0, 29, 0.3).keepPer1000).toEqual([0, 0]);
  });

  it("the sample size for a 3-point drop from 8% is about 1,060 per group; smaller effects need far more", () => {
    expect(sampleSizePerGroup(0.08, 0.03)).toBeGreaterThan(1000);
    expect(sampleSizePerGroup(0.08, 0.03)).toBeLessThan(1120);
    expect(sampleSizePerGroup(0.08, 0.02)).toBeGreaterThan(2400);
    expect(sampleSizePerGroup(0.08, 0.01)).toBeGreaterThan(8000);
  });

  it("sensor protection pauses on opt-out share, on opt-outs above the holdout, and on a reply-rate drop; not on noise", () => {
    const zero = { n: 0, optOuts: 0, reachedCheckIn: 0, replied: 0 };
    expect(sensorCheck({ sends: 99, optOuts7d: 50, treatment: zero, holdout: zero }).pause).toBe(false); // under the minimum
    expect(sensorCheck({ sends: 200, optOuts7d: 4, treatment: zero, holdout: zero }).pause).toBe(false); // 2.0% is not above 2%
    expect(sensorCheck({ sends: 200, optOuts7d: 5, treatment: zero, holdout: zero })).toMatchObject({ pause: true });
    const bad = sensorCheck({ sends: 400, optOuts7d: 2, treatment: { n: 400, optOuts: 30, reachedCheckIn: 0, replied: 0 }, holdout: { n: 400, optOuts: 10, reachedCheckIn: 0, replied: 0 } });
    expect(bad.pause).toBe(true);
    expect(bad.reason).toContain("higher than in the holdout");
    const noise = sensorCheck({ sends: 400, optOuts7d: 2, treatment: { n: 400, optOuts: 12, reachedCheckIn: 0, replied: 0 }, holdout: { n: 400, optOuts: 10, reachedCheckIn: 0, replied: 0 } });
    expect(noise.pause).toBe(false);
    const reply = sensorCheck({ sends: 400, optOuts7d: 0, treatment: { n: 400, optOuts: 0, reachedCheckIn: 400, replied: 120 }, holdout: { n: 400, optOuts: 0, reachedCheckIn: 400, replied: 200 } });
    expect(reply.pause).toBe(true);
    expect(reply.reason).toContain("reply rate");
    expect(sensorCheck({ sends: 400, optOuts7d: 0, treatment: { n: 150, optOuts: 100, reachedCheckIn: 150, replied: 0 }, holdout: { n: 150, optOuts: 0, reachedCheckIn: 150, replied: 150 } }).pause).toBe(false); // under 200 per arm
    expect(diffBounds({ x: 30, n: 400 }, { x: 10, n: 400 }).lower).toBeGreaterThan(0);
  });
});

describe("offers: scheduling never adds a text and results hide benefit until N", () => {
  let t: TestConsole;
  beforeAll(() => {
    t = freshConsole();
  });
  afterAll(() => t.cleanup());

  it("scheduling puts the offer line on existing queued reminders; the number of queued texts does not grow", () => {
    const queuedBefore = get<{ n: number }>(t.db, "SELECT COUNT(*) AS n FROM messages WHERE status = 'queued' AND direction = 'out'")!.n;
    const id = createOffer(t.ctx, rotation);
    expect(get<{ status: string }>(t.db, "SELECT status FROM offers WHERE id = ?", id)!.status).toBe("Draft");
    const r = scheduleOffer(t.ctx, id);
    expect(r).toMatchObject({ ok: true, status: "Scheduled" });
    const queuedAfter = get<{ n: number }>(t.db, "SELECT COUNT(*) AS n FROM messages WHERE status = 'queued' AND direction = 'out'")!.n;
    expect(queuedAfter).toBe(queuedBefore);
    const withOffer = all<{ customer_id: string; body: string }>(t.db, "SELECT customer_id, body FROM messages WHERE status = 'queued' AND offer_id = ?", id);
    expect(withOffer.length).toBeGreaterThan(0);
    for (const m of withOffer) {
      expect(m.body).toContain("ROTATE");
      expect(m.body).toContain("NO OFFERS");
      const a = get<{ arm: string }>(t.db, "SELECT arm FROM offer_assignments WHERE offer_id = ? AND customer_id = ?", id, m.customer_id)!;
      expect(a.arm).toBe("treatment");
      expect(get<{ c: number }>(t.db, "SELECT consent_offers AS c FROM customers WHERE id = ?", m.customer_id)!.c).toBe(1);
    }
    // each customer has at most one queued reminder
    expect(get<{ n: number }>(t.db, "SELECT COUNT(*) AS n FROM (SELECT customer_id FROM messages WHERE kind = 'reminder' AND status = 'queued' GROUP BY customer_id HAVING COUNT(*) > 1)")!.n).toBe(0);
    // holdout customers are assigned but get the plain reminder
    const hold = all<{ customer_id: string }>(t.db, "SELECT customer_id FROM offer_assignments WHERE offer_id = ? AND arm = 'holdout' LIMIT 5", id);
    for (const h of hold) expect(get<{ n: number }>(t.db, "SELECT COUNT(*) AS n FROM messages WHERE customer_id = ? AND status = 'queued' AND offer_id IS NOT NULL", h.customer_id)!.n).toBe(0);
  });

  it("results show counts and the collecting-data line only; the sandbox never fakes outcomes", () => {
    const id = all<{ id: number }>(t.db, "SELECT id FROM offers WHERE name = 'Athens roast rotation'")[0]!.id;
    const r = offerResults(t.db, id);
    expect(r.readReady).toBe(false);
    expect(r.statusLine).toMatch(/^Collecting data · [\d,]+ of 1,0\d\d per group · first read (est\. \w{3} 20\d\d|is more than 2 years away at this audience size)$/);
    expect(r.accepted).toBe(0);
    expect(r.sandboxNote).toContain("never simulated");
  });

  it("sending the reminder marks the offer Running; a customer who says NO OFFERS leaves it; the rest still get their delivery texts", () => {
    const id = all<{ id: number }>(t.db, "SELECT id FROM offers WHERE name = 'Athens roast rotation'")[0]!.id;
    const c = get<{ customer_id: string }>(t.db, "SELECT customer_id FROM offer_assignments WHERE offer_id = ? AND arm = 'treatment' LIMIT 1", id)!.customer_id;
    handleInbound(t.ctx, c, "NO OFFERS");
    expect(get<{ n: number }>(t.db, "SELECT COUNT(*) AS n FROM offer_assignments WHERE offer_id = ? AND customer_id = ?", id, c)!.n).toBe(0);
    const rem = get<{ body: string }>(t.db, "SELECT body FROM messages WHERE customer_id = ? AND kind = 'reminder' AND status = 'queued'", c);
    expect(rem?.body).toMatch(/^Your coffee arrives \w{3} \w{3} \d+\. Running low\? Reply SOONER\.$/);
  });

  it("a discount offer goes to Approvals first; approving schedules it", () => {
    const id = createOffer(t.ctx, { name: "Gift-to-own test", type: "gift_to_own", audience: { sources: ["gift"], giftEndingWithinDays: 90 }, holdoutMode: "experiment", holdoutPct: 50, discountPct: 10, budget: 500, approvalRequired: true });
    expect(scheduleOffer(t.ctx, id)).toMatchObject({ ok: true, status: "Pending approval" });
    expect(get<{ n: number }>(t.db, "SELECT COUNT(*) AS n FROM offer_assignments WHERE offer_id = ?", id)!.n).toBe(0);
    expect(approveOffer(t.ctx, id)).toMatchObject({ ok: true, status: "Scheduled" });
    const q = get<{ body: string }>(t.db, "SELECT body FROM messages WHERE offer_id = ? AND status = 'queued' LIMIT 1", id);
    if (q) expect(q.body).toContain("10% off");
  });

  it("a discount offer cannot target by on-hand, city or similar; scheduling is refused", () => {
    const id = createOffer(t.ctx, { name: "Bad discount", type: "gift_to_own", audience: { onHand: "ge14" }, holdoutMode: "global", holdoutPct: 0, discountPct: 10, budget: 0, approvalRequired: true });
    const r = scheduleOffer(t.ctx, id);
    expect(r.ok).toBe(false);
  });

  it("the daily sensor check pauses an offer whose opt-outs exceed 2% of sends", () => {
    const id = createOffer(t.ctx, { name: "Noisy", type: "seasonal_swap", audience: {}, holdoutMode: "global", holdoutPct: 0, discountPct: 0, budget: 0, approvalRequired: false });
    run(t.db, "UPDATE offers SET status = 'Running' WHERE id = ?", id);
    const custs = all<{ id: string }>(t.db, "SELECT id FROM customers WHERE consent_offers = 1 AND status = 'ACTIVE' LIMIT 150 OFFSET 500");
    for (const [i, c] of custs.entries()) {
      const m = run(t.db, "INSERT INTO messages(customer_id, at, direction, body, kind, status, offer_id) VALUES (?,?,?,?,?,?,?)", c.id, nowMs(t.db) - 3 * MS_DAY, "out", "x", "reminder", "delivered", id);
      run(t.db, "INSERT INTO offer_assignments(offer_id, customer_id, family, arm, message_id, assigned_at) VALUES (?,?,?,?,?,?)", id, c.id, "seasonal_swap", "treatment", m.lastInsertRowid, nowMs(t.db) - 4 * MS_DAY);
      if (i < 6) run(t.db, "INSERT INTO messages(customer_id, at, direction, body, kind, reason_code, status) VALUES (?,?,?,?,?,?,?)", c.id, nowMs(t.db) - 2 * MS_DAY, "in", "NO OFFERS", "reply", "KEYWORD_NO_OFFERS", "received");
    }
    expect(runSensorChecks(t.ctx)).toContain(id);
    const row = get<{ status: string; paused_reason: string }>(t.db, "SELECT status, paused_reason FROM offers WHERE id = ?", id)!;
    expect(row.status).toBe("Paused");
    expect(row.paused_reason).toContain("within 7 days");
    expect(pauseOffer(t.ctx, id, "again").ok).toBe(false);
  });

  it("the copy deck has the reminder + offer texts (spec 11.4)", () => {
    expect(COPY.reminderRotation({ new: 20_000 })).toMatch(/^Your coffee arrives .*Want a different Athens roast each delivery, same price\? Reply ROTATE\. Running low\? Reply SOONER\. No more offers\? Reply NO OFFERS\.$/);
    expect(COPY.reminderSmaller({ new: 20_000 })).toContain("Reply SMALLER for a smaller bag at a lower price");
  });
});
