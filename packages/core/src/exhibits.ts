/** Exhibit C constants (spec 5.1). artifacts/exhibits.json is generated from this file. */

export type SourceName = "in_cafe" | "website" | "social" | "gift" | "referral";
export const SOURCES: readonly SourceName[] = ["in_cafe", "website", "social", "gift", "referral"] as const;

export interface SourceExhibit {
  newSubs: number;
  ret90: number;
  ret12: number;
  aov: number;
}

export const EXHIBITS = {
  dtc: { revenueUSD: 1_300_000, grossMargin: 0.61, growth: 0.14, grossProfitUSD: 793_000, newSubsPerYear: 8670 },
  sources: {
    in_cafe: { newSubs: 2140, ret90: 0.71, ret12: 0.38, aov: 34 },
    website: { newSubs: 1860, ret90: 0.54, ret12: 0.22, aov: 41 },
    social: { newSubs: 3420, ret90: 0.39, ret12: 0.11, aov: 29 },
    gift: { newSubs: 940, ret90: 0.62, ret12: 0.31, aov: 46 },
    referral: { newSubs: 310, ret90: 0.78, ret12: 0.51, aov: 52 },
  } satisfies Record<SourceName, SourceExhibit>,
  notes:
    "Exhibit C. Blended ret90 ≈ 0.54, ret12 ≈ 0.236. Deliveries per active subscriber-year is NOT in the exhibits: new-cohort sub-years ≈ 3,973; $1.3m / $35.47 AOV ≈ 36,650 orders ⇒ at most ≈ 9.2 per new-cohort sub-year, and 5–6 if older cohorts also contribute. We use ≈ 7 as a labelled assumption.",
} as const;

/** The two sources whose top cancellation reason is "too much coffee arriving" (Exhibit C). */
export const STOCKPILE_SOURCES: readonly SourceName[] = ["in_cafe", "website"] as const;

export function sourceWeight(s: SourceName): number {
  return EXHIBITS.sources[s].newSubs;
}

export function groupBaseline(group: readonly SourceName[]): { ret90: number; ret12: number; newSubs: number } {
  let n = 0;
  let r90 = 0;
  let r12 = 0;
  for (const s of group) {
    const e = EXHIBITS.sources[s];
    n += e.newSubs;
    r90 += e.newSubs * e.ret90;
    r12 += e.newSubs * e.ret12;
  }
  return { ret90: r90 / n, ret12: r12 / n, newSubs: n };
}
