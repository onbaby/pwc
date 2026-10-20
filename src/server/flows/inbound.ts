import { ENGINE } from "../../shared/constants.ts";
import { holidayWindowFor } from "../../shared/holidays.ts";
import { dayFromISO, etParts, isoFromDay, latestWednesdayOnOrBefore, nextWednesdayOnOrAfter, type Day } from "../../shared/dates.ts";
import type { CustomerRow, MessageRow, WhySnapshot } from "../../shared/types.ts";
import { all, get, run } from "../db.ts";
import { COPY } from "../copy.ts";
import { addEvent, audit, customerRow, nextScheduled, nowMs, projectionOf, todayOf } from "../store.ts";
import type { AppCtx } from "./context.ts";
import { cancelQueued, moveDelivery, priceFor, queueCycle, queueReminder } from "./schedule.ts";
import { insertMessage, sendText, updateMessage, whySnapshot } from "./send.ts";

/** Inbound handling with no NLP dependency (spec 11.3): numbers, a closed list of keywords, everything else to a person. */

export type Parsed =
  | { kind: "weeks"; weeks: number }
  | { kind: "keyword"; word: Keyword }
  | { kind: "plenty" }
  | { kind: "other"; mentionsCancel: boolean };

export type Keyword = "YES" | "OK" | "OLD" | "SOONER" | "SKIP" | "PAUSE" | "SWAP" | "ROTATE" | "SMALLER" | "NO OFFERS" | "STOP" | "START" | "HELP" | "CANCEL" | "BACK" | "WHY" | "HUMAN" | "AWAY";

const WORDS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const KEYWORDS: Keyword[] = ["YES", "OK", "OLD", "SOONER", "SKIP", "PAUSE", "SWAP", "ROTATE", "SMALLER", "NO OFFERS", "STOP", "START", "HELP", "CANCEL", "BACK", "WHY", "HUMAN", "AWAY"];

export function parseInbound(text: string): Parsed {
  const raw = text.trim();
  const n = raw.toLowerCase().replace(/\s+/g, " ").replace(/[.!?,;:]+$/g, "").trim();
  if (/^(\u{1F44D}[\u{1F3FB}-\u{1F3FF}]?)+$/u.test(raw)) return { kind: "keyword", word: "OK" };
  if (/^\d{1,2}$/.test(n) && Number(n) <= 12) return { kind: "weeks", weeks: Number(n) };
  if (n in WORDS) return { kind: "weeks", weeks: WORDS[n]! };
  const upper = n.toUpperCase() as Keyword;
  if (KEYWORDS.includes(upper)) return { kind: "keyword", word: upper };
  if (n === "plenty" || n === "lots") return { kind: "plenty" };
  return { kind: "other", mentionsCancel: /\bcancel/.test(n) };
}

export interface InboundOptions {
  /** how the text arrived: typed in the sandbox drawer, a scripted replay, or a live phone */
  via?: "console" | "replay" | "photon";
}

function reply(ctx: AppCtx, customerId: string, body: string, code = "RESPONSE", kind: MessageRow["kind"] = "confirmation", snapshot: WhySnapshot = {}): void {
  sendText(ctx, { customerId, body, kind, reasonCode: code, response: true, snapshot });
}

function setStatus(ctx: AppCtx, id: string, status: CustomerRow["status"]): void {
  run(ctx.db, "UPDATE customers SET status = ? WHERE id = ?", status, id);
  ctx.emit({ type: "projection", customerId: id });
}

function needsPerson(ctx: AppCtx, messageId: number, customerId: string, why: string): void {
  updateMessage(ctx, messageId, { status: "needs_person", snapshot: { reasonChip: why } });
  reply(ctx, customerId, COPY.person(), "AUTO_PERSON", "other");
  ctx.emit({ type: "queue" });
}

