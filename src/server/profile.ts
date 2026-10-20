import { PantryTracker } from "../engine/pantryFilter.ts";
import { priorFor } from "../engine/prior.ts";
import { pantryTitle } from "../engine/explain.ts";
import { freshnessFromProjection } from "../engine/freshness.ts";
import { WORLD } from "../shared/constants.ts";
import { holidayWindowFor } from "../shared/holidays.ts";
import { acquisitionOf } from "./qr.ts";
import { dayFromISO, etParts, type Day } from "../shared/dates.ts";
import type { CustomerProfile, DeliveryDTO } from "../shared/types.ts";
import { all, type Db } from "./db.ts";
import { messagesFor } from "./flows/send.ts";
import { planLabel } from "./queries.ts";
import { answersOf, customerRow, getEnv, loadContext, nextScheduled, nowMs, projectionOf, seedFor } from "./store.ts";

/** The customer profile (spec 3.2): everything the centerpiece page needs in one response. */
export function buildProfile(db: Db, id: string): CustomerProfile | undefined {
  const c = customerRow(db, id);
  if (!c) return undefined;
  const now = nowMs(db);
  const today = etParts(now).day;
  const env = getEnv(db);
  const ctx = loadContext(db, id, today);
  const p = projectionOf(db, id, { whatIf: true });
  const next = nextScheduled(db, id);
  const base = c.base_arrival ? dayFromISO(c.base_arrival) : null;

  // estimated days on hand over time: the tracker's posterior mean, sampled every two days
  const estimate: Array<{ day: Day; days: number }> = [];
  if (ctx.deliveredDays.length) {
    const first = Math.min(...ctx.deliveredDays);
    const prior = priorFor(env.prior, { source: ctx.source, cups: ctx.cups, people: ctx.people, rhythmDays: ctx.rhythmDays });
    const tr = new PantryTracker(prior, seedFor(env, id), first, { particles: 200 });
    tr.setHolds(ctx.holds);
    const evs = [
      ...ctx.deliveredDays.map((d) => ({ d, k: 0, w: 0 })),
      ...ctx.skips.map((d) => ({ d, k: 1, w: 0 })),
      ...ctx.replies.map((r) => ({ d: r.day, k: 2, w: r.weeks })),
    ].sort((a, b) => a.d - b.d || a.k - b.k);
    let i = 0;
    for (let d = first; d <= today; d += 2) {
      while (i < evs.length && evs[i]!.d <= d) {
        const e = evs[i++]!;
        tr.advance(e.d);
        if (e.k === 0) tr.deliver();
        else if (e.k === 1) tr.skip();
        else tr.reply(e.w);
      }
      tr.advance(d);
      estimate.push({ day: d, days: Math.round(tr.meanR() * 10) / 10 });
    }
  }

  const proposed = next && base !== null && next.day !== base ? next.day : p.proposal.direction !== "none" && next && p.proposal.to !== next.day ? p.proposal.to : null;
  const hasReplies = ctx.replies.length > 0;
  const deliveries: DeliveryDTO[] = all<{ id: number; scheduled_date: string; delivered_date: string | null; status: string; size: string; price: number; items: string }>(db, "SELECT * FROM deliveries WHERE customer_id = ? ORDER BY scheduled_date DESC LIMIT 40", id).map((d) => {
    const arrival = d.delivered_date ? dayFromISO(d.delivered_date) : null;
    let onHand: number | null = null;
    if (arrival !== null) {
      const before = estimate.filter((e) => e.day < arrival).pop();
      onHand = before ? before.days : null;
    }
    return { id: d.id, scheduledDate: dayFromISO(d.scheduled_date), deliveredDate: arrival, status: d.status, size: d.size, price: d.price, items: d.items, daysOnHandAtArrival: onHand, openedAtAge: onHand !== null ? Math.round(WORLD.roastToDoorDays + onHand) : null };
  });

  const activity = all<{ at: number; action: string; data: string }>(db, "SELECT at, action, data FROM audit_log WHERE customer_id = ? ORDER BY at DESC, id DESC LIMIT 25", id).map((a) => ({ at: a.at, text: activityText(a.action, a.data) }));
  const notes = all<{ id: number; at: number; author: string; body: string }>(db, "SELECT id, at, author, body FROM notes WHERE customer_id = ? ORDER BY at DESC", id);
  const lo = p.runOutDates.lo;
  const mid = p.runOutDates.mid;
  const hi = p.runOutDates.hi;
  return {
    customer: {
      id: c.id,
      name: c.name,
      city: c.city,
      source: c.source,
      memberSince: dayFromISO(c.signup_date),
      plan: planLabel(c),
      planType: c.plan_type,
      rhythmDays: c.plan_cadence_days,
      suggestedRhythmDays: c.suggested_cadence_days,
      size: c.size,
      state: c.status,
      consentDelivery: !!c.consent_delivery,
      consentOffers: !!c.consent_offers,
      nextDelivery: next?.day ?? null,
      baseArrival: base,
      signupAnswers: answersOf(c),
      inPilot: !!c.in_pilot,
      heldUntil: c.held_until ? dayFromISO(c.held_until) : null,
      acquisition: acquisitionOf(db, id),
      holiday: next ? (holidayWindowFor(next.day)?.name ?? null) : null,
    },
    projection: p,
    freshness: {
      next: next ? freshnessFromProjection(p, next.day) : null,
      original: next && base !== null && base !== next.day ? freshnessFromProjection(p, base) : null,
      proposed: proposed !== null && proposed !== next?.day ? freshnessFromProjection(p, proposed) : null,
    },
    pantry: {
      title: hasReplies ? pantryTitle(mid, lo, hi) : "No replies yet: projection based on similar customers",
      deliveries: ctx.deliveredDays.map((day) => ({ day })),
      replies: ctx.replies.map((r) => ({ day: r.day, weeks: r.weeks })),
      estimate,
      runOut: p.runOutDates,
      today,
      scheduled: base,
      proposed,
      empty: hasReplies ? null : "No replies yet: projection based on similar customers",
    },
    messages: messagesFor(db, id),
    deliveries,
    activity,
    notes,
    now,
  };
}

function activityText(action: string, data: string): string {
  const d = JSON.parse(data) as Record<string, unknown>;
  const map: Record<string, string> = {
    send_checkin_now: "Staff sent a check-in",
    move: "Staff moved the delivery",
    hold: "Staff held the delivery",
    pause: "Delivery paused",
    note: "Note added",
    reply: "Staff replied",
    resolve: "Marked resolved",
    approve: "Move approved",
    hold_message: "Proposal put on hold",
    stop: "Customer replied STOP",
    start: "Customer replied START",
    cancel: "Customer cancelled",
    back: "Customer undid the cancellation",
    old: "Customer asked for the old date",
    no_offers: "Customer replied NO OFFERS",
    offer_accepted: "Customer accepted an offer",
    sooner_yes: "Customer said YES to a sooner delivery",
    away: "Customer is away for a holiday: delivery held",
    qr_signup: "Subscribed from a grocery bag QR code",
  };
  void d;
  return map[action] ?? action.replaceAll("_", " ");
}
