import { fitPrior, type PriorModel } from "../engine/prior.ts";
import { EXHIBITS, SOURCES, WORLD } from "../shared/constants.ts";
import { Stream } from "../shared/rng.ts";
import { SIM_SEED, makeCustomer, priorFeatures, draw, type WorldOverrides } from "./world.ts";

/**
 * Layer A fit on a synthetic training split (spec 7.1): customer ids never overlap the ones scored. In the sandbox this
 * is labelled "assumed prior, fit on synthetic data (circular by construction)".
 */
export function trainPrior(n = 4000, seed = SIM_SEED, o: WorldOverrides = {}): PriorModel {
  const rows = [];
  const dev: number[] = [];
  const pick = new Stream("train", seed);
  const w = SOURCES.map((s) => EXHIBITS.sources[s].newSubs);
  for (let i = 0; i < n; i++) {
    const src = SOURCES[pick.weighted(w)]!;
    const c = makeCustomer(`train-${src}-${i}`, src, o, seed);
    rows.push({ features: priorFeatures(c), theta: c.theta });
    // within-customer variation of ln(days) from delivery to delivery
    for (let k = 0; k < 4; k++) dev.push(WORLD.sigmaB * draw.box(c, k));
  }
  return fitPrior(rows, dev);
}
