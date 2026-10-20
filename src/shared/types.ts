import type { Source } from "./constants.ts";
import type { Confidence } from "../engine/decision.ts";
import type { Projection } from "../engine/project.ts";

/** Types shared by the server and the web app (API payloads and database rows). Days are "days since 1970-01-01". */

export type ConvState = "OPT_IN_PENDING" | "ACTIVE" | "AWAITING_CHECKIN" | "AWAITING_PROPOSAL" | "HELD" | "PAUSED" | "CANCELLED" | "OPTED_OUT";
export type PlanType = "payg" | "prepaid" | "gift";

export interface CustomerRow {
  id: string;
  name: string;
  city: string;
  source: Source;
  signup_date: string;
  plan_cadence_days: number;
  suggested_cadence_days: number | null;
  size: string;
  plan_type: PlanType;
  status: ConvState;
  consent_delivery: number;
  consent_delivery_at: string | null;
  consent_offers: number;
  consent_offers_at: string | null;
  signup_answers: string;
  cancelled_at: number | null;
  gift_ends: string | null;
  in_pilot: number;
  base_arrival: string | null;
  proposal_count: number;
  checkin_cycles_skipped: number;
  held_until: string | null;
  cancel_prev_status: string | null;
}

export interface SignupAnswers {
  cups: number;
  people: number;
  brew?: string;
  /** free text the customer typed at sign-up; shown on the profile */
  note?: string;
}

export type MessageKind = "checkin" | "reminder" | "proposal" | "sooner" | "offer" | "clarify" | "confirmation" | "consent" | "system" | "reply" | "staff" | "other";
export type MessageStatus = "queued" | "sent" | "delivered" | "failed" | "held" | "pending_approval" | "received" | "needs_person" | "resolved" | "cancelled" | "skipped";

export interface MessageRow {
  id: number;
  customer_id: string;
  at: number;
  direction: "out" | "in";
  body: string;
  kind: MessageKind;
  reason_code: string | null;
  status: MessageStatus;
  offer_id: number | null;
  snapshot: string;
  resolved_at: number | null;
}

/** What gets stored with an automated text so "Why we sent this" can be shown later (spec 3.2). */
export interface WhySnapshot {
  runOutDates?: { lo: number; mid: number; hi: number };
  confidence?: Confidence;
  checks?: Array<{ ok: boolean; text: string }>;
  reasonChip?: string;
  /** a proposed delivery date this text is about */
  to?: number;
  from?: number;
  weeks?: number;
  technical?: Record<string, unknown>;
  blockedBy?: string[];
  offerType?: string;
  amount?: number;
  /** a sooner text the customer has answered YES to */
  confirmed?: boolean;
  /** which consent a consent text asks for */
  consentFor?: "delivery" | "offers";
}

export type StatusChip = "Check-in sent" | "Reply received" | "Move proposed" | "Holding off" | "On schedule" | "Held" | "Paused" | "Cancelled" | "Texts off";

export interface CustomerListItem {
  id: string;
  name: string;
  city: string;
  source: Source;
  plan: string;
  planType: PlanType;
  nextDelivery: number | null;
  runOut: { lo: number; mid: number; hi: number } | null;
  confidence: Confidence | null;
  lastReply: { day: number; weeks: number } | null;
  status: StatusChip;
  state: ConvState;
  consentDelivery: boolean;
  consentOffers: boolean;
}

export interface MessageDTO {
  id: number;
  customerId: string;
  customerName?: string;
  at: number;
  direction: "out" | "in";
  body: string;
  kind: MessageKind;
  reasonCode: string | null;
  reasonChip: string | null;
  status: MessageStatus;
  offerId: number | null;
  why: WhySnapshot | null;
  whySentence: string | null;
}

export interface DeliveryDTO {
  id: number;
  scheduledDate: number;
  deliveredDate: number | null;
  status: string;
  size: string;
  price: number;
  items: string;
  /** model's estimate of days on hand when it arrived (null if unknown) */
  daysOnHandAtArrival: number | null;
}

export interface CustomerProfile {
  customer: {
    id: string;
    name: string;
    city: string;
    source: Source;
    memberSince: number;
    plan: string;
    planType: PlanType;
    rhythmDays: number;
    suggestedRhythmDays: number | null;
    size: string;
    state: ConvState;
    consentDelivery: boolean;
    consentOffers: boolean;
    nextDelivery: number | null;
    baseArrival: number | null;
    signupAnswers: SignupAnswers;
    inPilot: boolean;
    heldUntil: number | null;
  };
  projection: Projection | null;
  pantry: {
    title: string;
    deliveries: Array<{ day: number }>;
    replies: Array<{ day: number; weeks: number }>;
    /** estimated days on hand, by day, from the model's posterior mean (past) */
    estimate: Array<{ day: number; days: number }>;
    runOut: { lo: number; mid: number; hi: number } | null;
    today: number;
    scheduled: number | null;
    proposed: number | null;
    empty: string | null;
  };
  messages: MessageDTO[];
  deliveries: DeliveryDTO[];
  activity: Array<{ at: number; text: string }>;
  notes: Array<{ id: number; at: number; author: string; body: string }>;
  now: number;
}