/** A text arrives from a customer. Everything is logged; the reply (if any) goes out through the same caps and consent rules. */
export function handleInbound(ctx: AppCtx, customerId: string, text: string, _opts: InboundOptions = {}): { messageId: number } {
  void _opts;
  const db = ctx.db;
  const c = customerRow(db, customerId);
  if (!c) throw new Error(`no customer ${customerId}`);
  const parsed = parseInbound(text);
  const inId = insertMessage(ctx, { customerId, at: nowMs(db), direction: "in", body: text, kind: "reply", reasonCode: parsed.kind === "keyword" ? `KEYWORD_${parsed.word.replace(" ", "_")}` : parsed.kind === "weeks" ? "WEEKS_LEFT" : parsed.kind === "plenty" ? "PLENTY" : "FREE_TEXT", status: "received" });

  if (c.status === "OPTED_OUT") {
    if (parsed.kind === "keyword" && parsed.word === "START") start(ctx, c);
    else if (parsed.kind === "keyword" && parsed.word === "HELP") reply(ctx, customerId, COPY.help(), "HELP", "confirmation");
    return { messageId: inId };
  }
  if (c.status === "CANCELLED") {
    if (parsed.kind === "keyword" && parsed.word === "BACK") back(ctx, c);
    else if (parsed.kind === "keyword" && parsed.word === "STOP") stop(ctx, c);
    else if (parsed.kind === "keyword" && parsed.word === "HELP") reply(ctx, customerId, COPY.help(), "HELP");
    else needsPerson(ctx, inId, customerId, "Wrote after cancelling");
    return { messageId: inId };
  }
  if (c.status === "OPT_IN_PENDING") {
    if (parsed.kind === "keyword" && parsed.word === "YES") {
      run(db, "UPDATE customers SET status = 'ACTIVE', consent_delivery = 1, consent_delivery_at = ? WHERE id = ?", isoFromDay(todayOf(db)), customerId);
      // a new sign-up (bag QR) has its first delivery waiting: queue its reminder now that texts are allowed
      const next = nextScheduled(db, customerId);
      if (next) queueReminder(ctx, customerId, next.day);
      ctx.emit({ type: "projection", customerId });
    } else if (parsed.kind === "keyword" && parsed.word === "STOP") stop(ctx, c);
    return { messageId: inId };
  }

  switch (parsed.kind) {
    case "weeks":
      handleWeeks(ctx, c, parsed.weeks);
      break;
    case "plenty": {
      const r = sendText(ctx, { customerId, body: COPY.needNumber(), kind: "clarify", reasonCode: "CLARIFY" });
      if ("blocked" in r) needsPerson(ctx, inId, customerId, "Replied without a number");
      break;
    }
    case "other":
      needsPerson(ctx, inId, customerId, parsed.mentionsCancel ? "Mentions cancel (not the single word CANCEL)" : "Free-text reply");
      break;
    case "keyword":
      handleKeyword(ctx, c, parsed.word, inId);
      break;
  }
  return { messageId: inId };
}

// ---- weeks-left replies and the proposals they cause ----------------------------------------------------------------

export function handleWeeks(ctx: AppCtx, c: CustomerRow, weeks: number): void {
  const db = ctx.db;
  const day = etParts(nowMs(db)).day;
  addEvent(db, c.id, "reply", { weeks, day });
  const p = projectionOf(db, c.id, { force: true });
  setStatus(ctx, c.id, "ACTIVE");
  const next = nextScheduled(db, c.id);
  const prop = p.proposal;
  if (!next || prop.direction === "none" || prop.to === next.day) return;
  if (prop.direction === "later") {
    if (prop.autoSend) applyLater(ctx, c.id, prop.to, weeks, "MOVE_LATER_AUTO");
    else {
      const first = c.name.split(" ")[0]!;
      insertMessage(ctx, {
        customerId: c.id,
        at: nowMs(db),
        direction: "out",
        body: COPY.laterMove({ name: first, weeks, old: prop.from, new: prop.to }),
        kind: "proposal",
        reasonCode: "MOVE_LATER_AUTO",
        status: "pending_approval",
        snapshot: whySnapshot(db, c.id, { weeks, from: prop.from, to: prop.to, blockedBy: prop.blockedBy, reasonChip: `Move proposed: replied ${weeks} week${weeks === 1 ? "" : "s"}` }),
      });
      ctx.emit({ type: "queue" });
    }
  } else {
    insertMessage(ctx, {
      customerId: c.id,
      at: nowMs(db),
      direction: "out",
      body: COPY.sooner({ old: next.day, sooner: prop.to, amount: priceFor(c) }),
      kind: "sooner",
      reasonCode: "SOONER_PROPOSED",
      status: "pending_approval",
      snapshot: whySnapshot(db, c.id, { weeks, from: next.day, to: prop.to, amount: priceFor(c), blockedBy: prop.blockedBy }),
    });
    ctx.emit({ type: "queue" });
  }
  ctx.emit({ type: "projection", customerId: c.id });
}

