import { priorFor, type PriorModel } from "../engine/prior.ts";
import { COPY } from "../server/copy.ts";
import { ENGINE, EXHIBITS, SOURCES, WORLD, type Source } from "../shared/constants.ts";
import { dayFromISO, etInstant, nextWednesdayOnOrAfter, type Day } from "../shared/dates.ts";
import { Stream, hash32 } from "../shared/rng.ts";
import type { PlanType, SignupAnswers } from "../shared/types.ts";
import { SIM_SEED, draw, makeCustomer, nearestRhythm, type SimCustomer } from "./world.ts";

/**
 * Sample data for the sandbox (spec 4): about 4,000 active subscribers generated to match Exhibit C's case numbers,
 * with synthetic names from common first/last-name lists (no real people), Georgia cities, nine months of orders and
 * messages and about 60% with offer consent. Deterministic from the seed. Nothing here is client data.
 */
export const TODAY: Day = dayFromISO("2026-10-18");
const WINDOW_DAYS = 270;

export interface SeedDelivery {
  scheduled: Day;
  delivered: Day | null;
  status: "delivered" | "skipped" | "scheduled";
}

export interface SeedMessage {
  at: number;
  direction: "out" | "in";
  body: string;
  kind: string;
  reasonCode: string;
  status: string;
  snapshot?: Record<string, unknown>;
}

export interface SeedCustomer {
  id: string;
  name: string;
  city: string;
  source: Source;
  signupDay: Day;
  rhythmDays: number;
  suggestedDays: number | null;
  size: string;
  planType: PlanType;
  status: "ACTIVE" | "CANCELLED" | "HELD" | "PAUSED";
  consentDelivery: boolean;
  consentOffers: boolean;
  answers: SignupAnswers;
  cancelledAt: number | null;
  giftEnds: Day | null;
  deliveries: SeedDelivery[];
  replies: Array<{ at: number; day: Day; weeks: number }>;
  skips: Day[];
  messages: SeedMessage[];
  /** explicit time (ms) for this customer's check-in today, for the demo personas */
  checkInAt?: number;
  persona?: "maya" | "dev" | "priya";
}

export interface SeedData {
  customers: SeedCustomer[];
  prior: PriorModel;
  today: Day;
  clockMs: number;
  stats: { active: number; cancelled: number; bySource: Record<string, number> };
}

const FIRST = ["Olivia", "Liam", "Emma", "Noah", "Ava", "Elijah", "Sophia", "Mason", "Isabella", "Lucas", "Mia", "Ethan", "Amelia", "Logan", "Harper", "Jackson", "Evelyn", "Aiden", "Abigail", "Carter", "Emily", "Owen", "Ella", "Wyatt", "Chloe", "Caleb", "Grace", "Isaac", "Aria", "Henry", "Lily", "Jayden", "Zoe", "Gavin", "Nora", "Levi", "Hannah", "Eli", "Layla", "Dylan", "Riley", "Hunter", "Stella", "Nolan", "Maya", "Jordan", "Taylor", "Avery", "Casey", "Morgan", "Camila", "Daniel", "Sofia", "Marcus", "Naomi", "Andre", "Tessa", "Malik", "Imani", "Priscilla", "Rosa", "Hector", "Wei", "Mei", "Arjun", "Ananya", "Kofi", "Amara", "Jamal", "Keisha", "Tyrone", "Latoya", "Sam", "Alex", "Jamie", "Drew", "Quinn", "Reese"];
const LAST = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores", "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell", "Carter", "Roberts", "Gomez", "Phillips", "Evans", "Turner", "Diaz", "Parker", "Cruz", "Edwards", "Collins", "Reyes", "Stewart", "Morris", "Morales", "Murphy", "Cook", "Rogers", "Gutierrez", "Ortiz", "Morgan", "Cooper", "Peterson", "Bailey", "Reed", "Kelly", "Howard", "Ramos", "Kim", "Cox", "Ward", "Richardson", "Watson", "Brooks", "Chavez", "Wood", "James", "Bennett", "Gray", "Mendoza", "Ruiz", "Hughes", "Price", "Alvarez", "Castillo", "Sanders", "Patel", "Myers", "Long", "Ross", "Foster", "Jimenez", "Shah", "Okafor", "Chen", "Tran"];
const CITIES: Array<[string, number]> = [["Athens", 40], ["Watkinsville", 6], ["Bogart", 3], ["Winterville", 3], ["Commerce", 2], ["Jefferson", 2], ["Monroe", 2], ["Madison", 2], ["Atlanta", 12], ["Decatur", 4], ["Marietta", 3], ["Lawrenceville", 3], ["Gainesville", 4], ["Savannah", 3], ["Macon", 2], ["Augusta", 2], ["Columbus", 1], ["Roswell", 3], ["Alpharetta", 3], ["Buford", 2], ["Statham", 1], ["Hoschton", 1]];
const BREWS = ["pour-over", "drip", "French press", "espresso", "cold brew", "AeroPress", "moka pot"];

