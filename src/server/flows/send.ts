import { ENGINE, RULES } from "../../shared/constants.ts";
import { etInstant, etParts, fmtDateTime, inQuietHours, isoFromDay, nextSendable, type Day } from "../../shared/dates.ts";
import { whySentSentence } from "../../engine/explain.ts";
import type { MessageDTO, MessageKind, MessageRow, MessageStatus, WhySnapshot } from "../../shared/types.ts";
import { all, get, run, type Db } from "../db.ts";
import { customerRow, nowMs, projectionOf } from "../store.ts";
import type { AppCtx } from "./context.ts";

export interface OutText {
  customerId: string;
  body: string;
  kind: MessageKind;
  reasonCode: string;
  snapshot?: WhySnapshot;
  offerId?: number | null;
  /** a response to something the customer just texted, or a legally required text: not capped, not held for quiet hours */
  response?: boolean;
  at?: number;
  /** turn an existing queued row into this text instead of inserting a new one */
  reuseMessageId?: number;
}

export function insertMessage(ctx: AppCtx, m: { customerId: string; at: number; direction: "out" | "in"; body: string; kind: MessageKind; reasonCode?: string | null; status: MessageStatus; offerId?: number | null; snapshot?: WhySnapshot }): number {
  const r = run(ctx.db, "INSERT INTO messages(customer_id, at, direction, body, kind, reason_code, status, offer_id, snapshot) VALUES(?,?,?,?,?,?,?,?,?)", m.customerId, m.at, m.direction, m.body, m.kind, m.reasonCode ?? null, m.status, m.offerId ?? null, JSON.stringify(m.snapshot ?? {}));
  ctx.emit({ type: "message", customerId: m.customerId, messageId: r.lastInsertRowid });
  return r.lastInsertRowid;
}

export function updateMessage(ctx: AppCtx, id: number, fields: { status?: MessageStatus; body?: string; snapshot?: WhySnapshot; resolvedAt?: number | null; at?: number }): void {
  const sets: string[] = [];
  const vals: Array<string | number | null> = [];
  if (fields.status !== undefined) (sets.push("status = ?"), vals.push(fields.status));
  if (fields.body !== undefined) (sets.push("body = ?"), vals.push(fields.body));
  if (fields.snapshot !== undefined) (sets.push("snapshot = ?"), vals.push(JSON.stringify(fields.snapshot)));
  if (fields.resolvedAt !== undefined) (sets.push("resolved_at = ?"), vals.push(fields.resolvedAt));
  if (fields.at !== undefined) (sets.push("at = ?"), vals.push(fields.at));
  if (!sets.length) return;
  run(ctx.db, `UPDATE messages SET ${sets.join(", ")} WHERE id = ?`, ...vals, id);
  const row = get<{ customer_id: string }>(ctx.db, "SELECT customer_id FROM messages WHERE id = ?", id);
  if (row) ctx.emit({ type: "message", customerId: row.customer_id, messageId: id });
}

/** Start of the current delivery cycle: local midnight of the last delivered date (or sign-up). */
export function cycleStart(db: Db, customerId: string): number {
  const d = get<{ delivered_date: string | null }>(db, "SELECT MAX(delivered_date) AS delivered_date FROM deliveries WHERE customer_id = ? AND status = 'delivered' AND delivered_date <= ?", customerId, isoFromDay(etParts(nowMs(db)).day));
  const day = d?.delivered_date ? Math.floor(Date.parse(d.delivered_date + "T00:00:00Z") / 86_400_000) : 0;
  return etInstant(day, 0, 0);
}

export function routineCount(db: Db, customerId: string): number {
  return get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM messages WHERE customer_id = ? AND direction = 'out' AND kind IN ('checkin','reminder','proposal','sooner') AND status IN ('sent','delivered') AND at >= ?", customerId, cycleStart(db, customerId))?.n ?? 0;
}

export function otherCount(db: Db, customerId: string): number {
  return get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM messages WHERE customer_id = ? AND direction = 'out' AND kind = 'clarify' AND status IN ('sent','delivered') AND at >= ?", customerId, cycleStart(db, customerId))?.n ?? 0;
}

export const ROUTINE_KINDS: MessageKind[] = ["checkin", "reminder", "proposal", "sooner"];

export type SendResult = { id: number; status: MessageStatus } | { blocked: string };

