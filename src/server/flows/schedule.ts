import { ENGINE } from "../../shared/constants.ts";
import { dayFromISO, etInstant, etParts, isoFromDay, type Day } from "../../shared/dates.ts";
import { hash32 } from "../../shared/rng.ts";
import type { CustomerRow, MessageRow, WhySnapshot } from "../../shared/types.ts";
import { all, get, run, type Db } from "../db.ts";
import { COPY, CHECKIN_WINDOW } from "../copy.ts";
import { addEvent, audit, customerRow, deliveredDays, nextScheduled, nowMs, projectionOf, setNow } from "../store.ts";
import { pendingOfferFor } from "../offers/assign.ts";
import type { AppCtx } from "./context.ts";
import { insertMessage, sendText, updateMessage } from "./send.ts";

/** Deterministic minute of the morning for a customer's check-in (9:00 - 11:30 local). */
export function checkInInstant(customerId: string, day: Day): number {
  const span = CHECKIN_WINDOW.toMinute - CHECKIN_WINDOW.fromMinute;
  const minute = CHECKIN_WINDOW.fromMinute + (hash32("checkin-minute", customerId, day) % span);
  return etInstant(day, Math.floor(minute / 60), minute % 60);
}

export function cancelQueued(ctx: AppCtx, customerId: string, kinds: string[]): void {
  const rows = all<{ id: number }>(ctx.db, `SELECT id FROM messages WHERE customer_id = ? AND status = 'queued' AND direction = 'out' AND kind IN (${kinds.map(() => "?").join(",")})`, customerId, ...kinds);
  for (const r of rows) updateMessage(ctx, r.id, { status: "cancelled" });
}

/** Reminder text for a delivery date, with this customer's offer riding along if one is due (never a new text). */
export function composeReminder(db: Db, customerId: string, arrival: Day): { body: string; snapshot: WhySnapshot; offerId: number | null; code: string } {
  const offer = pendingOfferFor(db, customerId, arrival);
  if (!offer) return { body: COPY.reminder({ new: arrival }), snapshot: { reasonChip: "Reminder" }, offerId: null, code: "REMINDER" };
  const body =
    offer.type === "rotation"
      ? COPY.reminderRotation({ new: arrival })
      : offer.type === "smaller"
        ? COPY.reminderSmaller({ new: arrival })
        : offer.type === "seasonal_swap"
          ? COPY.reminderSwap({ new: arrival })
          : COPY.reminderGiftToOwn({ new: arrival, percent: offer.discountPct });
  return { body, snapshot: { reasonChip: `Reminder + offer: ${offer.name}`, offerType: offer.name }, offerId: offer.offerId, code: "REMINDER" };
}

export function queueReminder(ctx: AppCtx, customerId: string, arrival: Day): void {
  const c = customerRow(ctx.db, customerId);
  if (!c || !c.consent_delivery || c.status === "OPTED_OUT" || c.status === "CANCELLED") return;
  cancelQueued(ctx, customerId, ["reminder"]);
  const at = etInstant(arrival - ENGINE.reminderDaysBefore, 10, 0);
  if (at < nowMs(ctx.db)) return;
  const r = composeReminder(ctx.db, customerId, arrival);
  insertMessage(ctx, { customerId, at, direction: "out", body: r.body, kind: "reminder", reasonCode: r.code, status: "queued", offerId: r.offerId, snapshot: r.snapshot });
}

export interface CheckInPlan {
  at: number;
  skip: boolean;
}

/** Queue this cycle's check-in 10 days before the scheduled arrival (every other delivery once How sure is High). */
export function queueCheckIn(ctx: AppCtx, customerId: string, arrival: Day, atOverride?: number): void {
  const db = ctx.db;
  const c = customerRow(db, customerId);
  if (!c || !c.consent_delivery || c.status === "OPTED_OUT" || c.status === "CANCELLED" || c.status === "PAUSED") return;
  cancelQueued(ctx, customerId, ["checkin"]);
  const at = atOverride ?? checkInInstant(customerId, arrival - ENGINE.checkInDaysBefore);
  if (at < nowMs(db) - 12 * 3_600_000) return;
  const existing = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM messages WHERE customer_id = ? AND kind = 'checkin' AND direction = 'out' AND at > ? AND status IN ('sent','delivered','queued')", customerId, etInstant(arrival - 12, 0, 0))?.n ?? 0;
  if (existing > 0) return;
  insertMessage(ctx, { customerId, at, direction: "out", body: "", kind: "checkin", reasonCode: "CHECKIN_DUE", status: "queued", snapshot: { reasonChip: `Check-in: delivery in ${ENGINE.checkInDaysBefore} days`, from: arrival } });
}

