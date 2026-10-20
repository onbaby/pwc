import { EXHIBITS, FRESHNESS, GROCERY, QR, WORLD, ENGINE, type Source } from "../shared/constants.ts";
import { dayFromISO, etInstant, etParts, isoFromDay, nextWednesdayOnOrAfter, weekday, type Day } from "../shared/dates.ts";
import { hash32, Stream } from "../shared/rng.ts";
import { nearestRhythm } from "../sim/world.ts";
import { COPY } from "./copy.ts";
import { all, get, run, type Db } from "./db.ts";
import type { AppCtx } from "./flows/context.ts";
import { priceFor, queueReminder } from "./flows/schedule.ts";
import { sendText } from "./flows/send.ts";
import { audit, nowMs, todayOf } from "./store.ts";

/**
 * The bag QR funnel: a QR code on every retail bag opens a page that shows that bag's roast date and offers a subscription
 * roasted to order. Grocery buyers become subscribers, and every scan says how long the bag sat before someone bought it
 * (a sell-through and freshness signal the wholesale channel otherwise never sees). Sample data in the sandbox.
 */

export type FreshBand = "best" | "peak" | "past_peak";
export const bandOf = (age: number): FreshBand => (age <= FRESHNESS.bestByDays ? "best" : age <= FRESHNESS.peakEndDays ? "peak" : "past_peak");

const ROASTS = ["House Blend", "Athens Morning", "Dark Roast No. 9", "Decaf Classic"];
const PILOT_WEEKS = 12;
const BAG_LB = WORLD.poundsPerDelivery;
const bagsPerWeek = (lbsPerMonth: number) => Math.round(((lbsPerMonth / BAG_LB) * 12) / 52);

/** Lot code printed on the bag and in its QR link: account code + roast date (yymmdd). */
export const lotCode = (accountId: string, roastDay: Day): string => `${accountId}-${isoFromDay(roastDay).slice(2).replaceAll("-", "")}`;

interface AccountSeed {
  id: string;
  name: string;
  city: string;
  kind: "chain" | "independent";
  bagsPerWeek: number;
  /** median days from roasting to a shopper buying (and scanning) the bag */
  shelfMedian: number;
}

/** The pilot accounts: two regional chains and ten independent grocers (Exhibit B volumes; names are generic). */
function pilotAccounts(): AccountSeed[] {
  const out: AccountSeed[] = [
    { id: "RA", name: "Regional chain A", city: "Athens area", kind: "chain", bagsPerWeek: bagsPerWeek(GROCERY.regionalChains.lbsPerMonth), shelfMedian: 17 },
    { id: "RB", name: "Regional chain B", city: "Atlanta area", kind: "chain", bagsPerWeek: bagsPerWeek(GROCERY.regionalChains.lbsPerMonth), shelfMedian: 21 },
  ];
  const cities = ["Athens", "Athens", "Athens", "Watkinsville", "Bogart", "Winterville", "Madison", "Monroe", "Jefferson", "Commerce"];
  const seen = new Map<string, number>();
  for (let i = 0; i < QR.pilotAccounts - 2; i++) {
    const city = cities[i % cities.length]!;
    const k = (seen.get(city) ?? 0) + 1;
    seen.set(city, k);
    out.push({ id: `G${String(i + 1).padStart(2, "0")}`, name: `Independent grocer${k > 1 ? ` ${k}` : ""}`, city, kind: "independent", bagsPerWeek: bagsPerWeek(GROCERY.independents.lbsPerMonth), shelfMedian: 30 });
  }
  return out;
}

