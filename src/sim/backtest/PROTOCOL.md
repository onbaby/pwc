# Real-data model check: protocol (written down before the first run)

> Scope (spec 7.6): this checks the **method** of Layer A, not Classic Cup. *Do partial pooling and calibrated ranges predict the next reorder gap better than "last gap" on real repeat-purchase data with few observations per customer?* It does **not** test coffee consumption, text replies, or Classic Cup's coefficients, and it does not test Layer B (the pantry tracker, which is checked against the simulator's known truth).
>
> `pnpm backtest` refuses to run unless this file is committed and unmodified, and records the hash of the commit that last touched it. "Written down before we looked", not "pre-registered".
>
> **Disclosure:** a structurally similar check was run in an earlier build of this project (v3) and its headline result was known to the author when this protocol was written. This protocol is a fresh implementation with a different series definition (180-day administrative cut) and different quantiles; the thresholds below are chosen from the spec's description and are not tuned to any result.

## 1. Data

*Online Retail II*, UCI Machine Learning Repository. Chen, D. (2012). doi:10.24432/C5CG6D. **CC BY 4.0**. UK online giftware retailer; 1 Dec 2009 – 9 Dec 2011; 1,067,371 rows in two sheets; columns `Invoice, StockCode, Description, Quantity, InvoiceDate, Price, Customer ID, Country`. Many customers are wholesalers: gaps are irregular and gift-ware gaps are **not** consumption gaps.

## 2. Filters (`scripts/convert-online-retail.py`; counts in `data/derived/online_retail_gaps.meta.json`)

1. `Customer ID` present. 2. Invoices starting with `C` are cancellations: dropped. 3. `Quantity > 0`. 4. Product codes only: `StockCode` matches `^\d{5}[A-Za-z]{0,2}$` (drops POST, DOT, M, BANK CHARGES, ADJUST…). 5. Dedupe to **purchase days** per customer × product. 6. A purchase day within 6 days of the last kept day is dropped (same-session repeats; counted). 7. **180-day administrative cut:** a series stops at its first gap longer than 180 days (the customer is treated as lapsed; that gap and any later purchases are dropped; counted). Consequence, stated on the card: every method is only ever asked to predict gaps of 180 days or less. 8. Series with **at least 3** kept purchase days are written (two gaps: one to learn from, one to predict). Customer ids become an opaque index.

## 3. Splits (time-ordered and customer-level)

- Cutoff day **365** (2010-12-01). Customers go to **fit** (70%) or **calibration** (30%) by `fnv1a32(customer id) mod 10 < 7`, applied to the pre-cutoff period only.
- **Fit set:** the gaps of fit customers whose *end* purchase is before the cutoff. Estimates all priors.
- **Calibration set:** every eligible prediction of calibration customers whose *target* end purchase is before the cutoff. Used for the conformal scales and the calibrated last-gap multipliers.
- **Test set:** every eligible prediction, **all customers**, whose prediction time (the purchase that ends the k-th completed gap) is **on or after the cutoff** and whose target gap is observed. Predictions with no next purchase (or a next gap cut at 180 days) are **censored**: excluded and counted.
- A prediction at a purchase has **k = completed gaps so far (k ≥ 1)**; reported groups k = 1, 2, 3, 4, 5+ ("earlier reorders"). History at prediction time contains only earlier gaps (no look-ahead). Report customers and series per split.

## 4. Model (Layer A method)

Normal model on `ln(gap days)` with partial pooling, empirical Bayes by method of moments **on the fit set only**: global mean `μ_g`; within-series variance `σ_w²` (pooled over series with ≥ 2 fit gaps); between-series variance within a product `τ²` (floored at 0.01); between-product variance `ρ²` over products with ≥ 10 fit gaps (floored at 0.01). Product mean `m_p = μ_g + B_p (ȳ_p − μ_g)`, `B_p = ρ² / (ρ² + (τ² + σ_w²)/n_p)`; unseen product → `μ_g`. A series with k observed log-gaps (mean `ḡ`): posterior precision `1/τ² + k/σ_w²`, mean `(m_p/τ² + kḡ/σ_w²)/precision`; predictive `N(post mean, 1/precision + σ_w²)`.

**Mondrian-by-k conformal scale** on the calibration set: for each k group `c_k` is the ⌈(n+1)·0.8⌉-th smallest standardised absolute residual; calibrated sd `σ′ = σ c_k / z_0.9`. Forecast quantile q = `exp(μ + z_q σ′)`, clipped to `[P1, P99]` of fit-set gaps. The 80% range is `[q0.10, q0.90]`.

## 5. Baselines (fair)

- **Bc, the calibrated last gap:** last gap × `m_q`, where `m_q` is the q-quantile of `y / lastGap` on the calibration set, for q = 0.10, 0.50, 0.90 (so the model must beat a *calibrated* baseline, not just last gap). Its 80% range is `[m_0.10, m_0.90] × lastGap`.
- **B0** the raw last gap and **B2** the product median of fit-set gaps (reported for context).

## 6. Metrics

- **Pinball loss at q = 0.10, 0.50, 0.90** (days) and their mean, model vs Bc; mean absolute error of the median forecast.
- **Coverage of the 80% range by k** (the evidence); pooled coverage is a sanity check only. Median width of the range in days.
- **Paired bootstrap over customers** (95% percentile interval, 2,000 resamples, PRNG seed 20261018) of the difference (model − Bc) in mean pinball at each k.

## 7. Success rule (written in advance)

All of: (1) the **upper** 95% bound of (model − Bc) mean pinball is **< 0** at k = 1 **and** k = 2; and (2) |coverage − 0.80| ≤ **0.05** at **each** of k = 1, 2, 3, 4.
**If it fails, the Impact card reports the failure.** Pre-written line for a partial failure: *"On real data the method beat last-gap for the first reorders but not the later ones; that is why the pilot starts with a text-only arm and no schedule changes."*

## 8. Known limits (stated on the card)

Gift-ware gaps are not consumption gaps; many buyers are wholesalers; the data say nothing about how fast anyone drinks coffee or whether they reply to a text. Conditioning on "the next purchase happened" and on the 180-day cut flatters every method equally but makes absolute errors optimistic. Series with fewer than 3 kept purchase days are not in the table.