/** Queue everything a new scheduled delivery needs. */
export function queueCycle(ctx: AppCtx, customerId: string, arrival: Day, opts: { checkInAt?: number } = {}): void {
  queueCheckIn(ctx, customerId, arrival, opts.checkInAt);
  queueReminder(ctx, customerId, arrival);
}

export function moveDelivery(ctx: AppCtx, customerId: string, to: Day, actor: string): { from: Day; to: Day } | undefined {
  const next = nextScheduled(ctx.db, customerId);
  if (!next) return undefined;
  run(ctx.db, "UPDATE deliveries SET scheduled_date = ? WHERE id = ?", isoFromDay(to), next.id);
  addEvent(ctx.db, customerId, "move", { from: next.day, to, actor });
  queueReminder(ctx, customerId, to);
  ctx.emit({ type: "projection", customerId });
  return { from: next.day, to };
}

// ---- the check-in leaves --------------------------------------------------------------------------------------

/** Fill in and send a queued check-in: the text depends on how many deliveries the customer has had. */
export function sendQueuedCheckIn(ctx: AppCtx, row: MessageRow): void {
  const db = ctx.db;
  const c = customerRow(db, row.customer_id);
  if (!c || c.status === "OPTED_OUT" || c.status === "CANCELLED" || c.status === "PAUSED" || !c.consent_delivery) {
    updateMessage(ctx, row.id, { status: "skipped" });
    return;
  }
  const today = etParts(nowMs(db)).day;
  const completed = deliveredDays(db, c.id, today).length;
  const first = c.name.split(" ")[0]!;
  const body = completed < 2 ? COPY.newSubscriber({ name: first }) : COPY.checkIn({ name: first });
  const prior = JSON.parse(row.snapshot) as WhySnapshot;
  let snap: WhySnapshot = { ...prior };
  try {
    const p = projectionOf(db, c.id);
    const lo = Math.round(p.runOut.q10);
    const hi = Math.round(p.runOut.q50);
    snap = {
      ...prior,
      runOutDates: p.runOutDates,
      confidence: p.confidence,
      checks: [],
      technical: { runOutDays: p.runOut, ratio: p.ratio, engineVersion: p.engineVersion },
      reasonChip: completed < 2 ? "New subscriber check-in" : lo <= 21 ? `Check-in: likely runs out in ${lo}–${hi} days` : prior.reasonChip,
    };
    // High confidence last time: check in every other delivery
    if (p.confidence === "High" && c.checkin_cycles_skipped === 0 && completed >= 2) {
      run(db, "UPDATE customers SET checkin_cycles_skipped = 1 WHERE id = ?", c.id);
      updateMessage(ctx, row.id, { status: "skipped", snapshot: { ...snap, reasonChip: "Skipped: How sure is High, so check-ins go out every other delivery" } });
      return;
    }
    if (c.checkin_cycles_skipped !== 0) run(db, "UPDATE customers SET checkin_cycles_skipped = 0 WHERE id = ?", c.id);
  } catch {
    /* a projection problem must never stop a text going out */
  }
  const sent = sendText(ctx, { customerId: c.id, body, kind: "checkin", reasonCode: "CHECKIN_DUE", snapshot: snap, at: row.at, reuseMessageId: row.id });
  if ("blocked" in sent) {
    updateMessage(ctx, row.id, { status: "skipped", snapshot: { ...snap, reasonChip: `Not sent: ${sent.blocked}` } });
    return;
  }
  if (c.status === "ACTIVE") run(db, "UPDATE customers SET status = 'AWAITING_CHECKIN' WHERE id = ?", c.id);
  ctx.emit({ type: "projection", customerId: c.id });
}

// ---- deliveries land ---------------------------------------------------------------------------------------------

