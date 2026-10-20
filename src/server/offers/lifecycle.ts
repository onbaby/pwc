import { RULES } from "../../shared/constants.ts";
import { etParts, MS_DAY, type Day } from "../../shared/dates.ts";
import { all, get, run, type Db } from "../db.ts";
import { audit, nowMs } from "../store.ts";
import type { AppCtx } from "../flows/context.ts";
import { queueReminder } from "../flows/schedule.ts";
import { breakEven, estimateFirstRead, evaluate, meanAov, sampleMessage, sampleSizePerGroup, validateAudience, type Evaluation } from "./eligibility.ts";
import { sensorCheck } from "./guardrails.ts";
import { DEFAULT_CAPS, OFFER_TYPES, type Audience, type OfferDraft, type OfferRow, type OfferStatus } from "./types.ts";
import type { OfferType } from "./assign.ts";
import type { Source } from "../../shared/constants.ts";

export const parseAudience = (row: OfferRow): Audience => JSON.parse(row.audience) as Audience;

export function createOffer(ctx: AppCtx, d: OfferDraft): number {
  const r = run(
    ctx.db,
    "INSERT INTO offers(name, type, family, status, audience, holdout_mode, holdout_pct, caps, approval_required, budget, discount_pct, template, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    d.name,
    d.type,
    d.type,
    "Draft",
    JSON.stringify(d.audience),
    d.holdoutMode,
    d.holdoutPct,
    JSON.stringify({ ...DEFAULT_CAPS, ...d.caps }),
    d.approvalRequired || OFFER_TYPES[d.type].discount ? 1 : 0,
    d.budget,
    OFFER_TYPES[d.type].discount ? d.discountPct || 10 : 0,
    OFFER_TYPES[d.type].template,
    nowMs(ctx.db),
  );
  audit(ctx.db, "Jordan · Subscriptions", "offer_create", null, { offerId: r.lastInsertRowid, name: d.name });
  ctx.emit({ type: "offer", offerId: r.lastInsertRowid });
  return r.lastInsertRowid;
}

export function updateOffer(ctx: AppCtx, id: number, d: OfferDraft): { ok: true } | { ok: false; error: string } {
  const row = get<OfferRow>(ctx.db, "SELECT * FROM offers WHERE id = ?", id);
  if (!row) return { ok: false, error: "No such offer." };
  if (row.status !== "Draft" && row.status !== "Paused") return { ok: false, error: `A ${row.status.toLowerCase()} offer can't be edited. Pause it first.` };
  run(ctx.db, "UPDATE offers SET name = ?, type = ?, family = ?, audience = ?, holdout_mode = ?, holdout_pct = ?, caps = ?, approval_required = ?, budget = ?, discount_pct = ?, template = ? WHERE id = ?", d.name, d.type, d.type, JSON.stringify(d.audience), d.holdoutMode, d.holdoutPct, JSON.stringify({ ...DEFAULT_CAPS, ...d.caps }), d.approvalRequired || OFFER_TYPES[d.type].discount ? 1 : 0, d.budget, OFFER_TYPES[d.type].discount ? d.discountPct || 10 : 0, OFFER_TYPES[d.type].template, id);
  ctx.emit({ type: "offer", offerId: id });
  return { ok: true };
}

export interface Preview {
  matching: number;
  eligible: number;
  excluded: Evaluation["excluded"];
  treatment: number;
  holdout: number;
  sample: { name: string; body: string } | null;
  breakEven: ReturnType<typeof breakEven>;
  sampleSizePerGroup: number;
  firstRead: { perGroupNeeded: number; perGroupNow: number; estimate: string; months: number };
  sensorNote: string;
  errors: string[];
}

