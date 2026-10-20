import { ENGINE, FRESHNESS, WORLD } from "../shared/constants.ts";
import type { Day } from "../shared/dates.ts";

/**
 * Freshness at the cup: "not too early, not too late". A subscription bag is roasted to order and reaches the door
 * roastToDoorDays later. It is opened when the coffee ahead of it runs out, so its age when opened is
 * roast-to-door + days of coffee still on hand when it arrives. Arriving after the pantry is empty is the other failure:
 * the customer is out of coffee. Pure; reads only the projection's numbers.
 */

export type FreshnessStatus = "best" | "peak" | "past_peak" | "late";

export interface Freshness {
  arrival: Day;
  /** days of coffee still on hand when this bag arrives (model median) */
  onHandAtArrival: number;
  /** days the customer is out of coffee before it arrives (0 if none) */
  daysWithout: number;
  /** age of the bag, in days after roasting, when it is opened */
  openedAtAge: number;
  /** age of the bag when its last cup is drunk */
  lastCupAge: number;
  status: FreshnessStatus;
}

export interface FreshnessInput {
  today: Day;
  arrival: Day;
  /** median days until the coffee on hand now runs out (projection runOut.q50) */
  runOutMedianDays: number;
  /** days one bag lasts this customer (projection daysPerBag) */
  daysPerBag: number;
  /** nothing delivered yet: this is the customer's first bag, so there is no pantry ahead of it */
  firstBag?: boolean;
}

const round = (x: number) => Math.round(x);

export function freshnessAt(i: FreshnessInput): Freshness {
  const until = i.arrival - i.today;
  const onHand = i.firstBag ? 0 : Math.max(0, i.runOutMedianDays - until);
  const daysWithout = i.firstBag ? 0 : Math.max(0, until - i.runOutMedianDays);
  const openedAtAge = WORLD.roastToDoorDays + onHand;
  const status: FreshnessStatus = daysWithout >= ENGINE.lateDays ? "late" : openedAtAge <= FRESHNESS.bestByDays ? "best" : openedAtAge <= FRESHNESS.peakEndDays ? "peak" : "past_peak";
  return { arrival: i.arrival, onHandAtArrival: round(onHand), daysWithout: round(daysWithout), openedAtAge: round(openedAtAge), lastCupAge: round(openedAtAge + i.daysPerBag), status };
}

export const FRESHNESS_LABEL: Record<FreshnessStatus, string> = {
  best: "At its best",
  peak: "Within the peak window",
  past_peak: "Past its peak",
  late: "Arrives after they run out",
};

/** "opened about 21 days after roasting (within the 2–4 week peak)" */
export function freshnessSentence(f: Freshness): string {
  if (f.status === "late") return `arrives about ${f.daysWithout} days after the coffee runs out`;
  const window = f.status === "best" ? "at its best" : f.status === "peak" ? "within the 2–4 week peak" : "past its 4-week peak";
  return `opened about ${f.openedAtAge} days after roasting (${window})`;
}

/** Freshness of a bag arriving on `arrival`, read from a stored projection (its run-out is counted from asOfDay). */
export function freshnessFromProjection(p: { asOfDay: Day; runOut: { q50: number }; daysPerBag: number; deliveredCount: number }, arrival: Day): Freshness {
  return freshnessAt({ today: p.asOfDay, arrival, runOutMedianDays: p.runOut.q50, daysPerBag: p.daysPerBag, firstBag: p.deliveredCount === 0 });
}
