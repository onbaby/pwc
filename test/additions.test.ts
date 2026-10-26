import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshnessAt } from "../src/engine/freshness.ts";
import { COPY } from "../src/server/copy.ts";
import { all, get, run } from "../src/server/db.ts";
import { staffAction } from "../src/server/flows/actions.ts";
import { handleInbound } from "../src/server/flows/inbound.ts";
import { buildProfile } from "../src/server/profile.ts";
import { normalisePhone, suggestFromAnswers } from "../src/server/qr.ts";
import { customerRow, nextScheduled } from "../src/server/store.ts";
import { FRESHNESS, WORLD } from "../src/shared/constants.ts";
import { dayFromISO, fmtDay, isoFromDay, weekday } from "../src/shared/dates.ts";
import { holidayWindowFor, thanksgiving } from "../src/shared/holidays.ts";
import { opportunity, whyDtc } from "../src/shared/opportunity.ts";
import type { MessageRow } from "../src/shared/types.ts";
import { freshConsole, getJson, postJson, type TestConsole } from "./helpers.ts";

const D = dayFromISO;

describe("freshness at the cup", () => {
  const base = { today: D("2026-10-18"), runOutMedianDays: 40, daysPerBag: 35 };
  it("opened age = roast to door + coffee still on hand when it arrives", () => {
    const f = freshnessAt({ ...base, arrival: D("2026-10-28") });
    expect(f.onHandAtArrival).toBe(30);
    expect(f.openedAtAge).toBe(30 + WORLD.roastToDoorDays);
    expect(f.lastCupAge).toBe(f.openedAtAge + 35);
    expect(f.status).toBe("past_peak");
  });
  it("bands: best within 14 days of roasting, peak to 28, late when the pantry is empty first", () => {
    expect(freshnessAt({ ...base, arrival: D("2026-11-25") }).status).toBe("best"); // 38 days out: 2 on hand
    expect(freshnessAt({ ...base, arrival: D("2026-11-11") }).status).toBe("peak"); // 16 on hand: opened at 21
    const late = freshnessAt({ ...base, arrival: D("2026-12-02") });
    expect(late.status).toBe("late");
    expect(late.daysWithout).toBe(5);
  });
  it("a first bag has no pantry ahead of it", () => {
    const f = freshnessAt({ ...base, runOutMedianDays: 0, arrival: D("2026-10-28"), firstBag: true });
    expect(f.status).toBe("best");
    expect(f.openedAtAge).toBe(WORLD.roastToDoorDays);
  });
});

describe("holiday travel windows", () => {
  it("Thanksgiving is the fourth Thursday of November", () => {
    expect(isoFromDay(thanksgiving(2026))).toBe("2026-11-26");
    expect(isoFromDay(thanksgiving(2027))).toBe("2027-11-25");
    expect(weekday(thanksgiving(2030))).toBe(4);
  });
  it("finds the window a delivery lands in, across the new year", () => {
    expect(holidayWindowFor(D("2026-11-25"))?.name).toBe("Thanksgiving");
    expect(holidayWindowFor(D("2026-12-30"))?.name).toBe("the holidays");
    expect(holidayWindowFor(D("2027-01-02"))?.name).toBe("the holidays");
    expect(holidayWindowFor(D("2026-11-11"))).toBeUndefined();
    expect(holidayWindowFor(D("2027-01-06"))).toBeUndefined();
  });
});

