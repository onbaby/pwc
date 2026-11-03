import { ARM_LABEL, PILOT, type Arm } from "../shared/pilot.ts";
import { RULES, SOURCE_LABEL, SOURCES } from "../shared/constants.ts";
import { dayFromISO, etParts, MS_DAY } from "../shared/dates.ts";
import { all, get, getSetting, type Db } from "./db.ts";
import { qrSummary } from "./qr.ts";
import { nowMs } from "./store.ts";

/**
 * The deck's A/B pilot, read from the live database: who is in each arm, the three measures (cancellations, revenue per
 * subscriber, freshness complaints), the QR measures, and where the month-3 stop rule stands. Nothing here is a constant
 * except the rule itself; the sandbox's sample data builds in no difference between the arms.
 */

const ARMS: Arm[] = ["ai", "fixed"];

interface ArmStats {
  arm: Arm;
  label: string;
  enrolled: number;
  active: number;
  cancelled: number;
  cancelRate: number | null;
  revenuePerSubscriber: number | null;
  bagsDelivered: number;
  complaints: number;
  complaintsPer100Bags: number | null;
  /** AI arm only: texts and moves; the control arm gets none by design */
  checkIns: number;
  replied: number;
  moves: number;
  bySource: Record<string, number>;
}

function armStats(db: Db, arm: Arm, now: number): ArmStats {
  const one = <T>(sql: string, ...p: Array<string | number>) => get<T>(db, sql, ...p)!;
  const enrolled = one<{ n: number }>("SELECT COUNT(*) AS n FROM customers WHERE arm = ?", arm).n;
  const cancelled = one<{ n: number }>("SELECT COUNT(*) AS n FROM customers WHERE arm = ? AND status = 'CANCELLED'", arm).n;
  const rev = one<{ revenue: number | null; bags: number }>("SELECT SUM(d.price) AS revenue, COUNT(*) AS bags FROM deliveries d JOIN customers c ON c.id = d.customer_id WHERE c.arm = ? AND d.status = 'delivered'", arm);
  const complaints = one<{ n: number }>("SELECT COUNT(*) AS n FROM events e JOIN customers c ON c.id = e.customer_id WHERE c.arm = ? AND e.type = 'freshness_complaint'", arm).n;
  // only a customer who has had a delivery can describe a pantry, so a first-timer's check-in is not counted against the rate
  const hasHad = "EXISTS (SELECT 1 FROM deliveries d WHERE d.customer_id = m.customer_id AND d.status = 'delivered')";
  const checkIns = one<{ n: number }>(`SELECT COUNT(DISTINCT m.customer_id) AS n FROM messages m JOIN customers c ON c.id = m.customer_id WHERE c.arm = ? AND m.kind = 'checkin' AND m.direction = 'out' AND m.status IN ('sent','delivered') AND m.at <= ? AND ${hasHad}`, arm, now).n;
  const replied = one<{ n: number }>(
    `SELECT COUNT(DISTINCT m.customer_id) AS n FROM messages m JOIN customers c ON c.id = m.customer_id
       JOIN messages r ON r.customer_id = m.customer_id AND r.direction = 'in' AND r.reason_code = 'WEEKS_LEFT' AND r.at > m.at AND r.at <= m.at + ?
      WHERE c.arm = ? AND m.kind = 'checkin' AND m.direction = 'out' AND m.status IN ('sent','delivered') AND m.at <= ? AND ${hasHad}`,
    5 * MS_DAY,
    arm,
    now,
  ).n;
  const moves = one<{ n: number }>("SELECT COUNT(*) AS n FROM events e JOIN customers c ON c.id = e.customer_id WHERE c.arm = ? AND e.type = 'move'", arm).n;
  const bySource: Record<string, number> = {};
  for (const s of SOURCES) bySource[s] = one<{ n: number }>("SELECT COUNT(*) AS n FROM customers WHERE arm = ? AND source = ?", arm, s).n;
  return {
    arm,
    label: ARM_LABEL[arm],
    enrolled,
    active: enrolled - cancelled,
    cancelled,
    cancelRate: enrolled ? cancelled / enrolled : null,
    revenuePerSubscriber: enrolled ? (rev.revenue ?? 0) / enrolled : null,
    bagsDelivered: rev.bags,
    complaints,
    complaintsPer100Bags: rev.bags ? (complaints / rev.bags) * 100 : null,
    checkIns,
    replied,
    moves,
    bySource,
  };
}

