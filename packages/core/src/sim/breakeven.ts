import { SIM } from "../constants.ts";

/**
 * Model-free break-even (spec 5.2.5): if Paced ships a share `x` fewer deliveries per active subscriber-year, how much
 * 12-month retention must it keep to match Fixed on year-one shipped gross profit?
 *
 * Piecewise-constant hazards are fitted to the two Exhibit C points (days 0-89 and 90-364). Find the hazard scaling s with
 *   (1 - x - c) SubYears(s) = SubYears(1),
 * where c is the program cost as a share of gross profit per active year (0 for the "before cost" version).
 *
 * Deviation from the v2 spec, on purpose: s scales only the hazard from day 90 on. Nothing is ever moved before a
 * subscriber's second completed delivery (spec 6.3 eligibility), so the first 90 days cannot change; scaling them too
 * (the literal "hazard scaling") understated the retention needed, and the bars then disagreed with the profit line.
 */
export interface BreakEven {
  scale: number;
  requiredRet12: number;
  requiredGainPP: number;
}

const FIRST_SEGMENT_DAYS = 90;

export function requiredRetention(
  x: number,
  base: { ret90: number; ret12: number },
  net?: { programCostPerSubYear: number; gpPerActiveYearUSD: number },
): BreakEven {
  const h1 = -Math.log(base.ret90) / FIRST_SEGMENT_DAYS;
  const h2 = -Math.log(base.ret12 / base.ret90) / (SIM.horizonDays - FIRST_SEGMENT_DAYS);
  const subYears = (s: number): number => {
    let cum = 0;
    let acc = 0;
    for (let t = 0; t < SIM.horizonDays; t++) {
      acc += Math.exp(-cum);
      cum += t < FIRST_SEGMENT_DAYS ? h1 : s * h2;
    }
    return acc / SIM.horizonDays;
  };
  const sy1 = subYears(1);
  const costShare = net ? net.programCostPerSubYear / net.gpPerActiveYearUSD : 0;
  const factor = 1 - x - costShare;
  const target = factor > 0 ? sy1 / factor : Infinity;
  let lo = 0;
  let hi = 6;
  let scale: number;
  if (!Number.isFinite(target) || target >= subYears(0)) {
    scale = 0; // even keeping everyone after day 90 is not enough: the bar is "everyone"
  } else {
    for (let it = 0; it < 80; it++) {
      const mid = (lo + hi) / 2;
      if (subYears(mid) > target) lo = mid;
      else hi = mid;
    }
    scale = (lo + hi) / 2;
  }
  const requiredRet12 = base.ret90 * Math.exp(-scale * h2 * (SIM.horizonDays - FIRST_SEGMENT_DAYS));
  return { scale, requiredRet12, requiredGainPP: (requiredRet12 - base.ret12) * 100 };
}
