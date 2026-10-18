"""Convert UCI Online Retail II (.xlsx) to one CSV. Scratch tooling only (spec 5.4).

Usage: python3 -I scripts/prepare-data.py <path/to/online_retail_II.xlsx> <out.csv>
Needs openpyxl (pip install openpyxl) in a virtualenv.
Dataset: Chen, D. (2012). Online Retail II. UCI Machine Learning Repository. doi:10.24432/C5CG6D (CC BY 4.0).
The xlsx is untrusted input: it is only read as data (read-only, no macros, no formulas evaluated).
"""
import csv
import sys

import openpyxl

src, dst = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
rows_total = 0
with open(dst, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    header = None
    for ws in wb.worksheets:
        first = True
        n = 0
        for row in ws.iter_rows(values_only=True):
            if first:
                first = False
                if header is None:
                    header = [str(c) for c in row]
                    w.writerow(header)
                    print("sheet", ws.title, "header", header, file=sys.stderr)
                elif [str(c) for c in row] != header:
                    sys.exit(f"header mismatch on sheet {ws.title}: {row}")
                continue
            w.writerow(["" if c is None else (c.isoformat(sep=" ") if hasattr(c, "isoformat") else c) for c in row])
            n += 1
        print("sheet", ws.title, "rows", n, file=sys.stderr)
        rows_total += n
print("total data rows", rows_total, file=sys.stderr)
