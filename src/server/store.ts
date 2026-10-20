import { ENGINE, RULES } from "../shared/constants.ts";
import { dayFromISO, etInstant, etParts, isoFromDay, type Day } from "../shared/dates.ts";
import { hash32 } from "../shared/rng.ts";
import { computeProjection, type CustomerContext, type EngineEnv, type Projection } from "../engine/project.ts";
import type { PriorModel } from "../engine/prior.ts";
import type { CustomerRow, SignupAnswers } from "../shared/types.ts";
import { all, get, getSetting, run, setSetting, type Db } from "./db.ts";

/** The sandbox clock (spec 6): one clock for everyone, an instant in America/New_York, stored in `settings`. */
export const SANDBOX_START = (): number => etInstant(dayFromISO("2026-10-18"), 9, 0);

export function nowMs(db: Db): number {
  return getSetting<number>(db, "clock", SANDBOX_START());
}

export function setNow(db: Db, ms: number): void {
  setSetting(db, "clock", ms);
}

export const todayOf = (db: Db): Day => etParts(nowMs(db)).day;

export const GLOBAL_SEED = 20_261_018;

export function getEnv(db: Db): EngineEnv {
  const prior = getSetting<PriorModel | null>(db, "prior", null);
  if (!prior) throw new Error("the sandbox has no prior: run `pnpm seed` (or boot the demo, which seeds on first start)");
  const cautiousness = getSetting<keyof typeof ENGINE.cautiousness>(db, "cautiousness", ENGINE.defaultCautiousness);
  return { prior, seed: GLOBAL_SEED, freeze: { from: dayFromISO(RULES.freezeFromISO), to: dayFromISO(RULES.freezeToISO) }, cautiousness };
}

export function customerRow(db: Db, id: string): CustomerRow | undefined {
  return get<CustomerRow>(db, "SELECT * FROM customers WHERE id = ?", id);
}

export const answersOf = (c: CustomerRow): SignupAnswers => JSON.parse(c.signup_answers) as SignupAnswers;

/** Next scheduled (not yet delivered) delivery date, or undefined. */
export function nextScheduled(db: Db, id: string): { id: number; day: Day } | undefined {
  const r = get<{ id: number; scheduled_date: string }>(db, "SELECT id, scheduled_date FROM deliveries WHERE customer_id = ? AND status = 'scheduled' ORDER BY scheduled_date LIMIT 1", id);
  return r ? { id: r.id, day: dayFromISO(r.scheduled_date) } : undefined;
}

export function deliveredDays(db: Db, id: string, today: Day): Day[] {
  return all<{ delivered_date: string }>(db, "SELECT delivered_date FROM deliveries WHERE customer_id = ? AND status = 'delivered' AND delivered_date <= ? ORDER BY delivered_date", id, isoFromDay(today)).map((r) => dayFromISO(r.delivered_date));
}

/** The customer's event log as the engine reads it. */
export function loadContext(db: Db, id: string, today: Day): CustomerContext {
  const c = customerRow(db, id);
  if (!c) throw new Error(`no customer ${id}`);
  const ans = answersOf(c);
  const events = all<{ at: number; type: string; data: string }>(db, "SELECT at, type, data FROM events WHERE customer_id = ? AND type IN ('reply','skip','hold') ORDER BY at, id", id);
  const replies: CustomerContext["replies"] = [];
  const skips: Day[] = [];
  const holds: CustomerContext["holds"] = [];
  for (const e of events) {
    const d = JSON.parse(e.data) as { weeks?: number; from?: number; to?: number; day?: number };
    const day = d.day ?? etParts(e.at).day;
    if (day > today) continue;
    if (e.type === "reply") replies.push({ day, weeks: d.weeks ?? 0 });
    else if (e.type === "skip") skips.push(day);
    else if (e.type === "hold" && d.from !== undefined && d.to !== undefined) holds.push({ from: d.from, to: d.to });
  }
  const delivered = deliveredDays(db, id, today);
  const last = delivered.length ? Math.max(...delivered) : today;
  const next = nextScheduled(db, id);
  const baseArrival = c.base_arrival ? dayFromISO(c.base_arrival) : next ? next.day : last + c.plan_cadence_days;
  // a reply in either of the two cycles before this one
  const prevReplies = replies.filter((r) => r.day < last);
  const twoCyclesBack = delivered.length >= 3 ? delivered[delivered.length - 3]! : -Infinity;
  const failedLastText = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM messages WHERE customer_id = ? AND direction = 'out' AND status = 'failed' AND at > ?", id, nowMs(db) - 30 * 86_400_000)?.n ?? 0;
  return {
    id,
    name: c.name,
    source: c.source,
    planType: c.plan_type,
    rhythmDays: c.plan_cadence_days,
    cups: ans.cups,
    people: ans.people,
    brew: ans.brew,
    deliveredDays: delivered,
    replies,
    skips,
    holds,
    baseArrival,
    proposalCount: c.proposal_count,
    deliveredReceipt: failedLastText === 0,
    repliedInPreviousTwoCycles: prevReplies.some((r) => r.day >= twoCyclesBack),
  };
}

