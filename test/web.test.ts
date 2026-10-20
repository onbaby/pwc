import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Source-level checks on the web app (spec 4, 5, 11.6): no hard-coded dates, no stray demo wording, no Math.random. */
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : /\.(tsx?|css)$/.test(f) ? [join(dir, f)] : []));
const web = files("src/web").map((p) => ({ p, s: readFileSync(p, "utf8") }));

describe("web sources", () => {
  it("hard-codes no calendar dates", () => {
    const date = /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\w*,? (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w* \d{1,2}\b|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}(, \d{4})?\b/;
    for (const { p, s } of web) expect(s.split("\n").filter((l) => date.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)), p).toEqual([]);
  });

  it("shows demo wording only in the environment badge", () => {
    for (const { p, s } of web) {
      expect(/SIMULATED|[Pp]resenter|[Dd]emo mode/.test(s), p).toBe(false);
    }
  });

  it("never uses Math.random", () => {
    for (const { p, s } of web) expect(s.includes("Math.random"), p).toBe(false);
  });

  it("keeps orange off text: no text-orange class other than orange-ink, and no orange on the cream background", () => {
    for (const { p, s } of web) expect(/text-orange(?!-ink)/.test(s), p).toBe(false);
  });
});
