import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { computeOutlook, type OutlookCustomer } from "../engine/outlook.ts";
import type { Projection } from "../engine/project.ts";
import { ENGINE, FRESHNESS, QR, RULES, SOURCE_LABEL, SOURCES, WORLD, type Source } from "../shared/constants.ts";
import { dayFromISO, etInstant, etParts, fmtDay, fmtMonthDay, isoFromDay, MS_DAY, weekday, type Day } from "../shared/dates.ts";
import type { CustomerRow } from "../shared/types.ts";
import { COPY } from "./copy.ts";
import { all, get, getSetting, type Db } from "./db.ts";
import { approve, holdMessage, staffAction, type StaffAction } from "./flows/actions.ts";
import type { AppCtx } from "./flows/context.ts";
import { handleInbound } from "./flows/inbound.ts";
import { advanceClock } from "./flows/schedule.ts";
import { toDTO } from "./flows/send.ts";
import { approveOffer, createOffer, draftOf, listOffers, offerResults, parseAudience, pauseOffer, previewOffer, runSensorChecks, scheduleOffer, updateOffer } from "./offers/lifecycle.ts";
import { OFFER_TYPES, type OfferDraft, type OfferRow } from "./offers/types.ts";
import { buildProfile } from "./profile.ts";
import { lotPublic, qrSignup, qrSummary, recordScan } from "./qr.ts";
import { freshnessFromProjection, type FreshnessStatus } from "../engine/freshness.ts";
import { upcomingHolidayWindows } from "../shared/holidays.ts";
import { approvals, goingOutToday, listCustomers, needsPerson, runningOutSoon, viewCounts } from "./queries.ts";
import type { Sandbox } from "./sandbox.ts";
import type { Hub } from "./sse.ts";
import { customerRow, nextScheduled, nowMs, todayOf } from "./store.ts";

export interface ServerCtx {
  ctx: AppCtx;
  hub: Hub;
  sandbox?: Sandbox;
  artifactsDir: string;
  webDist: string;
  /** switch to the photon channel (sandbox drawer); returns false if it could not connect */
  connectPhoton?: () => Promise<boolean>;
}

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".map": "application/json" };


/** Hand-written guards at the untrusted boundary (spec 12.1): request bodies. */
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 2000): string | undefined => (typeof v === "string" && v.length <= max ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function parseDraft(b: unknown): OfferDraft | string {
  if (!isObj(b)) return "Expected an object.";
  const type = str(b.type) as OfferDraft["type"] | undefined;
  if (!type || !(type in OFFER_TYPES)) return "Choose an offer type.";
  const name = str(b.name, 120)?.trim();
  if (!name) return "Give the offer a name.";
  const aud = isObj(b.audience) ? b.audience : {};
  const sources = Array.isArray(aud.sources) ? (aud.sources.filter((s) => typeof s === "string" && (SOURCES as readonly string[]).includes(s)) as Source[]) : undefined;
  const audience: OfferDraft["audience"] = {
    sources: sources?.length ? sources : undefined,
    memberDaysMin: num(aud.memberDaysMin),
    memberDaysMax: num(aud.memberDaysMax),
    runOutMinDays: num(aud.runOutMinDays),
    runOutMaxDays: num(aud.runOutMaxDays),
    onHand: aud.onHand === "lt7" || aud.onHand === "lt14" || aud.onHand === "ge14" ? aud.onHand : undefined,
    lastReplyMaxWeeks: num(aud.lastReplyMaxWeeks),
    skipped2of4: aud.skipped2of4 === true ? true : undefined,
    giftEndingWithinDays: num(aud.giftEndingWithinDays),
    notStockpiled: aud.notStockpiled === true ? true : undefined,
  };
  const holdoutMode = b.holdoutMode === "experiment" || b.holdoutMode === "none" ? b.holdoutMode : "global";
  return { name, type, audience, holdoutMode, holdoutPct: Math.min(Math.max(num(b.holdoutPct) ?? 50, 0), 90), discountPct: Math.min(Math.max(num(b.discountPct) ?? 0, 0), 100), budget: Math.max(num(b.budget) ?? 0, 0), approvalRequired: b.approvalRequired === true };
}

function offerDTO(db: Db, row: OfferRow, results = offerResults(db, row.id)) {
  const draft = draftOf(row);
  const preview = row.status === "Draft" || row.status === "Pending approval" || row.status === "Paused" ? previewOffer(db, draft, row.id) : null;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    typeLabel: OFFER_TYPES[row.type].label,
    reason: OFFER_TYPES[row.type].reason,
    status: row.status,
    audience: parseAudience(row),
    holdoutMode: row.holdout_mode,
    holdoutPct: row.holdout_pct,
    discountPct: row.discount_pct,
    budget: row.budget,
    approvalRequired: !!row.approval_required,
    pausedReason: row.paused_reason,
    audienceSize: preview ? preview.eligible : results.treatmentAssigned + results.holdoutAssigned,
    holdout: row.holdout_mode === "experiment" ? `${row.holdout_pct}% experiment holdout` : row.holdout_mode === "global" ? "Standing 10% holdout" : "No holdout",
    sends: results.sends,
    statusLine: row.status === "Draft" ? "Not scheduled" : row.status === "Pending approval" ? "Waiting for manager approval" : results.statusLine,
    results,
  };
}