/** A scheduled delivery lands: the next one is scheduled one rhythm later and its texts are queued. */
export function markDelivered(ctx: AppCtx, deliveryId: number, customerId: string, day: Day): void {
  const db = ctx.db;
  const c = customerRow(db, customerId) as CustomerRow;
  run(db, "UPDATE deliveries SET status = 'delivered', delivered_date = ? WHERE id = ?", isoFromDay(day), deliveryId);
  if (c.status === "CANCELLED" || c.status === "OPTED_OUT") {
    if (c.status === "OPTED_OUT") scheduleNextAfter(ctx, c, day);
    return;
  }
  scheduleNextAfter(ctx, c, day);
  if (c.status === "AWAITING_CHECKIN" || c.status === "AWAITING_PROPOSAL" || c.status === "HELD" || c.status === "PAUSED") run(db, "UPDATE customers SET status = 'ACTIVE', held_until = NULL WHERE id = ?", c.id);
  ctx.emit({ type: "projection", customerId });
}

function scheduleNextAfter(ctx: AppCtx, c: CustomerRow, day: Day): void {
  const next = day + c.plan_cadence_days;
  run(ctx.db, "INSERT INTO deliveries(customer_id, scheduled_date, status, size, price, items) VALUES(?,?,?,?,?,?)", c.id, isoFromDay(next), "scheduled", c.size, priceFor(c), "Coffee, 12 oz");
  run(ctx.db, "UPDATE customers SET base_arrival = ?, proposal_count = proposal_count WHERE id = ?", isoFromDay(next), c.id);
  if (c.status !== "OPTED_OUT") queueCycle(ctx, c.id, next);
}

export function priceFor(c: Pick<CustomerRow, "source">): number {
  return { in_cafe: 34, website: 41, social: 29, gift: 46, referral: 52 }[c.source];
}

// ---- the sandbox clock moves ----------------------------------------------------------------------------------------

/**
 * Advance the sandbox clock, running everything that comes due in time order: deliveries landing (6 am local on their
 * day) and queued texts. Never uses timers.
 */
export function advanceClock(ctx: AppCtx, targetMs: number): { sent: number } {
  const db = ctx.db;
  let sent = 0;
  for (let guard = 0; guard < 100_000; guard++) {
    const now = nowMs(db);
    const nextMsg = get<MessageRow>(db, "SELECT * FROM messages WHERE status = 'queued' AND direction = 'out' AND at <= ? ORDER BY at, id LIMIT 1", targetMs);
    const nextDel = get<{ scheduled_date: string }>(db, "SELECT MIN(scheduled_date) AS scheduled_date FROM deliveries WHERE status = 'scheduled'");
    let delAt = Infinity;
    if (nextDel?.scheduled_date) {
      const d = dayFromISO(nextDel.scheduled_date);
      delAt = Math.max(etInstant(d, 6, 0), now);
    }
    const msgAt = nextMsg ? Math.max(nextMsg.at, now) : Infinity;
    const at = Math.min(msgAt, delAt);
    if (at > targetMs || at === Infinity) break;
    setNow(db, at);
    if (msgAt <= delAt && nextMsg) {
      if (nextMsg.kind === "checkin") sendQueuedCheckIn(ctx, nextMsg);
      else {
        // a queued text (reminder, an offer riding on one, a quiet-hours deferral)
        const res = sendText(ctx, { customerId: nextMsg.customer_id, body: nextMsg.body, kind: nextMsg.kind, reasonCode: nextMsg.reason_code ?? "REMINDER", snapshot: JSON.parse(nextMsg.snapshot) as WhySnapshot, offerId: nextMsg.offer_id, at: nextMsg.at, reuseMessageId: nextMsg.id });
        if ("blocked" in res) updateMessage(ctx, nextMsg.id, { status: "skipped", snapshot: { ...(JSON.parse(nextMsg.snapshot) as WhySnapshot), reasonChip: `Not sent: ${res.blocked}` } });
        else if (nextMsg.offer_id) run(db, "UPDATE offer_assignments SET message_id = ? WHERE offer_id = ? AND customer_id = ?", nextMsg.id, nextMsg.offer_id, nextMsg.customer_id);
      }
      sent++;
    } else {
      const dueDay = etParts(at).day;
      const due = all<{ id: number; customer_id: string; scheduled_date: string }>(db, "SELECT id, customer_id, scheduled_date FROM deliveries WHERE status = 'scheduled' AND scheduled_date <= ?", isoFromDay(dueDay));
      for (const d of due) markDelivered(ctx, d.id, d.customer_id, dayFromISO(d.scheduled_date));
    }
  }
  if (targetMs > nowMs(db)) setNow(db, targetMs);
  ctx.emit({ type: "clock", now: nowMs(db) });
  ctx.emit({ type: "queue" });
  audit(db, "sandbox", "advance", null, { to: nowMs(db), sent });
  return { sent };
}
