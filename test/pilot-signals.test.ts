import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { all, get } from "../src/server/db.ts";
import { staffAction } from "../src/server/flows/actions.ts";
import { buildProfile } from "../src/server/profile.ts";
import { customerRow, nextScheduled } from "../src/server/store.ts";
import { RULES } from "../src/shared/constants.ts";
import { fmtDay, isoFromDay } from "../src/shared/dates.ts";
import { freshConsole, getJson, type TestConsole } from "./helpers.ts";

/** The panel's three P0 enhancements (spec 18.3) and the stores-to-visit rule. */
describe("move summary and undo (E1)", () => {
  let t: TestConsole;
  beforeAll(() => {
    t = freshConsole();
  });
  afterAll(() => t.cleanup());

  it("Undo move puts Maya back on Oct 28 and texts her; a second undo is refused", () => {
    t.sandbox.advance();
    t.sandbox.advance();
    expect(fmtDay(nextScheduled(t.db, "maya-thompson")!.day)).toBe("Wed Nov 11");
    const r = staffAction(t.ctx, "maya-thompson", { action: "undo_move" });
    expect(r.ok).toBe(true);
    expect(fmtDay(nextScheduled(t.db, "maya-thompson")!.day)).toBe("Wed Oct 28");
    const texts = all<{ body: string; reason_code: string }>(t.db, "SELECT body, reason_code FROM messages WHERE customer_id = 'maya-thompson' AND direction = 'out' ORDER BY id DESC LIMIT 1");
    expect(texts[0]!.reason_code).toBe("STAFF_UNDO");
    expect(texts[0]!.body).toContain("Wed Oct 28");
    expect(get<{ n: number }>(t.db, "SELECT COUNT(*) AS n FROM messages WHERE customer_id = 'maya-thompson' AND reason_code = 'STAFF_UNDO'")!.n).toBe(1);
    expect(staffAction(t.ctx, "maya-thompson", { action: "undo_move" }).ok).toBe(false);
    // the profile no longer reports a moved delivery
    const p = buildProfile(t.db, "maya-thompson")!;
    expect(p.customer.baseArrival === p.customer.nextDelivery || p.customer.baseArrival === null).toBe(true);
    expect(customerRow(t.db, "maya-thompson")!.status).not.toBe("CANCELLED");
  });

  it("a delivery that was never moved cannot be undone", () => {
    expect(staffAction(t.ctx, "dev-patel", { action: "undo_move" })).toEqual({ ok: false, error: "This delivery has not been moved." });
  });
});

describe("reply rate against the pilot bar (E2) and the evidence line (E3)", () => {
  let t: TestConsole;
  beforeAll(() => {
    t = freshConsole();
  });
  afterAll(() => t.cleanup());

  it("Today's reply rate is counted from the messages table, not typed in", async () => {
    const j = await getJson(t, "/api/today");
    const k = j.kpis.replyRate;
    expect(k.goBar).toBe(RULES.pilotMinReplyRate);
    expect(k.reached).toBeGreaterThan(100);
    expect(k.rate).toBeCloseTo(k.replied / k.reached, 10);
    expect(k.rate).toBeGreaterThan(0.1);
    expect(k.rate).toBeLessThan(0.9);
    // an independent count of the same thing
    const replied = get<{ n: number }>(
      t.db,
      `SELECT COUNT(DISTINCT m.customer_id) AS n FROM messages m JOIN messages r ON r.customer_id = m.customer_id AND r.direction = 'in' AND r.reason_code = 'WEEKS_LEFT' AND r.at > m.at AND r.at <= m.at + 432000000
        WHERE m.kind = 'checkin' AND m.direction = 'out' AND m.status IN ('sent','delivered') AND m.at >= ? AND m.at <= ?
          AND EXISTS (SELECT 1 FROM deliveries d WHERE d.customer_id = m.customer_id AND d.status = 'delivered')`,
      j.now - 14 * 86_400_000,
      j.now,
    )!.n;
    expect(k.replied).toBe(replied);
  });

  it("/api/evidence comes from the committed backtest artifact", async () => {
    const e = await getJson(t, "/api/evidence");
    expect(e.available).toBe(true);
    expect(e.orders).toBe(1_067_371);
    expect(e.pooledCoverage80).toBeGreaterThan(0.7);
    expect(e.pooledCoverage80).toBeLessThan(0.9);
    expect(e.committedBeforeRun).toBe(true);
    expect(e.protocolCommit).toHaveLength(10);
  });
});

describe("web sources keep the evidence out of the code", () => {
  it("no literal order count or coverage figure in src/web", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : /\.tsx?$/.test(f) ? [join(d, f)] : []));
    for (const f of files("src/web")) expect(readFileSync(f, "utf8").includes("1,067,371"), f).toBe(false);
    void isoFromDay;
  });
});
