# Backtest protocol (written down before we looked)

> Scope: this checks **Layer A only** of the engine (spec §5.4, §6.1): *do partial pooling and calibrated ranges predict the next reorder gap better than "last gap" on real repeat-purchase data with few observations per customer?*
> It does **not** test Classic Cup customers, coffee consumption, the text-reply sensor, or Layer B (the pantry filter, which is tested against the simulator's known synthetic truth).
> This file is committed before the first run of `pnpm backtest`. `backtest.json` records the commit hash of this file; `pnpm backtest` refuses to run if this file has uncommitted changes. "Written down before we looked", not "pre-registered".

## 1. Data

*Online Retail II*, UCI Machine Learning Repository. Chen, D. (2012). doi:10.24432/C5CG6D. **CC BY 4.0** (attribution required; derived table in `data/derived/` is shared under the same licence).
UK online giftware retailer; 1 Dec 2009 – 9 Dec 2011; 1,067,371 rows in the `.xlsx` (two sheets: 525,461 + 541,910 data rows; verified on the file opened 18 Oct 2026, SHA-256 of the `.xlsx`: `bcbe73b35f5b7babf197fb0cb983a11f5d9ff929078d4aa53d171b1f2df2e980`).
Columns in the file: `Invoice, StockCode, Description, Quantity, InvoiceDate, Price, Customer ID, Country` (the older "Online Retail" names `InvoiceNo/UnitPrice/CustomerID` do not appear). The UCI page states that many customers are wholesalers: gaps are irregular and lumpy, and gift-ware gaps are **not** consumption gaps.

## 2. Filters (applied in `scripts/derive-series.py`; counts are in `data/derived/meta.json`)

1. `Customer ID` present (243,007 rows dropped).
2. Invoices whose number starts with `C` are cancellations: dropped (18,744 rows after step 1; 19,494 in the whole file; confirmed on the file).
3. `Quantity > 0`.
4. Product codes only: `StockCode` matches `^\d{5}[A-Za-z]{0,2}$` (drops POST, DOT, M, BANK CHARGES, ADJUST, ADJUST2, C2, D, PADS, SP1002, TEST001, TEST002; 2,927 rows).
5. Dedupe to **purchase days** per customer × product.
6. **Drop gaps under 7 days** (same-session repeats): walking each series in date order, a purchase day within 6 days of the last *kept* day is dropped (12,201 days dropped).
7. A series is the sequence of kept purchase days for one customer × one product. **Series with at least 3 kept purchase days are written** to `data/derived/series.csv` (two gaps: one to learn from, one to predict). Customer ids are replaced by an opaque index.

## 3. Day-1 feasibility count (recorded before the first run)

| Quantity | Value |
|---|---|
| Rows after filters 1–4 | 802,693 |
| Customer × product purchase days | 759,550 |
| Customer × product series (any length) | 480,978 |
| Series with ≥ 3 kept purchase days | 53,373 |
| Series with ≥ 5 | 18,414 |
| **Series with ≥ 7 kept purchase days** | **8,428** (the spec's feasibility test: ≥ ~1,500 required) |
| Gaps inside those 8,428 series | 76,578 |
| Median gap in them | 36 days (P1 = 7, P99 = 278) |
| Share of line items with quantity > 12 | 16.2% (bulk buying is common; gaps are purchase rhythm, not consumption) |

Decision: **product-level series are feasible; no fallback to customer-level series.** 8,428 ≥ 1,500.

## 4. Splits (time-ordered *and* customer-level)

- Cutoff day **2010-12-01** (day index 365 from 2009-12-01).
- Customers are assigned by a fixed hash of the opaque customer id: `fnv1a32(id) mod 10 < 7` → **fit** (70%), otherwise **calibration** (30%). Applies inside the pre-cutoff period only.
- **Fit set:** gaps (consecutive kept purchase days) of fit customers whose *end* purchase is before the cutoff. Used to estimate the priors (§5).
- **Calibration set:** every eligible (series, k) prediction of calibration customers whose *target* end purchase is before the cutoff. Used for the Mondrian conformal scales and the fitted baseline multipliers B3 and the B1/B3 bands.
- **Test set:** every eligible (series, k) prediction, **all customers**, whose prediction time (the purchase date that ends the k-th completed gap) is **on or after the cutoff**, and whose target gap (next gap) is observed before 2011-12-09. Priors and calibration never see these targets.
- Report customers and series per split.

## 5. Eligibility, k, and censoring (no look-ahead)

At a prediction time (a purchase), the series has *n* purchases and **k = n − 1 completed gaps**. A series is eligible for step *k* if k ≥ 1. The target is the next gap (purchase *n+1* − purchase *n*). If there is no purchase *n+1* in the data the prediction is **censored**: excluded and counted (only series in `series.csv`, i.e. ≥ 3 purchase days, are visible; so the censored count is a lower bound). Reported steps: k = 1, 2, 3, 4 and "5+". On screen the word is "earlier reorders".

## 6. Model (engine Layer A)

Normal model on log-gaps `ln(gap days)` with partial pooling (empirical Bayes, method of moments, all estimated on the **fit set** only):
- `σ_w²`: pooled within-series variance of log-gaps (series with ≥ 2 fit gaps).
- `τ²`: between-series variance within a product (variance of series means minus `σ_w²/k̄`), floored at 0.01.
- `ρ²`: between-product variance of product means (products with ≥ 10 fit gaps), floored at 0.01. Product prior mean `m_p = μ_g + B_p (ȳ_p − μ_g)`, `B_p = ρ² / (ρ² + (τ² + σ_w²)/n_p)`; products with no fit gaps use the global mean `μ_g` (fallback).
- Series posterior with k observed log-gaps (mean `ḡ`): precision `1/τ² + k/σ_w²`; mean `(m_p/τ² + k ḡ/σ_w²) / precision`; predictive `N(post mean, 1/precision + σ_w²)`.
- **Grid rescaled per dataset to [P1, P99]:** the predictive quantiles in days are clipped to `[P1, P99]` of fit-set gaps (7 and the dataset's P99).
- **Mondrian-by-k conformal scale** on the calibration set: for each k in {1,2,3,4,5+}, `c_k` is the ⌈(n+1)·0.8⌉-th smallest standardised absolute residual `|ln y − μ|/σ`; the calibrated predictive sd is `σ' = σ c_k / z_0.9` (z_0.9 = 1.2816). Quantile q of the forecast = `exp(μ + z_q σ')`, clipped to [P1, P99]. The 80% range is `[q0.10, q0.90]`.

## 7. Baselines (fair)

- **B0** last gap (point forecast).
- **B1** median of the last ≤ 3 gaps (point forecast).
- **B2** product median of fit-set gaps (global median if the product is unseen).
- **B3** = B1 × a multiplier fitted on the calibration set so that 33% of calibration targets fall below `m·B1` (the 0.33-quantile of `y / B1`), with a symmetric (in probability) 80% band `B1 × [Q0.10(y/B1), Q0.90(y/B1)]`. The model must beat this *calibrated* baseline, not just last gap.
- **B4** pooled empirical quantiles of fit-set gaps by product (global if unseen).

## 8. Metrics

- **Pinball loss at q = 0.33** (days) of each forecast of the 0.33-quantile (point forecasts are used as given, B0/B1/B2 included).
- Mean absolute error (days) of the median forecast (model median `exp(μ)`; B0, B1, B2 as given; B3 median = B1 × `Q0.50(y/B1)` fitted on calibration; B4 product median).
- **80%-range coverage by k** (Mondrian-calibrated, the evidence); pooled coverage is shown only as a sanity check. Also the median width (days) of the 80% range by k.
- **Paired bootstrap over customers** (95% percentile interval, 2,000 resamples, PRNG seed 20261018) of the mean pinball@0.33 difference (model − B3) at each k.
- **Decision-level analogue:** apply the ship rule to real gaps: predicted arrival = `round(Q_0.10 forecast) + 3` days after the last purchase (the "balanced" rule of §5.2.4: `q = 0.10`, grace 3 days). Report, by k, for the rule, B0-as-date and B1-as-date: the share of gaps where the predicted date is **3 or more days after** the actual repeat purchase ("late") and the mean days **early** (`max(actual − predicted, 0)`).

## 9. Success rule (written in advance)

All of:
1. the **upper** 95% bound of (model − B3) mean pinball@0.33 is **< 0** at k = 1 **and** k = 2; and
2. |80%-range coverage − 0.80| ≤ **0.05** at **each** of k = 1, 2, 3, 4.

**If it fails, the screen reports the failure.** Pre-written line for a partial failure: *"On real data the method beat last-gap for the first reorders but not the later ones; that is why the pilot starts with a text-only arm and no schedule changes."* The screen shows the computed verdict and the commit hash of this file.

## 10. Known limits (stated on the screen and in `/backup`)

- Gift-ware purchase gaps are not consumption gaps; many buyers are wholesalers; the data say nothing about how fast anyone drinks coffee or whether they reply to a text.
- Conditioning on "the next purchase happened" (§5) flatters every method equally; it cannot rank them differently, but absolute errors are optimistic.
- Series with fewer than 3 kept purchase days are not in the table.
