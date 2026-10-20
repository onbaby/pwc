"""One-off: UCI Online Retail II -> the derived reorder-gap table used by the real-data model check (spec 7.6).

Usage:  python3 -I scripts/convert-online-retail.py <online_retail_II.xlsx | online_retail_II.csv> data/derived

An .xlsx input needs openpyxl (pip install openpyxl, in a virtualenv); a .csv input needs only pandas.
Dataset: Chen, D. (2012). Online Retail II [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C5CG6D (CC BY 4.0).
The input is untrusted data: it is only read.

Filters (written in src/sim/backtest/PROTOCOL.md before the first run):
  Customer ID present; invoices starting with "C" dropped (cancellations); Quantity > 0; product codes only
  (5 digits + up to 2 letters: postage, fees and adjustments dropped); dedupe to purchase days per customer x product;
  a purchase day within 6 days of the last kept day is dropped (same-session repeats; counted);
  180-day administrative cut: a series stops at its first gap longer than 180 days (that gap and later purchases dropped; counted).
Output: one row per customer x product series with at least 3 kept purchase days:
  customer (opaque index), product (stock code), firstDay (days since 2009-12-01), gaps (space-separated gap lengths in days)
"""
import csv
import hashlib
import json
import sys

import pandas as pd

src, outdir = sys.argv[1], sys.argv[2]
EPOCH = pd.Timestamp("2009-12-01")
ADMIN_CUT_DAYS = 180
SAME_SESSION_DAYS = 7

if src.lower().endswith(".xlsx"):
    import openpyxl  # noqa: E402

    wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
    rows = []
    header = None
    for ws in wb.worksheets:
        first = True
        for row in ws.iter_rows(values_only=True):
            if first:
                first = False
                header = header or [str(c) for c in row]
                continue
            rows.append(row)
    df = pd.DataFrame(rows, columns=header)
else:
    df = pd.read_csv(src, dtype={"Invoice": str, "StockCode": str, "Customer ID": str}, low_memory=False)

df["Invoice"] = df["Invoice"].astype(str)
df["StockCode"] = df["StockCode"].astype(str)
df["Customer ID"] = df["Customer ID"].astype("string")
counts = {"rows": int(len(df))}
df = df[df["Customer ID"].notna()]
counts["after_customer_id_filter"] = int(len(df))
df = df[~df["Invoice"].str.startswith("C")]
counts["after_cancellation_filter"] = int(len(df))
df = df[df["Quantity"] > 0]
counts["after_quantity_filter"] = int(len(df))
df = df[df["StockCode"].str.match(r"^\d{5}[A-Za-z]{0,2}$")]
counts["after_product_code_filter"] = int(len(df))
df["day"] = (pd.to_datetime(df["InvoiceDate"]).dt.normalize() - EPOCH).dt.days
days = df[["Customer ID", "StockCode", "day"]].drop_duplicates().sort_values(["Customer ID", "StockCode", "day"])
counts["customer_product_purchase_days"] = int(len(days))
counts["last_day_index"] = int(df["day"].max())

cust_index = {c: i for i, c in enumerate(sorted(days["Customer ID"].unique()), start=1)}
rows = []
dropped_same_session = 0
cut_gaps = 0
series_total = 0
for (c, p), g in days.groupby(["Customer ID", "StockCode"], sort=False):
    kept = []
    for d in g["day"]:
        d = int(d)
        if not kept:
            kept.append(d)
        elif d - kept[-1] < SAME_SESSION_DAYS:
            dropped_same_session += 1
        elif d - kept[-1] > ADMIN_CUT_DAYS:
            cut_gaps += 1
            break  # administrative cut: the customer has lapsed; later purchases are a new relationship and are ignored
        else:
            kept.append(d)
    series_total += 1
    if len(kept) >= 3:
        gaps = [b - a for a, b in zip(kept, kept[1:])]
        rows.append((f"c{cust_index[c]:05d}", p, kept[0], " ".join(map(str, gaps))))
counts["same_session_days_dropped"] = int(dropped_same_session)
counts["series_cut_at_180_days"] = int(cut_gaps)
counts["series_total"] = int(series_total)
counts["series_written_ge3_days"] = len(rows)
rows.sort()
path = f"{outdir}/online_retail_gaps.csv"
with open(path, "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f)
    w.writerow(["customer", "product", "firstDay", "gaps"])
    w.writerows(rows)
digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
meta = {
    "dataset": "Online Retail II",
    "citation": "Chen, D. (2012). Online Retail II [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C5CG6D",
    "license": "CC BY 4.0",
    "note": "Derived table: customer ids replaced by an opaque index; firstDay = days since 2009-12-01; gaps in days; series with at least 3 kept purchase days; series cut at the first gap longer than 180 days.",
    "counts": counts,
    "gapsCsvSha256": digest,
}
with open(f"{outdir}/online_retail_gaps.meta.json", "w", encoding="utf-8") as f:
    json.dump(meta, f, indent=2)
    f.write("\n")
print(json.dumps(meta, indent=2))