/** Move the delivery later and tell the customer (they can undo with OLD). */
export function applyLater(ctx: AppCtx, customerId: string, to: Day, weeks: number, code: "MOVE_LATER_AUTO" | "MOVE_LATER_APPROVED", reuseMessageId?: number): void {
  const db = ctx.db;
  const c = customerRow(db, customerId) as CustomerRow;
  const moved = moveDelivery(ctx, customerId, to, code === "MOVE_LATER_AUTO" ? "model" : "staff-approved");
  if (!moved) return;
  run(db, "UPDATE customers SET proposal_count = proposal_count + 1, status = 'AWAITING_PROPOSAL' WHERE id = ?", customerId);
  const snap = whySnapshot(db, customerId, { weeks, from: moved.from, to: moved.to, reasonChip: `Delivery moved: replied ${weeks} week${weeks === 1 ? "" : "s"}` });
  sendText(ctx, { customerId, body: COPY.laterMove({ name: c.name.split(" ")[0]!, weeks, old: dayFromISO(c.base_arrival ?? isoFromDay(moved.from)), new: to }), kind: "proposal", reasonCode: code, snapshot: snap, response: code === "MOVE_LATER_AUTO", reuseMessageId });
  ctx.emit({ type: "projection", customerId });
}

// ---- keywords ---------------------------------------------------------------------------------------------------------

function lastSentMessage(ctx: AppCtx, customerId: string, kinds: string[]): MessageRow | undefined {
  return get<MessageRow>(ctx.db, `SELECT * FROM messages WHERE customer_id = ? AND direction = 'out' AND status IN ('sent','delivered') AND kind IN (${kinds.map(() => "?").join(",")}) ORDER BY at DESC, id DESC LIMIT 1`, customerId, ...kinds);
}