/** The one sentence for "suggested at sign-up": the rhythm whose length would not leave a stockpile for most households. */
export function suggestRhythm(prior: PriorModel, source: Source, cups: number, people: number): number {
  const p = priorFor(prior, { source, cups, people, rhythmDays: 42 });
  return nearestRhythm(p.mu - 0.67 * p.tau);
}

function hazards(source: Source): { h1: number; h2: number } {
  const e = EXHIBITS.sources[source];
  return { h1: -Math.log(e.ret90) / 90, h2: -Math.log(e.ret12 / e.ret90) / 275 };
}

const survival = (h: { h1: number; h2: number }, t: number): number => Math.exp(-h.h1 * Math.min(t, 90) - h.h2 * Math.max(t - 90, 0));

/** Invert survival: the cancel day t in [0, tMax] with S(t) = u. */
function invSurvival(h: { h1: number; h2: number }, u: number): number {
  const cum = -Math.log(u);
  if (cum <= h.h1 * 90) return cum / h.h1;
  return 90 + (cum - h.h1 * 90) / h.h2;
}

interface Planned {
  source: Source;
  signupDay: Day;
  cancelDay: Day | null;
}

/** The population: sign-ups over two years, each surviving with the Exhibit C survival curve; cancelled ones kept for nine months. */
function plan(seed: number, targetActive: number): Planned[] {
  const s = new Stream("population", seed);
  const spans = 730;
  let expected = 0;
  for (const src of SOURCES) {
    const h = hazards(src);
    let sum = 0;
    for (let t = 0; t < spans; t++) sum += survival(h, t);
    expected += (EXHIBITS.sources[src].newSubs / 365) * sum;
  }
  const f = targetActive / expected;
  const out: Planned[] = [];
  for (const src of SOURCES) {
    const h = hazards(src);
    const rate = (f * EXHIBITS.sources[src].newSubs) / 365;
    for (let t = 0; t < spans; t++) {
      const n = s.poisson(rate);
      for (let i = 0; i < n; i++) {
        const signup = TODAY - t;
        const S = survival(h, t);
        if (s.next() < S) out.push({ source: src, signupDay: signup, cancelDay: null });
        else {
          const u = S + (1 - S) * s.next();
          const tau = Math.floor(invSurvival(h, Math.max(u, S + 1e-9)));
          const cancelDay = signup + Math.min(tau, t);
          if (TODAY - cancelDay <= WINDOW_DAYS) out.push({ source: src, signupDay: signup, cancelDay });
        }
      }
    }
  }
  return out;
}

/** A name no other customer has (two "Abigail Edwards" in one list read as a bug), and never a demo persona's name. */
function pickName(s: Stream, used: Set<string>): string {
  for (let tries = 0; tries < 80; tries++) {
    const n = `${s.pick(FIRST)} ${s.pick(LAST)}`;
    if (!used.has(n)) {
      used.add(n);
      return n;
    }
  }
  // the common-name lists are nearly exhausted: add a middle initial
  for (;;) {
    const [f, l] = [s.pick(FIRST), s.pick(LAST)];
    const n = `${f} ${String.fromCharCode(65 + s.int(0, 25))}. ${l}`;
    if (!used.has(n)) {
      used.add(n);
      return n;
    }
  }
}

