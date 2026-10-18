"""Day-1 feasibility count for the real-data check (spec 5.4). Scratch tooling.

Usage: python3 -I scripts/feasibility.py data/raw/online_retail_ii.csv
Prints the counts that are recorded in packages/core/src/backtest/PROTOCOL.md BEFORE the backtest is run.
"""
import re
import sys

import pandas as pd

df = pd.read_csv(sys.argv[1], dtype={"Invoice": str, "StockCode": str, "Customer ID": str}, low_memory=False)
n0 = len(df)
print("rows", n0, "columns", list(df.columns))
print("distinct invoices starting with C (cancellations):", df["Invoice"].str.startswith("C").sum())
print("rows with missing Customer ID:", df["Customer ID"].isna().sum())
df = df[df["Customer ID"].notna()]
print("after customer filter:", len(df))
df = df[~df["Invoice"].str.startswith("C")]
print("after dropping C invoices:", len(df))
df = df[df["Quantity"] > 0]
print("after Quantity > 0:", len(df))
is_product = df["StockCode"].str.match(r"^\d{5}[A-Za-z]{0,2}$")
print("non-product stock codes dropped:", (~is_product).sum(), sorted(df.loc[~is_product, "StockCode"].unique())[:40])
df = df[is_product]
print("after product codes only:", len(df))
print("share of lines with Quantity > 12:", round((df["Quantity"] > 12).mean(), 4))
df["day"] = pd.to_datetime(df["InvoiceDate"]).dt.normalize()
pd_days = df[["Customer ID", "StockCode", "day"]].drop_duplicates().sort_values(["Customer ID", "StockCode", "day"])
print("customer x product purchase days:", len(pd_days))

def thin(days):
    kept = []
    dropped = 0
    last = None
    for d in days:
        if last is None or (d - last).days >= 7:
            kept.append(d)
            last = d
        else:
            dropped += 1
    return kept, dropped

series = 0
dropped_total = 0
gaps = []
n_by_series = []
for (_c, _p), g in pd_days.groupby(["Customer ID", "StockCode"], sort=False):
    kept, dropped = thin(list(g["day"]))
    dropped_total += dropped
    n_by_series.append(len(kept))
    if len(kept) >= 7:
        series += 1
        gaps.extend((b - a).days for a, b in zip(kept, kept[1:]))
print("short-gap (<7d) purchase days dropped:", dropped_total)
s = pd.Series(n_by_series)
print("customer x product series total:", len(s), "with >=3 days:", (s >= 3).sum(), ">=5:", (s >= 5).sum(), ">=7:", (s >= 7).sum())
print("series with >=7 purchase days:", series, "gaps in them:", len(gaps))
if gaps:
    g = pd.Series(gaps)
    print("gap median", g.median(), "P1", g.quantile(.01), "P99", g.quantile(.99), "mean", round(g.mean(), 1))
