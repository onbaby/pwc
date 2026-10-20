import { EXHIBITS, SOURCES, WORLD, type Source } from "../shared/constants.ts";
import { nextWednesdayOnOrAfter, ymd, type Day } from "../shared/dates.ts";
import { Stream } from "../shared/rng.ts";
import { quantileSorted } from "../shared/stats.ts";

/**
 * Roast outlook (spec 9.2): weekly DTC deliveries and pounds for six weeks with a P10-P90 band, from
 * (a) scheduled deliveries, (b) pending moves (the scheduled date already includes automatic moves), (c) expected
 * skips and cancellations (Exhibit C hazards by tenure) and (d) new sign-ups' first deliveries (Poisson at
 * 8,670/yr x the Exhibit D monthly index). 200 Monte Carlo draws; each draw first samples a hazard multiplier (±20%)
 * and a sign-up-rate multiplier (±15%), so the band includes rate uncertainty.
 */
export interface OutlookCustomer {
  source: Source;
  /** next scheduled delivery */
  nextDelivery: Day;
  /** days between deliveries */
  rhythmDays: number;
  tenureDays: number;
  /** chance this customer skips a delivery that would otherwise arrive (stockpiled customers skip more) */
  skipProb: number;
  /** probability a pending staff-approval move shifts the date later by 7 days (0 when none) */
  pendingLaterProb?: number;
}

export interface OutlookWeek {
  /** the Wednesday of the week */
  wednesday: Day;
  deliveries: { p10: number; p50: number; p90: number };
  pounds: { p10: number; p50: number; p90: number };
  poundsTwoBag: { p10: number; p50: number; p90: number };
}

export interface OutlookResult {
  weeks: OutlookWeek[];
  draws: number;
  poundsPerDelivery: number;
  note: string;
}

/** Daily cancel hazard by source and tenure, fitted to the two Exhibit C retention points. */
export function hazardPerDay(source: Source, tenureDays: number): number {
  const e = EXHIBITS.sources[source];
  const h1 = -Math.log(e.ret90) / 90;
  const h2 = -Math.log(e.ret12 / e.ret90) / 275;
  return tenureDays < 90 ? h1 : h2;
}

const pct = (xs: number[], q: number) => quantileSorted(Float64Array.from(xs).sort(), q);

export function monthIndex(day: Day): number {
  return EXHIBITS.monthlyIndex[ymd(day).month - 1]!;
}

export function computeOutlook(customers: readonly OutlookCustomer[], today: Day, seed: number | string, draws = 200, weeksAhead = 6): OutlookResult {
  const firstWed = nextWednesdayOnOrAfter(today);
  const wednesdays = Array.from({ length: weeksAhead }, (_, i) => firstWed + 7 * i);
  const perWeek: number[][] = wednesdays.map(() => []);
  const r = new Stream("outlook", seed);
  const lambdaPerWeek = EXHIBITS.dtc.newSubsPerYear / 52;

  for (let d = 0; d < draws; d++) {
    const hazMult = 0.8 + 0.4 * r.next();
    const signupMult = 0.85 + 0.3 * r.next();
    const counts = new Array<number>(weeksAhead).fill(0);
    for (const c of customers) {
      let day = c.nextDelivery;
      if (c.pendingLaterProb && r.next() < c.pendingLaterProb) day += 7;
      let alive = true;
      let last = today;
      while (alive && day <= wednesdays[weeksAhead - 1]!) {
        const h = hazardPerDay(c.source, c.tenureDays + (day - today)) * hazMult;
        if (r.next() < 1 - Math.exp(-h * Math.max(day - last, 0))) alive = false;
        else {
          if (day >= wednesdays[0]! && r.next() >= c.skipProb) {
            const w = Math.floor((day - wednesdays[0]!) / 7);
            if (w >= 0 && w < weeksAhead) counts[w]! += 1;
          }
          last = day;
          day += c.rhythmDays;
        }
      }
    }
    // new sign-ups: the first delivery lands the Wednesday after sign-up (about a week later)
    for (let w = 0; w < weeksAhead; w++) {
      const lambda = lambdaPerWeek * (monthIndex(wednesdays[w]!) / 100) * signupMult;
      counts[w]! += r.poisson(lambda);
    }
    counts.forEach((c, w) => perWeek[w]!.push(c));
  }
  const weeks: OutlookWeek[] = wednesdays.map((wed, w) => {
    const x = perWeek[w]!;
    const band = (k: number) => ({ p10: Math.round(pct(x, 0.1) * k * 10) / 10, p50: Math.round(pct(x, 0.5) * k * 10) / 10, p90: Math.round(pct(x, 0.9) * k * 10) / 10 });
    return {
      wednesday: wed,
      deliveries: { p10: pct(x, 0.1), p50: pct(x, 0.5), p90: pct(x, 0.9) },
      pounds: band(WORLD.poundsPerDelivery),
      poundsTwoBag: band(WORLD.poundsPerDeliveryTwoBag),
    };
  });
  return {
    weeks,
    draws,
    poundsPerDelivery: WORLD.poundsPerDelivery,
    note: "Planning view · DTC only · a small share of roaster volume (under 2% of wholesale pounds). Pounds = deliveries × 0.75 lb (one 12-oz bag); the 1.5 lb (two-bag) sensitivity is in the CSV header.",
  };
}

export { SOURCES };