function replyWeeks(c: SimCustomer, R: number, k: number): number {
  if (draw.garbage(c, k) < WORLD.replyGarbage) return Math.floor(draw.garbageWeeks(c, k) * 13);
  return Math.min(12, Math.max(0, Math.round((Math.max(R, 0) * Math.exp(WORLD.replyAccuracySd * draw.noise(c, k))) / 7)));
}

/** Simulate nine months of orders (the Fixed schedule) and, for the last cycles, the check-ins and replies the system collected. */
function history(c: SimCustomer, p: Planned, consentDelivery: boolean, signupMs: number, rng: Stream, firstName: string): Pick<SeedCustomer, "deliveries" | "replies" | "skips" | "messages"> & { nextArrival: Day } {
  const windowStart = Math.max(p.signupDay, TODAY - WINDOW_DAYS);
  const end = p.cancelDay ?? TODAY;
  const deliveries: SeedDelivery[] = [];
  const replies: SeedCustomer["replies"] = [];
  const skips: Day[] = [];
  const messages: SeedMessage[] = [];
  const newInWindow = p.signupDay >= TODAY - WINDOW_DAYS;
  let arr = nextWednesdayOnOrAfter(newInWindow ? p.signupDay + 5 : windowStart + (hash32(c.id, "phase") % c.rhythmDays));
  let R = newInWindow ? 0 : rng.next() * 25;
  let k = 0;
  let delivered = 0;
  const stockAt = new Map<Day, number>();
  const arrivals: Day[] = [];
  for (let day = windowStart; day <= Math.min(end, TODAY); day++) {
    if (day === arr) {
      if (delivered > 0 && R >= ENGINE.skipThresholdDays && draw.skip(c, k) < WORLD.skipProb) {
        deliveries.push({ scheduled: arr, delivered: null, status: "skipped" });
        skips.push(arr);
      } else {
        R += Math.exp(c.theta + WORLD.sigmaB * draw.box(c, k));
        deliveries.push({ scheduled: arr, delivered: arr, status: "delivered" });
        arrivals.push(arr);
        delivered++;
      }
      k++;
      arr += c.rhythmDays;
    }
    if (delivered > 0) R = Math.max(R - c.pace[Math.min(day - windowStart, c.pace.length - 1)]!, 0);
    stockAt.set(day, R);
  }
  let nextArrival = arr;
  if (p.cancelDay === null) {
    while (nextArrival <= TODAY) nextArrival += c.rhythmDays;
    deliveries.push({ scheduled: nextArrival, delivered: null, status: "scheduled" });
  }

  if (consentDelivery) {
    messages.push({ at: signupMs, direction: "out", body: COPY.consentDelivery(), kind: "consent", reasonCode: "CONSENT", status: "delivered", snapshot: { consentFor: "delivery" } });
    messages.push({ at: signupMs + 60_000, direction: "in", body: "YES", kind: "reply", reasonCode: "KEYWORD_YES", status: "received" });
    const first = c.id;
    let cyc = 0;
    for (const a of arrivals) {
      const rem = etInstant(a - ENGINE.reminderDaysBefore, 10, 0);
      if (rem > signupMs + 3_600_000) messages.push({ at: rem, direction: "out", body: COPY.reminder({ new: a }), kind: "reminder", reasonCode: "REMINDER", status: "delivered", snapshot: { reasonChip: "Reminder" } });
      // the last two delivery cycles also had check-ins and some replies
      if (a >= TODAY - 130 && a !== arrivals[0]) {
        const ci = a - ENGINE.checkInDaysBefore;
        const at = etInstant(ci, 9, 0) + (hash32(first, a) % 150) * 60_000;
        if (at > signupMs) {
          messages.push({ at, direction: "out", body: COPY.checkIn({ name: firstName }), kind: "checkin", reasonCode: "CHECKIN_DUE", status: "delivered", snapshot: { reasonChip: `Check-in: delivery in ${ENGINE.checkInDaysBefore} days` } });
          const delay = Math.min(5, Math.floor(draw.delay(c, cyc) * 6));
          const rd = ci + delay;
          const Rr = stockAt.get(rd) ?? 0;
          const prob = Math.min(WORLD.replyCap, WORLD.replyBase * (Rr > 14 ? WORLD.replyMultHigh : Rr > 3 ? WORLD.replyMultMid : WORLD.replyMultLow));
          if (draw.reply(c, cyc) < prob && rd < TODAY) {
            const weeks = replyWeeks(c, Rr, cyc);
            const rat = etInstant(rd, 10, 0) + (hash32(first, rd, "r") % 360) * 60_000;
            messages.push({ at: rat, direction: "in", body: String(weeks), kind: "reply", reasonCode: "WEEKS_LEFT", status: "received" });
            replies.push({ at: rat, day: rd, weeks });
          }
        }
        cyc++;
      }
    }
  }
  return { deliveries, replies, skips, messages, nextArrival };
}