/** Monday-free week: Sunday through Saturday, containing `day`. */
const weekStart = (day: Day): Day => day - weekday(day);

function kpis(db: Db, today: Day, now: number, ctx: AppCtx) {
  const prevDay = today - 7;
  const prevNow = now - 7 * MS_DAY;
  const active = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM customers WHERE status != 'CANCELLED'")?.n ?? 0;
  const activePrev = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM customers WHERE signup_date <= ? AND (cancelled_at IS NULL OR cancelled_at > ?)", isoFromDay(prevDay), prevNow)?.n ?? 0;
  const ws = weekStart(today);
  const delivThis = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM deliveries WHERE scheduled_date >= ? AND scheduled_date <= ? AND status IN ('scheduled','delivered')", isoFromDay(ws), isoFromDay(ws + 6))?.n ?? 0;
  const delivPrev = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM deliveries WHERE scheduled_date >= ? AND scheduled_date <= ? AND status = 'delivered'", isoFromDay(ws - 7), isoFromDay(ws - 1))?.n ?? 0;
  const dayFrom = etInstant(today, 0, 0);
  const dayTo = etInstant(today + 1, 0, 0);
  const checkToday = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM messages WHERE kind = 'checkin' AND direction = 'out' AND at >= ? AND at < ? AND status IN ('queued','sent','delivered')", dayFrom, dayTo)?.n ?? 0;
  const checkPrev = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM messages WHERE kind = 'checkin' AND direction = 'out' AND at >= ? AND at < ? AND status IN ('sent','delivered')", etInstant(prevDay, 0, 0), etInstant(prevDay + 1, 0, 0))?.n ?? 0;
  const person = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM messages WHERE status = 'needs_person'")?.n ?? 0;
  const personPrev = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM messages WHERE status IN ('needs_person','resolved') AND at <= ? AND (resolved_at IS NULL OR resolved_at > ?)", prevNow, prevNow)?.n ?? 0;
  const o = outlook(db, ctx);
  return {
    freshness: freshnessKpi(db, today),
    active: { value: active, prev: activePrev },
    deliveriesThisWeek: { value: delivThis, prev: delivPrev, sparkline: o.weeks.map((w) => w.deliveries.p50), weeks: o.weeks.map((w) => w.wednesday) },
    checkInsToday: { value: checkToday, prev: checkPrev },
    waitingForPerson: { value: person, prev: personPrev },
  };
}

