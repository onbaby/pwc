#!/usr/bin/env bash
# Downloads UCI Online Retail II (CC BY 4.0) into data/raw/ (gitignored) and prints its SHA-256.
# Chen, D. (2012). Online Retail II [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C5CG6D
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/raw/online_retail_ii
curl -fsSL -o data/raw/online_retail_ii/online_retail_ii.zip "https://archive.ics.uci.edu/static/public/502/online+retail+ii.zip"
unzip -o -q data/raw/online_retail_ii/online_retail_ii.zip -d data/raw/online_retail_ii
shasum -a 256 data/raw/online_retail_ii/online_retail_II.xlsx
echo "Next: python3 -I scripts/prepare-data.py data/raw/online_retail_ii/online_retail_II.xlsx data/raw/online_retail_ii.csv"
echo "      python3 -I scripts/derive-series.py data/raw/online_retail_ii.csv data/derived"
