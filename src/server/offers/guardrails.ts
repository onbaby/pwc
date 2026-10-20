import { RULES } from "../../shared/constants.ts";

/**
 * Sensor-protection rule (spec 8.3), checked daily for every offer. An offer is paused if
 *  (a) STOP or NO OFFERS replies within 7 days of an offer text exceed 2% of sends (at least 100 sends); or
 *  (b) with at least 200 per arm, the one-sided 95% lower bound of (treatment - holdout) opt-out rate is above 0; or
 *  (c) with at least 200 per arm that reached their next check-in, the one-sided 95% upper bound of the reply-rate
 *      difference is below -5 points.
 * Harm stops may be checked continuously; benefit is read only at the pre-set sample size.
 */
export interface SensorInputs {
  sends: number;
  optOuts7d: number;
  treatment: { n: number; optOuts: number; reachedCheckIn: number; replied: number };
  holdout: { n: number; optOuts: number; reachedCheckIn: number; replied: number };
}

export interface SensorVerdict {
  pause: boolean;
  reason: string | null;
  detail: { optOutShare: number | null; optOutDiffLower: number | null; replyDiffUpper: number | null };
}

const Z95_ONE_SIDED = 1.6448536269514722;

/** Normal-approximation interval for a difference of two proportions (one-sided 95%). */
export function diffBounds(a: { x: number; n: number }, b: { x: number; n: number }): { diff: number; lower: number; upper: number } {
  const pa = a.x / a.n;
  const pb = b.x / b.n;
  const se = Math.sqrt((pa * (1 - pa)) / a.n + (pb * (1 - pb)) / b.n);
  const diff = pa - pb;
  return { diff, lower: diff - Z95_ONE_SIDED * se, upper: diff + Z95_ONE_SIDED * se };
}

export function sensorCheck(i: SensorInputs): SensorVerdict {
  const detail: SensorVerdict["detail"] = { optOutShare: null, optOutDiffLower: null, replyDiffUpper: null };
  if (i.sends >= RULES.sensor.minSends) {
    detail.optOutShare = i.optOuts7d / i.sends;
    if (detail.optOutShare > RULES.sensor.optOutShareMax) {
      return { pause: true, reason: `STOP or NO OFFERS replies within 7 days were ${(detail.optOutShare * 100).toFixed(1)}% of sends (limit ${RULES.sensor.optOutShareMax * 100}%).`, detail };
    }
  }
  if (i.treatment.n >= RULES.sensor.minPerArm && i.holdout.n >= RULES.sensor.minPerArm) {
    const d = diffBounds({ x: i.treatment.optOuts, n: i.treatment.n }, { x: i.holdout.optOuts, n: i.holdout.n });
    detail.optOutDiffLower = d.lower;
    if (d.lower > 0) return { pause: true, reason: `Opt-outs are higher than in the holdout (95% lower bound +${(d.lower * 100).toFixed(2)} points).`, detail };
  }
  if (i.treatment.reachedCheckIn >= RULES.sensor.minPerArm && i.holdout.reachedCheckIn >= RULES.sensor.minPerArm) {
    const d = diffBounds({ x: i.treatment.replied, n: i.treatment.reachedCheckIn }, { x: i.holdout.replied, n: i.holdout.reachedCheckIn });
    detail.replyDiffUpper = d.upper;
    if (d.upper < -RULES.sensor.replyDropPoints / 100) return { pause: true, reason: `The next check-in reply rate is lower than the holdout's (95% upper bound ${(d.upper * 100).toFixed(1)} points).`, detail };
  }
  return { pause: false, reason: null, detail };
}
