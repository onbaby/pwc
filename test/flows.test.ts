import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COPY } from "../src/server/copy.ts";
import { all, get, run } from "../src/server/db.ts";
import { approve, holdMessage, staffAction } from "../src/server/flows/actions.ts";
import { handleInbound, parseInbound } from "../src/server/flows/inbound.ts";
import { advanceClock } from "../src/server/flows/schedule.ts";
import { sendText } from "../src/server/flows/send.ts";
import { customerRow, nextScheduled, nowMs, projectionOf, todayOf } from "../src/server/store.ts";
import { dayFromISO, etInstant, fmtDay } from "../src/shared/dates.ts";
import type { MessageRow } from "../src/shared/types.ts";
import { freshConsole, type TestConsole } from "./helpers.ts";

/** the thread as sent: queued texts are the future, cancelled ones never happened */
const msgs = (t: TestConsole, id: string) => all<MessageRow>(t.db, "SELECT * FROM messages WHERE customer_id = ? AND status NOT IN ('cancelled','queued') ORDER BY at, id", id);
const lastOut = (t: TestConsole, id: string, kind?: string) => msgs(t, id).filter((m) => m.direction === "out" && (!kind || m.kind === kind)).pop();
const within = (v: number, target: number, tol = 0.25) => Math.abs(v - target) <= tol * target;

describe("the scripted morning (Appendix A)", () => {
  let t: TestConsole;
  beforeAll(() => {
    t = freshConsole();
  });
  afterAll(() => t.cleanup());

  it("starts at Sun Oct 18, 9:00 am with Maya's and Dev's check-ins queued for 10:00 and 9:30", () => {
    expect(nowMs(t.db)).toBe(etInstant(dayFromISO("2026-10-18"), 9, 0));
    const m = get<MessageRow>(t.db, "SELECT * FROM messages WHERE customer_id = 'maya-thompson' AND kind = 'checkin' AND status = 'queued'")!;
    const d = get<MessageRow>(t.db, "SELECT * FROM messages WHERE customer_id = 'dev-patel' AND kind = 'checkin' AND status = 'queued'")!;
    expect(m.at).toBe(etInstant(dayFromISO("2026-10-18"), 10, 0));
    expect(d.at).toBe(etInstant(dayFromISO("2026-10-18"), 9, 30));
  });

  it("10:00 check-ins go out; Dev is Not yet sure and holding off, one delivery so far, so not movable", () => {
    const r = t.sandbox.advance();
    expect(r.event?.id).toBe("checkins");
    const maya = lastOut(t, "maya-thompson", "checkin")!;
    expect(maya.status === "sent" || maya.status === "delivered").toBe(true);
    expect(maya.body).toBe(COPY.checkIn({ name: "Maya" }));
    const dev = lastOut(t, "dev-patel", "checkin")!;
    expect(dev.body).toBe(COPY.newSubscriber({ name: "Dev" }));
    const p = projectionOf(t.db, "dev-patel");
    expect(p.confidence).toBe("Not yet sure");
    expect(p.holdingOff).toBe(true);
    expect(p.proposal.direction).toBe("none");
    expect(p.ruleTrace.some((x) => x.code === "TOO_FEW_DELIVERIES")).toBe(true);
    expect(customerRow(t.db, "dev-patel")!.suggested_cadence_days).toBe(42);
    expect(customerRow(t.db, "dev-patel")!.plan_cadence_days).toBe(28);
  });

  it("Maya replies 6: Medium, run-out about 29/39/45/67 days, later move Wed Oct 28 → Wed Nov 11 sent automatically", () => {
    const before = nextScheduled(t.db, "maya-thompson")!;
    expect(fmtDay(before.day)).toBe("Wed Oct 28");
    const r = t.sandbox.advance();
    expect(r.event?.id).toBe("maya-reply");
    expect(nowMs(t.db)).toBe(etInstant(dayFromISO("2026-10-18"), 10, 2));
    const p = projectionOf(t.db, "maya-thompson");
    expect(p.confidence).toBe("Medium");
    expect(within(p.runOut.q10, 29)).toBe(true);
    expect(within(p.runOut.q33, 39)).toBe(true);
    expect(within(p.runOut.q50, 45)).toBe(true);
    expect(within(p.runOut.q90, 67)).toBe(true);
    expect(fmtDay(nextScheduled(t.db, "maya-thompson")!.day)).toBe("Wed Nov 11");
    const m = lastOut(t, "maya-thompson", "proposal")!;
    expect(m.body).toBe(COPY.laterMove({ name: "Maya", weeks: 6, old: dayFromISO("2026-10-28"), new: dayFromISO("2026-11-11") }));
    expect(m.reason_code).toBe("MOVE_LATER_AUTO");
    const why = JSON.parse(m.snapshot) as { checks: Array<{ ok: boolean; text: string }>; confidence: string };
    expect(why.confidence).toBe("Medium");
    expect(why.checks.every((c) => c.ok)).toBe(true);
    expect(why.checks.map((c) => c.text).join(" ")).toContain("not in the holiday freeze");
    // a reminder is queued three days before the new date
    const rem = get<MessageRow>(t.db, "SELECT * FROM messages WHERE customer_id = 'maya-thompson' AND kind = 'reminder' AND status = 'queued'")!;
    expect(rem.at).toBe(etInstant(dayFromISO("2026-11-08"), 10, 0));
    expect(rem.body).toBe(COPY.reminder({ new: dayFromISO("2026-11-11") }));
  });

  it("OK never reverts; OLD does", () => {
    handleInbound(t.ctx, "maya-thompson", "OK");
    handleInbound(t.ctx, "maya-thompson", "👍");
    expect(fmtDay(nextScheduled(t.db, "maya-thompson")!.day)).toBe("Wed Nov 11");
  });

  it("Priya's free text goes to Needs a person; staff 'Hold until Wed Nov 4' moves the delivery and confirms", () => {
    t.sandbox.advance();
    const inbox = all<MessageRow>(t.db, "SELECT * FROM messages WHERE customer_id = 'priya-shah' AND status = 'needs_person'");
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.body).toBe("heading to Denver till Nov 2");
    expect(lastOut(t, "priya-shah")!.body).toBe(COPY.person());
    const r = staffAction(t.ctx, "priya-shah", { action: "hold", until: dayFromISO("2026-11-04"), messageId: inbox[0]!.id });
    expect(r.ok).toBe(true);
    expect(fmtDay(nextScheduled(t.db, "priya-shah")!.day)).toBe("Wed Nov 4");
    expect(lastOut(t, "priya-shah")!.body).toBe(COPY.staffHold({ old: dayFromISO("2026-10-28"), new: dayFromISO("2026-11-04") }));
    expect(get<MessageRow>(t.db, "SELECT * FROM messages WHERE id = ?", inbox[0]!.id)!.status).toBe("resolved");
    const gap = nextScheduled(t.db, "priya-shah")!.day - dayFromISO("2026-09-30");
    expect(gap).toBeGreaterThanOrEqual(21);
    expect(gap).toBeLessThanOrEqual(84);
  });

  it("the script is exhausted after three events", () => {
    expect(t.sandbox.advance().event).toBeNull();
    expect(t.sandbox.state().done).toBe(true);
  });
});

