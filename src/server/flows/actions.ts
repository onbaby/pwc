import { dayFromISO, etParts, isoFromDay, nextWednesdayOnOrAfter, weekday, WEDNESDAY, type Day } from "../../shared/dates.ts";
import type { CustomerRow, MessageRow, WhySnapshot } from "../../shared/types.ts";
import { get, run } from "../db.ts";
import { COPY } from "../copy.ts";
import { addEvent, audit, customerRow, nextScheduled, nowMs, todayOf } from "../store.ts";
import type { AppCtx } from "./context.ts";
import { applyLater } from "./inbound.ts";
import { moveDelivery, sendQueuedCheckIn } from "./schedule.ts";
import { insertMessage, sendText, updateMessage, whySnapshot } from "./send.ts";

/** Staff actions and the approval queue (spec 3.2, 3.3). Every action is written to the audit log. */

export type StaffAction =
  | { action: "send_checkin_now" }
  | { action: "move"; to: Day }
  | { action: "hold"; until: Day; messageId?: number }
  | { action: "pause"; days: number }
  | { action: "add_note"; body: string }
  | { action: "reply"; body: string; messageId?: number }
  | { action: "resolve"; messageId: number }
  /** put a moved delivery back on its original date (the same as the customer replying OLD) */
  | { action: "undo_move" };

const ACTOR = "Jordan · Subscriptions";

function resolveOpen(ctx: AppCtx, customerId: string, messageId?: number): void {
  const rows = messageId !== undefined ? [{ id: messageId }] : (ctx.db.prepare("SELECT id FROM messages WHERE customer_id = ? AND status = 'needs_person'").all(customerId) as Array<{ id: number }>);
  for (const r of rows) updateMessage(ctx, r.id, { status: "resolved", resolvedAt: nowMs(ctx.db) });
  ctx.emit({ type: "queue" });
}

export function staffAction(ctx: AppCtx, customerId: string, a: StaffAction): { ok: true; detail?: string } | { ok: false; error: string } {
  const db = ctx.db;
  const c = customerRow(db, customerId);
  if (!c) return { ok: false, error: "no such customer" };
  const today = todayOf(db);
  switch (a.action) {
    case "send_checkin_now": {
      if (c.status === "OPTED_OUT" || c.status === "CANCELLED") return { ok: false, error: "This customer has stopped texts or cancelled." };
      const id = insertMessage(ctx, { customerId, at: nowMs(db), direction: "out", body: "", kind: "checkin", reasonCode: "CHECKIN_DUE", status: "queued", snapshot: { reasonChip: "Check-in sent by staff" } });
      const row = get<MessageRow>(db, "SELECT * FROM messages WHERE id = ?", id)!;
      sendQueuedCheckIn(ctx, row);
      audit(db, ACTOR, "send_checkin_now", customerId);
      return { ok: true };
    }
    case "move": {
      if (weekday(a.to) !== WEDNESDAY) return { ok: false, error: "Deliveries land on Wednesdays." };
      const next = nextScheduled(db, customerId);
      if (!next) return { ok: false, error: "No delivery is scheduled." };
      if (a.to < today + 3) return { ok: false, error: "Too soon to ship: at least 3 days." };
      moveDelivery(ctx, customerId, a.to, ACTOR);
      sendText(ctx, { customerId, body: COPY.staffHold({ old: next.day, new: a.to }), kind: "proposal", reasonCode: "STAFF_HOLD", response: true, snapshot: { reasonChip: "Staff move", from: next.day, to: a.to } });
      audit(db, ACTOR, "move", customerId, { from: next.day, to: a.to });
      ctx.emit({ type: "projection", customerId });
      return { ok: true };
    }
    case "hold": {
      const next = nextScheduled(db, customerId);
      if (!next) return { ok: false, error: "No delivery is scheduled." };
      const to = nextWednesdayOnOrAfter(a.until);
      addEvent(db, customerId, "hold", { from: today, to: a.until });
      moveDelivery(ctx, customerId, Math.max(to, next.day), ACTOR);
      run(db, "UPDATE customers SET status = 'HELD', held_until = ? WHERE id = ?", isoFromDay(a.until), customerId);
      const after = nextScheduled(db, customerId)!;
      sendText(ctx, { customerId, body: COPY.staffHold({ old: next.day, new: after.day }), kind: "proposal", reasonCode: "STAFF_HOLD", response: true, snapshot: { reasonChip: "Staff hold", from: next.day, to: after.day } });
      resolveOpen(ctx, customerId, a.messageId);
      audit(db, ACTOR, "hold", customerId, { until: a.until, to: after.day });
      ctx.emit({ type: "projection", customerId });
      return { ok: true, detail: `Held until ${isoFromDay(a.until)}; delivery moves to ${isoFromDay(after.day)}` };
    }
    case "pause": {
      const next = nextScheduled(db, customerId);
      if (!next) return { ok: false, error: "No delivery is scheduled." };
      const to = nextWednesdayOnOrAfter(next.day + a.days);
      moveDelivery(ctx, customerId, to, ACTOR);
      run(db, "UPDATE customers SET status = 'PAUSED', held_until = ? WHERE id = ?", isoFromDay(to), customerId);
      sendText(ctx, { customerId, body: COPY.paused({ old: next.day, new: to }), kind: "proposal", reasonCode: "STAFF_PAUSE", response: true, snapshot: { reasonChip: "Staff pause", from: next.day, to } });
      resolveOpen(ctx, customerId);
      audit(db, ACTOR, "pause", customerId, { days: a.days });
      ctx.emit({ type: "projection", customerId });
      return { ok: true };
    }
    case "add_note": {
      if (!a.body.trim()) return { ok: false, error: "A note needs some text." };
      run(db, "INSERT INTO notes(customer_id, at, author, body) VALUES(?,?,?,?)", customerId, nowMs(db), ACTOR, a.body.trim());
      audit(db, ACTOR, "note", customerId);
      ctx.emit({ type: "projection", customerId });
      return { ok: true };
    }
    case "reply": {
      if (!a.body.trim()) return { ok: false, error: "A reply needs some text." };
      const r = sendText(ctx, { customerId, body: a.body.trim(), kind: "other", reasonCode: "STAFF_REPLY", response: true, snapshot: { reasonChip: "Staff reply" } });
      if ("blocked" in r) return { ok: false, error: r.blocked };
      resolveOpen(ctx, customerId, a.messageId);
      audit(db, ACTOR, "reply", customerId);
      return { ok: true };
    }
    case "undo_move": {
      const next = nextScheduled(db, customerId);
      const base = c.base_arrival ? dayFromISO(c.base_arrival) : undefined;
      if (!next || base === undefined || base === next.day) return { ok: false, error: "This delivery has not been moved." };
      if (base < today + 3) return { ok: false, error: "The original date is too close to restore: at least 3 days." };
      moveDelivery(ctx, customerId, base, ACTOR);
      if (c.status === "HELD" || c.status === "PAUSED") run(db, "UPDATE customers SET status = 'ACTIVE', held_until = NULL WHERE id = ?", customerId);
      sendText(ctx, { customerId, body: COPY.oldRestored({ old: base }), kind: "proposal", reasonCode: "STAFF_UNDO", response: true, snapshot: { reasonChip: "Move undone by staff", from: next.day, to: base } });
      audit(db, ACTOR, "undo_move", customerId, { from: next.day, to: base });
      ctx.emit({ type: "projection", customerId });
      return { ok: true, detail: `Back on ${isoFromDay(base)}` };
    }
    case "resolve":
      resolveOpen(ctx, customerId, a.messageId);
      audit(db, ACTOR, "resolve", customerId, { messageId: a.messageId });
      return { ok: true };
  }
}

