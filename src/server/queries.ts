import { ENGINE } from "../shared/constants.ts";
import { dayFromISO, etInstant, etParts, isoFromDay, MS_DAY, type Day } from "../shared/dates.ts";
import type { Projection } from "../engine/project.ts";
import type { CustomerListItem, CustomerRow, MessageRow, StatusChip } from "../shared/types.ts";
import { COPY } from "./copy.ts";
import { all, get, type Db } from "./db.ts";
import { nowMs } from "./store.ts";
import { toDTO } from "./flows/send.ts";

/** Read-side helpers for the screens: status chips, list rows and the queues. */

export const planLabel = (c: Pick<CustomerRow, "plan_cadence_days" | "plan_type">): string => `Every ${Math.round(c.plan_cadence_days / 7)} weeks${c.plan_type === "gift" ? " · gift" : c.plan_type === "prepaid" ? " · prepaid" : ""}`;

interface ListRow extends CustomerRow {
  projection_json: string | null;
  next_delivery: string | null;
  last_delivered: string | null;
  last_reply_weeks: number | null;
  last_reply_at: number | null;
  checkin_at: number | null;
  has_pending: number;
  moved_this_cycle: number;
}

const LIST_SQL = `
SELECT c.*, p.json AS projection_json,
  (SELECT MIN(d.scheduled_date) FROM deliveries d WHERE d.customer_id = c.id AND d.status = 'scheduled') AS next_delivery,
  (SELECT MAX(d.delivered_date) FROM deliveries d WHERE d.customer_id = c.id AND d.status = 'delivered') AS last_delivered,
  (SELECT json_extract(e.data, '$.weeks') FROM events e WHERE e.customer_id = c.id AND e.type = 'reply' ORDER BY e.at DESC LIMIT 1) AS last_reply_weeks,
  (SELECT e.at FROM events e WHERE e.customer_id = c.id AND e.type = 'reply' ORDER BY e.at DESC LIMIT 1) AS last_reply_at,
  (SELECT MAX(m.at) FROM messages m WHERE m.customer_id = c.id AND m.kind = 'checkin' AND m.direction = 'out' AND m.status IN ('sent','delivered')) AS checkin_at,
  (SELECT COUNT(*) FROM messages m WHERE m.customer_id = c.id AND m.status = 'pending_approval') AS has_pending,
  (SELECT COUNT(*) FROM events e WHERE e.customer_id = c.id AND e.type = 'move' AND e.at >= COALESCE(CAST(strftime('%s', (SELECT MAX(d2.delivered_date) FROM deliveries d2 WHERE d2.customer_id = c.id AND d2.status = 'delivered')) AS INTEGER) * 1000, 0)) AS moved_this_cycle
FROM customers c LEFT JOIN projections p ON p.customer_id = c.id`;

export function statusChipOf(r: ListRow, now: number): StatusChip {
  if (r.status === "CANCELLED") return "Cancelled";
  if (r.status === "OPTED_OUT") return "Texts off";
  if (r.status === "HELD") return "Held";
  if (r.status === "PAUSED") return "Paused";
  const lastDeliveredMs = r.last_delivered ? etInstant(dayFromISO(r.last_delivered), 0, 0) : 0;
  const repliedThisCycle = r.last_reply_at !== null && r.last_reply_at >= lastDeliveredMs;
  if (r.has_pending > 0 || r.moved_this_cycle > 0) return "Move proposed";
  if (repliedThisCycle) return "Reply received";
  if (r.checkin_at !== null && r.checkin_at >= lastDeliveredMs && now - r.checkin_at < 5 * MS_DAY) return "Check-in sent";
  const p = r.projection_json ? (JSON.parse(r.projection_json) as Projection) : null;
  if (p?.holdingOff && r.checkin_at !== null && r.checkin_at >= lastDeliveredMs) return "Holding off";
  return "On schedule";
}