/** Seed the pilot: weekly lots for 12 weeks, anonymous scans, and website sign-ups that came through a bag (deterministic). */
export function seedQr(db: Db, today: Day, startMs: number): void {
  const accounts = pilotAccounts();
  const insAcc = db.prepare("INSERT INTO retail_accounts(id, name, city, kind, bags_per_week) VALUES (?,?,?,?,?)");
  const insLot = db.prepare("INSERT INTO retail_lots(code, account_id, roast, roast_date, shipped_date, bags) VALUES (?,?,?,?,?,?)");
  const insScan = db.prepare("INSERT INTO qr_scans(lot_code, at, customer_id) VALUES (?,?,?)");
  const pilotStart = today - PILOT_WEEKS * 7;
  const lots: Array<{ code: string; roast: Day; shipped: Day; acc: AccountSeed }> = [];
  let anonymous = 0;
  for (const a of accounts) {
    insAcc.run(a.id, a.name, a.city, a.kind, a.bagsPerWeek);
    // ships every Monday; roasted the day before
    for (let ship = pilotStart + ((1 - weekday(pilotStart) + 7) % 7); ship <= today; ship += 7) {
      const roast = ship - 1;
      const code = lotCode(a.id, roast);
      insLot.run(code, a.id, ROASTS[hash32("roast", code) % ROASTS.length]!, isoFromDay(roast), isoFromDay(ship), a.bagsPerWeek);
      lots.push({ code, roast, shipped: ship, acc: a });
      const s = new Stream("qr-scans", code);
      const n = s.poisson(a.bagsPerWeek * QR.scanRate);
      for (let i = 0; i < n; i++) {
        const age = Math.max(ship - roast + 1, Math.round(a.shelfMedian * Math.exp(0.45 * s.normal())));
        const at = etInstant(roast + age, 0, 0) + s.int(8 * 60, 21 * 60) * 60_000;
        if (at > startMs) continue;
        insScan.run(code, at, null);
        anonymous++;
      }
    }
  }
  // website sign-ups during the pilot that arrived through a bag: sign-ups / scans ≈ QR.signupRate
  const candidates = all<{ id: string; signup_date: string }>(db, "SELECT id, signup_date FROM customers WHERE source = ? AND signup_date >= ? AND signup_date <= ? AND id NOT IN ('maya-thompson','dev-patel','priya-shah') ORDER BY id", QR.cohortLike, isoFromDay(pilotStart + 7), isoFromDay(today));
  const target = (anonymous * QR.signupRate) / (1 - QR.signupRate);
  const p = candidates.length ? Math.min(1, target / candidates.length) : 0;
  const insSignup = db.prepare("INSERT INTO qr_signups(customer_id, scan_id, lot_code, phone, at) VALUES (?,?,?,?,?)");
  for (const c of candidates) {
    if (hash32("qr-signup", c.id) % 10_000 >= p * 10_000) continue;
    const day = dayFromISO(c.signup_date);
    const eligible = lots.filter((l) => l.shipped <= day - 1 && l.roast >= day - 70);
    if (!eligible.length) continue;
    const lot = eligible[hash32("qr-lot", c.id) % eligible.length]!;
    const at = etInstant(day, 0, 0) + (8 * 60 + (hash32("qr-min", c.id) % (12 * 60))) * 60_000;
    const scanId = Number(insScan.run(lot.code, at, c.id).lastInsertRowid);
    insSignup.run(c.id, scanId, lot.code, null, at);
  }
}

// ---- the console page ---------------------------------------------------------------------------------------------

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function qrSummary(db: Db) {
  const now = nowMs(db);
  const today = etParts(now).day;
  const accounts = all<{ id: string; name: string; city: string; kind: string; bags_per_week: number }>(db, "SELECT * FROM retail_accounts ORDER BY kind, id");
  const lots = all<{ code: string; account_id: string; roast: string; roast_date: string; shipped_date: string; bags: number }>(db, "SELECT * FROM retail_lots WHERE shipped_date <= ? ORDER BY shipped_date", isoFromDay(today));
  const lotBy = new Map(lots.map((l) => [l.code, l]));
  const scans = all<{ lot_code: string; at: number; customer_id: string | null }>(db, "SELECT lot_code, at, customer_id FROM qr_scans WHERE at <= ?", now).filter((s) => lotBy.has(s.lot_code));
  const signups = all<{ customer_id: string; lot_code: string; at: number; name: string; status: string }>(db, "SELECT q.customer_id, q.lot_code, q.at, c.name, c.status FROM qr_signups q JOIN customers c ON c.id = q.customer_id WHERE q.at <= ? ORDER BY q.at DESC", now);
  const ageAt = (s: { lot_code: string; at: number }) => etParts(s.at).day - dayFromISO(lotBy.get(s.lot_code)!.roast_date);
  const firstShip = lots.length ? dayFromISO(lots[0]!.shipped_date) : today;
  const bags = lots.reduce((n, l) => n + l.bags, 0);

  const weekOf = (d: Day) => d - weekday(d);
  const weeks: Array<{ weekOf: Day; scans: number; signups: number }> = [];
  for (let w = weekOf(firstShip); w <= weekOf(today); w += 7) weeks.push({ weekOf: w, scans: 0, signups: 0 });
  const wk = (ms: number) => weeks.find((w) => w.weekOf === weekOf(etParts(ms).day));
  for (const s of scans) {
    const w = wk(s.at);
    if (!w) continue;
    w.scans++;
    if (s.customer_id) w.signups++;
  }

  const bands = { best: 0, peak: 0, past_peak: 0 };
  for (const s of scans) bands[bandOf(ageAt(s))]++;

  return {
    now,
    pilot: { from: firstShip, weeks: weeks.length, accounts: accounts.length },
    totals: {
      bags,
      scans: scans.length,
      signups: signups.length,
      scanRate: bags ? scans.length / bags : 0,
      signupRate: scans.length ? signups.length / scans.length : 0,
      stillSubscribed: signups.filter((s) => s.status !== "CANCELLED").length,
      medianShelfAge: median(scans.map(ageAt)),
    },
    freshnessAtScan: bands,
    weeks,
    accounts: accounts.map((a) => {
      const mine = scans.filter((s) => lotBy.get(s.lot_code)!.account_id === a.id);
      const ages = mine.map(ageAt);
      return {
        id: a.id,
        name: a.name,
        city: a.city,
        kind: a.kind,
        bags: lots.filter((l) => l.account_id === a.id).reduce((n, l) => n + l.bags, 0),
        scans: mine.length,
        signups: mine.filter((s) => s.customer_id).length,
        medianShelfAge: median(ages),
        pastPeakShare: ages.length ? ages.filter((x) => x > FRESHNESS.peakEndDays).length / ages.length : null,
      };
    }),
    latestLots: lots.slice(-6).reverse().map((l) => ({ code: l.code, roast: l.roast, roastDate: dayFromISO(l.roast_date), account: accounts.find((a) => a.id === l.account_id)?.name ?? l.account_id, bags: l.bags })),
    recentSignups: signups.slice(0, 8).map((s) => ({ customerId: s.customer_id, name: s.name, at: s.at, lot: s.lot_code, ageAtScan: ageAt(s), status: s.status })),
    exhibit: { regionalChains: GROCERY.regionalChains, independents: GROCERY.independents },
  };
}

