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
});
