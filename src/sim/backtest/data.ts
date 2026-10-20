import { readFileSync } from "node:fs";

/** One customer x product series from the derived table: purchase days (days since 2009-12-01) and the gaps between them. */
export interface Series {
  customer: string;
  product: string;
  /** purchase days, ascending; days.length = gaps.length + 1 */
  days: number[];
  gaps: number[];
}

export function parseGapsCsv(text: string): Series[] {
  const lines = text.split("\n").filter((l) => l.length > 0);
  if (lines[0] !== "customer,product,firstDay,gaps") throw new Error("unexpected gaps csv header");
  return lines.slice(1).map((line) => {
    const [customer, product, first, gapText] = line.split(",");
    const gaps = gapText!.split(" ").map(Number);
    const days = [Number(first)];
    for (const g of gaps) days.push(days[days.length - 1]! + g);
    return { customer: customer!, product: product!, days, gaps };
  });
}

export const loadGaps = (path: string): Series[] => parseGapsCsv(readFileSync(path, "utf8"));

/** A forecast opportunity: at the purchase that ends the k-th completed gap, predict the next gap. */
export interface Prediction {
  customer: string;
  product: string;
  /** completed gaps at prediction time */
  k: number;
  /** only earlier gaps: no look-ahead */
  history: number[];
  /** the day of the purchase at prediction time */
  day: number;
  /** the next gap; undefined = censored */
  y: number | undefined;
  targetEnd: number | undefined;
}

export function predictionsOf(s: Series): Prediction[] {
  const out: Prediction[] = [];
  for (let i = 1; i < s.days.length; i++) {
    const hasNext = i < s.gaps.length;
    out.push({ customer: s.customer, product: s.product, k: i, history: s.gaps.slice(0, i), day: s.days[i]!, y: hasNext ? s.gaps[i]! : undefined, targetEnd: hasNext ? s.days[i + 1]! : undefined });
  }
  return out;
}

export const K_GROUPS = ["1", "2", "3", "4", "5+"] as const;
export const kGroup = (k: number): string => (k >= 5 ? "5+" : String(k));
