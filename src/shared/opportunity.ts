import { CHANNELS, COMPANY, EXHIBITS, GROCERY, QR, WORLD } from "./constants.ts";

/**
 * Why DTC, and what it is worth (Impact page). Pure arithmetic on Exhibits A-C plus the labelled assumptions in QR and
 * WORLD; the UI never hard-codes a result.
 */

const dtc = CHANNELS.find((c) => c.id === "dtc")!;
const grocery = CHANNELS.find((c) => c.id === "grocery")!;
const wholesaleCafes = CHANNELS.find((c) => c.id === "wholesale_cafes")!;

/** Share of the first year a new sign-up is still subscribed: the area under Exhibit C's survival curve (same piecewise
 * exponential hazards as the sample-data generator). */
export function firstYearActiveShare(ret90: number, ret12: number): number {
  const h1 = -Math.log(ret90) / 90;
  const h2 = -Math.log(ret12 / ret90) / 275;
  let sum = 0;
  for (let t = 0; t < 365; t++) sum += Math.exp(-h1 * Math.min(t, 90) - h2 * Math.max(t - 90, 0));
  return sum / 365;
}

export function whyDtc() {
  const sources = Object.values(EXHIBITS.sources);
  const newSubs = sources.reduce((n, s) => n + s.newSubs, 0);
  const keptAt90 = sources.reduce((n, s) => n + s.newSubs * s.ret90, 0);
  const keptAt12 = sources.reduce((n, s) => n + s.newSubs * s.ret12, 0);
  const dtcGrossProfit = dtc.revenueUSD * dtc.grossMargin;
  return {
    channels: CHANNELS,
    company: COMPANY,
    dtc: { share: dtc.share, grossMargin: dtc.grossMargin, growth: dtc.growth, revenueUSD: dtc.revenueUSD, grossProfit: dtcGrossProfit },
    /** DTC's growth relative to wholesale cafes and to the whole company */
    growthMultiple: { vsWholesaleCafes: dtc.growth / wholesaleCafes.growth, vsCompany: dtc.growth / COMPANY.growth },
    marginGapVsGrocery: dtc.grossMargin - grocery.grossMargin,
    newSubs,
    ret90: keptAt90 / newSubs,
    ret12: keptAt12 / newSubs,
    /** new subscribers a year who are gone within a year */
    lostWithinYear: Math.round(newSubs - keptAt12),
  };
}

export interface OpportunityInput {
  /** relative increase in subscribers kept (0.10 = 10% more) */
  retentionLift: number;
  /** share of Classic Cup grocery buyers who convert to a subscription in a year */
  groceryConversion: number;
  bagsPerBuyerPerYear?: number;
  deliveriesPerYear?: number;
}

export function opportunity(i: OpportunityInput) {
  const dtcGrossProfit = dtc.revenueUSD * dtc.grossMargin;
  const retentionGP = dtcGrossProfit * i.retentionLift;

  const groceryLbsPerYear = (GROCERY.regionalChains.accounts * GROCERY.regionalChains.lbsPerMonth + GROCERY.independents.accounts * GROCERY.independents.lbsPerMonth) * 12;
  const groceryBags = groceryLbsPerYear / WORLD.poundsPerDelivery;
  const bagsPerBuyer = i.bagsPerBuyerPerYear ?? QR.bagsPerBuyerPerYear;
  const buyers = groceryBags / bagsPerBuyer;
  const converts = buyers * i.groceryConversion;

  const cohort = EXHIBITS.sources[QR.cohortLike];
  const activeShare = firstYearActiveShare(cohort.ret90, cohort.ret12);
  const deliveries = (i.deliveriesPerYear ?? WORLD.deliveriesPerYearAssumed) * activeShare;
  const dtcGPPerConvert = deliveries * cohort.aov * dtc.grossMargin;
  // the same bags would otherwise have been bought in a grocery store: subtract the wholesale gross profit they carried
  const groceryRevenuePerBag = grocery.revenueUSD / groceryBags;
  const lostGroceryGPPerConvert = deliveries * groceryRevenuePerBag * grocery.grossMargin;
  const netPerConvert = dtcGPPerConvert - lostGroceryGPPerConvert;
  const groceryGP = converts * netPerConvert;

  return {
    retentionGP,
    groceryGP,
    totalGP: retentionGP + groceryGP,
    detail: { dtcGrossProfit, groceryLbsPerYear, groceryBags, bagsPerBuyer, buyers, converts, activeShare, deliveries, dtcGPPerConvert, lostGroceryGPPerConvert, netPerConvert, groceryRevenuePerBag },
  };
}
