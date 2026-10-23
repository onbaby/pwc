import { EXHIBITS, GROSS_MARGIN, RULES, WORLD, type Source } from "../../shared/constants.ts";
import { dayFromISO, etParts, fmtMonthYear, MS_DAY, type Day } from "../../shared/dates.ts";
import { hash32 } from "../../shared/rng.ts";
import { normPpf } from "../../shared/stats.ts";
import type { CustomerRow } from "../../shared/types.ts";
import type { Projection } from "../../engine/project.ts";
import { COPY } from "../copy.ts";
import { all, get, type Db } from "../db.ts";
import { nowMs } from "../store.ts";
import type { OfferType } from "./assign.ts";
import { OFFER_TYPES, type Audience, type HoldoutMode, type OfferDraft } from "./types.ts";

/** Who would get this offer, who is excluded and why, and what it has to achieve to pay (spec 8). All computed from the database. */

export const EXCLUSION_REASONS = [
  "no offer consent",
  "texts stopped, cancelled or paused",
  "in pacing pilot",
  "stockpiled",
  "no message to ride on",
  "had an offer in last 30 days",
  "in another experiment",
  "in the standing holdout",
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export interface Evaluation {
  matching: number;
  eligible: string[];
  excluded: Record<ExclusionReason, number>;
  treatment: string[];
  holdout: string[];
}

interface Row extends CustomerRow {
  projection_json: string | null;
  last_reply_weeks: number | null;
  skips_recent: number;
  ride_at: number | null;
  recent_offer: number;
  other_experiment: number;
  global_holdout: number;
}

const arm = (customerId: string, family: string, holdoutPct: number): "treatment" | "holdout" => (hash32("arm", customerId, family) % 100 < holdoutPct ? "holdout" : "treatment");

export function chipsMatch(c: CustomerRow, p: Projection | null, row: { lastReplyWeeks: number | null; skipsRecent: number }, a: Audience, today: Day): boolean {
  if (a.sources?.length && !a.sources.includes(c.source)) return false;
  const member = today - dayFromISO(c.signup_date);
  if (a.memberDaysMin !== undefined && member < a.memberDaysMin) return false;
  if (a.memberDaysMax !== undefined && member > a.memberDaysMax) return false;
  const onHand = p ? p.runOut.q50 : null;
  if ((a.runOutMinDays !== undefined || a.runOutMaxDays !== undefined) && onHand === null) return false;
  if (a.runOutMinDays !== undefined && onHand! < a.runOutMinDays) return false;
  if (a.runOutMaxDays !== undefined && onHand! > a.runOutMaxDays) return false;
  if (a.onHand && onHand === null) return false;
  if (a.onHand === "lt7" && onHand! >= 7) return false;
  if (a.onHand === "lt14" && onHand! >= 14) return false;
  if (a.onHand === "ge14" && onHand! < 14) return false;
  if (a.notStockpiled && onHand !== null && onHand >= 14) return false;
  if (a.lastReplyMaxWeeks !== undefined && (row.lastReplyWeeks === null || row.lastReplyWeeks > a.lastReplyMaxWeeks)) return false;
  if (a.skipped2of4 && row.skipsRecent < 2) return false;
  if (a.giftEndingWithinDays !== undefined) {
    if (c.plan_type !== "gift" || !c.gift_ends) return false;
    const left = dayFromISO(c.gift_ends) - today;
    if (left < 0 || left > a.giftEndingWithinDays) return false;
  }
  return true;
}

/** The rules a discount audience must obey: only source, gift status and tenure; never city, ZIP or name-derived fields (spec 8.2). */
export function validateAudience(draft: Pick<OfferDraft, "type" | "audience" | "discountPct">): string[] {
  const errors: string[] = [];
  const discount = OFFER_TYPES[draft.type].discount || draft.discountPct > 0;
  if (discount) {
    const allowed = new Set(["sources", "memberDaysMin", "memberDaysMax", "giftEndingWithinDays"]);
    for (const k of Object.keys(draft.audience)) if (!allowed.has(k) && (draft.audience as Record<string, unknown>)[k] !== undefined) errors.push(`A discount offer may target only sign-up source, gift status and tenure, not “${k}”.`);
    if (draft.discountPct > RULES.discountMaxPercent) errors.push(`Discounts are capped at ${RULES.discountMaxPercent}%.`);
  }
  if (!OFFER_TYPES[draft.type]) errors.push("Unknown offer type.");
  return errors;
}

export function evaluate(db: Db, draft: { type: OfferType; audience: Audience; holdoutMode: HoldoutMode; holdoutPct: number }, opts: { offerId?: number } = {}): Evaluation {
  const now = nowMs(db);
  const today = etParts(now).day;
  const family = draft.type;
  const rows = all<Row>(
    db,
    `SELECT c.*, p.json AS projection_json,
        (SELECT json_extract(e.data, '$.weeks') FROM events e WHERE e.customer_id = c.id AND e.type = 'reply' ORDER BY e.at DESC LIMIT 1) AS last_reply_weeks,
        (SELECT COUNT(*) FROM (SELECT status FROM deliveries d WHERE d.customer_id = c.id AND d.status IN ('delivered','skipped') ORDER BY d.scheduled_date DESC LIMIT 4) WHERE status = 'skipped') AS skips_recent,
        rd.ride_at AS ride_at,
        (SELECT COUNT(*) FROM messages m WHERE m.customer_id = c.id AND m.direction = 'out' AND m.offer_id IS NOT NULL AND m.status IN ('sent','delivered') AND m.at > ?) AS recent_offer,
        (SELECT COUNT(*) FROM experiment_membership x WHERE x.customer_id = c.id AND x.outcome_closes_at > ? AND x.family != ? AND (? IS NULL OR x.offer_id != ?)) AS other_experiment,
        (SELECT COUNT(*) FROM global_holdout g WHERE g.customer_id = c.id AND g.until_at > ?) AS global_holdout
       FROM customers c LEFT JOIN projections p ON p.customer_id = c.id
       LEFT JOIN (SELECT customer_id, MIN(at) AS ride_at FROM messages WHERE status = 'queued' AND kind = 'reminder' AND at >= ? GROUP BY customer_id) rd ON rd.customer_id = c.id
      WHERE c.status != 'CANCELLED' OR c.status IS NULL`,
    now - RULES.offerCapDays * MS_DAY,
    now,
    family,
    opts.offerId ?? null,
    opts.offerId ?? null,
    now,
    now,
  );
  const excluded = Object.fromEntries(EXCLUSION_REASONS.map((r) => [r, 0])) as Record<ExclusionReason, number>;
  const eligible: string[] = [];
  let matching = 0;
  const horizon = now + 21 * MS_DAY;
  for (const r of rows) {
    const p = r.projection_json ? (JSON.parse(r.projection_json) as Projection) : null;
    if (!chipsMatch(r, p, { lastReplyWeeks: r.last_reply_weeks, skipsRecent: r.skips_recent }, draft.audience, today)) continue;
    matching++;
    const reason: ExclusionReason | null = !r.consent_offers
      ? "no offer consent"
      : r.status === "OPTED_OUT" || r.status === "CANCELLED" || r.status === "PAUSED"
        ? "texts stopped, cancelled or paused"
        : r.in_pilot
          ? "in pacing pilot"
          : r.global_holdout
            ? "in the standing holdout"
            : r.ride_at === null || r.ride_at > horizon
              ? "no message to ride on"
              : r.recent_offer > 0
                ? "had an offer in last 30 days"
                : r.other_experiment > 0
                  ? "in another experiment"
                  : null;
    if (reason) excluded[reason]++;
    else eligible.push(r.id);
  }
  // "stockpiled" is also reported for customers dropped by the notStockpiled chip, so the count is visible
  if (draft.audience.notStockpiled) {
    const without = { ...draft.audience, notStockpiled: undefined };
    let n = 0;
    for (const r of rows) {
      const p = r.projection_json ? (JSON.parse(r.projection_json) as Projection) : null;
      if (!chipsMatch(r, p, { lastReplyWeeks: r.last_reply_weeks, skipsRecent: r.skips_recent }, without, today)) continue;
      if (p && p.runOut.q50 >= 14 && r.consent_offers) n++;
    }
    excluded.stockpiled = n;
  }
  const treatment: string[] = [];
  const holdout: string[] = [];
  for (const id of eligible) {
    if (draft.holdoutMode === "experiment" && arm(id, family, draft.holdoutPct) === "holdout") holdout.push(id);
    else treatment.push(id);
  }
  return { matching, eligible, excluded, treatment, holdout };
}

// ---- break-even (spec 8.4) ---------------------------------------------------------------------------------------

export interface BreakEven {
  acceptRate: number;
  costPerAccept: number;
  costPerRecipient: number;
  valuePerSave: [number, number];
  /** recipients out of every 1,000 an offer must keep to pay, across 7-9.2 deliveries a year */
  keepPer1000: [number, number];
  aov: number;
  discount: boolean;
}

const monthsOfValue = (): number => {
  let s = 0;
  for (let k = 0; k < 12; k++) s += 0.92 ** k;
  return s;
};

/** breakEvenPer1000 = 1000 x acceptRate x costPerAccept / valuePerSave, computed from the ledger constants. */
export function breakEven(type: OfferType, discountPct: number, aov: number, acceptRate = 0.3): BreakEven {
  const discount = OFFER_TYPES[type].discount || discountPct > 0;
  const costPerAccept = discount ? (discountPct / 100) * aov : 0;
  const [dLow, dHigh] = WORLD.deliveriesPerYearRange;
  const value = (dpy: number): number => ((dpy * aov * GROSS_MARGIN) / 12) * monthsOfValue();
  const vs: [number, number] = [value(dLow), value(dHigh)];
  const per1000 = (v: number): number => (1000 * (discount ? acceptRate : 0) * costPerAccept) / v;
  return { acceptRate: discount ? acceptRate : 0, costPerAccept, costPerRecipient: (discount ? acceptRate : 0) * costPerAccept, valuePerSave: vs, keepPer1000: [per1000(vs[1]), per1000(vs[0])], aov, discount };
}

/** Two-sided 5% test at 80% power: customers per group to see a drop in 30-day cancellation. */
export function sampleSizePerGroup(p1 = 0.08, drop = 0.03, alpha = 0.05, power = 0.8): number {
  const p2 = p1 - drop;
  const pbar = (p1 + p2) / 2;
  const za = normPpf(1 - alpha / 2);
  const zb = normPpf(power);
  return Math.ceil((za * Math.sqrt(2 * pbar * (1 - pbar)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2 / drop ** 2);
}

/** Average order value across a set of customers, by source (the case's AOV per source). */
export function meanAov(sources: Source[]): number {
  if (!sources.length) return 0;
  return sources.reduce((a, s) => a + EXHIBITS.sources[s].aov, 0) / sources.length;
}

export interface FirstRead {
  perGroupNeeded: number;
  perGroupNow: number;
  estimate: string;
  months: number;
  statusLine: (n: number) => string;
}

/**
 * When could the first read happen? Recipients accumulate as eligible customers pass through the audience; the cancellation
 * outcome window then has to close (60 days). With a tenure window the audience refreshes every window; otherwise
 * about once a year. These are labelled assumptions, shown as "first read est.".
 */
export function estimateFirstRead(eligible: number, audience: Audience, holdoutMode: HoldoutMode, today: Day): FirstRead {
  const needed = sampleSizePerGroup();
  const groups = holdoutMode === "experiment" ? 2 : 1;
  const perGroupNow = Math.floor(eligible / groups);
  const windowMonths = audience.memberDaysMin !== undefined && audience.memberDaysMax !== undefined ? Math.max((audience.memberDaysMax - audience.memberDaysMin) / 30, 0.5) : 12;
  const monthlyIn = Math.max(eligible / windowMonths / groups, 1);
  const monthsToN = perGroupNow >= needed ? 1 : 1 + (needed - perGroupNow) / monthlyIn;
  const totalMonths = monthsToN + RULES.experimentOutcomeDays / 30;
  const readDay = today + Math.round(totalMonths * 30);
  const far = totalMonths > 24;
  const estimate = far ? "more than 2 years away at this audience size" : fmtMonthYear(readDay);
  return {
    perGroupNeeded: needed,
    perGroupNow,
    estimate,
    months: Math.round(totalMonths * 10) / 10,
    statusLine: (n: number) => `Collecting data · ${n.toLocaleString("en-US")} of ${needed.toLocaleString("en-US")} per group · first read ${far ? "is " : "est. "}${estimate}`,
  };
}

/** A sample message for a real customer: the reminder with this offer's line, using the live copy deck. */
export function sampleMessage(db: Db, customerId: string | undefined, type: OfferType, discountPct: number): { name: string; body: string } | null {
  if (!customerId) return null;
  const c = get<{ name: string }>(db, "SELECT name FROM customers WHERE id = ?", customerId);
  const d = get<{ scheduled_date: string }>(db, "SELECT scheduled_date FROM deliveries WHERE customer_id = ? AND status = 'scheduled' LIMIT 1", customerId);
  if (!c || !d) return null;
  const arrival = dayFromISO(d.scheduled_date);
  const body = type === "rotation" ? COPY.reminderRotation({ new: arrival }) : type === "smaller" ? COPY.reminderSmaller({ new: arrival }) : type === "seasonal_swap" ? COPY.reminderSwap({ new: arrival }) : COPY.reminderGiftToOwn({ new: arrival, percent: discountPct || 10 });
  return { name: c.name, body };
}
