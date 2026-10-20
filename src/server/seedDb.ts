import { ENGINE, RULES } from "../shared/constants.ts";
import { dayFromISO, etInstant, etParts, isoFromDay, MS_DAY, type Day } from "../shared/dates.ts";
import { hash32 } from "../shared/rng.ts";
import { generateSeed, TODAY, type SeedData } from "../sim/seed.ts";
import { trainPrior } from "../sim/prior.ts";
import { createHash } from "node:crypto";
import { resetTables, run, setSetting, tx, all, type Db } from "./db.ts";
import { COPY } from "./copy.ts";
import { staffAction } from "./flows/actions.ts";
import { noopChannel, type AppCtx } from "./flows/context.ts";
import { handleInbound, handleWeeks } from "./flows/inbound.ts";
import { queueCycle } from "./flows/schedule.ts";
import { insertMessage } from "./flows/send.ts";
import { seedOffers } from "./offers/seedOffers.ts";
import { audit, customerRow, GLOBAL_SEED, recomputeAll, SANDBOX_START, setNow } from "./store.ts";

/**
 * Seed or reset the sandbox in one transaction (spec 12.5). Deterministic: the same seed gives the same database.
 * Never run this while another process has the file open.
 */
export interface SeedReport {
  customers: number;
  active: number;
  projections: number;
  historyReplies: number;
  seconds: number;
}

const FREE_TEXT = [
  "Can I switch to decaf for the next one?",
  "Is the Ethiopia coming back in stock?",
  "I moved to Savannah, can you update my address?",
  "The last bag tasted a little stale",
  "Can I get a gift card for my mom?",
  "how do I change my card on file",
  "Please send two bags next time",
  "wrong grind, I wanted whole bean",
  "my box never showed up",
  "can I skip december but keep january",
];

