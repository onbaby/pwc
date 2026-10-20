import { dayFromISO, etInstant, etParts } from "../../shared/dates.ts";
import { COPY } from "../copy.ts";
import { all, run } from "../db.ts";
import type { AppCtx } from "../flows/context.ts";
import { nowMs } from "../store.ts";
import { createOffer } from "./lifecycle.ts";

/**
 * Sample offers (spec 4, 8.5): one running offer whose past reminders really carried the offer line, and two drafts.
 * Offer outcomes are never faked: the running offer shows sends and the collecting-data state only.
 */
export function seedOffers(ctx: AppCtx): void {
  const db = ctx.db;
  const start = etInstant(dayFromISO("2026-10-06"), 9, 0);
  const id = createOffer(ctx, { name: "Seasonal swap: October roast", type: "seasonal_swap", audience: { notStockpiled: true }, holdoutMode: "global", holdoutPct: 0, discountPct: 0, budget: 0, approvalRequired: false });
  run(db, "UPDATE offers SET status = 'Running', scheduled_at = ?, created_at = ? WHERE id = ?", start, start - 86_400_000, id);

  const rows = all<{ id: number; customer_id: string; at: number }>(
    db,
    `SELECT m.id AS id, m.customer_id AS customer_id, m.at AS at
       FROM messages m
       JOIN customers c ON c.id = m.customer_id
       JOIN projections p ON p.customer_id = c.id
      WHERE m.kind = 'reminder' AND m.direction = 'out' AND m.status = 'delivered' AND m.at >= ? AND m.at < ?
        AND c.consent_offers = 1 AND c.status != 'CANCELLED'
        AND NOT EXISTS (SELECT 1 FROM global_holdout g WHERE g.customer_id = c.id)
      ORDER BY m.at, m.id`,
    start,
    nowMs(db),
  );
  const upd = db.prepare("UPDATE messages SET body = ?, offer_id = ?, snapshot = ? WHERE id = ?");
  const ins = db.prepare("INSERT INTO offer_assignments(offer_id, customer_id, family, arm, message_id, assigned_at) VALUES (?,?,?,?,?,?)");
  // one offer per customer in the window (the 30-day cap); today's stockpile state cannot be rewound, so past sends are not filtered by it
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.customer_id)) continue;
    seen.add(r.customer_id);
    const arrival = etParts(r.at).day + 3;
    upd.run(COPY.reminderSwap({ new: arrival }), id, JSON.stringify({ reasonChip: "Reminder + offer: Seasonal swap: October roast", offerType: "Seasonal swap: October roast" }), r.id);
    ins.run(id, r.customer_id, "seasonal_swap", "treatment", r.id, start);
  }

  createOffer(ctx, { name: "Smaller bag for stockpilers", type: "smaller", audience: { sources: ["in_cafe", "website"], onHand: "ge14" }, holdoutMode: "global", holdoutPct: 0, discountPct: 0, budget: 0, approvalRequired: false });
  createOffer(ctx, { name: "Gift-to-own: keep it coming", type: "gift_to_own", audience: { sources: ["gift"], giftEndingWithinDays: 30 }, holdoutMode: "experiment", holdoutPct: 50, discountPct: 10, budget: 500, approvalRequired: true });
}