function handleKeyword(ctx: AppCtx, c: CustomerRow, word: Keyword, inId: number): void {
  const db = ctx.db;
  const today = todayOf(db);
  switch (word) {
    case "OK":
      return; // acknowledges; never reverts, never accepts a charge
    case "STOP":
      return stop(ctx, c);
    case "START":
      return reply(ctx, c.id, COPY.start(), "START");
    case "HELP":
      return reply(ctx, c.id, COPY.help(), "HELP");
    case "WHY": {
      const lastReply = all<{ at: number; data: string }>(db, "SELECT at, data FROM events WHERE customer_id = ? AND type = 'reply' ORDER BY at DESC LIMIT 1", c.id)[0];
      if (lastReply) {
        const d = JSON.parse(lastReply.data) as { weeks: number; day: number };
        return reply(ctx, c.id, COPY.why({ date: d.day, weeks: d.weeks }), "WHY", "confirmation");
      }
      return reply(ctx, c.id, COPY.whyNoReply(), "WHY", "confirmation");
    }
    case "HUMAN":
      return needsPerson(ctx, inId, c.id, "Asked for a person");
    case "CANCEL":
      return cancel(ctx, c);
    case "BACK":
      return back(ctx, c);
    case "NO OFFERS": {
      run(db, "UPDATE customers SET consent_offers = 0 WHERE id = ?", c.id);
      run(db, "DELETE FROM offer_assignments WHERE customer_id = ? AND message_id IS NULL", c.id);
      const next = nextScheduled(db, c.id);
      if (next) queueReminder(ctx, c.id, next.day);
      audit(db, "customer", "no_offers", c.id);
      return reply(ctx, c.id, COPY.noOffers(), "NO_OFFERS");
    }
    case "OLD": {
      const next = nextScheduled(db, c.id);
      const base = c.base_arrival ? dayFromISO(c.base_arrival) : undefined;
      if (!next || base === undefined || base === next.day) return reply(ctx, c.id, COPY.nothingToUndo(), "RESPONSE");
      moveDelivery(ctx, c.id, base, "customer");
      setStatus(ctx, c.id, "ACTIVE");
      run(db, "UPDATE customers SET held_until = NULL WHERE id = ?", c.id);
      audit(db, "customer", "old", c.id, { to: base });
      return reply(ctx, c.id, COPY.oldRestored({ old: base }), "RESPONSE");
    }
    case "SOONER": {
      const next = nextScheduled(db, c.id);
      if (!next) return needsPerson(ctx, inId, c.id, "Asked for a sooner delivery");
      const sooner = nextWednesdayOnOrAfter(today + ENGINE.minLeadDays);
      if (sooner >= next.day) return needsPerson(ctx, inId, c.id, "Asked for a sooner delivery (next delivery is already the soonest)");
      insertMessage(ctx, { customerId: c.id, at: nowMs(db), direction: "out", body: COPY.sooner({ old: next.day, sooner, amount: priceFor(c) }), kind: "sooner", reasonCode: "SOONER_PROPOSED", status: "pending_approval", snapshot: whySnapshot(db, c.id, { from: next.day, to: sooner, amount: priceFor(c), reasonChip: "Sooner delivery requested" }) });
      ctx.emit({ type: "queue" });
      return;
    }
    case "SKIP": {
      const next = nextScheduled(db, c.id);
      if (!next) return needsPerson(ctx, inId, c.id, "Asked to skip");
      const to = next.day + c.plan_cadence_days;
      run(db, "UPDATE deliveries SET status = 'skipped' WHERE id = ?", next.id);
      run(db, "INSERT INTO deliveries(customer_id, scheduled_date, status, size, price, items) VALUES(?,?,?,?,?,?)", c.id, isoFromDay(to), "scheduled", c.size, priceFor(c), "Coffee, 12 oz");
      addEvent(db, c.id, "skip", { day: next.day });
      run(db, "UPDATE customers SET base_arrival = ? WHERE id = ?", isoFromDay(to), c.id);
      cancelQueued(ctx, c.id, ["reminder"]);
      queueReminder(ctx, c.id, to);
      return reply(ctx, c.id, COPY.skipped({ old: next.day, new: to }), "RESPONSE");
    }
    case "PAUSE": {
      const next = nextScheduled(db, c.id);
      if (!next) return needsPerson(ctx, inId, c.id, "Asked to pause");
      const to = nextWednesdayOnOrAfter(next.day + 28);
      moveDelivery(ctx, c.id, to, "customer");
      run(db, "UPDATE customers SET status = 'PAUSED', held_until = ? WHERE id = ?", isoFromDay(to), c.id);
      return reply(ctx, c.id, COPY.paused({ old: next.day, new: to }), "RESPONSE");
    }
    case "AWAY": {
      // holiday travel: hold the delivery until the Wednesday after the window, so it isn't sitting on the porch
      const next = nextScheduled(db, c.id);
      const window = next ? holidayWindowFor(next.day) : undefined;
      if (!next || !window) return needsPerson(ctx, inId, c.id, "Says they're away: pick a date");
      const to = nextWednesdayOnOrAfter(window.to + 1);
      const last = all<{ d: string }>(db, "SELECT delivered_date AS d FROM deliveries WHERE customer_id = ? AND status = 'delivered' ORDER BY delivered_date DESC LIMIT 1", c.id)[0];
      if (last && to - dayFromISO(last.d) > ENGINE.gapMaxDays) return needsPerson(ctx, inId, c.id, `Away for ${window.name}: the hold would leave more than 12 weeks between deliveries`);
      addEvent(db, c.id, "hold", { from: Math.max(today, window.from), to: window.to });
      moveDelivery(ctx, c.id, to, "customer");
      run(db, "UPDATE customers SET status = 'HELD', held_until = ? WHERE id = ?", isoFromDay(window.to), c.id);
      audit(db, "customer", "away", c.id, { holiday: window.name, from: next.day, to });
      return reply(ctx, c.id, COPY.away({ holiday: window.name, old: next.day, new: to }), "RESPONSE", "confirmation", { reasonChip: `Away for ${window.name}`, from: next.day, to, holiday: window.name });
    }
    case "YES":
      return handleYes(ctx, c, inId);
    case "SWAP":
    case "ROTATE":
    case "SMALLER":
      return acceptOffer(ctx, c, word, inId);
  }
}

