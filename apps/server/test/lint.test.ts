import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** "No hard-coded date strings on any screen" (spec 11): dates come from the scenario file or the engine. */
const root = resolve(import.meta.dirname, "../../..");
const MONTH = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.? \d{1,2}\b/;
const ISO = /\b20\d{2}-\d{2}-\d{2}\b/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css|html)$/.test(f) ? [p] : [];
  });
}

describe("no hard-coded dates in screens or copy", () => {
  const targets = [...files(join(root, "apps/web/src")), join(root, "apps/server/src/copy.ts"), join(root, "apps/server/src/views.ts"), join(root, "apps/server/src/world.ts")];
  it.each(targets)("%s", (file) => {
    const text = readFileSync(file, "utf8");
    // lines that only quote the "$44-80K" style or code comments are fine; dates are not
    const bad = text.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && (MONTH.test(l) || ISO.test(l)));
    expect(bad).toEqual([]);
  });
});