export type StopRuleState = "too_early" | "below_control" | "not_below_control";

export function pilotSummary(db: Db) {
  const now = nowMs(db);
  const today = etParts(now).day;
  const startIso = getSetting<string>(db, "pilotStart", "");
  const start = startIso ? dayFromISO(startIso) : today;
  const week = Math.max(1, Math.floor((today - start) / 7) + 1);
  const [ai, fixed] = ARMS.map((a) => armStats(db, a, now)) as [ArmStats, ArmStats];
  const outside = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM customers WHERE arm IS NULL AND status != 'CANCELLED'")?.n ?? 0;

  let state: StopRuleState = "too_early";
  if (week >= PILOT.weeks && ai.cancelRate !== null && fixed.cancelRate !== null) state = ai.cancelRate < fixed.cancelRate ? "below_control" : "not_below_control";
  const diff = ai.cancelRate !== null && fixed.cancelRate !== null ? ai.cancelRate - fixed.cancelRate : null;
  // how far a gap this size can move by chance alone with this many people (95%, two proportions)
  const margin = diff === null ? null : 1.96 * Math.sqrt((ai.cancelRate! * (1 - ai.cancelRate!)) / ai.enrolled + (fixed.cancelRate! * (1 - fixed.cancelRate!)) / fixed.enrolled);

  const managed = (cond: string) =>
    get<{ n: number }>(db, `SELECT COUNT(DISTINCT m.customer_id) AS n FROM messages m JOIN customers c ON c.id = m.customer_id WHERE m.kind = 'checkin' AND m.direction = 'out' AND m.status IN ('sent','delivered') AND m.at >= ? AND m.at <= ? AND (c.arm IS NULL OR c.arm = 'ai') AND EXISTS (SELECT 1 FROM deliveries d WHERE d.customer_id = m.customer_id AND d.status = 'delivered') ${cond}`, now - 14 * MS_DAY, now)?.n ?? 0;
  const managedAsked = managed("");
  const managedReplied = get<{ n: number }>(
    db,
    `SELECT COUNT(DISTINCT m.customer_id) AS n FROM messages m JOIN customers c ON c.id = m.customer_id
       JOIN messages r ON r.customer_id = m.customer_id AND r.direction = 'in' AND r.reason_code = 'WEEKS_LEFT' AND r.at > m.at AND r.at <= m.at + ?
      WHERE m.kind = 'checkin' AND m.direction = 'out' AND m.status IN ('sent','delivered') AND m.at >= ? AND m.at <= ? AND (c.arm IS NULL OR c.arm = 'ai') AND EXISTS (SELECT 1 FROM deliveries d WHERE d.customer_id = m.customer_id AND d.status = 'delivered')`,
    5 * MS_DAY,
    now - 14 * MS_DAY,
    now,
  )?.n ?? 0;
  const q = qrSummary(db);
  return {
    start,
    week,
    totalWeeks: PILOT.weeks,
    arms: { ai, fixed },
    outsideTest: outside,
    stopRule: {
      atWeek: PILOT.weeks,
      state,
      weeksLeft: Math.max(PILOT.weeks - week, 0),
      cancelDiffPoints: diff === null ? null : diff * 100,
      cancelMarginPoints: margin === null ? null : margin * 100,
      text: "If AI-timed subscribers are not cancelling less than the control group by the end of month 3, turn it off.",
    },
    replyBar: RULES.pilotMinReplyRate,
    /** every customer the console is texting (the AI arm plus those who joined earlier), last 14 days: the same count as Today's tile */
    managedReply: { asked: managedAsked, replied: managedReplied },
    qr: { bags: q.totals.bags, scans: q.totals.scans, scansPerBag: q.totals.scanRate, signups: q.totals.signups, scanToSubscribe: q.totals.signupRate, accounts: q.pilot.accounts },
    sources: SOURCES.map((s) => ({ key: s, label: SOURCE_LABEL[s] })),
  };
}