function handleYes(ctx: AppCtx, c: CustomerRow, inId: number): void {
  const db = ctx.db;
  const sent = lastSentMessage(ctx, c.id, ["sooner", "consent", "reminder"]);
  const snap = sent ? (JSON.parse(sent.snapshot) as WhySnapshot & { confirmed?: boolean; consentFor?: string }) : undefined;
  if (sent && sent.kind === "sooner" && snap?.to !== undefined && !snap.confirmed) {
    const next = nextScheduled(db, c.id);
    if (next && snap.to < next.day) {
      moveDelivery(ctx, c.id, snap.to, "customer-yes");
      setStatus(ctx, c.id, "ACTIVE");
      updateMessage(ctx, sent.id, { snapshot: { ...snap, confirmed: true } });
      audit(db, "customer", "sooner_yes", c.id, { to: snap.to });
      return reply(ctx, c.id, COPY.soonerDone({ sooner: snap.to }), "RESPONSE");
    }
  }
  if (sent && sent.kind === "consent" && snap?.consentFor === "offers") {
    run(db, "UPDATE customers SET consent_offers = 1, consent_offers_at = ? WHERE id = ?", isoFromDay(todayOf(db)), c.id);
    ctx.emit({ type: "projection", customerId: c.id });
    return;
  }
  if (sent && sent.kind === "reminder" && snap?.offerType && sent.offer_id) {
    const off = get<{ type: string; discount_pct: number }>(db, "SELECT type, discount_pct FROM offers WHERE id = ?", sent.offer_id);
    if (off?.type === "gift_to_own") return acceptOffer(ctx, c, "YES", inId);
  }
  reply(ctx, c.id, COPY.yesNothing(), "RESPONSE");
}

const OFFER_FOR: Record<string, string> = { ROTATE: "rotation", SMALLER: "smaller", SWAP: "seasonal_swap", YES: "gift_to_own" };

function acceptOffer(ctx: AppCtx, c: CustomerRow, word: string, inId: number): void {
  const db = ctx.db;
  const type = OFFER_FOR[word]!;
  const a = get<{ offer_id: number; name: string }>(
    db,
    `SELECT a.offer_id AS offer_id, o.name AS name FROM offer_assignments a JOIN offers o ON o.id = a.offer_id
      WHERE a.customer_id = ? AND a.arm = 'treatment' AND a.message_id IS NOT NULL AND a.accepted_at IS NULL AND o.type = ? ORDER BY a.assigned_at DESC LIMIT 1`,
    c.id,
    type,
  );
  if (!a) return needsPerson(ctx, inId, c.id, `Replied ${word} with no matching offer`);
  run(db, "UPDATE offer_assignments SET accepted_at = ? WHERE offer_id = ? AND customer_id = ?", nowMs(db), a.offer_id, c.id);
  if (type === "smaller") run(db, "UPDATE customers SET size = '8 oz' WHERE id = ?", c.id);
  const what = type === "rotation" ? "a different Athens roast each delivery, same price" : type === "smaller" ? "a smaller bag at a lower price" : type === "seasonal_swap" ? "this month's roast instead of your usual" : "your first delivery as an owner, 10% off";
  addEvent(db, c.id, "offer_accepted", { offerId: a.offer_id, type });
  audit(db, "customer", "offer_accepted", c.id, { offerId: a.offer_id, type });
  ctx.emit({ type: "offer", offerId: a.offer_id });
  reply(ctx, c.id, COPY.offerAccepted({ what }), "OFFER_ACCEPTED");
}