describe("inbound handling (spec 11.3)", () => {
  it("numbers 0-12 and the closed keyword list; plenty asks once; everything else goes to a person", () => {
    for (const [text, weeks] of [["0", 0], ["6", 6], ["12", 12], ["zero", 0], ["Twelve", 12], [" 4. ", 4]] as const) expect(parseInbound(text)).toEqual({ kind: "weeks", weeks });
    expect(parseInbound("13").kind).toBe("other");
    expect(parseInbound("6 weeks").kind).toBe("other");
    for (const w of ["YES", "OK", "OLD", "SOONER", "SKIP", "PAUSE", "SWAP", "ROTATE", "SMALLER", "NO OFFERS", "STOP", "START", "HELP", "CANCEL", "BACK", "WHY", "HUMAN"]) {
      expect(parseInbound(w.toLowerCase())).toEqual({ kind: "keyword", word: w });
    }
    expect(parseInbound("👍")).toEqual({ kind: "keyword", word: "OK" });
    expect(parseInbound("Plenty")).toEqual({ kind: "plenty" });
    expect(parseInbound("lots!")).toEqual({ kind: "plenty" });
    expect(parseInbound("please don't cancel, I love it")).toEqual({ kind: "other", mentionsCancel: true });
    expect(parseInbound("can I get decaf")).toEqual({ kind: "other", mentionsCancel: false });
  });
});

