import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { round } from "../shared/stats.ts";
import { computeImpact } from "./impact.ts";
import { trainPrior } from "./prior.ts";
import { SIM_SEED } from "./world.ts";

/** pnpm impact [--n 6000] [--bootstrap 200] [--out artifacts/impact.json] */
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const root = resolve(import.meta.dirname, "../..");
const n = Number(arg("--n") ?? 6000);
const bootstrap = Number(arg("--bootstrap") ?? 200);
const out = resolve(root, arg("--out") ?? "artifacts/impact.json");

const roundDeep = <T>(v: T): T => {
  if (typeof v === "number") return round(v, 5) as unknown as T;
  if (Array.isArray(v)) return v.map(roundDeep) as unknown as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, roundDeep(x)])) as T;
  return v;
};

const t0 = Date.now();
console.log(`pnpm impact: ${n} synthetic customers per source, ${bootstrap} bootstrap draws, seed ${SIM_SEED}`);
const prior = trainPrior(4000);
const impact = computeImpact({ n, seed: SIM_SEED, bootstrap, prior, onProgress: (m) => { if (!m.startsWith("scoring")) console.log("  " + m); } });
process.stdout.write("\n");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(roundDeep(impact), null, 1) + "\n");
for (const w of impact.warnings) console.warn("WARNING:", w);
console.log(`wrote ${out} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(`paced breaks even at phi = ${impact.paced.breakEvenPhi}; ceiling at ${impact.ceiling.breakEvenPhi}; rule at ${impact.rule.breakEvenPhi}`);