function stop(ctx: AppCtx, c: CustomerRow): void {
  const db = ctx.db;
  cancelQueued(ctx, c.id, ["checkin", "reminder", "proposal", "sooner", "offer", "clarify"]);
  run(db, "UPDATE customers SET status = 'OPTED_OUT', consent_offers = 0 WHERE id = ?", c.id);
  run(db, "DELETE FROM offer_assignments WHERE customer_id = ? AND message_id IS NULL", c.id);
  audit(db, "customer", "stop", c.id);
  reply(ctx, c.id, COPY.stop(), "STOP");
  ctx.emit({ type: "projection", customerId: c.id });
}

function start(ctx: AppCtx, c: CustomerRow): void {
  const db = ctx.db;
  run(db, "UPDATE customers SET status = 'ACTIVE', consent_delivery = 1, consent_delivery_at = ? WHERE id = ?", isoFromDay(todayOf(db)), c.id);
  audit(db, "customer", "start", c.id);
  reply(ctx, c.id, COPY.start(), "START");
  const next = nextScheduled(db, c.id);
  if (next) queueCycle(ctx, c.id, next.day);
  ctx.emit({ type: "projection", customerId: c.id });
}

/** Exact CANCEL is honoured immediately; no offer is attached to a cancel reply or sent afterwards (spec 8.3). */
function cancel(ctx: AppCtx, c: CustomerRow): void {
  const db = ctx.db;
  cancelQueued(ctx, c.id, ["checkin", "reminder", "proposal", "sooner", "offer", "clarify"]);
  run(db, "DELETE FROM offer_assignments WHERE customer_id = ? AND message_id IS NULL", c.id);
  run(db, "UPDATE deliveries SET status = 'cancelled' WHERE customer_id = ? AND status = 'scheduled'", c.id);
  run(db, "UPDATE customers SET cancel_prev_status = status, status = 'CANCELLED', cancelled_at = ? WHERE id = ?", nowMs(db), c.id);
  addEvent(db, c.id, "cancel", {});
  audit(db, "customer", "cancel", c.id);
  reply(ctx, c.id, COPY.cancel(), "CANCEL");
  ctx.emit({ type: "projection", customerId: c.id });
}

/** BACK undoes a cancellation for 24 hours (inclusive). */
function back(ctx: AppCtx, c: CustomerRow): void {
  const db = ctx.db;
  const fresh = customerRow(db, c.id)!;
  if (fresh.status !== "CANCELLED" || fresh.cancelled_at === null) return reply(ctx, c.id, COPY.nothingToUndo(), "RESPONSE");
  if (nowMs(db) - fresh.cancelled_at > 24 * 3_600_000) return reply(ctx, c.id, COPY.backTooLate(), "RESPONSE");
  const last = get<{ id: number }>(db, "SELECT id FROM deliveries WHERE customer_id = ? AND status = 'cancelled' ORDER BY scheduled_date DESC LIMIT 1", c.id);
  if (last) run(db, "UPDATE deliveries SET status = 'scheduled' WHERE id = ?", last.id);
  run(db, "UPDATE customers SET status = COALESCE(cancel_prev_status, 'ACTIVE'), cancelled_at = NULL, cancel_prev_status = NULL WHERE id = ?", c.id);
  addEvent(db, c.id, "back", {});
  audit(db, "customer", "back", c.id);
  const next = nextScheduled(db, c.id);
  if (next) queueCycle(ctx, c.id, next.day);
  reply(ctx, c.id, COPY.back(), "BACK");
  ctx.emit({ type: "projection", customerId: c.id });
}

export { latestWednesdayOnOrBefore };