export interface SeedOptions {
  targetActive?: number;
  seed?: number;
  prior: PriorModel;
}

export function generateSeed(opts: SeedOptions): SeedData {
  const seed = opts.seed ?? SIM_SEED;
  const planned = plan(seed, opts.targetActive ?? 3_990);
  const customers: SeedCustomer[] = [];
  const names = new Stream("names", seed);
  const usedNames = new Set<string>(["Maya Thompson", "Dev Patel", "Priya Shah"]);
  const cityWeights = CITIES.map((c) => c[1]);
  planned.sort((a, b) => a.signupDay - b.signupDay || SOURCES.indexOf(a.source) - SOURCES.indexOf(b.source));
  planned.forEach((p, i) => {
    const id = `C${String(10_000 + i)}`;
    const c = makeCustomer(id, p.source, {}, seed);
    const r = new Stream("seed-cust", seed, id);
    const consentDelivery = r.next() < 0.96;
    const consentOffers = consentDelivery && r.next() < 0.62;
    const signupMs = etInstant(p.signupDay, 11, 0);
    const name = pickName(names, usedNames);
    const h = history(c, p, consentDelivery, signupMs, r, name.split(" ")[0]!);
    const planType: PlanType = p.source === "gift" && r.next() < 0.55 ? "gift" : r.next() < 0.07 ? "prepaid" : "payg";
    const giftEnds = planType === "gift" ? TODAY + (r.next() < 0.22 ? r.int(5, 28) : r.int(35, 300)) : null;
    const sug = suggestRhythm(opts.prior, p.source, c.cupsObs, c.peopleObs);
    const status: SeedCustomer["status"] = p.cancelDay !== null ? "CANCELLED" : r.next() < 0.015 ? "PAUSED" : "ACTIVE";
    customers.push({
      id,
      name,
      city: CITIES[names.weighted(cityWeights)]![0],
      source: p.source,
      signupDay: p.signupDay,
      rhythmDays: c.rhythmDays,
      suggestedDays: p.signupDay >= TODAY - 300 ? sug : null,
      size: "12 oz",
      planType,
      status,
      consentDelivery,
      consentOffers,
      answers: { cups: c.cupsObs, people: c.peopleObs, brew: r.pick(BREWS) },
      cancelledAt: p.cancelDay !== null ? etInstant(p.cancelDay, 14, 0) : null,
      giftEnds,
      deliveries: h.deliveries,
      replies: h.replies,
      skips: h.skips,
      messages: h.messages,
    });
  });

  // --- the three demo personas (Appendix A) -------------------------------------------------------------------
  const persona = (key: "maya" | "dev" | "priya", over: Partial<SeedCustomer> & { name: string; id: string }): SeedCustomer => {
    const base: SeedCustomer = {
      id: over.id,
      name: over.name,
      city: "Athens",
      source: "in_cafe",
      signupDay: TODAY - 90,
      rhythmDays: 28,
      suggestedDays: null,
      size: "12 oz",
      planType: "payg",
      status: "ACTIVE",
      consentDelivery: true,
      consentOffers: true,
      answers: { cups: 2, people: 2 },
      cancelledAt: null,
      giftEnds: null,
      deliveries: [],
      replies: [],
      skips: [],
      messages: [],
      persona: key,
    };
    return { ...base, ...over };
  };
  const D = (iso: string) => dayFromISO(iso);
  const consentAt = (iso: string, h = 10, m = 12) => etInstant(D(iso), h, m);
  customers.push(
    persona("maya", {
      id: "maya-thompson",
      name: "Maya Thompson",
      source: "in_cafe",
      signupDay: D("2026-07-29"),
      rhythmDays: 28,
      suggestedDays: 42,
      answers: { cups: 2, people: 2, brew: "pour-over" },
      deliveries: [
        { scheduled: D("2026-08-05"), delivered: D("2026-08-05"), status: "delivered" },
        { scheduled: D("2026-09-02"), delivered: D("2026-09-02"), status: "delivered" },
        { scheduled: D("2026-09-30"), delivered: D("2026-09-30"), status: "delivered" },
        { scheduled: D("2026-10-28"), delivered: null, status: "scheduled" },
      ],
      messages: [
        { at: consentAt("2026-10-02"), direction: "out", body: COPY.consentDelivery(), kind: "consent", reasonCode: "CONSENT", status: "delivered", snapshot: { consentFor: "delivery" } },
        { at: consentAt("2026-10-02", 10, 13), direction: "in", body: "YES", kind: "reply", reasonCode: "KEYWORD_YES", status: "received" },
        { at: consentAt("2026-10-02", 10, 14), direction: "out", body: COPY.consentOffers(), kind: "consent", reasonCode: "CONSENT", status: "delivered", snapshot: { consentFor: "offers" } },
        { at: consentAt("2026-10-02", 10, 15), direction: "in", body: "YES", kind: "reply", reasonCode: "KEYWORD_YES", status: "received" },
      ],
      checkInAt: etInstant(TODAY, 10, 0),
    }),
    persona("dev", {
      id: "dev-patel",
      name: "Dev Patel",
      source: "in_cafe",
      signupDay: D("2026-09-26"),
      rhythmDays: 28,
      suggestedDays: 42,
      answers: { cups: 1, people: 1, brew: "drip", note: "1 cup a day, just me" },
      deliveries: [
        { scheduled: D("2026-09-30"), delivered: D("2026-09-30"), status: "delivered" },
        { scheduled: D("2026-10-28"), delivered: null, status: "scheduled" },
      ],
      messages: [
        { at: consentAt("2026-09-26"), direction: "out", body: COPY.consentDelivery(), kind: "consent", reasonCode: "CONSENT", status: "delivered", snapshot: { consentFor: "delivery" } },
        { at: consentAt("2026-09-26", 10, 13), direction: "in", body: "YES", kind: "reply", reasonCode: "KEYWORD_YES", status: "received" },
      ],
      checkInAt: etInstant(TODAY, 9, 30),
    }),
    persona("priya", {
      id: "priya-shah",
      name: "Priya Shah",
      source: "website",
      signupDay: D("2026-06-10"),
      rhythmDays: 28,
      suggestedDays: 56,
      consentOffers: false,
      answers: { cups: 1, people: 1, brew: "espresso" },
      deliveries: [
        { scheduled: D("2026-08-05"), delivered: D("2026-08-05"), status: "delivered" },
        { scheduled: D("2026-09-02"), delivered: D("2026-09-02"), status: "delivered" },
        { scheduled: D("2026-09-30"), delivered: D("2026-09-30"), status: "delivered" },
        { scheduled: D("2026-10-28"), delivered: null, status: "scheduled" },
      ],
      messages: [
        { at: consentAt("2026-06-10"), direction: "out", body: COPY.consentDelivery(), kind: "consent", reasonCode: "CONSENT", status: "delivered", snapshot: { consentFor: "delivery" } },
        { at: consentAt("2026-06-10", 10, 13), direction: "in", body: "YES", kind: "reply", reasonCode: "KEYWORD_YES", status: "received" },
        { at: etInstant(D("2026-09-27"), 10, 0), direction: "out", body: COPY.reminder({ new: D("2026-09-30") }), kind: "reminder", reasonCode: "REMINDER", status: "delivered", snapshot: { reasonChip: "Reminder" } },
      ],
    }),
  );

  const active = customers.filter((c) => c.status !== "CANCELLED").length;
  const bySource: Record<string, number> = {};
  for (const c of customers) if (c.status !== "CANCELLED") bySource[c.source] = (bySource[c.source] ?? 0) + 1;
  return { customers, prior: opts.prior, today: TODAY, clockMs: etInstant(TODAY, 9, 0), stats: { active, cancelled: customers.length - active, bySource } };
}
