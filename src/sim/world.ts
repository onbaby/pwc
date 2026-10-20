import { EXHIBITS, SOURCES, WORLD, type Source } from "../shared/constants.ts";
import { hash32, uN, zN, Stream } from "../shared/rng.ts";
import type { PriorFeatures } from "../engine/prior.ts";
import { dayOf, type Day } from "../shared/dates.ts";

/**
 * The simulated world (spec 7.5): synthetic customers with a latent pantry. Used to generate the sandbox and to compare
 * policies on the Impact page. Everything is a labelled assumption (see LEDGER); nothing is client data.
 */
export interface WorldOverrides {
  rhythmBias?: number;
  replyBase?: number;
  replyAccuracySd?: number;
  medianScale?: number;
}

export interface SimCustomer {
  id: string;
  source: Source;
  cups: number;
  people: number;
  cupsObs: number;
  peopleObs: number;
  /** ln(days one delivery lasts at the usual pace) */
  theta: number;
  daysPerDelivery: number;
  rhythmDays: number;
  /** the customer's per-day consumption multiplier (pace noise x life events), length horizon + 60 */
  pace: Float32Array;
  /** pre-hashed seed for this customer's random inputs */
  cs: number;
  /** pre-hashed seed for the pantry tracker */
  pfSeed: number;
}

export const SIM_SEED = 20_261_018;
/** simulation uses real days: the first delivery is a Wednesday */
export const SIM_START: Day = dayOf(2026, 1, 7);
export const H = WORLD.horizonDays;
const PACE_LEN = H + 60;

export function nearestRhythm(logDays: number): number {
  let best: number = WORLD.rhythmMenu[0];
  let bd = Infinity;
  for (const c of WORLD.rhythmMenu) {
    const d = Math.abs(Math.log(c) - logDays);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

export function makeCustomer(id: string, source: Source, o: WorldOverrides = {}, seed = SIM_SEED): SimCustomer {
  const s = new Stream("world", seed, id);
  const cups = s.pick([1, 2, 3], [0.3, 0.45, 0.25]);
  const people = s.pick([1, 2, 3], [0.3, 0.4, 0.3]);
  const theta = Math.log(WORLD.medianDaysPerDelivery[source] * (o.medianScale ?? 1)) + WORLD.cupsEffect * (cups - 2) + WORLD.peopleEffect * (people - 2) + WORLD.tauPop * s.normal();
  const mis = s.next() < WORLD.misreport;
  const cupsObs = mis ? s.pick([1, 2, 3]) : cups;
  const peopleObs = mis ? s.pick([1, 2, 3]) : people;
  const eps = (o.rhythmBias ?? WORLD.rhythmBias) + WORLD.rhythmSd * s.normal();
  const rhythmDays = nearestRhythm(theta + eps);
  const cs = hash32(seed, id, "c");
  const pace = new Float32Array(PACE_LEN);
  for (let t = 0; t < PACE_LEN; t++) pace[t] = Math.exp(WORLD.paceSd * zN(cs, 10, 0, t));
  const ev = new Stream("events", seed, id);
  let d = 0;
  while (d < PACE_LEN) {
    if (ev.next() < WORLD.eventProbPerMonth / 30) {
      const dur = ev.int(WORLD.eventMinDays, WORLD.eventMaxDays);
      for (let k = d; k < Math.min(d + dur, PACE_LEN); k++) pace[k] = pace[k]! * WORLD.eventPaceMult;
      d += dur;
    }
    d += 1;
  }
  return { id, source, cups, people, cupsObs, peopleObs, theta, daysPerDelivery: Math.exp(theta), rhythmDays, pace, cs, pfSeed: hash32(seed, id, "pf") };
}

export function priorFeatures(c: SimCustomer): PriorFeatures {
  return { source: c.source, cups: c.cupsObs, people: c.peopleObs, rhythmDays: c.rhythmDays };
}

/** Random inputs for cycle k of a customer: counter-based so every policy sees the same draws. */
export const draw = {
  /** delivery-to-delivery variation of days one delivery lasts */
  box: (c: SimCustomer, k: number) => zN(c.cs, 11, k, 0),
  skip: (c: SimCustomer, k: number) => uN(c.cs, 12, k, 0),
  reply: (c: SimCustomer, k: number) => uN(c.cs, 13, k, 0),
  delay: (c: SimCustomer, k: number) => uN(c.cs, 14, k, 0),
  accept: (c: SimCustomer, k: number) => uN(c.cs, 15, k, 0),
  revert: (c: SimCustomer, k: number) => uN(c.cs, 16, k, 0),
  noise: (c: SimCustomer, k: number) => zN(c.cs, 17, k, 0),
  garbage: (c: SimCustomer, k: number) => uN(c.cs, 18, k, 0),
  garbageWeeks: (c: SimCustomer, k: number) => uN(c.cs, 19, k, 0),
};

export function sourceWeights(): number[] {
  return SOURCES.map((s) => EXHIBITS.sources[s].newSubs);
}
