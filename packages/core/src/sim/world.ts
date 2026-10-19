import { SIM } from "../constants.ts";
import type { SubscriberFeatures } from "../engine/prior.ts";
import { hashSeed, Rng } from "../rng.ts";
import { SOURCES, type SourceName } from "../exhibits.ts";
import type { SimParams } from "./params.ts";

export const H = SIM.horizonDays;
/** random-stream length: more than the deliveries any path can have */
export const STREAM = 40;

/** One synthetic subscriber: latent truth plus every random input a policy run may need (common random numbers). */
export interface SimSubscriber {
  source: SourceName;
  idx: number;
  theta: number;
  /** exp(theta): days one delivery lasts at the usual pace */
  daysPerDelivery: number;
  cupsObs: number;
  householdObs: number;
  /** the customer-chosen cadence in days (4, 6, 8 or 12 weeks) */
  cadence: number;
  /** per-day consumption multiplier (pace noise x life events); length H + STREAM */
  pace: Float32Array;
  zBox: Float64Array;
  uSkip: Float64Array;
  uReply: Float64Array;
  uDelay: Float64Array;
  uAccept: Float64Array;
  uRevert: Float64Array;
  zReply: Float64Array;
  uGarbage: Float64Array;
  uGarbageWeeks: Float64Array;
  pfSeed: number;
}

function stream(r: Rng, n = STREAM): Float64Array {
  const a = new Float64Array(n);
  for (let i = 0; i < n; i++) a[i] = r.next();
  return a;
}

function normals(r: Rng, n = STREAM): Float64Array {
  const a = new Float64Array(n);
  for (let i = 0; i < n; i++) a[i] = r.normal();
  return a;
}

export function nearestCadence(logDays: number): number {
  let best = SIM.cadenceMenu[0] as number;
  let bd = Infinity;
  for (const c of SIM.cadenceMenu) {
    const d = Math.abs(Math.log(c) - logDays);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

export function makeSubscriber(p: SimParams, seed: number, source: SourceName, idx: number): SimSubscriber {
  const srcIdx = SOURCES.indexOf(source);
  const r = new Rng("sub", seed, srcIdx, idx);
  const cups = r.pick([1, 2, 3], [0.3, 0.45, 0.25]);
  const hh = r.pick([1, 2, 3], [0.3, 0.4, 0.3]);
  const theta =
    Math.log(p.medianDays[source] * p.medianScale) + p.cupsEffect * (cups - 2) + p.householdEffect * (hh - 2) + p.tauPop * r.normal();
  const mis = r.next() < p.misreportShare;
  const cupsObs = mis ? r.pick([1, 2, 3]) : cups;
  const hhObs = mis ? r.pick([1, 2, 3]) : hh;
  const eps = p.cadenceBias + p.cadenceSd * r.normal();
  const cadence = nearestCadence(theta + eps);

  const rp = new Rng("pace", seed, srcIdx, idx);
  const pace = new Float32Array(H + STREAM);
  for (let t = 0; t < pace.length; t++) pace[t] = Math.exp(p.paceSd * rp.normal());
  const re = new Rng("events", seed, srcIdx, idx);
  let d = 0;
  while (d < pace.length) {
    if (re.next() < p.eventProbPerMonth / 30) {
      const dur = re.int(p.eventMinDays, p.eventMaxDays);
      for (let k = d; k < Math.min(d + dur, pace.length); k++) pace[k] = pace[k]! * p.eventPaceMult;
      d += dur;
    }
    d += 1;
  }
  const rs = (name: string) => new Rng(name, seed, srcIdx, idx);
  return {
    source,
    idx,
    theta,
    daysPerDelivery: Math.exp(theta),
    cupsObs,
    householdObs: hhObs,
    cadence,
    pace,
    zBox: normals(rs("box")),
    uSkip: stream(rs("skip")),
    uReply: stream(rs("reply")),
    uDelay: stream(rs("delay")),
    uAccept: stream(rs("accept")),
    uRevert: stream(rs("revert")),
    zReply: normals(rs("zreply")),
    uGarbage: stream(rs("garbage")),
    uGarbageWeeks: stream(rs("garbageweeks")),
    pfSeed: hashSeed("pf", seed, srcIdx, idx),
  };
}

export function featuresOf(s: SimSubscriber): SubscriberFeatures {
  return { source: s.source, cupsObs: s.cupsObs, householdObs: s.householdObs, cadenceDays: s.cadence };
}
