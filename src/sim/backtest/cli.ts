import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { round } from "../../shared/stats.ts";
import { loadGaps } from "./data.ts";
import { CUTOFF_DAY, runBacktest } from "./run.ts";

/**
 * pnpm backtest. Refuses to run unless PROTOCOL.md is committed and unmodified ("written down before we looked"),
 * then records the hash and date of the commit that last touched it.
 */
const root = resolve(import.meta.dirname, "../../..");
const protocolRel = "src/sim/backtest/PROTOCOL.md";
const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();

if (git("status", "--porcelain", "--", protocolRel)) {
  console.error(`Refusing to run: ${protocolRel} has uncommitted changes. Commit the protocol first.`);
  process.exit(1);
}
const commit = git("log", "-1", "--format=%H", "--", protocolRel);
if (!commit) {
  console.error(`Refusing to run: ${protocolRel} is not committed.`);
  process.exit(1);
}
const committedAt = git("log", "-1", "--format=%cI", "--", protocolRel).slice(0, 10);
const meta = JSON.parse(readFileSync(resolve(root, "data/derived/online_retail_gaps.meta.json"), "utf8")) as {
  dataset: string;
  citation: string;
  license: string;
  gapsCsvSha256: string;
  counts: Record<string, number>;
};
const series = loadGaps(resolve(root, "data/derived/online_retail_gaps.csv"));
console.log(`protocol commit ${commit.slice(0, 10)} (${committedAt}); ${series.length} series`);

const result = runBacktest(series, {
  protocol: { path: protocolRel, commit, committedAt, committedBeforeRun: true, cutoffDay: CUTOFF_DAY },
  dataset: { name: meta.dataset, citation: meta.citation, license: meta.license, gapsSha256: meta.gapsCsvSha256, counts: meta.counts },
});
const roundDeep = <T>(v: T): T => {
  if (typeof v === "number") return round(v, 5) as unknown as T;
  if (Array.isArray(v)) return v.map(roundDeep) as unknown as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, roundDeep(x)])) as T;
  return v;
};
const out = resolve(root, "artifacts/backtest.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(roundDeep(result), null, 1) + "\n");
console.log("wrote", out);
for (const r of result.rows) {
  console.log(`k=${r.k} n=${r.n} cust=${r.customers} pinball model ${r.pinballMean.model.toFixed(2)} Bc ${r.pinballMean.bc.toFixed(2)} | diff ${r.diff.mean.toFixed(2)} [${r.diff.lo.toFixed(2)}, ${r.diff.hi.toFixed(2)}] | coverage ${(r.coverage80.model * 100).toFixed(1)}%`);
}
console.log(result.success.passed ? "SUCCESS RULE: passed" : "SUCCESS RULE: failed");
console.log(result.success.line);