export function toListItem(r: ListRow, now: number): CustomerListItem {
  const p = r.projection_json ? (JSON.parse(r.projection_json) as Projection) : null;
  return {
    id: r.id,
    name: r.name,
    city: r.city,
    source: r.source,
    plan: planLabel(r),
    planType: r.plan_type,
    nextDelivery: r.next_delivery ? dayFromISO(r.next_delivery) : null,
    runOut: p ? p.runOutDates : null,
    confidence: p ? p.confidence : null,
    lastReply: r.last_reply_at !== null && r.last_reply_weeks !== null ? { day: etParts(r.last_reply_at).day, weeks: r.last_reply_weeks } : null,
    status: statusChipOf(r, now),
    state: r.status,
    consentDelivery: !!r.consent_delivery,
    consentOffers: !!r.consent_offers,
  };
}

export interface CustomerFilter {
  q?: string;
  status?: string;
  source?: string;
  consent?: string;
  /** a saved worklist: attention, running, approval or new */
  view?: string;
  page?: number;
  pageSize?: number;
  /** return every matching row (CSV export) */
  all?: boolean;
}

export const CUSTOMER_VIEWS = ["attention", "running", "approval", "new"] as const;
export type CustomerView = (typeof CUSTOMER_VIEWS)[number];

/** The SQL condition (and its parameters) for a saved worklist. */
function viewCondition(view: string | undefined, today: Day): { sql: string; params: number[] | string[] } | null {
  switch (view) {
    case "attention":
      return { sql: "EXISTS (SELECT 1 FROM messages m WHERE m.customer_id = c.id AND m.status IN ('pending_approval','needs_person'))", params: [] };
    case "approval":
      return { sql: "EXISTS (SELECT 1 FROM messages m WHERE m.customer_id = c.id AND m.status = 'pending_approval')", params: [] };
    case "running":
      return { sql: "json_extract(p.json, '$.runOutDates.lo') <= ? AND json_extract(p.json, '$.confidence') IN ('High','Medium')", params: [today + 14] };
    case "new":
      return { sql: "c.signup_date >= ?", params: [isoFromDay(today - 60)] };
    default:
      return null;
  }
}

/** How many customers are in each saved worklist (shown on its chip). */
export function viewCounts(db: Db): Record<CustomerView | "all", number> {
  const today = etParts(nowMs(db)).day;
  const out = {} as Record<CustomerView | "all", number>;
  out.all = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM customers WHERE status != 'CANCELLED'")?.n ?? 0;
  for (const v of CUSTOMER_VIEWS) {
    const c = viewCondition(v, today)!;
    out[v] = get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM customers c LEFT JOIN projections p ON p.customer_id = c.id WHERE c.status NOT IN ('CANCELLED','OPTED_OUT') AND ${c.sql}`, ...c.params)?.n ?? 0;
  }
  return out;
}

export function listCustomers(db: Db, f: CustomerFilter): { items: CustomerListItem[]; total: number; page: number; pageSize: number } {
  const now = nowMs(db);
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (f.q?.trim()) {
    where.push("(c.name LIKE ? OR c.id LIKE ? OR c.city LIKE ?)");
    const q = `%${f.q.trim()}%`;
    params.push(q, q, q);
  }
  if (f.source) (where.push("c.source = ?"), params.push(f.source));
  if (f.consent === "offers") where.push("c.consent_offers = 1");
  if (f.consent === "no-offers") where.push("c.consent_offers = 0");
  if (f.consent === "no-delivery") where.push("c.consent_delivery = 0");
  if (f.status === "active") where.push("c.status NOT IN ('CANCELLED','OPTED_OUT')");
  else if (f.status === "cancelled") where.push("c.status = 'CANCELLED'");
  else if (f.status === "texts-off") where.push("c.status = 'OPTED_OUT'");
  else if (f.status === "held") where.push("c.status IN ('HELD','PAUSED')");
  else if (!f.status) where.push("c.status != 'CANCELLED'");
  const vc = viewCondition(f.view, etParts(now).day);
  if (vc) (where.push(vc.sql), params.push(...vc.params));
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const pageSize = f.all ? 50_000 : Math.min(f.pageSize ?? 50, 200);
  const page = f.all ? 1 : Math.max(f.page ?? 1, 1);
  const total = get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM customers c LEFT JOIN projections p ON p.customer_id = c.id ${w}`, ...params)?.n ?? 0;
  const rows = all<ListRow>(db, `${LIST_SQL} ${w} ORDER BY COALESCE(json_extract(p.json, '$.runOutDates.mid'), 999999), c.name LIMIT ? OFFSET ?`, ...params, pageSize, (page - 1) * pageSize);
  return { items: rows.map((r) => toListItem(r, now)), total, page, pageSize };
}