export function previewOffer(db: Db, d: OfferDraft, offerId?: number): Preview {
  const errors = validateAudience(d);
  const ev = evaluate(db, { type: d.type, audience: d.audience, holdoutMode: d.holdoutMode, holdoutPct: d.holdoutPct }, { offerId });
  const sources = ev.eligible.length
    ? (all<{ source: Source }>(db, `SELECT source FROM customers WHERE id IN (${ev.eligible.map(() => "?").join(",")})`, ...ev.eligible).map((r) => r.source) as Source[])
    : ((d.audience.sources ?? (d.type === "gift_to_own" ? ["gift"] : ["in_cafe"])) as Source[]);
  const aov = meanAov(sources.length ? sources : (["in_cafe"] as Source[]));
  const fr = estimateFirstRead(ev.eligible.length, d.audience, d.holdoutMode, etParts(nowMs(db)).day);
  return {
    matching: ev.matching,
    eligible: ev.eligible.length,
    excluded: ev.excluded,
    treatment: ev.treatment.length,
    holdout: ev.holdout.length,
    sample: sampleMessage(db, ev.treatment[0] ?? ev.eligible[0], d.type, OFFER_TYPES[d.type].discount ? d.discountPct || 10 : 0),
    breakEven: breakEven(d.type, OFFER_TYPES[d.type].discount ? d.discountPct || 10 : 0, aov),
    sampleSizePerGroup: sampleSizePerGroup(),
    firstRead: { perGroupNeeded: fr.perGroupNeeded, perGroupNow: fr.perGroupNow, estimate: fr.estimate, months: fr.months },
    sensorNote: "Paused automatically if STOP or NO OFFERS replies exceed 2% of sends, or if opt-outs or check-in replies move against the holdout.",
    errors,
  };
}

export function draftOf(row: OfferRow): OfferDraft {
  return { name: row.name, type: row.type, audience: parseAudience(row), holdoutMode: row.holdout_mode, holdoutPct: row.holdout_pct, discountPct: row.discount_pct, budget: row.budget, approvalRequired: !!row.approval_required, caps: JSON.parse(row.caps) };
}

/** Schedule an offer: assign every eligible customer to an arm (sticky per offer family) and put the line on their next reminder. */
export function scheduleOffer(ctx: AppCtx, id: number): { ok: true; status: OfferStatus; assigned: number } | { ok: false; error: string } {
  const db = ctx.db;
  const row = get<OfferRow>(db, "SELECT * FROM offers WHERE id = ?", id);
  if (!row) return { ok: false, error: "No such offer." };
  if (row.status !== "Draft" && row.status !== "Paused") return { ok: false, error: `This offer is already ${row.status.toLowerCase()}.` };
  const d = draftOf(row);
  const errors = validateAudience(d);
  if (errors.length) return { ok: false, error: errors.join(" ") };
  if (row.approval_required && row.status !== "Paused") {
    run(db, "UPDATE offers SET status = 'Pending approval', scheduled_at = ? WHERE id = ?", nowMs(db), id);
    audit(db, "Jordan · Subscriptions", "offer_submit", null, { offerId: id });
    ctx.emit({ type: "offer", offerId: id });
    return { ok: true, status: "Pending approval", assigned: 0 };
  }
  return activate(ctx, id);
}

export function approveOffer(ctx: AppCtx, id: number): { ok: true; status: OfferStatus; assigned: number } | { ok: false; error: string } {
  const row = get<OfferRow>(ctx.db, "SELECT * FROM offers WHERE id = ?", id);
  if (!row || row.status !== "Pending approval") return { ok: false, error: "Nothing to approve." };
  audit(ctx.db, "Jordan · Subscriptions", "offer_approve", null, { offerId: id });
  return activate(ctx, id);
}

function activate(ctx: AppCtx, id: number): { ok: true; status: OfferStatus; assigned: number } {
  const db = ctx.db;
  const row = get<OfferRow>(db, "SELECT * FROM offers WHERE id = ?", id)!;
  const d = draftOf(row);
  const ev = evaluate(db, { type: d.type, audience: d.audience, holdoutMode: d.holdoutMode, holdoutPct: d.holdoutPct }, { offerId: id });
  const now = nowMs(db);
  const max = d.caps?.maxRecipients ?? 0;
  const treatment = max > 0 ? ev.treatment.slice(0, max) : ev.treatment;
  const ins = db.prepare("INSERT OR IGNORE INTO offer_assignments(offer_id, customer_id, family, arm, assigned_at) VALUES (?,?,?,?,?)");
  const mem = db.prepare("INSERT OR IGNORE INTO experiment_membership(customer_id, offer_id, family, started_at, outcome_closes_at) VALUES (?,?,?,?,?)");
  for (const c of treatment) ins.run(id, c, row.family, "treatment", now);
  for (const c of ev.holdout) ins.run(id, c, row.family, "holdout", now);
  if (d.holdoutMode === "experiment") for (const c of [...treatment, ...ev.holdout]) mem.run(c, id, row.family, now, now + RULES.experimentOutcomeDays * MS_DAY);
  run(db, "UPDATE offers SET status = 'Scheduled', scheduled_at = ?, paused_reason = NULL WHERE id = ?", now, id);
  // put the offer line on each treatment customer's queued reminder (never a new text)
  for (const c of treatment) {
    const next = get<{ scheduled_date: string }>(db, "SELECT scheduled_date FROM deliveries WHERE customer_id = ? AND status = 'scheduled' LIMIT 1", c);
    if (next) queueReminder(ctx, c, Math.floor(Date.parse(next.scheduled_date + "T00:00:00Z") / MS_DAY));
  }
  audit(db, "Jordan · Subscriptions", "offer_schedule", null, { offerId: id, treatment: treatment.length, holdout: ev.holdout.length });
  ctx.emit({ type: "offer", offerId: id });
  ctx.emit({ type: "queue" });
  return { ok: true, status: "Scheduled", assigned: treatment.length + ev.holdout.length };
}