/** How fresh the bags arriving in the next four weeks will be when opened (model median), from stored projections. */
function freshnessKpi(db: Db, today: Day) {
  const rows = all<{ scheduled_date: string; pjson: string }>(
    db,
    `SELECT MIN(d.scheduled_date) AS scheduled_date, p.json AS pjson FROM customers c JOIN deliveries d ON d.customer_id = c.id AND d.status = 'scheduled' JOIN projections p ON p.customer_id = c.id
      WHERE c.status NOT IN ('CANCELLED') GROUP BY c.id HAVING MIN(d.scheduled_date) <= ?`,
    isoFromDay(today + 28),
  );
  const counts: Record<FreshnessStatus, number> = { best: 0, peak: 0, past_peak: 0, late: 0 };
  for (const r of rows) {
    const p = JSON.parse(r.pjson) as Projection;
    if (p.daysPerBag === undefined || p.deliveredCount === undefined) continue;
    counts[freshnessFromProjection(p, dayFromISO(r.scheduled_date)).status]++;
  }
  const total = counts.best + counts.peak + counts.past_peak + counts.late;
  return { total, counts, atPeakShare: total ? (counts.best + counts.peak) / total : 0, peakEndDays: FRESHNESS.peakEndDays };
}

// The outlook is a Monte Carlo over the whole base: cache it per (day, number of events/messages) until something changes.
let outlookCache: { key: string; value: ReturnType<typeof computeOutlook> } | undefined;

function outlook(db: Db, _ctx: AppCtx) {
  void _ctx;
  const today = todayOf(db);
  const stamp = get<{ a: number | null; b: number | null; c: number | null }>(db, "SELECT (SELECT MAX(id) FROM events) AS a, (SELECT MAX(id) FROM messages) AS b, (SELECT COUNT(*) FROM deliveries WHERE status = 'scheduled') AS c");
  const key = `${today}:${stamp?.a}:${stamp?.b}:${stamp?.c}`;
  if (outlookCache?.key === key) return outlookCache.value;
  const rows = all<{ id: string; source: Source; signup_date: string; plan_cadence_days: number; scheduled_date: string; pjson: string | null }>(
    db,
    `SELECT c.id AS id, c.source AS source, c.signup_date AS signup_date, c.plan_cadence_days AS plan_cadence_days, d.scheduled_date AS scheduled_date, p.json AS pjson
       FROM customers c JOIN deliveries d ON d.customer_id = c.id AND d.status = 'scheduled' LEFT JOIN projections p ON p.customer_id = c.id
      WHERE c.status NOT IN ('CANCELLED','OPTED_OUT')`,
  );
  const pending = new Map<string, number>();
  for (const m of all<{ customer_id: string; snapshot: string }>(db, "SELECT customer_id, snapshot FROM messages WHERE status = 'pending_approval' AND kind = 'proposal'")) {
    const s = JSON.parse(m.snapshot) as { from?: number; to?: number };
    if (s.from !== undefined && s.to !== undefined) pending.set(m.customer_id, s.to - s.from);
  }
  const customers: OutlookCustomer[] = rows.map((r) => {
    const next = dayFromISO(r.scheduled_date);
    const p = r.pjson ? (JSON.parse(r.pjson) as Projection) : null;
    const onHandAtArrival = p ? p.runOut.q50 - (next - today) : 0;
    return { source: r.source, nextDelivery: next, rhythmDays: r.plan_cadence_days, tenureDays: today - dayFromISO(r.signup_date), skipProb: onHandAtArrival >= ENGINE.skipThresholdDays ? WORLD.skipProb : 0.03, pendingShiftDays: pending.get(r.id), pendingProb: pending.has(r.id) ? 0.7 : undefined };
  });
  const value = computeOutlook(customers, today, "outlook");
  outlookCache = { key, value };
  return value;
}

