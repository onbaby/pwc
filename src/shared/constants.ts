/**
 * Every assumption and rule constant in one place (spec 12.3). Anything marked ASSUMPTION is listed in LEDGER with its
 * range and source. Nothing here is client data.
 */

export const SOURCES = ["in_cafe", "website", "social", "gift", "referral"] as const;
export type Source = (typeof SOURCES)[number];
export const SOURCE_LABEL: Record<Source, string> = {
  in_cafe: "In-cafe",
  website: "Website",
  social: "Social / paid",
  gift: "Gift",
  referral: "Wholesale referral",
};
/** The two sources whose top Exhibit C cancel reason is "too much coffee arriving". */
export const STOCKPILE_SOURCES: readonly Source[] = ["in_cafe", "website"];

/** Exhibit C (case numbers). */
export const EXHIBITS = {
  dtc: { revenueUSD: 1_300_000, grossMargin: 0.61, growth: 0.14, newSubsPerYear: 8670 },
  sources: {
    in_cafe: { newSubs: 2140, ret90: 0.71, ret12: 0.38, aov: 34, reason: "too much coffee arriving" },
    website: { newSubs: 1860, ret90: 0.54, ret12: 0.22, aov: 41, reason: "too much coffee arriving" },
    social: { newSubs: 3420, ret90: 0.39, ret12: 0.11, aov: 29, reason: "was only sampling" },
    gift: { newSubs: 940, ret90: 0.62, ret12: 0.31, aov: 46, reason: "price" },
    referral: { newSubs: 310, ret90: 0.78, ret12: 0.51, aov: 52, reason: "moved or changed job" },
  },
  /** Exhibit D, DTC index by month Jan..Dec (100 = twelve-month average): Jan-Feb 118, Mar-Apr 96, May-Jul 84, Aug 92, Sep-Nov 98, Dec 141. */
  monthlyIndex: [118, 118, 96, 96, 84, 84, 84, 92, 98, 98, 98, 141],
  wholesalePoundsPerMonth: 124_000,
} as const;

export const GROSS_MARGIN = EXHIBITS.dtc.grossMargin;
export const WEEKS_PER_YEAR = 52;

/** The engine: fixed constants (spec 7.2, 7.3). `version` changes when behaviour changes; projections recompute on a mismatch. */
export const ENGINE = {
  version: "4.2.0",
  particles: 500,
  sigmaObs: 0.35,
  garbage: 0.1,
  nu: 0.1,
  sigmaB: 0.15,
  holdNuMultiplier: 1.5,
  skipThresholdDays: 21,
  skipWeightHigh: 0.95,
  skipWeightLow: 0.05,
  resampleFraction: 0.5,
  thetaJitter: 0.01,
  rJitterDays: 0.5,
  weightFloor: 0.01,
  rMinForLikelihood: 0.5,
  /** How sure: ratio = (q90 + offset) / (q10 + offset) */
  ratioOffset: 7,
  ratioHigh: 1.6,
  ratioMedium: 3.0,
  graceDays: 3,
  cautiousness: { Cautious: 0.05, Balanced: 0.1, Aggressive: 0.2 },
  defaultCautiousness: "Balanced" as "Cautious" | "Balanced" | "Aggressive",
  maxStepDays: 14,
  gapMinDays: 21,
  gapMaxDays: 84,
  minCompletedDeliveries: 2,
  /** later moves go automatically only if the text goes out at least this many days before the original date */
  autoLeadDays: 7,
  reminderDaysBefore: 3,
  checkInDaysBefore: 10,
  /** a "late" delivery: out of coffee at least this many days before it arrives */
  lateDays: 3,
  /** a "stockpile": this many days of coffee still on hand when a delivery arrives */
  stockpileDays: 14,
  /** sooner moves need this much processing time */
  minLeadDays: 3,
} as const;

/** Rules and caps (spec 7.3, 8.3, settings). */
export const RULES = {
  deliveryWeekday: "Wednesday",
  quietHours: { from: 21, to: 8 },
  routineTextsPerDelivery: 3,
  otherTextsPerDelivery: 1,
  freezeFromISO: "2026-11-15",
  freezeToISO: "2027-01-05",
  offerCapDays: 30,
  /** standing global holdout: share of offer-consented customers who receive no offers for six months */
  globalHoldoutShare: 0.1,
  globalHoldoutMonths: 6,
  pilotWeeks: 12,
  pilotMinReplyRate: 0.4,
  /** experiment: the 60-day outcome window must close before another experiment */
  experimentOutcomeDays: 60,
  sensor: {
    optOutShareMax: 0.02,
    minSends: 100,
    minPerArm: 200,
    replyDropPoints: 5,
  },
  /** Customers do not get an offer on the same delivery they asked to stop offers for; discount offers: manager approval */
  discountMaxPercent: 10,
} as const;