export function pauseOffer(ctx: AppCtx, id: number, reason: string, actor = "Jordan · Subscriptions"): { ok: true } | { ok: false; error: string } {
  const db = ctx.db;
  const row = get<OfferRow>(db, "SELECT * FROM offers WHERE id = ?", id);
  if (!row) return { ok: false, error: "No such offer." };
  if (row.status !== "Scheduled" && row.status !== "Running") return { ok: false, error: "Only a scheduled or running offer can be paused." };
  run(db, "UPDATE offers SET status = 'Paused', paused_reason = ? WHERE id = ?", reason, id);
  // unsent offer lines come off the queued reminders
  const unsent = all<{ customer_id: string }>(db, "SELECT customer_id FROM offer_assignments WHERE offer_id = ? AND message_id IS NULL AND arm = 'treatment'", id);
  run(db, "DELETE FROM offer_assignments WHERE offer_id = ? AND message_id IS NULL", id);
  for (const u of unsent) {
    const next = get<{ scheduled_date: string }>(db, "SELECT scheduled_date FROM deliveries WHERE customer_id = ? AND status = 'scheduled' LIMIT 1", u.customer_id);
    if (next) queueReminder(ctx, u.customer_id, Math.floor(Date.parse(next.scheduled_date + "T00:00:00Z") / MS_DAY));
  }
  audit(db, actor, "offer_pause", null, { offerId: id, reason });
  ctx.emit({ type: "offer", offerId: id });
  ctx.emit({ type: "queue" });
  return { ok: true };
}

// ---- results (spec 8.5): counts and guardrails only until the pre-set sample size is reached -------------------------

export interface OfferResults {
  sends: number;
  accepted: number;
  acceptRate: number | null;
  optOuts7d: number;
  optOutShare: number | null;
  holdoutAssigned: number;
  treatmentAssigned: number;
  nextCheckIn: { treatment: { reached: number; replied: number; rate: number | null }; holdout: { reached: number; replied: number; rate: number | null } };
  perGroup: number;
  perGroupNeeded: number;
  statusLine: string;
  readReady: boolean;
  sandboxNote: string;
}