export function createApp(s: ServerCtx): Hono {
  const { ctx, hub } = s;
  const db = ctx.db;
  const app = new Hono();
  const body = async (c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> => {
    const b = await c.req.json().catch(() => ({}));
    return isObj(b) ? b : {};
  };

  // ---- stream ----------------------------------------------------------------------------------------------------
  app.get("/api/stream", (c) => {
    c.header("Cache-Control", "no-cache");
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      let closed = false;
      const queue: Array<{ id: number } & Record<string, unknown>> = [];
      let wake: (() => void) | undefined;
      // subscribe first, so nothing that happens right after the snapshot is missed
      const unsub = hub.subscribe((e) => {
        queue.push(e as never);
        wake?.();
      });
      stream.onAbort(() => {
        closed = true;
        unsub();
        wake?.();
      });
      await stream.writeSSE({ event: "snapshot", data: JSON.stringify({ now: nowMs(db), id: hub.lastId }) });
      while (!closed) {
        while (queue.length) {
          const e = queue.shift()!;
          await stream.writeSSE({ event: String(e.type), id: String(e.id), data: JSON.stringify(e) });
        }
        await new Promise<void>((r) => {
          wake = r;
          const t = setTimeout(r, 15_000);
          t.unref?.();
        });
        if (!closed && !queue.length) await stream.writeSSE({ event: "heartbeat", data: "{}" });
      }
    });
  });

  // ---- Today -----------------------------------------------------------------------------------------------------
  app.get("/api/today", (c) => {
    const now = nowMs(db);
    const today = etParts(now).day;
    const person = needsPerson(db, 5);
    const appr = approvals(db, 3);
    return c.json({
      now,
      today,
      kpis: kpis(db, today, now, ctx),
      runningOutSoon: runningOutSoon(db, today),
      goingOut: goingOutToday(db, today),
      needsPerson: person,
      approvals: { items: appr.items, total: appr.total },
    });
  });

  // ---- Customers -------------------------------------------------------------------------------------------------
  app.get("/api/customers/views", (c) => c.json(viewCounts(db)));
  app.get("/api/customers", (c) => {
    const q = c.req.query();
    const filter = { q: q.q, status: q.status, source: q.source, consent: q.consent, view: q.view };
    if (q.format === "csv") {
      const r = listCustomers(db, { ...filter, all: true });
      const cell = (v: string | number | null): string => {
        const t = v === null ? "" : String(v);
        // a leading = + - @ would be run as a formula by a spreadsheet
        const safe = /^[=+\-@]/.test(t) ? `'${t}` : t;
        return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
      };
      const day = (d: number | null) => (d === null ? "" : isoFromDay(d));
      const rows = r.items.map((i) => [i.id, i.name, i.city, SOURCE_LABEL[i.source], i.plan, day(i.nextDelivery), day(i.runOut?.lo ?? null), day(i.runOut?.mid ?? null), day(i.runOut?.hi ?? null), i.confidence, i.lastReply?.weeks ?? null, day(i.lastReply?.day ?? null), i.status, i.consentDelivery ? "yes" : "no", i.consentOffers ? "yes" : "no"].map(cell).join(","));
      const head = "id,name,city,sign_up_source,plan,next_delivery,runs_out_early,runs_out_likely,runs_out_late,how_sure,last_reply_weeks,last_reply_date,status,delivery_texts,offer_texts";
      return c.body([head, ...rows].join("\n") + "\n", 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="customers.csv"' });
    }
    return c.json(listCustomers(db, { ...filter, page: q.page ? Number(q.page) : 1, pageSize: q.pageSize ? Number(q.pageSize) : 50 }));
  });
  app.get("/api/customers/:id", (c) => {
    const p = buildProfile(db, c.req.param("id"));
    return p ? c.json(p) : c.json({ error: "not found" }, 404);
  });
  app.post("/api/customers/:id/actions", async (c) => {
    const id = c.req.param("id");
    const b = await body(c);
    const action = str(b.action);
    let a: StaffAction | undefined;
    switch (action) {
      case "send_checkin_now":
        a = { action };
        break;
      case "move":
        a = num(b.to) !== undefined ? { action, to: num(b.to)! } : undefined;
        break;
      case "hold":
        a = num(b.until) !== undefined ? { action, until: num(b.until)!, messageId: num(b.messageId) } : undefined;
        break;
      case "pause":
        a = { action, days: num(b.days) ?? 28 };
        break;
      case "add_note":
        a = { action, body: str(b.body) ?? "" };
        break;
      case "reply":
        a = { action, body: str(b.body) ?? "", messageId: num(b.messageId) };
        break;
      case "resolve":
        a = num(b.messageId) !== undefined ? { action, messageId: num(b.messageId)! } : undefined;
        break;
    }
    if (!a) return c.json({ ok: false, error: "Unknown or incomplete action." }, 400);
    const r = staffAction(ctx, id, a);
    return c.json(r, r.ok ? 200 : 400);
  });

  // ---- Inbox -----------------------------------------------------------------------------------------------------
  // the sidebar badge and inbox tabs: totals only
  app.get("/api/inbox/counts", (c) => {
    const pendingOffers = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM offers WHERE status = 'Pending approval'")?.n ?? 0;
    return c.json({ needs: needsPerson(db).total, approvals: approvals(db).total + pendingOffers });
  });
  app.get("/api/inbox", (c) => {
    const tab = c.req.query("tab") ?? "needs";
    if (tab === "needs") return c.json(needsPerson(db));
    if (tab === "approvals") {
      const m = approvals(db);
      const offers = all<OfferRow>(db, "SELECT * FROM offers WHERE status = 'Pending approval'").map((o) => offerDTO(db, o));
      return c.json({ items: m.items, total: m.total + offers.length, offers });
    }
    const q = c.req.query("q")?.trim();
    const page = Math.max(Number(c.req.query("page") ?? 1), 1);
    const where = q ? "WHERE (c.name LIKE ? OR m.body LIKE ? OR m.customer_id LIKE ?)" : "WHERE 1=1";
    const params = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];
    const rows = all<Parameters<typeof toDTO>[0] & { name: string }>(db, `SELECT m.*, c.name AS name FROM messages m JOIN customers c ON c.id = m.customer_id ${where} AND m.status NOT IN ('queued','cancelled') ORDER BY m.at DESC, m.id DESC LIMIT 50 OFFSET ?`, ...params, (page - 1) * 50);
    const total = get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM messages m JOIN customers c ON c.id = m.customer_id ${where} AND m.status NOT IN ('queued','cancelled')`, ...params)?.n ?? 0;
    return c.json({ items: rows.map((r) => toDTO(r, r.name)), total, page });
  });
  app.post("/api/messages/:id/approve", (c) => {
    const r = approve(ctx, Number(c.req.param("id")));
    return c.json(r, r.ok ? 200 : 400);
  });
  app.post("/api/messages/:id/hold", (c) => {
    const r = holdMessage(ctx, Number(c.req.param("id")));
    return c.json(r, r.ok ? 200 : 400);
  });

  // ---- Offers ----------------------------------------------------------------------------------------------------
  app.get("/api/offers", (c) => c.json({ offers: listOffers(db).map(({ row, results }) => offerDTO(db, row, results)), types: OFFER_TYPES }));
  app.get("/api/offers/:id", (c) => {
    const row = get<OfferRow>(db, "SELECT * FROM offers WHERE id = ?", Number(c.req.param("id")));
    return row ? c.json(offerDTO(db, row)) : c.json({ error: "not found" }, 404);
  });
  app.post("/api/offers", async (c) => {
    const d = parseDraft(await body(c));
    if (typeof d === "string") return c.json({ ok: false, error: d }, 400);
    return c.json({ ok: true, id: createOffer(ctx, d) });
  });
  app.put("/api/offers/:id", async (c) => {
    const d = parseDraft(await body(c));
    if (typeof d === "string") return c.json({ ok: false, error: d }, 400);
    const r = updateOffer(ctx, Number(c.req.param("id")), d);
    return c.json(r, r.ok ? 200 : 400);
  });
  app.post("/api/offers/:id/preview", async (c) => {
    const id = c.req.param("id");
    const d = parseDraft(await body(c));
    if (typeof d === "string") return c.json({ ok: false, error: d }, 400);
    return c.json({ ok: true, preview: previewOffer(db, d, id === "new" ? undefined : Number(id)) });
  });
  app.post("/api/offers/:id/schedule", (c) => {
    const r = scheduleOffer(ctx, Number(c.req.param("id")));
    return c.json(r, r.ok ? 200 : 400);
  });
  app.post("/api/offers/:id/approve", (c) => {
    const r = approveOffer(ctx, Number(c.req.param("id")));
    return c.json(r, r.ok ? 200 : 400);
  });
  app.post("/api/offers/:id/pause", async (c) => {
    const b = await body(c);
    const r = pauseOffer(ctx, Number(c.req.param("id")), str(b.reason) ?? "Paused by staff");
    return c.json(r, r.ok ? 200 : 400);
  });
  app.post("/api/offers/check", (c) => c.json({ paused: runSensorChecks(ctx) }));

  // ---- Roast outlook ---------------------------------------------------------------------------------------------
  app.get("/api/outlook", (c) => {
    const o = outlook(db, ctx);
    if (c.req.query("format") === "csv") {
      const lines = [
        "# Roast outlook: DTC only, a small share of roaster volume (under 2% of wholesale pounds).",
        `# Pounds = deliveries x ${WORLD.poundsPerDelivery} lb (one 12-oz bag). Sensitivity: x ${WORLD.poundsPerDeliveryTwoBag} lb if each delivery is two bags (columns pounds_2bag_*).`,
        `# Band = P10-P90 of ${o.draws} Monte Carlo draws that include rate uncertainty. Sample data: not a forecast of Classic Cup's volumes.`,
        "week_of,deliveries_p10,deliveries_p50,deliveries_p90,pounds_p10,pounds_p50,pounds_p90,pounds_2bag_p10,pounds_2bag_p50,pounds_2bag_p90",
        ...o.weeks.map((w) => [isoFromDay(w.wednesday), w.deliveries.p10, w.deliveries.p50, w.deliveries.p90, w.pounds.p10, w.pounds.p50, w.pounds.p90, w.poundsTwoBag.p10, w.poundsTwoBag.p50, w.poundsTwoBag.p90].join(",")),
      ];
      return c.body(lines.join("\n") + "\n", 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="roast-outlook.csv"' });
    }
    return c.json(o);
  });

  // ---- Bag QR: the console page, and the public page a grocery buyer opens from the bag ---------------------------
  app.get("/api/qr", (c) => c.json(qrSummary(db)));
  app.get("/api/qr/lots/:code", (c) => {
    const l = lotPublic(db, c.req.param("code"));
    return l ? c.json(l) : c.json({ error: "not found" }, 404);
  });
  app.post("/api/qr/scan", async (c) => {
    const code = str((await body(c)).code, 40);
    const r = code ? recordScan(ctx, code) : undefined;
    return r ? c.json({ ok: true, ...r }) : c.json({ ok: false, error: "Unknown bag." }, 404);
  });
  app.post("/api/qr/signup", async (c) => {
    const b = await body(c);
    const scanId = num(b.scanId);
    const code = str(b.code, 40);
    const name = str(b.name, 120);
    const phone = str(b.phone, 40);
    if (scanId === undefined || !code || name === undefined || phone === undefined) return c.json({ ok: false, error: "Please fill in every field." }, 400);
    const r = qrSignup(ctx, { scanId, code, name, phone, cups: num(b.cups) ?? 0, people: num(b.people) ?? 0, rhythmDays: num(b.rhythmDays) ?? 0, consentDelivery: b.consentDelivery === true, consentOffers: b.consentOffers === true });
    return c.json(r, r.ok ? 200 : 400);
  });

  // ---- Settings (static, read-only) ----------------------------------------------------------------------------
  app.get("/api/settings", (c) =>
    c.json({
      deliveryDay: RULES.deliveryWeekday,
      quietHours: { from: RULES.quietHours.from, to: RULES.quietHours.to },
      caps: { routine: RULES.routineTextsPerDelivery, other: RULES.otherTextsPerDelivery, offerEveryDays: RULES.offerCapDays },
      freeze: { from: dayFromISO(RULES.freezeFromISO), to: dayFromISO(RULES.freezeToISO) },
      cautiousness: getSetting(db, "cautiousness", ENGINE.defaultCautiousness),
      consentTexts: { delivery: COPY.consentDelivery(), offers: COPY.consentOffers() },
      standingHoldout: { share: RULES.globalHoldoutShare, months: RULES.globalHoldoutMonths, members: get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM global_holdout")?.n ?? 0 },
      engineVersion: ENGINE.version,
      holidays: upcomingHolidayWindows(todayOf(db)),
      freshness: { bestByDays: FRESHNESS.bestByDays, peakEndDays: FRESHNESS.peakEndDays, roastToDoorDays: WORLD.roastToDoorDays },
      environment: "Sandbox · sample data",
    }),
  );

  // ---- Sandbox (SANDBOX=1 only) ----------------------------------------------------------------------------------
  if (s.sandbox) {
    const sb = s.sandbox;
    app.get("/api/sandbox", (c) => c.json({ ...sb.state(), scenario: sb.scenario }));
    app.post("/api/sandbox/advance", (c) => c.json(sb.advance()));
    app.post("/api/sandbox/reset", (c) => c.json(sb.reset()));
    app.post("/api/sandbox/inject", async (c) => {
      const b = await body(c);
      const id = str(b.customerId);
      const text = str(b.text, 500);
      if (!id || !text) return c.json({ ok: false, error: "customerId and text are required" }, 400);
      try {
        sb.inject(id, text);
        return c.json({ ok: true });
      } catch (e) {
        return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
      }
    });
    app.post("/api/sandbox/clock", async (c) => {
      const b = await body(c);
      const hours = num(b.hours) ?? 0;
      advanceClock(ctx, nowMs(db) + Math.min(Math.max(hours, 0), 24 * 60) * 3_600_000);
      return c.json(sb.state());
    });
    app.post("/api/sandbox/channel", async (c) => {
      const b = await body(c);
      const name = str(b.name);
      try {
        if (name === "photon") {
          const ok = (await s.connectPhoton?.()) ?? false;
          if (!ok) {
            sb.setChannel("replay");
            ctx.emit({ type: "toast", message: "Photon did not connect within 5 s: fell back to replay" });
            return c.json({ ...sb.state(), fellBack: true });
          }
          return c.json(sb.state());
        }
        if (name === "replay" || name === "console") sb.setChannel(name);
        else return c.json({ ok: false, error: "channel must be replay, console or photon" }, 400);
        return c.json(sb.state());
      } catch (e) {
        return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
      }
    });
  }

  // an inbound text from a live channel (photon)
  app.post("/api/_inbound", async (c) => {
    if (!s.sandbox) return c.json({ ok: false }, 404);
    const b = await body(c);
    const id = str(b.customerId);
    const text = str(b.text, 500);
    if (!id || !text || !customerRow(db, id)) return c.json({ ok: false }, 400);
    handleInbound(ctx, id, text);
    return c.json({ ok: true });
  });

  // ---- static web app (hash router: no SPA fallback needed) ------------------------------------------------------
  app.get("*", (c) => {
    const root = resolve(s.webDist);
    const reqPath = normalize(decodeURIComponent(new URL(c.req.url).pathname)).replace(/^(\.\.[/\\])+/, "");
    let file = join(root, reqPath === "/" ? "index.html" : reqPath);
    if (!file.startsWith(root)) return c.text("forbidden", 403);
    if (!existsSync(file)) file = join(root, "index.html");
    if (!existsSync(file)) return c.text("web app not built: run `pnpm demo` (it builds first) or `pnpm dev`", 404);
    return c.body(readFileSync(file), 200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  });
  return app;
}

export type { CustomerRow };
export { fmtDay, fmtMonthDay, etInstant, nextScheduled };
