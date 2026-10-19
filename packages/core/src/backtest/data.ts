import { readFileSync } from "node:fs";

export interface Series {
  customer: string;
  product: string;
  /** kept purchase days (days since 2009-12-01), ascending */
  days: number[];
}

export function parseSeriesCsv(text: string): Series[] {
  const lines = text.split("\n").filter((l) => l.length > 0);
  if (lines[0] !== "customer,stockcode,days") throw new Error("unexpected series.csv header");
  return lines.slice(1).map((line) => {
    const [customer, product, days] = line.split(",");
    return { customer: customer!, product: product!, days: days!.split(" ").map(Number) };
  });
}

export function loadSeries(path: string): Series[] {
  return parseSeriesCsv(readFileSync(path, "utf8"));
}

/** One forecast opportunity: at the purchase that ends the k-th completed gap, predict the next gap. */
export interface Prediction {
  customer: string;
  product: string;
  /** completed gaps at prediction time (= purchases - 1) */
  k: number;
  history: number[];
  /** day of the purchase at prediction time */
  predDay: number;
  /** the next gap, in days; undefined = censored (no further purchase in the data) */
  y: number | undefined;
  targetEnd: number | undefined;
}

export function predictionsOf(s: Series): Prediction[] {
  const out: Prediction[] = [];
  const gaps: number[] = [];
  for (let i = 1; i < s.days.length; i++) gaps.push(s.days[i]! - s.days[i - 1]!);
  for (let i = 1; i < s.days.length; i++) {
    const hasNext = i + 1 < s.days.length;
    out.push({
      customer: s.customer,
      product: s.product,
      k: i,
      history: gaps.slice(0, i),
      predDay: s.days[i]!,
      y: hasNext ? s.days[i + 1]! - s.days[i]! : undefined,
      targetEnd: hasNext ? s.days[i + 1]! : undefined,
    });
  }
  return out;
}

export const kGroup = (k: number): string => (k >= 5 ? "5+" : String(k));
export const K_GROUPS = ["1", "2", "3", "4", "5+"] as const;