/** The simulator world (spec 7.5). All ASSUMPTIONS unless noted. */
export const WORLD = {
  horizonDays: 365,
  rhythmMenu: [28, 42, 56, 84] as const,
  medianDaysPerDelivery: { in_cafe: 64, website: 66, social: 78, gift: 74, referral: 60 } as Record<Source, number>,
  cupsEffect: -0.25,
  peopleEffect: -0.15,
  tauPop: 0.3,
  sigmaB: 0.15,
  /** rhythm choice: nearest menu item (log distance) to exp(theta + eps); eps ~ N(bias, sd^2) */
  rhythmBias: -0.1,
  rhythmSd: 0.15,
  misreport: 0.25,
  paceSd: 0.02,
  eventProbPerMonth: 0.08,
  eventMinDays: 14,
  eventMaxDays: 35,
  eventPaceMult: 0.4,
  skipProb: 0.25,
  replyBase: 0.45,
  replyMultHigh: 0.8,
  replyMultMid: 1.2,
  replyMultLow: 1.5,
  replyCap: 0.9,
  replyAccuracySd: 0.35,
  replyGarbage: 0.1,
  sooner: { yes: 0.6 },
  laterRevert: 0.05,
  /** extra churn hazard multiplier (1 + lambda) for 30 days after a run-out */
  lambda: 0.5,
  programCostPerActiveYear: 2,
  roastToDoorDays: 5,
  deliveriesPerYearAssumed: 7,
  deliveriesPerYearRange: [7, 9.2] as const,
  poundsPerDelivery: 0.75,
  poundsPerDeliveryTwoBag: 1.5,
} as const;

/** Exhibit A, channel economics FY25 (case numbers). */
export const CHANNELS = [
  { id: "cafes", label: "Company cafes (20)", revenueUSD: 14_200_000, share: 0.58, grossMargin: 0.68, growth: 0.03 },
  { id: "grocery", label: "Wholesale: grocery", revenueUSD: 4_600_000, share: 0.19, grossMargin: 0.34, growth: 0.01 },
  { id: "wholesale_cafes", label: "Wholesale: cafes and restaurants", revenueUSD: 2_900_000, share: 0.12, grossMargin: 0.41, growth: 0.07 },
  { id: "office", label: "Wholesale: office and institutional", revenueUSD: 1_400_000, share: 0.06, grossMargin: 0.44, growth: -0.02 },
  { id: "dtc", label: "Direct to consumer online", revenueUSD: 1_300_000, share: 0.05, grossMargin: 0.61, growth: 0.14 },
] as const;
export const COMPANY = { revenueUSD: 24_400_000, grossMargin: 0.57, growth: 0.04 } as const;

/** Exhibit B, the grocery rows (case numbers). */
export const GROCERY = {
  regionalChains: { accounts: 6, lbsPerMonth: 3900, staleReturn: 0.068 },
  independents: { accounts: 84, lbsPerMonth: 210, staleReturn: 0.094 },
} as const;

/**
 * Freshness (case Key Terms: "most [coffee] is at its best within two to four weeks" of roasting). A subscription bag is
 * roasted to order and reaches the door WORLD.roastToDoorDays later; it is opened when the coffee ahead of it runs out.
 */
export const FRESHNESS = {
  bestByDays: 14,
  peakEndDays: 28,
} as const;

/**
 * Holiday weeks when many households travel, so a bag that lands then sits on the porch and loses its first weeks of
 * freshness. A check-in for a delivery landing in one of these windows also asks "Away? Reply AWAY" (no extra text);
 * AWAY holds the delivery until the Wednesday after the window. Windows are computed per year (holidays.ts).
 */
export const HOLIDAY_RULES = {
  /** Thanksgiving: the Monday before to the Sunday after (4th Thursday of November) */
  thanksgiving: { fromOffset: -3, toOffset: 3 },
  /** winter holidays: Dec 21 to Jan 2 */
  winter: { fromMonthDay: [12, 21] as const, toMonthDay: [1, 2] as const },
} as const;

/**
 * The bag QR funnel (grocery buyers to subscribers) and the opportunity sizing on the Impact page. All ASSUMPTIONS except
 * where Exhibits A-C are cited; each is in LEDGER.
 */
export const QR = {
  /** share of QR bags that get scanned (sandbox sample data only) */
  scanRate: 0.03,
  /** share of scans that start a subscription (sandbox sample data only) */
  signupRate: 0.09,
  /** grocery bags a Classic Cup grocery buyer purchases in a year: turns Exhibit B pounds into buyers */
  bagsPerBuyerPerYear: 12,
  /** a QR sign-up behaves like a website sign-up (Exhibit C website retention and AOV) */
  cohortLike: "website" as Source,
  /** the pilot: QR labels on bags shipped to these many grocery accounts */
  pilotAccounts: 12,
} as const;

