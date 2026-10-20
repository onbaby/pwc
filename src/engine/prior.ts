import { SOURCES, type Source } from "../shared/constants.ts";
import { ols, sd } from "../shared/stats.ts";
import type { ThetaPrior } from "./pantryFilter.ts";

/**
 * Layer A: the starting estimate (spec 7.1). A small linear model of ln(days one delivery lasts) on sign-up source,
 * sign-up answers and the chosen rhythm; coefficients by OLS, tau from the residuals, sigma_b as the pooled
 * within-customer variation. In the sandbox it is fit on synthetic data ("assumed prior; circular by construction").
 */
export interface PriorFeatures {
  source: Source;
  cups: number;
  people: number;
  rhythmDays: number;
}

export interface PriorModel {
  sources: readonly Source[];
  /** [source dummies..., cups - 2, people - 2, ln(rhythm) - 3.9] */
  beta: number[];
  tau: number;
  sigmaB: number;
  /** how it was fit: shown verbatim next to every starting estimate */
  label: string;
  trainedOn: number;
}

export const PRIOR_LABEL = "assumed prior, fit on synthetic data (circular by construction)";

export function featureVector(f: PriorFeatures): number[] {
  return [...SOURCES.map((s) => (s === f.source ? 1 : 0)), f.cups - 2, f.people - 2, Math.log(f.rhythmDays) - 3.9];
}

export function priorFor(model: PriorModel, f: PriorFeatures): ThetaPrior {
  const x = featureVector(f);
  let mu = 0;
  for (let i = 0; i < x.length; i++) mu += model.beta[i]! * x[i]!;
  return { mu, tau: model.tau };
}

export function fitPrior(rows: Array<{ features: PriorFeatures; theta: number }>, withinCustomerDeviations: number[], label = PRIOR_LABEL): PriorModel {
  const { beta, residualSd } = ols(
    rows.map((r) => featureVector(r.features)),
    rows.map((r) => r.theta),
  );
  return { sources: SOURCES, beta, tau: residualSd, sigmaB: sd(withinCustomerDeviations), label, trainedOn: rows.length };
}