describe("why DTC and the opportunity sizing (Exhibits A-C)", () => {
  it("DTC grows 2x wholesale to cafes and 3.5x the company; 23.6% of new subscribers are kept at a year", () => {
    const w = whyDtc();
    expect(w.growthMultiple.vsWholesaleCafes).toBeCloseTo(2, 6);
    expect(w.growthMultiple.vsCompany).toBeCloseTo(3.5, 6);
    expect(w.newSubs).toBe(8670);
    expect(w.ret12).toBeCloseTo(0.236, 3);
    expect(w.dtc.grossProfit).toBe(793_000);
  });
  it("is arithmetic on the exhibits: grocery pounds, buyers, first-year value net of lost grocery margin", () => {
    const o = opportunity({ retentionLift: 0.1, groceryConversion: 0.05, bagsPerBuyerPerYear: 12 });
    expect(o.retentionGP).toBeCloseTo(79_300, 6);
    expect(o.detail.groceryLbsPerYear).toBe((6 * 3900 + 84 * 210) * 12);
    expect(o.detail.buyers).toBeCloseTo(o.detail.groceryBags / 12, 6);
    expect(o.detail.netPerConvert).toBeLessThan(o.detail.dtcGPPerConvert);
    expect(o.totalGP).toBeCloseTo(o.retentionGP + o.groceryGP, 6);
    // fewer bags per buyer means more buyers; more buyers means more converts
    expect(opportunity({ retentionLift: 0, groceryConversion: 0.05, bagsPerBuyerPerYear: 6 }).groceryGP).toBeGreaterThan(o.groceryGP);
    expect(opportunity({ retentionLift: 0, groceryConversion: 0, bagsPerBuyerPerYear: 12 }).totalGP).toBe(0);
  });
});

describe("bag page helpers", () => {
  it("normalises US mobile numbers and rejects others", () => {
    expect(normalisePhone("(706) 555-0142")).toBe("+17065550142");
    expect(normalisePhone("1-706-555-0142")).toBe("+17065550142");
    expect(normalisePhone("555-0142")).toBeUndefined();
    expect(normalisePhone("+44 20 7946 0958")).toBeUndefined();
  });
  it("suggests a shorter rhythm for more cups and more people", () => {
    expect(suggestFromAnswers("website", 1, 1)).toBeGreaterThan(suggestFromAnswers("website", 2, 2));
    expect(suggestFromAnswers("website", 2, 2)).toBeGreaterThan(suggestFromAnswers("website", 4, 4));
    expect((WORLD.rhythmMenu as readonly number[]).includes(suggestFromAnswers("website", 3, 2))).toBe(true);
  });
});