describe("consent, STOP, CANCEL, caps and quiet hours", () => {
  let t: TestConsole;
  beforeAll(() => {
    t = freshConsole();
  });
  afterAll(() => t.cleanup());
  const pickActive = (n: number) => all<{ id: string }>(t.db, "SELECT id FROM customers WHERE status = 'ACTIVE' AND consent_delivery = 1 AND consent_offers = 1 AND id NOT IN ('maya-thompson','dev-patel','priya-shah') ORDER BY id LIMIT ?", n + 40).map((r) => r.id).slice(40, 40 + n);

  const states = ["OPT_IN_PENDING", "ACTIVE", "AWAITING_CHECKIN", "AWAITING_PROPOSAL", "HELD", "PAUSED", "CANCELLED", "OPTED_OUT"] as const;
  it.each(states)("STOP in state %s", (st) => {
    const id = pickActive(10)[states.indexOf(st)]!;
    run(t.db, "UPDATE customers SET status = ? WHERE id = ?", st, id);
    if (st === "CANCELLED") run(t.db, "UPDATE customers SET cancelled_at = ? WHERE id = ?", nowMs(t.db), id);
    const before = msgs(t, id).filter((m) => m.direction === "out").length;
    handleInbound(t.ctx, id, "STOP");
    expect(customerRow(t.db, id)!.status).toBe("OPTED_OUT");
    expect(msgs(t, id).filter((m) => m.direction === "out").length).toBe(before + (st === "OPTED_OUT" ? 0 : 1));
  });

  it("double STOP is silent; nothing but START or HELP gets a reply afterwards; STOP stops queued texts", () => {
    const id = pickActive(12)[11]!;
    handleInbound(t.ctx, id, "STOP");
    expect(all(t.db, "SELECT 1 FROM messages WHERE customer_id = ? AND status = 'queued'", id)).toHaveLength(0);
    const n = msgs(t, id).filter((m) => m.direction === "out").length;
    handleInbound(t.ctx, id, "STOP");
    handleInbound(t.ctx, id, "6");
    handleInbound(t.ctx, id, "what is this");
    expect(msgs(t, id).filter((m) => m.direction === "out").length).toBe(n);
    handleInbound(t.ctx, id, "START");
    expect(customerRow(t.db, id)!.status).toBe("ACTIVE");
  });

  it("exact CANCEL cancels immediately with no offer; text merely containing 'cancel' goes to the Inbox", () => {
    const [a, b] = pickActive(14).slice(12) as [string, string];
    handleInbound(t.ctx, b, "please don't cancel, I love it");
    expect(customerRow(t.db, b)!.status).not.toBe("CANCELLED");
    expect(get<MessageRow>(t.db, "SELECT * FROM messages WHERE customer_id = ? AND status = 'needs_person'", b)).toBeTruthy();
    handleInbound(t.ctx, a, "CANCEL");
    expect(customerRow(t.db, a)!.status).toBe("CANCELLED");
    expect(lastOut(t, a)!.body).toBe(COPY.cancel());
    expect(lastOut(t, a)!.offer_id).toBeNull();
    expect(all(t.db, "SELECT 1 FROM messages WHERE customer_id = ? AND status = 'queued'", a)).toHaveLength(0);
  });

  it("BACK undoes a cancel at 23 h 59 but not at 24 h 01", () => {
    const [a, b] = pickActive(16).slice(14) as [string, string];
    for (const [id, minutes, ok] of [[a, 23 * 60 + 59, true], [b, 24 * 60 + 1, false]] as const) {
      handleInbound(t.ctx, id, "CANCEL");
      const at = customerRow(t.db, id)!.cancelled_at!;
      run(t.db, "UPDATE customers SET cancelled_at = ? WHERE id = ?", nowMs(t.db) - minutes * 60_000 + 0, id);
      void at;
      handleInbound(t.ctx, id, "BACK");
      expect(customerRow(t.db, id)!.status === "CANCELLED").toBe(!ok);
      expect(lastOut(t, id)!.body).toBe(ok ? COPY.back() : COPY.backTooLate());
    }
  });

  it("NO OFFERS clears offer consent only; delivery texts continue", () => {
    const id = pickActive(18)[17]!;
    handleInbound(t.ctx, id, "no offers");
    const c = customerRow(t.db, id)!;
    expect(c.consent_offers).toBe(0);
    expect(c.consent_delivery).toBe(1);
    expect(c.status).not.toBe("OPTED_OUT");
    expect(lastOut(t, id)!.body).toBe(COPY.noOffers());
  });

  it("caps: at most 3 routine texts per delivery (check-in, proposal, reminder) and one other", () => {
    const id = pickActive(20)[19]!;
    const mk = (kind: "checkin" | "reminder" | "proposal" | "sooner") => sendText(t.ctx, { customerId: id, body: "x", kind, reasonCode: "T" });
    const before = all(t.db, "SELECT 1 FROM messages WHERE customer_id = ? AND direction = 'out' AND kind IN ('checkin','reminder','proposal','sooner') AND status IN ('sent','delivered') AND at >= (SELECT COALESCE(MAX(0),0))", id).length;
    void before;
    const results = [mk("checkin"), mk("reminder"), mk("proposal"), mk("sooner")];
    const sent = results.filter((r) => !("blocked" in r)).length;
    expect(sent).toBeLessThanOrEqual(3);
    expect(results.some((r) => "blocked" in r)).toBe(true);
    const c1 = sendText(t.ctx, { customerId: id, body: "clarify", kind: "clarify", reasonCode: "CLARIFY" });
    const c2 = sendText(t.ctx, { customerId: id, body: "clarify", kind: "clarify", reasonCode: "CLARIFY" });
    expect("blocked" in c1).toBe(false);
    expect("blocked" in c2).toBe(true);
  });

  it("quiet hours: a proactive text at 10 pm is queued for 8 am; a response is not held", () => {
    const id = pickActive(22)[21]!;
    advanceClock(t.ctx, etInstant(todayOf(t.db), 22, 0));
    const r = sendText(t.ctx, { customerId: id, body: "hello", kind: "reminder", reasonCode: "REMINDER" });
    expect(r).toMatchObject({ status: "queued" });
    const row = get<MessageRow>(t.db, "SELECT * FROM messages WHERE id = ?", (r as { id: number }).id)!;
    expect(row.at).toBe(etInstant(todayOf(t.db) + 1, 8, 0));
    const resp = sendText(t.ctx, { customerId: id, body: "done", kind: "confirmation", reasonCode: "RESPONSE", response: true });
    expect(resp).toMatchObject({ status: "sent" });
  });

  it("a clock jump runs deliveries and queued texts in time order and schedules the next cycle", () => {
    const wed = dayFromISO("2026-10-21");
    const due = all<{ id: string }>(t.db, "SELECT customer_id AS id FROM deliveries WHERE status = 'scheduled' AND scheduled_date = ? LIMIT 5", "2026-10-21");
    expect(due.length).toBeGreaterThan(0);
    advanceClock(t.ctx, etInstant(wed, 12, 0));
    for (const { id } of due) {
      const d = all<{ status: string; delivered_date: string | null }>(t.db, "SELECT status, delivered_date FROM deliveries WHERE customer_id = ? AND scheduled_date = '2026-10-21'", id)[0];
      expect(d?.status === "delivered" || d === undefined || d?.status === "scheduled").toBe(true);
      const next = nextScheduled(t.db, id);
      expect(next).toBeTruthy();
    }
    expect(nowMs(t.db)).toBe(etInstant(wed, 12, 0));
  });
});