/** Customers whose likely run-out starts within `days`, soonest first. */
export function runningOutSoon(db: Db, today: Day, days = 14, limit = 40): { items: CustomerListItem[]; total: number } {
  const now = nowMs(db);
  const where = `WHERE c.status NOT IN ('CANCELLED','OPTED_OUT') AND json_extract(p.json, '$.runOutDates.lo') <= ?`;
  const total = get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM customers c JOIN projections p ON p.customer_id = c.id ${where}`, today + days)?.n ?? 0;
  const rows = all<ListRow>(db, `${LIST_SQL} ${where} ORDER BY CASE WHEN json_extract(p.json, '$.confidence') IN ('High','Medium') THEN 0 ELSE 1 END, json_extract(p.json, '$.runOutDates.lo'), c.name LIMIT ?`, today + days, limit);
  return { items: rows.map((r) => toListItem(r, now)), total };
}

/** The body a queued check-in will have, composed for the preview (the real text is fixed when it goes out). */
export function checkInPreview(db: Db, customerId: string, name: string): string {
  const n = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM deliveries WHERE customer_id = ? AND status = 'delivered'", customerId)?.n ?? 0;
  const first = name.split(" ")[0]!;
  return n < 2 ? COPY.newSubscriber({ name: first }) : COPY.checkIn({ name: first });
}

export interface GoingOutItem {
  messageId: number;
  customerId: string;
  name: string;
  at: number;
  kind: string;
  reasonChip: string;
  body: string;
}

export function goingOutToday(db: Db, today: Day, limit = 40): { items: GoingOutItem[]; total: number } {
  const from = etInstant(today, 0, 0);
  const to = etInstant(today + 1, 0, 0);
  const total = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM messages WHERE direction = 'out' AND status = 'queued' AND at >= ? AND at < ?", from, to)?.n ?? 0;
  const rows = all<MessageRow & { name: string }>(db, "SELECT m.*, c.name AS name FROM messages m JOIN customers c ON c.id = m.customer_id WHERE m.direction = 'out' AND m.status = 'queued' AND m.at >= ? AND m.at < ? ORDER BY m.at, m.id LIMIT ?", from, to, limit);
  const items = rows.map((r) => {
    const dto = toDTO(r, r.name);
    return { messageId: r.id, customerId: r.customer_id, name: r.name, at: r.at, kind: r.kind, reasonChip: dto.reasonChip ?? "Automated text", body: r.kind === "checkin" && !r.body ? checkInPreview(db, r.customer_id, r.name) : r.body };
  });
  return { items, total };
}

export function needsPerson(db: Db, limit = 100): { items: Array<{ messageId: number; customerId: string; name: string; text: string; at: number; reason: string }>; total: number } {
  const total = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM messages WHERE status = 'needs_person'")?.n ?? 0;
  const rows = all<MessageRow & { name: string }>(db, "SELECT m.*, c.name AS name FROM messages m JOIN customers c ON c.id = m.customer_id WHERE m.status = 'needs_person' ORDER BY m.at LIMIT ?", limit);
  return { items: rows.map((r) => ({ messageId: r.id, customerId: r.customer_id, name: r.name, text: r.body, at: r.at, reason: (JSON.parse(r.snapshot) as { reasonChip?: string }).reasonChip ?? "Free-text reply" })), total };
}

export function approvals(db: Db, limit = 100): { items: Array<ReturnType<typeof toDTO> & { customerName: string }>; total: number } {
  const total = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM messages WHERE status = 'pending_approval'")?.n ?? 0;
  const rows = all<MessageRow & { name: string }>(db, "SELECT m.*, c.name AS name FROM messages m JOIN customers c ON c.id = m.customer_id WHERE m.status = 'pending_approval' ORDER BY m.at LIMIT ?", limit);
  return { items: rows.map((r) => ({ ...toDTO(r, r.name), customerName: r.name })), total };
}

export { ENGINE };
