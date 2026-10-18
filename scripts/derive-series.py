"""Derive the per-series purchase-day table used by the real-data check (spec 5.4). Scratch tooling.

Usage: python3 -I scripts/derive-series.py data/raw/online_retail_ii.csv data/derived

Filters (written in packages/core/src/backtest/PROTOCOL.md before the first backtest run):
  Customer ID present; invoices starting with "C" dropped (cancellations); Quantity > 0;
  product codes only (5 digits plus up to 2 letters; postage, fees, adjustments dropped);
  dedupe to purchase days per customer x product; purchase days within 7 days of the previous kept day are dropped
  (same-session repeats; counted). Series with >= 3 kept purchase days are written (>= 2 gaps: one to learn from, one to predict).
Customer IDs are replaced by an opaque index. Output is CC BY 4.0 derived data (attribution in meta.json).
"""
import hashlib
import json
import sys

import pandas as pd

src, outdir = sys.argv[1], sys.argv[2]
EPOCH = pd.Timestamp("2009-12-01")
df = pd.read_csv(src, dtype={"Invoice": str, "StockCode": str, "Customer ID": str}, low_memory=False)
counts = {"rows": int(len(df))}
df = df[df["Customer ID"].notna()]
counts["after_customer_id_filter"] = int(len(df))
df = df[~df["Invoice"].str.startswith("C")]
counts["after_cancellation_filter"] = int(len(df))
df = df[df["Quantity"] > 0]
counts["after_quantity_filter"] = int(len(df))
df = df[df["StockCode"].str.match(r"^\d{5}[A-Za-z]{0,2}$")]
counts["after_product_code_filter"] = int(len(df))
counts["share_lines_quantity_gt_12"] = round(float((df["Quantity"] > 12).mean()), 4)
df["day"] = (pd.to_datetime(df["InvoiceDate"]).dt.normalize() - EPOCH).dt.days
days = df[["Customer ID", "StockCode", "day"]].drop_duplicates().sort_values(["Customer ID", "StockCode", "day"])
counts["customer_product_purchase_days"] = int(len(days))
counts["data_first_day"] = str(EPOCH.date())
counts["data_last_day_index"] = int(df["day"].max())

cust_index = {c: i for i, c in enumerate(sorted(days["Customer ID"].unique()), start=1)}
rows = []
dropped = 0
series_total = 0
for (c, p), g in days.groupby(["Customer ID", "StockCode"], sort=False):
    kept = []
    for d in g["day"]:
        if not kept or d - kept[-1] >= 7:
            kept.append(int(d))
        else:
            dropped += 1
    series_total += 1
    if len(kept) >= 3:
        rows.append((f"c{cust_index[c]:05d}", p, " ".join(map(str, kept))))
counts["short_gap_purchase_days_dropped"] = int(dropped)
counts["series_total"] = int(series_total)
counts["series_written_ge3_days"] = len(rows)
rows.sort()
with open(f"{outdir}/series.csv", "w", encoding="utf-8") as f:
    f.write("customer,stockcode,days\n")
    for r in rows:
        f.write(",".join(r) + "\n")
digest = hashlib.sha256(open(f"{outdir}/series.csv", "rb").read()).hexdigest()
meta = {
    "dataset": "Online Retail II",
    "citation": "Chen, D. (2012). Online Retail II [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C5CG6D",
    "license": "CC BY 4.0",
    "note": "Derived table: customer ids replaced by an opaque index; day = days since 2009-12-01; only series with >= 3 kept purchase days.",
    "counts": counts,
    "series_csv_sha256": digest,
}
with open(f"{outdir}/meta.json", "w", encoding="utf-8") as f:
    json.dump(meta, f, indent=2)
    f.write("\n")
print(json.dumps(meta, indent=2))