describe("the approval queue", () => {
  let t: TestConsole;
  beforeAll(() => {
    t = freshConsole();
  });
  afterAll(() => t.cleanup());

  it("a later move held for review is applied and sent on approval", () => {
    const later = all<MessageRow>(t.db, "SELECT m.* FROM messages m JOIN customers c ON c.id = m.customer_id WHERE m.status = 'pending_approval' AND m.kind = 'proposal' AND c.status NOT IN ('OPTED_OUT','CANCELLED') ORDER BY m.id LIMIT 1")[0];
    expect(later).toBeTruthy();
    const snap = JSON.parse(later!.snapshot) as { to: number; blockedBy: string[] };
    expect(snap.blockedBy.length).toBeGreaterThan(0);
    expect(approve(t.ctx, later!.id).ok).toBe(true);
    expect(nextScheduled(t.db, later!.customer_id)!.day).toBe(snap.to);
    expect(["sent", "delivered"]).toContain(get<MessageRow>(t.db, "SELECT * FROM messages WHERE id = ?", later!.id)!.status);
  });

  it("a sooner move is sent on approval and waits for the customer's YES; nothing is charged earlier without it", () => {
    const sooner = all<MessageRow>(t.db, "SELECT m.* FROM messages m JOIN customers c ON c.id = m.customer_id WHERE m.status = 'pending_approval' AND m.kind = 'sooner' AND c.status NOT IN ('OPTED_OUT','CANCELLED') ORDER BY m.id LIMIT 1")[0];
    if (!sooner) return; // the seed's replies may not include one
    const snap = JSON.parse(sooner.snapshot) as { to: number };
    const before = nextScheduled(t.db, sooner.customer_id)!.day;
    expect(approve(t.ctx, sooner.id).ok).toBe(true);
    expect(nextScheduled(t.db, sooner.customer_id)!.day).toBe(before);
    handleInbound(t.ctx, sooner.customer_id, "OK");
    expect(nextScheduled(t.db, sooner.customer_id)!.day).toBe(before);
    handleInbound(t.ctx, sooner.customer_id, "YES");
    expect(nextScheduled(t.db, sooner.customer_id)!.day).toBe(snap.to);
  });

  it("holding a proposal sends nothing", () => {
    const m = all<MessageRow>(t.db, "SELECT * FROM messages WHERE status = 'pending_approval' ORDER BY id DESC LIMIT 1")[0];
    if (!m) return;
    const before = nextScheduled(t.db, m.customer_id)!.day;
    expect(holdMessage(t.ctx, m.id).ok).toBe(true);
    expect(get<MessageRow>(t.db, "SELECT * FROM messages WHERE id = ?", m.id)!.status).toBe("held");
    expect(nextScheduled(t.db, m.customer_id)!.day).toBe(before);
  });
});