/** Approve a proposed text. A later move goes ahead and is sent; a sooner move is sent and waits for the customer's YES. */
export function approve(ctx: AppCtx, messageId: number): { ok: true } | { ok: false; error: string } {
  const db = ctx.db;
  const m = get<MessageRow>(db, "SELECT * FROM messages WHERE id = ?", messageId);
  if (!m || m.status !== "pending_approval") return { ok: false, error: "Nothing to approve." };
  const snap = JSON.parse(m.snapshot) as WhySnapshot;
  const c = customerRow(db, m.customer_id) as CustomerRow;
  if (c.status === "OPTED_OUT" || c.status === "CANCELLED") {
    updateMessage(ctx, messageId, { status: "cancelled" });
    return { ok: false, error: "This customer has stopped texts or cancelled." };
  }
  if (m.kind === "proposal" && snap.to !== undefined) {
    applyLater(ctx, m.customer_id, snap.to, snap.weeks ?? 0, "MOVE_LATER_APPROVED", messageId);
  } else {
    const res = sendText(ctx, { customerId: m.customer_id, body: m.body, kind: m.kind, reasonCode: m.reason_code ?? "SOONER_PROPOSED", snapshot: whySnapshot(db, m.customer_id, snap), reuseMessageId: messageId, response: true });
    if ("blocked" in res) return { ok: false, error: res.blocked };
  }
  audit(db, ACTOR, "approve", m.customer_id, { messageId });
  ctx.emit({ type: "queue" });
  return { ok: true };
}

export function holdMessage(ctx: AppCtx, messageId: number): { ok: true } | { ok: false; error: string } {
  const m = get<MessageRow>(ctx.db, "SELECT * FROM messages WHERE id = ?", messageId);
  if (!m || m.status !== "pending_approval") return { ok: false, error: "Nothing to hold." };
  updateMessage(ctx, messageId, { status: "held" });
  audit(ctx.db, ACTOR, "hold_message", m.customer_id, { messageId });
  ctx.emit({ type: "queue" });
  return { ok: true };
}

export { etParts };
export { dayFromISO };