export function offerResults(db: Db, id: number): OfferResults {
  const row = get<OfferRow>(db, "SELECT * FROM offers WHERE id = ?", id);
  const d = row ? draftOf(row) : undefined;
  const sends = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM offer_assignments WHERE offer_id = ? AND message_id IS NOT NULL", id)?.n ?? 0;
  const accepted = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM offer_assignments WHERE offer_id = ? AND accepted_at IS NOT NULL", id)?.n ?? 0;
  const tAssigned = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM offer_assignments WHERE offer_id = ? AND arm = 'treatment'", id)?.n ?? 0;
  const hAssigned = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM offer_assignments WHERE offer_id = ? AND arm = 'holdout'", id)?.n ?? 0;
  const optOuts = get<{ n: number }>(
    db,
    `SELECT COUNT(DISTINCT a.customer_id) AS n FROM offer_assignments a
       JOIN messages o ON o.id = a.message_id
       JOIN messages i ON i.customer_id = a.customer_id AND i.direction = 'in' AND i.reason_code IN ('KEYWORD_STOP','KEYWORD_NO_OFFERS') AND i.at >= o.at AND i.at <= o.at + ?
      WHERE a.offer_id = ?`,
    7 * MS_DAY,
    id,
  )?.n ?? 0;
  const checkIn = (a: "treatment" | "holdout") => {
    const reached = get<{ n: number }>(db, `SELECT COUNT(DISTINCT a.customer_id) AS n FROM offer_assignments a JOIN messages m ON m.customer_id = a.customer_id AND m.kind = 'checkin' AND m.direction = 'out' AND m.status IN ('sent','delivered') AND m.at > a.assigned_at WHERE a.offer_id = ? AND a.arm = ?`, id, a)?.n ?? 0;
    const replied = get<{ n: number }>(db, `SELECT COUNT(DISTINCT a.customer_id) AS n FROM offer_assignments a JOIN messages m ON m.customer_id = a.customer_id AND m.kind = 'checkin' AND m.direction = 'out' AND m.status IN ('sent','delivered') AND m.at > a.assigned_at JOIN messages r ON r.customer_id = a.customer_id AND r.direction = 'in' AND r.reason_code = 'WEEKS_LEFT' AND r.at > m.at AND r.at <= m.at + ? WHERE a.offer_id = ? AND a.arm = ?`, 5 * MS_DAY, id, a)?.n ?? 0;
    return { reached, replied, rate: reached ? replied / reached : null };
  };
  const needed = sampleSizePerGroup();
  const perGroup = d?.holdoutMode === "experiment" ? Math.min(sends, hAssigned) : sends;
  const today = etParts(nowMs(db)).day;
  const fr = d ? estimateFirstRead(tAssigned + hAssigned, d.audience, d.holdoutMode, today) : undefined;
  return {
    sends,
    accepted,
    acceptRate: sends ? accepted / sends : null,
    optOuts7d: optOuts,
    optOutShare: sends ? optOuts / sends : null,
    holdoutAssigned: hAssigned,
    treatmentAssigned: tAssigned,
    nextCheckIn: { treatment: checkIn("treatment"), holdout: checkIn("holdout") },
    perGroup,
    perGroupNeeded: needed,
    statusLine: fr ? fr.statusLine(perGroup) : "Collecting data",
    readReady: perGroup >= needed,
    sandboxNote: "Sandbox: offer outcomes are never simulated. Counts are real events in this database; benefit intervals appear only at the pre-set sample size.",
  };
}

/** Daily sensor-protection check for every running offer (spec 8.3). Returns the offers it paused. */
export function runSensorChecks(ctx: AppCtx): number[] {
  const db = ctx.db;
  const paused: number[] = [];
  for (const o of all<OfferRow>(db, "SELECT * FROM offers WHERE status IN ('Scheduled','Running')")) {
    const r = offerResults(db, o.id);
    const tAll = get<{ n: number; opt: number }>(db, `SELECT COUNT(*) AS n, SUM(CASE WHEN EXISTS (SELECT 1 FROM messages i WHERE i.customer_id = a.customer_id AND i.direction = 'in' AND i.reason_code IN ('KEYWORD_STOP','KEYWORD_NO_OFFERS') AND i.at >= a.assigned_at) THEN 1 ELSE 0 END) AS opt FROM offer_assignments a WHERE a.offer_id = ? AND a.arm = 'treatment' AND a.message_id IS NOT NULL`, o.id);
    const hAll = get<{ n: number; opt: number }>(db, `SELECT COUNT(*) AS n, SUM(CASE WHEN EXISTS (SELECT 1 FROM messages i WHERE i.customer_id = a.customer_id AND i.direction = 'in' AND i.reason_code IN ('KEYWORD_STOP','KEYWORD_NO_OFFERS') AND i.at >= a.assigned_at) THEN 1 ELSE 0 END) AS opt FROM offer_assignments a WHERE a.offer_id = ? AND a.arm = 'holdout'`, o.id);
    const v = sensorCheck({
      sends: r.sends,
      optOuts7d: r.optOuts7d,
      treatment: { n: tAll?.n ?? 0, optOuts: tAll?.opt ?? 0, reachedCheckIn: r.nextCheckIn.treatment.reached, replied: r.nextCheckIn.treatment.replied },
      holdout: { n: hAll?.n ?? 0, optOuts: hAll?.opt ?? 0, reachedCheckIn: r.nextCheckIn.holdout.reached, replied: r.nextCheckIn.holdout.replied },
    });
    if (v.pause) {
      pauseOffer(ctx, o.id, v.reason ?? "Sensor protection", "sensor-protection rule");
      paused.push(o.id);
    }
  }
  return paused;
}

export function listOffers(db: Db): Array<{ row: OfferRow; results: OfferResults }> {
  return all<OfferRow>(db, "SELECT * FROM offers ORDER BY id DESC").map((row) => ({ row, results: offerResults(db, row.id) }));
}

export type { Day, OfferType };