export interface LedgerEntry {
  parameter: string;
  value: string;
  range: string;
  source: string;
}

/** Assumptions ledger: rendered on the Impact page and in docs; the break-even code reads the numeric parts of WORLD. */
export const LEDGER: LedgerEntry[] = [
  { parameter: "Median days one delivery lasts (in-cafe / website / social / gift / referral)", value: "64 / 66 / 78 / 74 / 60", range: "±20%", source: "ASSUMPTION, set so Fixed ships about 7 deliveries per active subscriber-year; the exhibits give no consumption data" },
  { parameter: "Effect of sign-up answers on log days", value: "−0.25 per extra cup/day, −0.15 per extra person (vs 2)", range: "n/a", source: "ASSUMPTION" },
  { parameter: "Between-person spread (τ) and delivery-to-delivery variation (σ_b)", value: "0.30 and 0.15", range: "0.2–0.45 and 0.1–0.3", source: "ASSUMPTION" },
  { parameter: "Delivery rhythm customers choose", value: "28, 42, 56 or 84 days; nearest to the true pace with a mild over-ordering bias (−0.10 ± 0.15 log)", range: "bias −0.30 … +0.10 (includes none and under-ordering)", source: "ASSUMPTION" },
  { parameter: "Life events (travel, guests)", value: "8% a month start; 14–35 days; pace × 0.4", range: "0–15%", source: "ASSUMPTION; the engine has no such term (misspecified on purpose)" },
  { parameter: "Reply probability", value: "45% (× 0.8 when more than 14 days left, × 1.2 at 3–14, × 1.5 at 3 or fewer)", range: "20 / 45 / 70%", source: "ASSUMPTION; the first number the pilot measures" },
  { parameter: "Reply accuracy", value: "±35% on the days left, 10% garbage", range: "±25 / ±35 / ±50%", source: "ASSUMPTION; the engine assumes σ = 0.35 and 10% garbage" },
  { parameter: "Share of cafe/website cancellations caused by stockpiles (φ)", value: "the Impact slider", range: "0–100 of every 100", source: "NOT identified by Exhibit C; to be measured in the pilot" },
  { parameter: "Extra cancel hazard for 30 days after running out", value: "+50%", range: "0–150%", source: "ASSUMPTION" },
  { parameter: "Program cost", value: "$2 per active subscriber-year (texts and care time)", range: "$0.5–6", source: "PLACEHOLDER, unverified: first client question" },
  { parameter: "Deliveries per active subscriber-year", value: "about 7", range: "7–9.2 (9.2 = $1.3m ÷ about 4,000 actives ÷ $35.5)", source: "Exhibits give no figure; 7 is a labelled assumption" },
  { parameter: "Pounds per delivery", value: "0.75 lb (one 12-oz bag)", range: "1.5 lb (two bags) shown as a sensitivity", source: "ASSUMPTION" },
  { parameter: "Monthly cancel rate of a saved customer (offers value)", value: "8% a month (≈ 7.9 expected months)", range: "n/a", source: "ASSUMPTION" },
  { parameter: "Simulated cancellation reasons", value: "stockpile-driven share φ for in-cafe and website only; 0 for the other sources by default", range: "n/a", source: "Exhibit C names different top reasons for the other sources" },
  { parameter: "Freshness window", value: "best within 14 days of roasting, past peak after 28", range: "n/a", source: "Case Key Terms: “most is at its best within two to four weeks”" },
  { parameter: "Roast to door (subscription)", value: "5 days", range: "3–7", source: "ASSUMPTION: roasted to order, shipped ground" },
  { parameter: "Holiday travel windows", value: "Thanksgiving Mon–Sun; Dec 21 – Jan 2", range: "n/a", source: "ASSUMPTION; check-ins for deliveries landing then add “Away? Reply AWAY” (no extra text)" },
  { parameter: "Bag QR: scans per bag, sign-ups per scan", value: "3% and 9% (sandbox sample data)", range: "1–6% and 4–15%", source: "ASSUMPTION; the QR pilot measures both" },
  { parameter: "Grocery bags per Classic Cup grocery buyer per year", value: "12", range: "6–24", source: "ASSUMPTION; turns Exhibit B grocery pounds (≈ 492K lb/yr ≈ 657K 12-oz bags) into buyers" },
  { parameter: "A QR sign-up's first year", value: "like a website sign-up: Exhibit C retention (54% at 90 days, 22% at 12 months) and $41 AOV", range: "n/a", source: "ASSUMPTION; QR sign-ups land on the website sign-up page" },
];
