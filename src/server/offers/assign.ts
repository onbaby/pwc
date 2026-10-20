import { RULES } from "../../shared/constants.ts";
import { MS_DAY, type Day } from "../../shared/dates.ts";
import { get, type Db } from "../db.ts";
import { nowMs } from "../store.ts";

export type OfferType = "rotation" | "smaller" | "seasonal_swap" | "gift_to_own";

export interface PendingOffer {
  offerId: number;
  type: OfferType;
  name: string;
  discountPct: number;
}

/**
 * The offer (if any) that rides on this customer's next reminder. Offers never add a text: they are appended to a
 * reminder the customer was getting anyway. Consent, the 30-day cap and treatment assignment are all checked here.
 */
export function pendingOfferFor(db: Db, customerId: string, _arrival: Day): PendingOffer | null {
  void _arrival;
  const c = get<{ consent_offers: number; consent_delivery: number; status: string; in_pilot: number }>(db, "SELECT consent_offers, consent_delivery, status, in_pilot FROM customers WHERE id = ?", customerId);
  if (!c || !c.consent_offers || !c.consent_delivery || c.status === "OPTED_OUT" || c.status === "CANCELLED" || c.in_pilot) return null;
  const recent = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM messages WHERE customer_id = ? AND direction = 'out' AND offer_id IS NOT NULL AND status IN ('sent','delivered') AND at > ?", customerId, nowMs(db) - RULES.offerCapDays * MS_DAY)?.n ?? 0;
  if (recent > 0) return null;
  const row = get<{ offer_id: number; type: OfferType; name: string; discount_pct: number }>(
    db,
    `SELECT a.offer_id AS offer_id, o.type AS type, o.name AS name, o.discount_pct AS discount_pct
       FROM offer_assignments a JOIN offers o ON o.id = a.offer_id
      WHERE a.customer_id = ? AND a.arm = 'treatment' AND a.message_id IS NULL AND o.status IN ('Scheduled','Running')
      ORDER BY a.assigned_at LIMIT 1`,
    customerId,
  );
  return row ? { offerId: row.offer_id, type: row.type, name: row.name, discountPct: row.discount_pct } : null;
}
