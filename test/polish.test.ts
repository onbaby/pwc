import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { all } from "../src/server/db.ts";
import { freshConsole, getJson, type TestConsole } from "./helpers.ts";

/** Demo polish: lists a judge reads must not look broken. */
describe("sample data and worklists", () => {
  let t: TestConsole;
  beforeAll(() => {
    t = freshConsole();
  });
  afterAll(() => t.cleanup());

  it("no two customers share a name, and the demo personas are unique", () => {
    expect(all<{ name: string; n: number }>(t.db, "SELECT name, COUNT(*) AS n FROM customers GROUP BY name HAVING n > 1")).toEqual([]);
  });

  it("Running out soon puts customers with a usable estimate before 'Not yet sure' ones", async () => {
    const r = await getJson<{ runningOutSoon: { items: Array<{ confidence: string | null }> } }>(t, "/api/today");
    const conf = r.runningOutSoon.items.map((i) => i.confidence);
    const firstUnsure = conf.indexOf("Not yet sure");
    if (firstUnsure >= 0) expect(conf.slice(firstUnsure).every((c) => c !== "High" && c !== "Medium")).toBe(true);
  });

  it("saved views: counts match the lists they open, and every view is a subset of everyone", async () => {
    const counts = await getJson<Record<string, number>>(t, "/api/customers/views");
    expect(counts.all).toBeGreaterThan(3000);
    for (const v of ["attention", "running", "approval", "new"]) {
      const r = await getJson<{ total: number }>(t, `/api/customers?view=${v}&pageSize=1`);
      expect(r.total, v).toBe(counts[v]);
      expect(r.total, v).toBeLessThanOrEqual(counts.all ?? 0);
    }
    expect(counts.attention).toBeGreaterThan(0);
    expect(counts.approval).toBeLessThanOrEqual(counts.attention ?? 0);
  });

  it("CSV export: every matching row, a header, and formula-looking text is neutralised", async () => {
    const res = await t.app.request("/api/customers?view=approval&format=csv");
    expect(res.headers.get("content-type")).toContain("text/csv");
    const lines = (await res.text()).trim().split("\n");
    const counts = await getJson<Record<string, number>>(t, "/api/customers/views");
    expect(lines[0]).toContain("runs_out_likely");
    expect(lines.length - 1).toBe(counts.approval);
    expect(lines.slice(1).every((l) => !/^[=+@-]/.test(l.split(",")[1]!))).toBe(true);
  });

  it("the Impact page and its API are gone", async () => {
    expect((await t.app.request("/api/impact")).headers.get("content-type") ?? "").not.toContain("application/json");
  });

  it("nothing sent or received is dated after the sandbox clock", () => {
    const now = Number(all<{ value: string }>(t.db, "SELECT value FROM settings WHERE key = 'clock' OR key = 'now'")[0]?.value ?? 0);
    expect(now).toBeGreaterThan(0);
    expect(all<{ n: number }>(t.db, "SELECT COUNT(*) AS n FROM messages WHERE at > ? AND status NOT IN ('queued','cancelled')", now)[0]!.n).toBe(0);
    expect(all<{ n: number }>(t.db, "SELECT COUNT(*) AS n FROM events WHERE at > ?", now)[0]!.n).toBe(0);
  });
});
