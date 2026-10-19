import type { Day } from "../calendar.ts";
import { DECISION } from "../constants.ts";
import { Rng } from "../rng.ts";
import { PantryFilter, type AwayWindow, type FilterOptions, type ThetaPrior } from "./pantry.ts";

/** Everything the engine knows about one subscriber (all days are whole days). */
export interface SubscriberHistory {
  id: string;
  /** delivery arrival days (first one starts consumption) */
  deliveries: Day[];
  /** "weeks of coffee left" replies (the customer's own words, parsed to a number 0-12) */
  replies: Array<{ day: Day; weeks: number }>;
  /** deliveries the customer skipped while holding >= 21 days of coffee (implicit evidence) */
  skips: Day[];
  away: AwayWindow[];
}

export type Confidence = "High" | "Medium" | "Not yet sure";

export interface RunOut {
  q05: number;
  q10: number;
  q33: number;
  q50: number;
  q90: number;
}

export interface Forecast {
  asOf: Day;
  /** days of coffee left (quantiles of the pantry posterior) */
  runOutDays: RunOut;
  /** quantile of days left at the service level actually used for the decision */
  qService: number;
  serviceQ: number;
  /** (q90 + 1) / (q10 + 1) */
  ratio: number;
  confidence: Confidence;
  /** a reply from this cycle exists */
  freshReply: boolean;
}

export function confidenceLabel(q10: number, q90: number, freshReply: boolean): Confidence {
  const ratio = (q90 + 1) / (q10 + 1);
  if (!freshReply) return "Not yet sure";
  if (ratio <= DECISION.ratioHigh) return "High";
  if (ratio <= DECISION.ratioMedium) return "Medium";
  return "Not yet sure";
}

/** Replay a subscriber's history through a fresh filter. Deterministic given (prior, history, seed). */
export function replayFilter(
  prior: ThetaPrior,
  history: SubscriberHistory,
  asOf: Day,
  seed: number | string,
  opts: Partial<FilterOptions> = {},
): PantryFilter {
  const first = history.deliveries.length ? Math.min(...history.deliveries) : asOf;
  const f = new PantryFilter(prior, new Rng("pantry", seed), opts, first);
  type Ev = { day: Day; rank: number; kind: "deliver" | "reply" | "skip"; weeks?: number };
  const events: Ev[] = [];
  for (const d of history.deliveries) events.push({ day: d, rank: 0, kind: "deliver" });
  for (const s of history.skips) events.push({ day: s, rank: 1, kind: "skip" });
  for (const r of history.replies) events.push({ day: r.day, rank: 2, kind: "reply", weeks: r.weeks });
  events.sort((a, b) => a.day - b.day || a.rank - b.rank);
  for (const e of events) {
    if (e.day > asOf) break;
    f.advance(e.day, history.away);
    if (e.kind === "deliver") f.deliver();
    else if (e.kind === "skip") f.observeSkip();
    else f.observeWeeks(e.weeks!);
  }
  f.advance(asOf, history.away);
  return f;
}

export function forecastFromFilter(
  f: PantryFilter,
  asOf: Day,
  freshReply: boolean,
  serviceQ: number = DECISION.serviceQ,
): Forecast {
  const [q05, q10, q33, q50, q90, qService] = f.quantiles([0.05, 0.1, 0.33, 0.5, 0.9, serviceQ]) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return {
    asOf,
    runOutDays: { q05, q10, q33, q50, q90 },
    qService,
    serviceQ,
    ratio: (q90 + 1) / (q10 + 1),
    confidence: confidenceLabel(q10, q90, freshReply),
    freshReply,
  };
}

/** A reply counts as "fresh" if it arrived at or after `cycleStart`. */
export function hasFreshReply(history: SubscriberHistory, cycleStart: Day, asOf: Day): boolean {
  return history.replies.some((r) => r.day >= cycleStart && r.day <= asOf);
}

export function forecast(
  prior: ThetaPrior,
  history: SubscriberHistory,
  asOf: Day,
  cycleStart: Day,
  seed: number | string,
  opts: { serviceQ?: number; filter?: Partial<FilterOptions> } = {},
): Forecast {
  const f = replayFilter(prior, history, asOf, seed, opts.filter);
  return forecastFromFilter(f, asOf, hasFreshReply(history, cycleStart, asOf), opts.serviceQ ?? DECISION.serviceQ);
}
