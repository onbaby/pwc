import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { armFor } from "../src/shared/pilot.ts";
import { all, get, openDb, run } from "../src/server/db.ts";
import { handleInbound, handleWeeks } from "../src/server/flows/inbound.ts";
import { advanceClock } from "../src/server/flows/schedule.ts";
import { customerRow, nowMs } from "../src/server/store.ts";
import { freshConsole, getJson, postJson, type TestConsole } from "./helpers.ts";

/** The deck's A/B pilot: new subscribers are split at random; the control arm is never texted or moved. */
describe("the A/B pilot", () => {
  let t: TestConsole;
  beforeAll(() => {
    t = freshConsole();
  });
  afterAll(() => t.cleanup());

  it("the split is a fixed function of the customer id and close to half and half", () => {
    expect(armFor("C10001")).toBe(armFor("C10001"));
    const n = all<{ arm: string }>(t.db, "SELECT arm FROM customers WHERE arm IS NOT NULL");
    const fixed = n.filter((r) => r.arm === "fixed").length;
    expect(n.length).toBeGreaterThan(300);
    expect(fixed / n.length).toBeGreaterThan(0.45);
    expect(fixed / n.length).toBeLessThan(0.55);
    for (const r of all<{ id: string; arm: string }>(t.db, "SELECT id, arm FROM customers WHERE arm IS NOT NULL LIMIT 200")) expect(r.arm).toBe(armFor(r.id));
  });

  it("the demo customers are where the story needs them: Maya joined earlier, Dev is in the AI arm", () => {
    expect(customerRow(t.db, "maya-thompson")!.arm).toBeNull();
    expect(customerRow(t.db, "dev-patel")!.arm).toBe("ai");
  });

  it("the control arm gets no check-ins, in the past or queued; the AI arm does", () => {
    const fixedCheckins = get<{ n: number }>(t.db, "SELECT COUNT(*) AS n FROM messages m JOIN customers c ON c.id = m.customer_id WHERE c.arm = 'fixed' AND m.kind = 'checkin'")!.n;
    const aiCheckins = get<{ n: number }>(t.db, "SELECT COUNT(*) AS n FROM messages m JOIN customers c ON c.id = m.customer_id WHERE c.arm = 'ai' AND m.kind = 'checkin'")!.n;
    expect(fixedCheckins).toBe(0);
    expect(aiCheckins).toBeGreaterThan(0);
  });

  it("a control customer who answers anyway is recorded, but the schedule never moves", () => {
    const id = all<{ id: string }>(t.db, "SELECT c.id AS id FROM customers c WHERE c.arm = 'fixed' AND c.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM deliveries d WHERE d.customer_id = c.id AND d.status = 'scheduled') ORDER BY c.id LIMIT 1")[0]!.id;
    const before = get<{ scheduled_date: string }>(t.db, "SELECT scheduled_date FROM deliveries WHERE customer_id = ? AND status = 'scheduled'", id)!.scheduled_date;
    handleInbound(t.ctx, id, "12");
    expect(get<{ n: number }>(t.db, "SELECT COUNT(*) AS n FROM events WHERE customer_id = ? AND type = 'reply'", id)!.n).toBeGreaterThan(0);
    expect(get<{ scheduled_date: string }>(t.db, "SELECT scheduled_date FROM deliveries WHERE customer_id = ? AND status = 'scheduled'", id)!.scheduled_date).toBe(before);
    expect(get<{ n: number }>(t.db, "SELECT COUNT(*) AS n FROM messages WHERE customer_id = ? AND status = 'pending_approval'", id)!.n).toBe(0);
    handleWeeks(t.ctx, customerRow(t.db, id)!, 1);
    expect(get<{ scheduled_date: string }>(t.db, "SELECT scheduled_date FROM deliveries WHERE customer_id = ? AND status = 'scheduled'", id)!.scheduled_date).toBe(before);
  });

  it("staff cannot send a check-in to a control customer", async () => {
    const id = all<{ id: string }>(t.db, "SELECT id FROM customers WHERE arm = 'fixed' AND status = 'ACTIVE' ORDER BY id LIMIT 1")[0]!.id;
    const r = await postJson(t, `/api/customers/${id}/actions`, { action: "send_checkin_now" });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("control group");
  });

  it("the control arm is not on the Today or Customers worklists", async () => {
    const today = await getJson<{ runningOutSoon: { items: Array<{ arm: string | null }> } }>(t, "/api/today");
    expect(today.runningOutSoon.items.some((i) => i.arm === "fixed")).toBe(false);
    const running = await getJson<{ items: Array<{ arm: string | null }> }>(t, "/api/customers?view=running&pageSize=200");
    expect(running.items.some((i) => i.arm === "fixed")).toBe(false);
    const fixed = await getJson<{ items: Array<{ arm: string | null }>; total: number }>(t, "/api/customers?arm=fixed&pageSize=50");
    expect(fixed.total).toBeGreaterThan(100);
    expect(fixed.items.every((i) => i.arm === "fixed")).toBe(true);
    const none = await getJson<{ items: Array<{ arm: string | null }> }>(t, "/api/customers?arm=none&pageSize=50");
    expect(none.items.every((i) => i.arm === null)).toBe(true);
  });

  it("/api/pilot reports both arms, the three measures, the QR measures and the stop rule", async () => {
    const p = await getJson(t, "/api/pilot");
    expect(p.week).toBe(5);
    expect(p.totalWeeks).toBe(13);
    for (const a of [p.arms.ai, p.arms.fixed]) {
      expect(a.enrolled).toBeGreaterThan(100);
      expect(a.cancelRate).toBeGreaterThanOrEqual(0);
      expect(a.revenuePerSubscriber).toBeGreaterThanOrEqual(0);
      expect(a.complaintsPer100Bags).toBeGreaterThanOrEqual(0);
    }
    expect(p.arms.fixed.checkIns).toBe(0);
    expect(p.managedReply.asked).toBeGreaterThan(100); // the console is texting people, so the overall reply rate is real
    expect(p.arms.fixed.moves).toBe(0);
    expect(p.stopRule.state).toBe("too_early");
    expect(p.stopRule.weeksLeft).toBe(8);
    expect(p.qr.scans).toBeGreaterThan(0);
    expect(p.qr.scanToSubscribe).toBeGreaterThan(0);
    expect(p.replyBar).toBe(0.4);
  });

  it("the month-3 stop rule reads the data once week 13 is reached", async () => {
    advanceClock(t.ctx, nowMs(t.db) + 8 * 7 * 86_400_000);
    const p = await getJson(t, "/api/pilot");
    expect(p.week).toBe(13);
    expect(["below_control", "not_below_control"]).toContain(p.stopRule.state);
    expect(p.arms.fixed.checkIns).toBe(0); // eight more weeks of deliveries and still no texts to the control group
  });

  it("offers are gone: no routes, no tables, no offer keywords", async () => {
    expect((await t.app.request("/api/offers")).headers.get("content-type") ?? "").not.toContain("application/json");
    const tables = all<{ name: string }>(t.db, "SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);
    for (const gone of ["offers", "offer_assignments", "global_holdout", "experiment_membership"]) expect(tables).not.toContain(gone);
    const id = all<{ id: string }>(t.db, "SELECT id FROM customers WHERE status = 'ACTIVE' AND consent_delivery = 1 AND (arm IS NULL OR arm = 'ai') ORDER BY id LIMIT 1")[0]!.id;
    handleInbound(t.ctx, id, "ROTATE");
    expect(get<{ n: number }>(t.db, "SELECT COUNT(*) AS n FROM messages WHERE customer_id = ? AND status = 'needs_person' AND body = 'ROTATE'", id)!.n).toBe(1);
    run(t.db, "DELETE FROM messages WHERE customer_id = ? AND body = 'ROTATE'", id);
  });
});

describe("a database written by an older schema", () => {
  it("is rebuilt, not migrated", () => {
    const dir = mkdtempSync(join(tmpdir(), "rot-schema-"));
    const path = join(dir, "old.db");
    const old = new DatabaseSync(path);
    old.exec("CREATE TABLE customers (id TEXT PRIMARY KEY, in_pilot INTEGER); CREATE TABLE offers (id INTEGER);");
    old.close();
    const db = openDb(path);
    const cols = all<{ name: string }>(db, "PRAGMA table_info(customers)").map((c) => c.name);
    expect(cols).toContain("arm");
    expect(cols).not.toContain("in_pilot");
    expect(all<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE name = 'offers'")).toHaveLength(0);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
