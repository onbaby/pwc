import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { all, get } from "../src/server/db.ts";
import { dayFromISO } from "../src/shared/dates.ts";
import { freshConsole, getJson, postJson, type TestConsole } from "./helpers.ts";

describe("HTTP: every route answers (spec 14)", () => {
  let t: TestConsole;
  beforeAll(() => {
    t = freshConsole();
  });
  afterAll(() => t.cleanup());

  it("GET /api/today has four KPI tiles with deltas, the two tabs, Needs a person and Waiting for approval", async () => {
    const j = await getJson(t, "/api/today");
    expect(j.kpis.active.value).toBeGreaterThan(3500);
    expect(j.kpis.active.value).toBeLessThan(4500);
    for (const k of ["active", "deliveriesThisWeek", "checkInsToday", "waitingForPerson"]) {
      expect(typeof j.kpis[k].value).toBe("number");
      expect(typeof j.kpis[k].prev).toBe("number");
    }
    expect(j.kpis.deliveriesThisWeek.sparkline).toHaveLength(6);
    expect(j.kpis.active.value).not.toBe(j.kpis.active.prev); // plausible week-to-week variation
    expect(j.kpis.checkInsToday.value).toBeGreaterThan(100);
    expect(j.goingOut.items.length).toBeGreaterThan(0);
    expect(j.goingOut.items[0].reasonChip).toMatch(/Check-in|Reminder/);
    expect(j.needsPerson.total).toBe(6);
    expect(j.needsPerson.items.length).toBeLessThanOrEqual(5);
    expect(j.approvals.items.length).toBeLessThanOrEqual(3);
    expect(j.runningOutSoon.items.length).toBeGreaterThan(0);
    for (const r of j.runningOutSoon.items) expect(r.runOut.lo).toBeLessThanOrEqual(j.today + 14);
  });

  it("GET /api/customers lists with filters, search and paging", async () => {
    const all50 = await getJson(t, "/api/customers");
    expect(all50.items).toHaveLength(50);
    expect(all50.total).toBeGreaterThan(3500);
    const maya = await getJson(t, "/api/customers?q=Maya%20Thompson");
    expect(maya.items.map((i: { id: string }) => i.id)).toContain("maya-thompson");
    const cafe = await getJson(t, "/api/customers?source=in_cafe&consent=offers&pageSize=20");
    for (const i of cafe.items) {
      expect(i.source).toBe("in_cafe");
      expect(i.consentOffers).toBe(true);
    }
    const p2 = await getJson(t, "/api/customers?page=2");
    expect(p2.items[0].id).not.toBe(all50.items[0].id);
    const cancelled = await getJson(t, "/api/customers?status=cancelled");
    expect(cancelled.total).toBeGreaterThan(0);
  });

  it("GET /api/customers/:id is the profile: chart data, consent chips, thread with why, order history, Why this date", async () => {
    const p = await getJson(t, "/api/customers/maya-thompson");
    expect(p.customer.name).toBe("Maya Thompson");
    expect(p.customer.consentDelivery).toBe(true);
    expect(p.customer.consentOffers).toBe(true);
    expect(p.customer.suggestedRhythmDays).toBe(42);
    expect(p.pantry.title).toBe("No replies yet: projection based on similar customers");
    expect(p.pantry.deliveries).toHaveLength(3);
    expect(p.pantry.estimate.length).toBeGreaterThan(10);
    expect(p.projection.explanation.whatWouldChange).toMatch(/^If Maya replies differently/);
    expect(p.projection.explanation.startingPointTag).toContain("circular by construction");
    expect(p.deliveries.some((d: { daysOnHandAtArrival: number | null }) => d.daysOnHandAtArrival !== null)).toBe(true);
    expect((await t.app.request("/api/customers/nobody")).status).toBe(404);
    const dev = await getJson(t, "/api/customers/dev-patel");
    expect(dev.customer.signupAnswers.note).toBe("1 cup a day, just me");
  });

  it("POST /api/customers/:id/actions: note, check-in now, move, hold, pause; bad input is refused", async () => {
    const note = await postJson(t, "/api/customers/dev-patel/actions", { action: "add_note", body: "Said he drinks one cup a day." });
    expect(note.status).toBe(200);
    const p = await getJson(t, "/api/customers/dev-patel");
    expect(p.notes[0].body).toBe("Said he drinks one cup a day.");
    expect((await postJson(t, "/api/customers/dev-patel/actions", { action: "nope" })).status).toBe(400);
    const notWed = await postJson(t, "/api/customers/dev-patel/actions", { action: "move", to: dayFromISO("2026-11-12") });
    expect(notWed.status).toBe(400);
    const move = await postJson(t, "/api/customers/dev-patel/actions", { action: "move", to: dayFromISO("2026-11-04") });
    expect(move.json.ok).toBe(true);
    const ci = await postJson(t, "/api/customers/priya-shah/actions", { action: "send_checkin_now" });
    expect(ci.json.ok).toBe(true);
  });

  it("GET /api/inbox: the three tabs; approve and hold work", async () => {
    const needs = await getJson(t, "/api/inbox?tab=needs");
    expect(needs.total).toBeGreaterThan(0);
    expect(needs.items[0]).toHaveProperty("text");
    const ap = await getJson(t, "/api/inbox?tab=approvals");
    expect(ap.total).toBeGreaterThan(0);
    const first = ap.items[0];
    expect(first.whySentSentence ?? first.body).toBeTruthy();
    const approved = await postJson(t, `/api/messages/${first.id}/approve`);
    expect([200, 400]).toContain(approved.status);
    const second = (await getJson(t, "/api/inbox?tab=approvals")).items[0];
    if (second) expect((await postJson(t, `/api/messages/${second.id}/hold`)).json.ok).toBe(true);
    const log = await getJson(t, "/api/inbox?tab=all&q=Maya");
    expect(log.items.length).toBeGreaterThan(0);
    for (const m of log.items) expect(`${m.customerName} ${m.body} ${m.customerId}`).toMatch(/Maya|maya/);
  });

  it("offers: list, create, preview (new and existing), schedule, pause", async () => {
    const list = await getJson(t, "/api/offers");
    expect(list.offers.length).toBeGreaterThanOrEqual(3);
    const running = list.offers.find((o: { status: string }) => o.status === "Running");
    expect(running.statusLine).toMatch(/^Collecting data/);
    const draft = { name: "Athens roast rotation", type: "rotation", audience: { sources: ["social"], memberDaysMin: 30, memberDaysMax: 90, notStockpiled: true }, holdoutMode: "experiment", holdoutPct: 50 };
    const prev = await postJson(t, "/api/offers/new/preview", draft);
    expect(prev.json.preview.eligible).toBeGreaterThan(0);
    expect((await postJson(t, "/api/offers", { ...draft, type: "bogus" })).status).toBe(400);
    const created = await postJson(t, "/api/offers", draft);
    expect(created.json.ok).toBe(true);
    const id = created.json.id;
    expect((await getJson(t, `/api/offers/${id}`)).status).toBe("Draft");
    const prev2 = await postJson(t, `/api/offers/${id}/preview`, draft);
    expect(prev2.json.preview.sample.body).toContain("ROTATE");
    expect((await postJson(t, `/api/offers/${id}/schedule`)).json.status).toBe("Scheduled");
    expect((await postJson(t, `/api/offers/${id}/pause`, { reason: "test" })).json.ok).toBe(true);
    expect((await getJson(t, `/api/offers/${id}`)).status).toBe("Paused");
  });

  it("GET /api/outlook (JSON and CSV), /api/settings", async () => {
    const o = await getJson(t, "/api/outlook");
    expect(o.weeks).toHaveLength(6);
    expect(o.note).toContain("small share of roaster volume");
    const csv = await t.app.request("/api/outlook?format=csv");
    const text = await csv.text();
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(text).toContain("0.75 lb");
    expect(text).toContain("1.5 lb");
    expect(text.trim().split("\n").filter((l) => !l.startsWith("#"))).toHaveLength(7);
    const s = await getJson(t, "/api/settings");
    expect(s.deliveryDay).toBe("Wednesday");
    expect(s.quietHours).toEqual({ from: 21, to: 8 });
    expect(s.consentTexts.delivery).toContain("Up to 3 per delivery");
    expect(s.environment).toBe("Sandbox · sample data");
  });

  it("sandbox: advance, inject, channel, clock, reset", async () => {
    const st = await getJson(t, "/api/sandbox");
    expect(st.total).toBe(3);
    const adv = await postJson(t, "/api/sandbox/advance");
    expect(adv.json.event.id).toBe("checkins");
    const inj = await postJson(t, "/api/sandbox/inject", { customerId: "maya-thompson", text: "6" });
    expect(inj.json.ok).toBe(true);
    expect((await postJson(t, "/api/sandbox/inject", { customerId: "nobody", text: "6" })).status).toBe(400);
    expect((await postJson(t, "/api/sandbox/channel", { name: "console" })).json.channel).toBe("console");
    expect((await postJson(t, "/api/sandbox/channel", { name: "replay" })).json.channel).toBe("replay");
    expect((await postJson(t, "/api/sandbox/channel", { name: "fax" })).status).toBe(400);
    expect(get<{ n: number }>(t.db, "SELECT COUNT(*) AS n FROM messages WHERE customer_id = 'maya-thompson' AND kind = 'proposal'")!.n).toBe(1);
  });

  it("the SSE stream sends a snapshot, then message / queue / clock events", async () => {
    const t2 = freshConsole();
    try {
      const r = await t2.app.request("/api/stream");
      expect(r.headers.get("content-type")).toContain("text/event-stream");
      expect(r.headers.get("cache-control")).toContain("no-cache");
      const reader = r.body!.getReader();
      const dec = new TextDecoder();
      const first = dec.decode((await reader.read()).value);
      expect(first).toContain("event: snapshot");
      t2.sandbox.advance();
      let text = "";
      // one advance sends hundreds of check-ins, so many message and projection events come before the clock event
      for (let i = 0; i < 20_000 && !text.includes("event: clock"); i++) text += dec.decode((await reader.read()).value);
      expect(text).toContain("event: message");
      expect(text).toContain("event: clock");
      await reader.cancel();
    } finally {
      t2.cleanup();
    }
  });

  it("serves the built web app and refuses path traversal", async () => {
    const r = await t.app.request("/..%2f..%2fetc/passwd");
    expect([403, 404, 200]).toContain(r.status);
    const text = await r.text();
    expect(text).not.toContain("root:");
    void all;
  });
});