// ---- the public bag page ------------------------------------------------------------------------------------------

/**
 * The sign-up suggestion on the bag page, from the two sign-up answers alone: the rhythm one 12-oz bag lasts most
 * households like this (the typical pace for the sign-up source, adjusted for cups and people, leaning shorter by two
 * thirds of the between-person spread so most don't build a stockpile). Uses the ledger's consumption assumptions; the
 * customer still chooses. (Layer A also conditions on the chosen rhythm, which a new buyer doesn't have yet.)
 */
export function suggestFromAnswers(source: Source, cups: number, people: number): number {
  const logDays = Math.log(WORLD.medianDaysPerDelivery[source]) + WORLD.cupsEffect * (cups - 2) + WORLD.peopleEffect * (people - 2) - 0.67 * WORLD.tauPop;
  return nearestRhythm(logDays);
}

export function lotPublic(db: Db, code: string) {
  const l = get<{ code: string; account_id: string; roast: string; roast_date: string; name: string; city: string }>(db, "SELECT l.code, l.account_id, l.roast, l.roast_date, a.name, a.city FROM retail_lots l JOIN retail_accounts a ON a.id = l.account_id WHERE l.code = ?", code);
  if (!l) return undefined;
  const today = todayOf(db);
  const roastDate = dayFromISO(l.roast_date);
  const ageDays = Math.max(0, today - roastDate);
  const rhythms: Record<string, number> = {};
  for (let cups = 1; cups <= 4; cups++) for (let people = 1; people <= 4; people++) rhythms[`${cups}-${people}`] = suggestFromAnswers(QR.cohortLike, cups, people);
  return {
    code: l.code,
    roast: l.roast,
    roastDate,
    store: l.city,
    ageDays,
    band: bandOf(ageDays),
    bestByDays: FRESHNESS.bestByDays,
    peakEndDays: FRESHNESS.peakEndDays,
    roastToDoorDays: WORLD.roastToDoorDays,
    price: EXHIBITS.sources[QR.cohortLike].aov,
    // roasted to order: a day to roast, then roast-to-door, landing on a Wednesday (never sooner than the usual lead time)
    firstDelivery: nextWednesdayOnOrAfter(today + Math.max(ENGINE.minLeadDays, WORLD.roastToDoorDays + 1)),
    rhythmMenu: WORLD.rhythmMenu,
    rhythms,
    consentTexts: { delivery: COPY.consentDelivery(), offers: COPY.consentOffers() },
    today,
  };
}

export function recordScan(ctx: AppCtx, code: string): { scanId: number } | undefined {
  if (!get(ctx.db, "SELECT 1 AS x FROM retail_lots WHERE code = ?", code)) return undefined;
  const scanId = run(ctx.db, "INSERT INTO qr_scans(lot_code, at, customer_id) VALUES (?,?,NULL)", code, nowMs(ctx.db)).lastInsertRowid;
  ctx.emit({ type: "queue" });
  return { scanId };
}

export interface QrSignupInput {
  scanId: number;
  code: string;
  name: string;
  phone: string;
  cups: number;
  people: number;
  rhythmDays: number;
  consentDelivery: boolean;
  consentOffers: boolean;
}

