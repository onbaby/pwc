import { EXHIBITS, SOURCES, type SourceName } from "../exhibits.ts";
import { fitPrior, type PriorModel } from "../engine/prior.ts";
import { Rng } from "../rng.ts";
import type { SimParams } from "./params.ts";
import { featuresOf, makeSubscriber } from "./world.ts";

/**
 * Layer A on the synthetic world (spec 6.1): OLS on a synthetic training split. Subscriber indices start at
 * TRAIN_OFFSET so training subscribers are never the ones scored.
 */
export const TRAIN_OFFSET = 50_000_000;

export function trainPrior(p: SimParams, seed: number, n = 4000): PriorModel {
  const rows: Array<{ features: ReturnType<typeof featuresOf>; theta: number }> = [];
  const dev: number[] = [];
  const weights = SOURCES.map((s) => EXHIBITS.sources[s].newSubs);
  const rs = new Rng("train-sources", seed);
  for (let k = 0; k < n; k++) {
    const src: SourceName = SOURCES[rs.weighted(weights)]!;
    const sub = makeSubscriber(p, seed, src, TRAIN_OFFSET + k);
    rows.push({ features: featuresOf(sub), theta: sub.theta });
    // within-subscriber deviations of ln(days one delivery lasts): sigma_b * z
    for (let j = 0; j < 4; j++) dev.push(p.sigmaB * sub.zBox[j]!);
  }
  return fitPrior(rows, dev);
}
