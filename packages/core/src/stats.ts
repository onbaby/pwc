/** Small numeric helpers (no dependencies). */

export function mean(xs: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i]!;
  return xs.length ? s / xs.length : NaN;
}

export function variance(xs: ArrayLike<number>): number {
  const m = mean(xs);
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += (xs[i]! - m) ** 2;
  return xs.length > 1 ? s / (xs.length - 1) : 0;
}

export function sd(xs: ArrayLike<number>): number {
  return Math.sqrt(variance(xs));
}

/** Quantile of a sorted array, linear interpolation (R type 7). */
export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0]!;
  const pos = Math.min(Math.max(q, 0), 1) * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, n - 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function quantile(xs: ArrayLike<number>, q: number): number {
  const s = Float64Array.from(xs as ArrayLike<number>).sort();
  return quantileSorted(s, q);
}

export function median(xs: ArrayLike<number>): number {
  return quantile(xs, 0.5);
}

/** Standard normal CDF (Abramowitz-Stegun 7.1.26 on erf, |err| < 1.5e-7). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Inverse standard normal CDF (Acklam's rational approximation, rel. err < 1.2e-9). */
export function normPpf(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - pl) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** Round to a fixed number of decimals (artifact stability). */
export function round(x: number, decimals = 6): number {
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}

/** Solve A x = y for a small symmetric positive-definite system (Gaussian elimination with partial pivoting). */
export function solveLinear(A: number[][], y: number[]): number[] {
  const n = y.length;
  const M = A.map((row, i) => [...row, y[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    if (Math.abs(M[piv]![col]!) < 1e-12) throw new Error("singular system");
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    for (let r = col + 1; r < n; r++) {
      const f = M[r]![col]! / M[col]![col]!;
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r]![n]!;
    for (let c = r + 1; c < n; c++) s -= M[r]![c]! * x[c]!;
    x[r] = s / M[r]![r]!;
  }
  return x;
}

/** Ordinary least squares via normal equations. X rows are feature vectors. */
export function ols(X: number[][], y: number[]): { beta: number[]; residualSd: number } {
  const p = X[0]!.length;
  const XtX = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const Xty = new Array<number>(p).fill(0);
  for (let i = 0; i < X.length; i++) {
    const row = X[i]!;
    for (let a = 0; a < p; a++) {
      Xty[a]! += row[a]! * y[i]!;
      for (let b = a; b < p; b++) XtX[a]![b]! += row[a]! * row[b]!;
    }
  }
  for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) XtX[a]![b] = XtX[b]![a]!;
  const beta = solveLinear(XtX, Xty);
  let ss = 0;
  for (let i = 0; i < X.length; i++) {
    let pred = 0;
    for (let a = 0; a < p; a++) pred += beta[a]! * X[i]![a]!;
    ss += (y[i]! - pred) ** 2;
  }
  return { beta, residualSd: Math.sqrt(ss / Math.max(X.length - p, 1)) };
}
