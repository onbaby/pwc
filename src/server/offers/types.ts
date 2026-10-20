import type { Source } from "../../shared/constants.ts";
import type { OfferType } from "./assign.ts";

export type OfferStatus = "Draft" | "Pending approval" | "Scheduled" | "Running" | "Paused" | "Ended";
export type HoldoutMode = "global" | "experiment" | "none";

/** Audience chips (spec 8.2). Offer consent is always enforced; it is not a chip. */
export interface Audience {
  sources?: Source[];
  memberDaysMin?: number;
  memberDaysMax?: number;
  /** likely run-out (the median) in N-M days */
  runOutMinDays?: number;
  runOutMaxDays?: number;
  /** median days on hand: under 7, under 14, or 14 and over */
  onHand?: "lt7" | "lt14" | "ge14";
  /** last reply was this many weeks or fewer */
  lastReplyMaxWeeks?: number;
  skipped2of4?: boolean;
  giftEndingWithinDays?: number;
  notStockpiled?: boolean;
}

export interface OfferCaps {
  maxPerCustomerDays: number;
  /** stop sending after this many recipients (0 = no cap) */
  maxRecipients: number;
}

export interface OfferRow {
  id: number;
  name: string;
  type: OfferType;
  family: string;
  status: OfferStatus;
  audience: string;
  holdout_mode: HoldoutMode;
  holdout_pct: number;
  caps: string;
  approval_required: number;
  budget: number;
  discount_pct: number;
  template: string;
  created_at: number;
  scheduled_at: number | null;
  paused_reason: string | null;
}

export interface OfferDraft {
  name: string;
  type: OfferType;
  audience: Audience;
  holdoutMode: HoldoutMode;
  holdoutPct: number;
  discountPct: number;
  budget: number;
  approvalRequired: boolean;
  caps?: Partial<OfferCaps>;
}

export const OFFER_TYPES: Record<OfferType, { label: string; discount: boolean; reason: string; template: string }> = {
  rotation: { label: "Athens roast rotation", discount: false, reason: "Social/paid: “was only sampling”", template: "A different Athens roast each delivery, same price" },
  smaller: { label: "Smaller bag / pause", discount: false, reason: "In-cafe and website: “too much coffee arriving”", template: "A smaller bag at a lower price (or pause a month)" },
  seasonal_swap: { label: "Seasonal swap", discount: false, reason: "Anyone not stockpiled (freshness, novelty)", template: "This month's roast instead of your usual, same price" },
  gift_to_own: { label: "Gift-to-own", discount: true, reason: "Gift recipients near the end: “price”", template: "Keep it coming yourself? First delivery 10% off" },
};

export const DEFAULT_CAPS: OfferCaps = { maxPerCustomerDays: 30, maxRecipients: 0 };