export function seedDatabase(db: Db, data?: SeedData): SeedReport {
  const t0 = Date.now();
  const prior = data?.prior ?? trainPrior(4000);
  const seed = data ?? generateSeed({ prior });
  const ctx: AppCtx = { db, emit: () => {}, channel: noopChannel() };
  let historyReplies = 0;

  tx(db, () => {
    resetTables(db);
    setSetting(db, "prior", seed.prior);
    setSetting(db, "cautiousness", ENGINE.defaultCautiousness);
    setSetting(db, "freeze", { from: RULES.freezeFromISO, to: RULES.freezeToISO });
    setSetting(db, "globalSeed", GLOBAL_SEED);
    setNow(db, SANDBOX_START());

    const insCustomer = db.prepare(
      `INSERT INTO customers(id, name, city, source, signup_date, plan_cadence_days, suggested_cadence_days, size, plan_type, status, consent_delivery, consent_delivery_at, consent_offers, consent_offers_at, signup_answers, cancelled_at, gift_ends, in_pilot, base_arrival, proposal_count, cancel_prev_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,0,?)`,
    );
    const insDelivery = db.prepare("INSERT INTO deliveries(customer_id, scheduled_date, delivered_date, status, size, price, items) VALUES (?,?,?,?,?,?,?)");
    const insEvent = db.prepare("INSERT INTO events(customer_id, at, type, data) VALUES (?,?,?,?)");
    const insMessage = db.prepare("INSERT INTO messages(customer_id, at, direction, body, kind, reason_code, status, snapshot) VALUES (?,?,?,?,?,?,?,?)");
    const price = { in_cafe: 34, website: 41, social: 29, gift: 46, referral: 52 } as const;

    for (const c of seed.customers) {
      const sched = c.deliveries.find((d) => d.status === "scheduled");
      const signupIso = isoFromDay(c.signupDay);
      insCustomer.run(
        c.id,
        c.name,
        c.city,
        c.source,
        signupIso,
        c.rhythmDays,
        c.suggestedDays,
        c.size,
        c.planType,
        c.status,
        c.consentDelivery ? 1 : 0,
        c.consentDelivery ? signupIso : null,
        c.consentOffers ? 1 : 0,
        c.consentOffers ? signupIso : null,
        JSON.stringify(c.answers),
        c.cancelledAt,
        c.giftEnds !== null ? isoFromDay(c.giftEnds) : null,
        sched ? isoFromDay(sched.scheduled) : null,
        c.status === "CANCELLED" ? "ACTIVE" : null,
      );
      for (const d of c.deliveries) insDelivery.run(c.id, isoFromDay(d.scheduled), d.delivered !== null ? isoFromDay(d.delivered) : null, d.status, c.size, price[c.source], "Coffee, 12 oz");
      for (const r of c.replies) insEvent.run(c.id, r.at, "reply", JSON.stringify({ weeks: r.weeks, day: r.day }));
      for (const day of c.skips) insEvent.run(c.id, etInstant(day, 6, 0), "skip", JSON.stringify({ day }));
      for (const m of c.messages) insMessage.run(c.id, m.at, m.direction, m.body, m.kind, m.reasonCode, m.status, JSON.stringify(m.snapshot ?? {}));
    }

    // standing global holdout: 10% of offer-consented customers receive no offers for six months (sticky, hash-assigned)
    const until = SANDBOX_START() + RULES.globalHoldoutMonths * 30 * MS_DAY;
    for (const r of all<{ id: string }>(db, "SELECT id FROM customers WHERE consent_offers = 1")) {
      if (hash32("global-holdout", r.id) % 100 < RULES.globalHoldoutShare * 100) run(db, "INSERT INTO global_holdout(customer_id, assigned_at, until_at) VALUES (?,?,?)", r.id, SANDBOX_START(), until);
    }

    recomputeAll(db, false);

    // queue everything the next delivery needs (check-ins 10 days before, reminders 3 days before)
    const nextRows = all<{ id: string; scheduled_date: string }>(db, "SELECT c.id AS id, MIN(d.scheduled_date) AS scheduled_date FROM customers c JOIN deliveries d ON d.customer_id = c.id AND d.status = 'scheduled' WHERE c.status IN ('ACTIVE','HELD','PAUSED') GROUP BY c.id");
    const overrides = new Map(seed.customers.filter((c) => c.checkInAt).map((c) => [c.id, c.checkInAt!]));
    for (const r of nextRows) queueCycle(ctx, r.id, dayFromISO(r.scheduled_date), { checkInAt: overrides.get(r.id) });

    // the check-ins for deliveries landing Wed Oct 21 went out last Sunday; about 45% replied, through the real flow
    const cohort = all<{ id: string; scheduled_date: string }>(db, "SELECT c.id AS id, d.scheduled_date AS scheduled_date FROM customers c JOIN deliveries d ON d.customer_id = c.id AND d.status = 'scheduled' WHERE c.status = 'ACTIVE' AND c.consent_delivery = 1 AND d.scheduled_date = ? ORDER BY c.id", isoFromDay(TODAY + 3));
    for (const r of cohort) {
      const sentDay = dayFromISO(r.scheduled_date) - ENGINE.checkInDaysBefore;
      const at = etInstant(sentDay, 9, 0) + (hash32(r.id, "ci") % 150) * 60_000;
      const c = customerRow(db, r.id)!;
      insertMessage(ctx, { customerId: r.id, at, direction: "out", body: COPY.checkIn({ name: c.name.split(" ")[0]! }), kind: "checkin", reasonCode: "CHECKIN_DUE", status: "delivered", snapshot: { reasonChip: `Check-in: delivery in ${ENGINE.checkInDaysBefore} days` } });
      run(db, "UPDATE customers SET status = 'AWAITING_CHECKIN' WHERE id = ?", r.id);
      if (hash32(r.id, "ci-reply") % 100 < 45) {
        const rd = sentDay + (hash32(r.id, "ci-delay") % 4);
        const replyAt = etInstant(rd, 10, 0) + (hash32(r.id, "ci-min") % 400) * 60_000;
        // the customer's own reading of their pantry: drawn around the model's median so replies are plausible
        const weeks = Math.max(0, Math.min(12, Math.round((hash32(r.id, "ci-weeks") % 1000) / 1000 * 8 + 1)));
        setNow(db, replyAt);
        insertMessage(ctx, { customerId: r.id, at: replyAt, direction: "in", body: String(weeks), kind: "reply", reasonCode: "WEEKS_LEFT", status: "received" });
        handleWeeks(ctx, customerRow(db, r.id)!, weeks);
        historyReplies++;
      }
    }

    // a few free-text replies for the Inbox: two resolved last week, the rest open
    const pool = all<{ id: string }>(db, "SELECT id FROM customers WHERE status IN ('ACTIVE','AWAITING_CHECKIN') AND consent_delivery = 1 AND id NOT IN ('maya-thompson','dev-patel','priya-shah') ORDER BY id");
    const pick = (i: number) => pool[hash32("free-text", i) % pool.length]!.id;
    const times = [etInstant(TODAY - 9, 11, 20), etInstant(TODAY - 8, 15, 5), etInstant(TODAY - 2, 9, 40), etInstant(TODAY - 2, 17, 10), etInstant(TODAY - 1, 10, 25), etInstant(TODAY - 1, 13, 50), etInstant(TODAY - 1, 19, 5), etInstant(TODAY, 8, 12)];
    times.forEach((at, i) => {
      setNow(db, at);
      const id = pick(i);
      handleInbound(ctx, id, FREE_TEXT[i % FREE_TEXT.length]!);
    });
    // resolve the two oldest as if staff had answered them last week
    const old = all<{ id: number; customer_id: string }>(db, "SELECT id, customer_id FROM messages WHERE status = 'needs_person' AND at < ? ORDER BY at", etInstant(TODAY - 7, 0, 0));
    old.forEach((m, i) => {
      setNow(db, etInstant(TODAY - 6 + i, 14, 0));
      staffAction(ctx, m.customer_id, { action: "resolve", messageId: m.id });
    });

    setNow(db, SANDBOX_START());
    seedOffers(ctx);
    audit(db, "sandbox", "seed", null, { customers: seed.customers.length });
  });

  const active = all<{ n: number }>(db, "SELECT COUNT(*) AS n FROM customers WHERE status NOT IN ('CANCELLED')")[0]!.n;
  const projections = all<{ n: number }>(db, "SELECT COUNT(*) AS n FROM projections")[0]!.n;
  void etParts;
  void (null as unknown as Day);
  return { customers: seed.customers.length, active, projections, historyReplies, seconds: (Date.now() - t0) / 1000 };
}

/** A sorted checksum of every table's content, so two seeds can be compared (spec 14). */
export function databaseChecksum(db: Db): string {
  const h = createHash("sha256");
  for (const t of ["customers", "deliveries", "events", "messages", "projections", "offers", "offer_assignments", "global_holdout", "settings"]) {
    h.update(t);
    const n = all(db, `PRAGMA table_info(${t})`).length;
    const order = Array.from({ length: n }, (_, i) => i + 1).join(", ");
    for (const r of all<Record<string, unknown>>(db, `SELECT * FROM ${t} ORDER BY ${order}`)) h.update(JSON.stringify(r));
  }
  return h.digest("hex").slice(0, 16);
}