describe("in the console", () => {
  let t: TestConsole;
  beforeAll(() => {
    t = freshConsole();
  });
  afterAll(() => t.cleanup());

  it("Maya: the Oct 28 bag would be opened past its peak; moved to Nov 11 it opens inside the window", () => {
    t.sandbox.advance(); // check-ins
    t.sandbox.advance(); // Maya replies 6
    const p = buildProfile(t.db, "maya-thompson")!;
    expect(fmtDay(p.freshness.next!.arrival)).toBe("Wed Nov 11");
    expect(fmtDay(p.freshness.original!.arrival)).toBe("Wed Oct 28");
    expect(p.freshness.original!.status).toBe("past_peak");
    expect(p.freshness.next!.openedAtAge).toBeLessThanOrEqual(FRESHNESS.peakEndDays);
    expect(p.freshness.next!.openedAtAge).toBeLessThan(p.freshness.original!.openedAtAge);
    expect(p.projection!.daysPerBag).toBeGreaterThan(20);
  });

  it("Today shows how fresh the next four weeks' bags will be", async () => {
    const j = await getJson(t, "/api/today");
    const f = j.kpis.freshness;
    expect(f.total).toBeGreaterThan(500);
    expect(f.counts.best + f.counts.peak + f.counts.past_peak + f.counts.late).toBe(f.total);
    expect(f.atPeakShare).toBeGreaterThan(0);
    expect(f.atPeakShare).toBeLessThan(1);
  });

  it("a check-in for a Thanksgiving-week delivery asks AWAY; AWAY holds it until after; OLD undoes it", () => {
    const id = all<{ id: string }>(t.db, "SELECT id FROM customers WHERE status = 'ACTIVE' AND consent_delivery = 1 AND id NOT IN ('maya-thompson','dev-patel','priya-shah') AND (SELECT COUNT(*) FROM deliveries d WHERE d.customer_id = customers.id AND d.status = 'delivered') >= 2 AND (SELECT MAX(delivered_date) FROM deliveries d WHERE d.customer_id = customers.id) >= '2026-10-01' ORDER BY id LIMIT 1")[0]!.id;
    const next = nextScheduled(t.db, id)!;
    const wed = D("2026-11-25");
    run(t.db, "UPDATE deliveries SET scheduled_date = ? WHERE id = ?", isoFromDay(wed), next.id);
    run(t.db, "UPDATE customers SET base_arrival = ? WHERE id = ?", isoFromDay(wed), id);
    expect(staffAction(t.ctx, id, { action: "send_checkin_now" }).ok).toBe(true);
    const ci = get<MessageRow>(t.db, "SELECT * FROM messages WHERE customer_id = ? AND kind = 'checkin' AND direction = 'out' ORDER BY id DESC LIMIT 1", id)!;
    const first = customerRow(t.db, id)!.name.split(" ")[0]!;
    expect(ci.body).toBe(COPY.checkInHoliday({ name: first, holiday: "Thanksgiving" }));
    expect(JSON.parse(ci.snapshot).holiday).toBe("Thanksgiving");
    expect(buildProfile(t.db, id)!.customer.holiday).toBe("Thanksgiving");

    handleInbound(t.ctx, id, "away");
    expect(fmtDay(nextScheduled(t.db, id)!.day)).toBe("Wed Dec 2");
    expect(customerRow(t.db, id)!.status).toBe("HELD");
    const conf = get<MessageRow>(t.db, "SELECT * FROM messages WHERE customer_id = ? AND direction = 'out' ORDER BY id DESC LIMIT 1", id)!;
    expect(conf.body).toBe(COPY.away({ holiday: "Thanksgiving", old: wed, new: D("2026-12-02") }));

    handleInbound(t.ctx, id, "OLD");
    expect(nextScheduled(t.db, id)!.day).toBe(wed);
  });

  it("AWAY that would leave more than 12 weeks between deliveries goes to a person", () => {
    const id = all<{ id: string }>(t.db, "SELECT id FROM customers WHERE status = 'ACTIVE' AND consent_delivery = 1 AND id NOT IN ('maya-thompson','dev-patel','priya-shah') AND (SELECT MAX(delivered_date) FROM deliveries d WHERE d.customer_id = customers.id) BETWEEN '2026-08-01' AND '2026-08-31' ORDER BY id LIMIT 1")[0]!.id;
    const next = nextScheduled(t.db, id)!;
    run(t.db, "UPDATE deliveries SET scheduled_date = ? WHERE id = ?", "2026-11-25", next.id);
    const { messageId } = handleInbound(t.ctx, id, "AWAY");
    expect(get<MessageRow>(t.db, "SELECT * FROM messages WHERE id = ?", messageId)!.status).toBe("needs_person");
    expect(nextScheduled(t.db, id)!.day).toBe(D("2026-11-25"));
  });

  it("AWAY outside a holiday window goes to a person", () => {
    const id = all<{ id: string }>(t.db, "SELECT c.id AS id FROM customers c JOIN deliveries d ON d.customer_id = c.id AND d.status = 'scheduled' WHERE c.status = 'ACTIVE' AND c.consent_delivery = 1 AND d.scheduled_date < '2026-11-20' AND c.id NOT IN ('maya-thompson','dev-patel','priya-shah') ORDER BY c.id LIMIT 1")[0]!.id;
    const { messageId } = handleInbound(t.ctx, id, "AWAY");
    expect(get<MessageRow>(t.db, "SELECT * FROM messages WHERE id = ?", messageId)!.status).toBe("needs_person");
  });

  it("GET /api/qr: the pilot's bags, scans, sign-ups and shelf age by store", async () => {
    const j = await getJson(t, "/api/qr");
    expect(j.pilot.accounts).toBe(12);
    expect(j.totals.bags).toBeGreaterThan(10_000);
    expect(j.totals.scans).toBeGreaterThan(100);
    expect(j.totals.signups).toBeGreaterThan(10);
    expect(j.totals.signupRate).toBeGreaterThan(0.03);
    expect(j.totals.signupRate).toBeLessThan(0.2);
    expect(j.accounts).toHaveLength(12);
    expect(j.freshnessAtScan.best + j.freshnessAtScan.peak + j.freshnessAtScan.past_peak).toBe(j.totals.scans);
    expect(j.latestLots.length).toBeGreaterThan(0);
    const s = j.recentSignups[0];
    expect(buildProfile(t.db, s.customerId)!.customer.acquisition?.lot).toBe(s.lot);
  });

  it("a shopper scans a bag, sees its roast date, and subscribes; texts start only after YES", async () => {
    const { latestLots } = await getJson(t, "/api/qr");
    const code = latestLots[0].code as string;
    const lot = await getJson(t, `/api/qr/lots/${code}`);
    expect(lot.roastDate).toBeLessThanOrEqual(lot.today);
    expect(lot.ageDays).toBe(lot.today - lot.roastDate);
    expect(weekday(lot.firstDelivery)).toBe(3);
    expect(Object.keys(lot.rhythms)).toHaveLength(16);
    expect((await t.app.request("/api/qr/lots/NOPE-000000")).status).toBe(404);

    const scan = await postJson(t, "/api/qr/scan", { code });
    expect(scan.json.ok).toBe(true);
    const form = { scanId: scan.json.scanId, code, name: "Jo Rivera", phone: "(706) 555-0142", cups: 2, people: 2, rhythmDays: 42, consentDelivery: true, consentOffers: false };
    expect((await postJson(t, "/api/qr/signup", { ...form, phone: "12" })).status).toBe(400);
    expect((await postJson(t, "/api/qr/signup", { ...form, rhythmDays: 30 })).status).toBe(400);
    const ok = await postJson(t, "/api/qr/signup", form);
    expect(ok.status).toBe(200);
    const id = ok.json.customerId as string;
    expect((await postJson(t, "/api/qr/signup", form)).status).toBe(400); // one subscription per scan

    const c = customerRow(t.db, id)!;
    expect(c.status).toBe("OPT_IN_PENDING");
    expect(c.consent_delivery).toBe(0);
    expect(c.consent_offers).toBe(0);
    expect(c.source).toBe("website");
    expect(nextScheduled(t.db, id)!.day).toBe(lot.firstDelivery);
    const consent = get<MessageRow>(t.db, "SELECT * FROM messages WHERE customer_id = ? AND kind = 'consent'", id)!;
    expect(consent.body).toBe(COPY.consentDelivery());
    expect(get<{ n: number }>(t.db, "SELECT COUNT(*) AS n FROM messages WHERE customer_id = ? AND kind = 'reminder' AND status = 'queued'", id)!.n).toBe(0);

    const p = buildProfile(t.db, id)!;
    expect(p.customer.acquisition?.lot).toBe(code);
    expect(p.freshness.next?.openedAtAge).toBe(WORLD.roastToDoorDays);

    handleInbound(t.ctx, id, "YES");
    expect(customerRow(t.db, id)!.status).toBe("ACTIVE");
    expect(customerRow(t.db, id)!.consent_delivery).toBe(1);
    expect(get<{ n: number }>(t.db, "SELECT COUNT(*) AS n FROM messages WHERE customer_id = ? AND kind = 'reminder' AND status = 'queued'", id)!.n).toBe(1);
  });

  it("GET /api/settings lists the holiday windows; the Impact page and API are gone", async () => {
    expect((await t.app.request("/api/impact")).headers.get("content-type") ?? "").not.toContain("application/json");
    const s = await getJson(t, "/api/settings");
    expect(s.holidays.map((h: { name: string }) => h.name)).toContain("Thanksgiving");
    expect(s.freshness.peakEndDays).toBe(FRESHNESS.peakEndDays);
  });
});