/** A cheap fingerprint of everything that changes a customer's projection. */
export function eventsHash(db: Db, id: string, today: Day): string {
  const c = customerRow(db, id);
  if (!c) return "";
  const ev = get<{ n: number; m: number | null }>(db, "SELECT COUNT(*) AS n, MAX(id) AS m FROM events WHERE customer_id = ? AND type IN ('reply','skip','hold')", id);
  const dl = get<{ n: number; m: string | null }>(db, "SELECT COUNT(*) AS n, MAX(delivered_date) AS m FROM deliveries WHERE customer_id = ? AND status = 'delivered' AND delivered_date <= ?", id, isoFromDay(today));
  return String(hash32(id, today, ev?.n ?? 0, ev?.m ?? 0, dl?.n ?? 0, dl?.m ?? "", c.base_arrival ?? "", c.plan_type, c.proposal_count, c.plan_cadence_days));
}

const seedOf = (env: EngineEnv, id: string): number => hash32(env.seed, id);

export function writeProjection(db: Db, id: string, p: Projection, hash: string): void {
  run(db, "INSERT INTO projections(customer_id, computed_at, as_of_day, engine_version, events_hash, json) VALUES(?,?,?,?,?,?) ON CONFLICT(customer_id) DO UPDATE SET computed_at=excluded.computed_at, as_of_day=excluded.as_of_day, engine_version=excluded.engine_version, events_hash=excluded.events_hash, json=excluded.json", id, p.computedAt, p.asOfDay, p.engineVersion, hash, JSON.stringify(p));
}

/**
 * The stored projection, recomputed if the engine version, the clock day or the customer's event log changed (spec 7.2).
 * `whatIf` always recomputes (a dozen extra runs: for one customer's profile, not for the whole base).
 */
export function projectionOf(db: Db, id: string, opts: { whatIf?: boolean; force?: boolean } = {}): Projection {
  const env = getEnv(db);
  const today = todayOf(db);
  const hash = eventsHash(db, id, today);
  if (!opts.whatIf && !opts.force) {
    const row = get<{ json: string; engine_version: string; events_hash: string; as_of_day: number }>(db, "SELECT json, engine_version, events_hash, as_of_day FROM projections WHERE customer_id = ?", id);
    if (row && row.engine_version === ENGINE.version && row.events_hash === hash && row.as_of_day === today) return JSON.parse(row.json) as Projection;
  }
  const ctx = loadContext(db, id, today);
  const p = computeProjection(ctx, env, today, nowMs(db), seedOf(env, id), { whatIf: opts.whatIf });
  writeProjection(db, id, p, hash);
  return p;
}

export function recomputeAll(db: Db, onlyStale = true): number {
  const env = getEnv(db);
  const today = todayOf(db);
  const ids = all<{ id: string }>(db, "SELECT id FROM customers WHERE status NOT IN ('CANCELLED')").map((r) => r.id);
  let n = 0;
  for (const id of ids) {
    const hash = eventsHash(db, id, today);
    if (onlyStale) {
      const row = get<{ engine_version: string; events_hash: string; as_of_day: number }>(db, "SELECT engine_version, events_hash, as_of_day FROM projections WHERE customer_id = ?", id);
      if (row && row.engine_version === ENGINE.version && row.events_hash === hash && row.as_of_day === today) continue;
    }
    const p = computeProjection(loadContext(db, id, today), env, today, nowMs(db), seedOf(env, id), {});
    writeProjection(db, id, p, hash);
    n++;
  }
  return n;
}

export function audit(db: Db, actor: string, action: string, customerId: string | null, data: unknown = {}): void {
  run(db, "INSERT INTO audit_log(at, actor, action, customer_id, data) VALUES(?,?,?,?,?)", nowMs(db), actor, action, customerId, JSON.stringify(data));
}

export function addEvent(db: Db, customerId: string, type: string, data: unknown, at = nowMs(db)): void {
  run(db, "INSERT INTO events(customer_id, at, type, data) VALUES(?,?,?,?)", customerId, at, type, JSON.stringify(data));
}

export function seedFor(env: EngineEnv, id: string): number {
  return seedOf(env, id);
}
