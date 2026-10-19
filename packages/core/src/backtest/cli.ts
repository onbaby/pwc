import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BacktestArtifactSchema } from "@rot/contracts";
import { roundDeep } from "../sim/grid.ts";
import { loadSeries } from "./data.ts";
import { CUTOFF_DAY, runBacktest } from "./run.ts";

/**
 * pnpm backtest. Refuses to run unless PROTOCOL.md is committed and unmodified (spec 5.4: "written down before we looked"),
 * then records the hash of the commit that last touched it.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const protocolRel = "packages/core/src/backtest/PROTOCOL.md";
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

const dirty = git("status", "--porcelain", "--", protocolRel);
if (dirty) {
  console.error(`Refusing to run: ${protocolRel} has uncommitted changes. Commit the protocol before running the backtest.`);
  process.exit(1);
}
const commit = git("log", "-1", "--format=%H", "--", protocolRel);
if (!commit) {
  console.error(`Refusing to run: ${protocolRel} is not committed.`);
  process.exit(1);
}

const meta = JSON.parse(readFileSync(resolve(root, "data/derived/meta.json"), "utf8")) as { dataset: string; citation: string; license: string; series_csv_sha256: string };
const series = loadSeries(resolve(root, "data/derived/series.csv"));
console.log(`protocol commit ${commit.slice(0, 10)}; ${series.length} series`);

const result = runBacktest({
  series,
  protocol: { path: protocolRel, commit, committedBeforeRun: true, cutoffDay: CUTOFF_DAY },
  dataset: { name: meta.dataset, citation: meta.citation, license: meta.license, seriesSha256: meta.series_csv_sha256 },
});
const parsed = BacktestArtifactSchema.parse(roundDeep(result));
const out = resolve(root, "artifacts/backtest.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(parsed, null, 1) + "\n");
console.log("wrote", out);
for (const r of parsed.rows) {
  console.log(
    `k=${r.k} n=${r.n} cust=${r.customers} pinball model ${r.pinball33.model.toFixed(2)} B3 ${r.pinball33.b3.toFixed(2)} B0 ${r.pinball33.b0.toFixed(2)} | diff ${r.diffVsB3.mean.toFixed(2)} [${r.diffVsB3.lo.toFixed(2)}, ${r.diffVsB3.hi.toFixed(2)}] | cov ${(r.coverage80.model * 100).toFixed(1)}%`,
  );
}
console.log(parsed.success.passed ? "SUCCESS RULE: passed" : "SUCCESS RULE: failed");
console.log(parsed.success.line);
