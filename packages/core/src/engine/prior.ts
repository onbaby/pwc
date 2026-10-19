import type { SourceName } from "../exhibits.ts";
import { SOURCES } from "../exhibits.ts";
import { ols, sd } from "../stats.ts";
import type { ThetaPrior } from "./pantry.ts";

/** Layer A: the rate prior (spec 6.1). A small linear model of log days-per-delivery, empirical Bayes. */
export interface SubscriberFeatures {
  source: SourceName;
  /** cups per day as the customer reported at signup (25% of reports are wrong in the simulator) */
  cupsObs: number;
  householdObs: number;
  /** the customer's chosen cadence in days */
  cadenceDays: number;
}

export interface PriorModel {
  sources: readonly SourceName[];
  /** [source dummies..., cups-2, household-2, ln(cadence)-3.9] */
  beta: number[];
  /** residual sd of theta given the features */
  tau: number;
  /** pooled within-subscriber sd of ln(days) from delivery to delivery */
  sigmaB: number;
}

export function featureVector(f: SubscriberFeatures): number[] {
  return [
    ...SOURCES.map((s) => (s === f.source ? 1 : 0)),
    f.cupsObs - 2,
    f.householdObs - 2,
    Math.log(f.cadenceDays) - 3.9,
  ];
}

export function priorMu(model: PriorModel, f: SubscriberFeatures): number {
  const x = featureVector(f);
  let mu = 0;
  for (let i = 0; i < x.length; i++) mu += model.beta[i]! * x[i]!;
  return mu;
}

export function priorFor(model: PriorModel, f: SubscriberFeatures): ThetaPrior {
  return { mu: priorMu(model, f), tau: model.tau };
}

/** OLS for the coefficients, tau from the residuals, sigma_b as the pooled within-subscriber sd. */
export function fitPrior(
  rows: Array<{ features: SubscriberFeatures; theta: number }>,
  withinSubscriberLogDeviations: number[],
): PriorModel {
  const X = rows.map((r) => featureVector(r.features));
  const y = rows.map((r) => r.theta);
  const { beta, residualSd } = ols(X, y);
  return { sources: SOURCES, beta, tau: residualSd, sigmaB: sd(withinSubscriberLogDeviations) };
}