/** The one place a text can leave: consent, STOP state, caps and quiet hours are all enforced here (spec 7.3, 8.3). */
export function sendText(ctx: AppCtx, t: OutText): SendResult {
  const db = ctx.db;
  const now = t.at ?? nowMs(db);
  const c = customerRow(db, t.customerId);
  if (!c) return { blocked: "no such customer" };
  if (!t.response) {
    if (c.status === "OPTED_OUT") return { blocked: "STOP: no more texts" };
    if (c.status === "CANCELLED") return { blocked: "cancelled" };
    if (!c.consent_delivery) return { blocked: "no delivery-text consent" };
    if (t.kind === "offer" && !c.consent_offers) return { blocked: "no offer consent" };
    if (ROUTINE_KINDS.includes(t.kind) && routineCount(db, t.customerId) >= RULES.routineTextsPerDelivery) return { blocked: "3 routine texts already sent for this delivery" };
    if (t.kind === "clarify" && otherCount(db, t.customerId) >= RULES.otherTextsPerDelivery) return { blocked: "the one other text for this delivery is used" };
    if (inQuietHours(now)) {
      const at = nextSendable(now);
      if (t.reuseMessageId !== undefined) {
        updateMessage(ctx, t.reuseMessageId, { body: t.body, status: "queued", snapshot: t.snapshot ?? {}, at });
        return { id: t.reuseMessageId, status: "queued" };
      }
      const id = insertMessage(ctx, { customerId: t.customerId, at, direction: "out", body: t.body, kind: t.kind, reasonCode: t.reasonCode, status: "queued", offerId: t.offerId, snapshot: t.snapshot });
      return { id, status: "queued" };
    }
  }
  let id: number;
  if (t.reuseMessageId !== undefined) {
    id = t.reuseMessageId;
    updateMessage(ctx, id, { body: t.body, status: "sent", snapshot: t.snapshot ?? {}, at: now });
  } else {
    id = insertMessage(ctx, { customerId: t.customerId, at: now, direction: "out", body: t.body, kind: t.kind, reasonCode: t.reasonCode, status: "sent", offerId: t.offerId, snapshot: t.snapshot });
  }
  dispatch(ctx, id, t.customerId, t.body);
  return { id, status: "sent" };
}

/** Hand the text to the channel; the status moves to delivered or failed when it answers. */
export function dispatch(ctx: AppCtx, id: number, customerId: string, body: string): void {
  void ctx.channel
    .send(customerId, body)
    .then((r) => updateMessage(ctx, id, { status: r.delivered ? "delivered" : "failed" }))
    .catch(() => updateMessage(ctx, id, { status: "failed" }));
}

// ---- views of messages ------------------------------------------------------------------------------------------

export function reasonChip(code: string | null, s: WhySnapshot): string | null {
  if (!code) return null;
  switch (code) {
    case "CHECKIN_DUE":
      return s.reasonChip ?? "Check-in";
    case "MOVE_LATER_AUTO":
    case "MOVE_LATER_APPROVED":
      return `Delivery moved: replied ${s.weeks} week${s.weeks === 1 ? "" : "s"}`;
    case "SOONER_PROPOSED":
      return s.weeks !== undefined ? `Sooner offer: replied ${s.weeks} week${s.weeks === 1 ? "" : "s"}` : "Sooner delivery requested";
    case "REMINDER":
      return s.offerType ? `Reminder + offer: ${s.offerType}` : "Reminder";
    case "OFFER_RIDE":
      return `Offer: ${s.offerType ?? "offer"}`;
    case "STAFF_HOLD":
      return "Staff hold";
    case "STAFF_REPLY":
      return "Staff reply";
    case "NEW_SUBSCRIBER":
      return "New subscriber check-in";
    case "RESPONSE":
      return "Reply to your text";
    case "CLARIFY":
      return "Asked for a number";
    case "AUTO_PERSON":
      return "Sent to a person";
    case "CONSENT":
      return "Consent request";
    default:
      return code.replaceAll("_", " ").toLowerCase().replace(/^./, (x) => x.toUpperCase());
  }
}

export function toDTO(row: MessageRow, name?: string): MessageDTO {
  const why = JSON.parse(row.snapshot) as WhySnapshot;
  const hasWhy = row.direction === "out" && (why.runOutDates !== undefined || why.reasonChip !== undefined || (why.checks?.length ?? 0) > 0);
  let sentence: string | null = null;
  if (row.direction === "out" && why.runOutDates && why.confidence) {
    sentence = whySentSentence({ runOutLo: why.runOutDates.lo, runOutMid: why.runOutDates.mid, runOutHi: why.runOutDates.hi, confidence: why.confidence, checks: why.checks ?? [], atText: fmtDateTime(row.at) });
  } else if (row.direction === "out" && hasWhy) sentence = `${why.reasonChip ?? reasonChip(row.reason_code, why) ?? "Automated text"} · ${fmtDateTime(row.at)}`;
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: name,
    at: row.at,
    direction: row.direction,
    body: row.body,
    kind: row.kind,
    reasonCode: row.reason_code,
    reasonChip: reasonChip(row.reason_code, why),
    status: row.status,
    offerId: row.offer_id,
    why: hasWhy ? why : null,
    whySentence: sentence,
  };
}

export function messagesFor(db: Db, customerId: string, limit = 200): MessageDTO[] {
  return all<MessageRow>(db, "SELECT * FROM messages WHERE customer_id = ? AND status != 'cancelled' ORDER BY at, id LIMIT ?", customerId, limit).map((r) => toDTO(r));
}

/** The snapshot stored with an automated text: the model's run-out range, how sure, and the checks that applied. */
export function whySnapshot(db: Db, customerId: string, extra: WhySnapshot = {}): WhySnapshot {
  try {
    const p = projectionOf(db, customerId);
    return {
      runOutDates: p.runOutDates,
      confidence: p.confidence,
      checks: p.explanation.checks,
      technical: { runOutDays: p.runOut, ratio: p.ratio, ruleTrace: p.ruleTrace.map((t) => t.code), engineVersion: p.engineVersion },
      ...extra,
    };
  } catch {
    return extra;
  }
}

export { ENGINE };
export type { Day };