/** Normalise a US mobile number to E.164; undefined if it is not one. */
export function normalisePhone(raw: string): string | undefined {
  const d = raw.replace(/[^\d]/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(ten) ? `+1${ten}` : undefined;
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").slice(0, 40) || "customer";

/**
 * A grocery buyer subscribes from the bag page. They land as a website sign-up (the model treats them like one), the
 * first bag ships on the next Wednesday at least 3 days out, and delivery texts start only after they answer YES to the
 * consent text (double opt-in). The scan that brought them is linked for attribution.
 */
export function qrSignup(ctx: AppCtx, i: QrSignupInput): { ok: true; customerId: string; firstDelivery: Day; rhythmDays: number } | { ok: false; error: string } {
  const db = ctx.db;
  const name = i.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 60) return { ok: false, error: "Please enter your name." };
  const phone = normalisePhone(i.phone);
  if (!phone) return { ok: false, error: "Please enter a US mobile number." };
  if (!(WORLD.rhythmMenu as readonly number[]).includes(i.rhythmDays)) return { ok: false, error: "Choose how often you'd like coffee." };
  if (!(i.cups >= 1 && i.cups <= 4 && i.people >= 1 && i.people <= 6)) return { ok: false, error: "Tell us cups a day and people at home." };
  const scan = get<{ id: number; lot_code: string; customer_id: string | null }>(db, "SELECT id, lot_code, customer_id FROM qr_scans WHERE id = ?", i.scanId);
  if (!scan || scan.lot_code !== i.code) return { ok: false, error: "That link has expired. Scan the bag again." };
  if (scan.customer_id) return { ok: false, error: "This scan already started a subscription." };
  const lot = lotPublic(db, i.code);
  if (!lot) return { ok: false, error: "Unknown bag." };

  const base = slug(name);
  let id = base;
  for (let k = 2; get(db, "SELECT 1 AS x FROM customers WHERE id = ?", id); k++) id = `${base}-${k}`;
  const today = todayOf(db);
  const now = nowMs(db);
  const first = lot.firstDelivery;
  const suggested = lot.rhythms[`${Math.min(i.cups, 4)}-${Math.min(i.people, 4)}`] ?? null;
  const city = lot.store.replace(/ area$/, "");
  run(
    db,
    `INSERT INTO customers(id, name, city, source, signup_date, plan_cadence_days, suggested_cadence_days, size, plan_type, status, consent_delivery, consent_delivery_at, consent_offers, consent_offers_at, signup_answers, base_arrival)
     VALUES (?,?,?,?,?,?,?,?,?,?,0,NULL,?,?,?,?)`,
    id,
    name,
    city,
    QR.cohortLike,
    isoFromDay(today),
    i.rhythmDays,
    suggested,
    "12 oz",
    "payg",
    i.consentDelivery ? "OPT_IN_PENDING" : "ACTIVE",
    i.consentOffers ? 1 : 0,
    i.consentOffers ? isoFromDay(today) : null,
    JSON.stringify({ cups: i.cups, people: i.people, note: `Subscribed from bag ${i.code} (${lot.roast}, roasted ${lot.ageDays} days before the scan)` }),
    isoFromDay(first),
  );
  run(db, "INSERT INTO deliveries(customer_id, scheduled_date, status, size, price, items) VALUES (?,?,?,?,?,?)", id, isoFromDay(first), "scheduled", "12 oz", priceFor({ source: QR.cohortLike }), "Coffee, 12 oz");
  run(db, "UPDATE qr_scans SET customer_id = ? WHERE id = ?", id, scan.id);
  run(db, "INSERT INTO qr_signups(customer_id, scan_id, lot_code, phone, at) VALUES (?,?,?,?,?)", id, scan.id, i.code, phone, now);
  audit(db, "customer", "qr_signup", id, { lot: i.code, rhythmDays: i.rhythmDays, suggested });
  if (i.consentDelivery) sendText(ctx, { customerId: id, body: COPY.consentDelivery(), kind: "consent", reasonCode: "CONSENT_REQUEST", response: true, snapshot: { reasonChip: "Consent request: signed up from a bag QR", consentFor: "delivery" } });
  else queueReminder(ctx, id, first);
  ctx.emit({ type: "projection", customerId: id });
  ctx.emit({ type: "queue" });
  return { ok: true, customerId: id, firstDelivery: first, rhythmDays: i.rhythmDays };
}

/** How a customer arrived through a bag, for the profile. */
export function acquisitionOf(db: Db, customerId: string) {
  const r = get<{ lot_code: string; at: number; roast: string; roast_date: string; name: string; city: string }>(db, "SELECT q.lot_code, q.at, l.roast, l.roast_date, a.name, a.city FROM qr_signups q JOIN retail_lots l ON l.code = q.lot_code JOIN retail_accounts a ON a.id = l.account_id WHERE q.customer_id = ?", customerId);
  if (!r) return null;
  return { lot: r.lot_code, roast: r.roast, store: `${r.name} · ${r.city}`, at: r.at, ageAtScan: etParts(r.at).day - dayFromISO(r.roast_date) };
}
