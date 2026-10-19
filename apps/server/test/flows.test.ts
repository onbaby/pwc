import { describe, expect, it } from "vitest";
import type { ConvState, PersonaId } from "@rot/contracts";
import { applyEvent, SseEventSchema, type DemoState, type SseEvent } from "@rot/contracts";
import { dayOf, fmtShort } from "@rot/core";
import { COPY } from "../src/copy.ts";
import { MIN_PER_DAY, minuteOf } from "../src/clock.ts";
import { World, type NewEvent } from "../src/world.ts";
import { resolve } from "node:path";

const artifactsDir = resolve(import.meta.dirname, "../../../artifacts");
const mk = () => new World({ artifactsDir });
const texts = (w: World, p: PersonaId) => w.subs[p].messages.filter((m) => m.from === "system").map((m) => m.text);
const last = (w: World, p: PersonaId) => w.subs[p].messages[w.subs[p].messages.length - 1]!;
const oct28 = dayOf(2026, 10, 28);
const nov11 = dayOf(2026, 11, 11);

function runTo(w: World, n: number) {
  while (w.step < n) w.next();
}

describe("scripted demo (Appendix A)", () => {
  it("S1: Maya says 6 -> later, Wed Oct 28 to Wed Nov 11, default-accepted, confirmed at +48 h", () => {
    const w = mk();
    runTo(w, 2); // s1b2
    const s = w.subs.maya;
    expect(s.proposal).toMatchObject({ kind: "later", oldArrival: oct28, newArrival: nov11, status: "applied", requiresYes: false });
    expect(s.currentArrival).toBe(nov11);
    expect(last(w, "maya").text).toBe(COPY.laterProposal({ name: "Maya", weeks: 6, old: oct28, new: nov11 }));
    expect(last(w, "maya").text).toBe("Maya, you said about 6 weeks left, so we've moved your delivery from Wed Oct 28 to Wed Nov 11. Nothing to do. Want Wed Oct 28 instead? Reply OLD.");
    const th = w.snapshot().threads.maya;
    expect(th.forecast?.confidence).toBe("Medium");
    expect(th.forecast?.note).toContain("two weeks later: the most we move at once");
    w.next(); // s1b3: +48 h
    expect(w.subs.maya.proposal?.status).toBe("confirmed");
    expect(w.banner).toBe("+48 h, no reply: new date confirmed");
    w.next(); // s1b4: WHY
    expect(last(w, "maya").text).toMatch(/^Your last check-in said about 6 weeks left on Oct 18/);
    expect(w.snapshot().threads.maya.explanation?.evidence.text).toBe("On Oct 18, Maya said about 6 weeks left.");
  });

  it("S2: Priya's trip holds the Oct 28 delivery and ships Wed Nov 4", () => {
    const w = mk();
    runTo(w, 5);
    const p = w.subs.priya;
    expect(p.state).toBe("AWAY");
    expect(p.proposal).toMatchObject({ kind: "away", oldArrival: oct28, newArrival: dayOf(2026, 11, 4) });
    expect(last(w, "priya").text).toBe(COPY.away({ place: "Denver", date: dayOf(2026, 11, 2), old: oct28, ship: dayOf(2026, 11, 4) }));
  });

  it("S3: Dev, day 4, no reply -> Not yet sure, hold off, no change, not on the person list; Jo's unclear reply is", () => {
    const w = mk();
    runTo(w, 6);
    const dev = w.snapshot().threads.dev;
    expect(dev.forecast?.confidence).toBe("Not yet sure");
    expect(dev.forecast?.abstain).toBe(true);
    expect(dev.currentArrival).toBe(dev.oldArrival);
    expect(w.humanQueue.map((q) => q.persona)).toEqual(["jo"]);
    expect(w.counters.cohort).toBe(100);
    expect(w.counters.heldOff).toBeGreaterThan(0);
    expect(w.clock.day).toBe(dayOf(2026, 10, 18));
    expect(texts(w, "dev").at(-1)).toContain("How's the first bag going?");
  });

  it("goto(n) equals stepping there (the engine is seeded)", () => {
    const a = mk();
    runTo(a, 7);
    const b = mk();
    b.goto(7);
    const sa = JSON.stringify({ ...a.snapshot(), lastEventId: 0 });
    const sb = JSON.stringify({ ...b.snapshot(), lastEventId: 0 });
    expect(sb).toBe(sa);
    b.goto(2);
    expect(b.subs.maya.proposal?.status).toBe("applied");
    b.goto(0);
    expect(b.subs.maya.messages).toHaveLength(3);
  });

  it("a typed reply works as well as the scripted one, and the step key does not double it", () => {
    const w = mk();
    runTo(w, 1);
    w.inbound("maya", "about 6 weeks", "customer");
    w.next(); // s1b2 sees a reply and does not inject
    expect(w.subs.maya.history.replies).toHaveLength(1);
    expect(w.subs.maya.currentArrival).toBe(nov11);
  });
});

describe("replies and proposals", () => {
  const setup = (reply: string) => {
    const w = mk();
    runTo(w, 1);
    w.inbound("maya", reply, "customer");
    return w;
  };
  it("a 0-weeks reply gets a same-day expedite offer that needs a YES and never charges silently", () => {
    const w = setup("0");
    const p = w.subs.maya.proposal!;
    expect(p.kind).toBe("sooner");
    expect(p.status).toBe("pending");
    expect(w.subs.maya.currentArrival).toBe(oct28);
    w.inbound("maya", "ok", "customer");
    expect(w.subs.maya.proposal?.status).toBe("pending");
    w.advanceHours(49);
    expect(w.subs.maya.proposal?.status).toBe("expired");
    expect(w.subs.maya.currentArrival).toBe(oct28);
  });
  it("YES accepts a pending sooner move", () => {
    const w = setup("0");
    w.inbound("maya", "YES", "customer");
    expect(w.subs.maya.proposal?.status).toBe("confirmed");
    expect(w.subs.maya.currentArrival).toBeLessThan(oct28);
  });
  it("OLD reverts a default-accepted move; OK never does", () => {
    const w = setup("6");
    w.inbound("maya", "OK", "customer");
    w.inbound("maya", "👍", "customer");
    expect(w.subs.maya.currentArrival).toBe(nov11);
    w.inbound("maya", "OLD", "customer");
    expect(w.subs.maya.currentArrival).toBe(oct28);
    expect(w.subs.maya.proposal?.status).toBe("reverted");
    expect(last(w, "maya").text).toBe(COPY.oldReverted({ old: oct28 }));
  });
  it("'plenty' asks for a number once, then goes to a person", () => {
    const w = setup("plenty");
    expect(last(w, "maya").text).toBe(COPY.needNumber());
    w.inbound("maya", "lots", "customer");
    expect(w.humanQueue).toHaveLength(1);
  });
  it("no reply means no change: advancing the clock moves nothing", () => {
    const w = mk();
    runTo(w, 1);
    w.advanceHours(48);
    expect(w.subs.maya.currentArrival).toBe(oct28);
  });
  it("never more than 3 texts in a cycle", () => {
    const w = setup("6");
    for (let i = 0; i < 6; i++) w.inbound("maya", i % 2 ? "6" : "2", "customer");
    expect(w.subs.maya.cycle.textsSent).toBeLessThanOrEqual(3);
  });
});

describe("consent, STOP and CANCEL", () => {
  const states: ConvState[] = ["OPT_IN_PENDING", "ACTIVE", "AWAITING_CHECKIN", "AWAITING_PROPOSAL", "AWAY", "PAUSED", "CANCELLED", "OPTED_OUT"];
  it.each(states)("STOP in state %s ends texts", (st) => {
    const w = mk();
    runTo(w, 1);
    w.subs.maya.state = st;
    if (st === "CANCELLED") w.subs.maya.cancel = { atMinute: w.clock.minute, prevState: "ACTIVE", prevArrival: oct28 };
    const before = texts(w, "maya").length;
    w.inbound("maya", "STOP", "customer");
    expect(w.subs.maya.state).toBe("OPTED_OUT");
    expect(texts(w, "maya").length).toBe(before + (st === "OPTED_OUT" ? 0 : 1));
  });
  it("double STOP is silent, and nothing but START / HELP gets a reply afterwards", () => {
    const w = mk();
    runTo(w, 1);
    w.inbound("maya", "STOP", "customer");
    const n = texts(w, "maya").length;
    w.inbound("maya", "STOP", "customer");
    w.inbound("maya", "6", "customer");
    w.inbound("maya", "what is this", "customer");
    expect(texts(w, "maya").length).toBe(n);
    expect(w.subs.maya.history.replies).toHaveLength(0);
    expect(w.humanQueue).toHaveLength(0);
    w.inbound("maya", "HELP", "customer");
    expect(last(w, "maya").text).toBe(COPY.help());
    w.inbound("maya", "START", "customer");
    expect(w.subs.maya.state).not.toBe("OPTED_OUT");
  });
  it("exact CANCEL cancels at once; free text with 'cancel' only clarifies, once", () => {
    const w = mk();
    runTo(w, 1);
    w.inbound("maya", "please don't cancel, I love it", "customer");
    expect(w.subs.maya.state).not.toBe("CANCELLED");
    expect(last(w, "maya").text).toBe(COPY.cancelClarify());
    w.inbound("maya", "CANCEL", "customer");
    expect(w.subs.maya.state).toBe("CANCELLED");
    expect(last(w, "maya").text).toBe(COPY.cancel());
  });
  it("BACK undoes a cancellation at 23 h 59 but not at 24 h 01", () => {
    for (const [mins, ok] of [[23 * 60 + 59, true], [24 * 60 + 1, false]] as const) {
      const w = mk();
      runTo(w, 1);
      w.inbound("maya", "CANCEL", "customer");
      w.advanceTo(w.subs.maya.cancel ? w.subs.maya.cancel.atMinute + mins : 0);
      w.inbound("maya", "BACK", "customer");
      expect(w.subs.maya.state === "CANCELLED").toBe(!ok);
      expect(last(w, "maya").text).toBe(ok ? COPY.back() : COPY.backTooLate());
    }
  });
  it("DELETE MY DATA erases engine data and stops texts; WHAT DO YOU KNOW answers", () => {
    const w = mk();
    runTo(w, 2);
    w.inbound("maya", "WHAT DO YOU KNOW", "customer");
    expect(last(w, "maya").text).toBe(COPY.whatDoYouKnow());
    w.inbound("maya", "DELETE MY DATA", "customer");
    expect(w.subs.maya.history.replies).toHaveLength(0);
    expect(w.subs.maya.state).toBe("OPTED_OUT");
    expect(w.snapshot().threads.maya.forecast).toBeUndefined();
  });
  it("unknown intents go to a person with the standard reply", () => {
    const w = mk();
    runTo(w, 1);
    w.inbound("maya", "can I change my grind", "customer");
    expect(last(w, "maya").text).toBe(COPY.unknown());
    expect(w.humanQueue[0]!.reason).toBe("Unclear reply");
  });
  it("Sam's 'Can they leave?' script runs end to end", () => {
    const w = mk();
    while (w.samNext());
    const s = w.subs.sam;
    expect(s.state).toBe("OPTED_OUT");
    expect(s.erased).toBe(true);
    expect(texts(w, "sam")).toContain(COPY.stop());
    expect(texts(w, "sam")).toContain(COPY.cancel());
    expect(texts(w, "sam")).toContain(COPY.back());
  });
});

describe("clock", () => {
  it("runs several due items in time order across a long jump", () => {
    const w = mk();
    runTo(w, 2); // Maya moved to Nov 11; confirm at +48h, reminder 3 days before, delivery on the day
    const before = w.subs.maya.messages.length;
    w.advanceTo(minuteOf(nov11, "12:00"));
    const th = w.subs.maya;
    const sys = th.messages.slice(before).filter((m) => m.from === "system");
    expect(sys[0]!.text).toBe(COPY.reminder({ new: nov11 }));
    expect(th.history.deliveries).toContain(nov11);
    expect(th.currentArrival).toBe(nov11 + 28);
    expect(w.clock.minute).toBe(minuteOf(nov11, "12:00"));
    // the next cycle's check-in is scheduled 10 days before the following delivery
    expect(w.due.some((d) => d.kind === "checkin" && d.persona === "maya")).toBe(true);
  });
  it("defers proactive texts out of quiet hours to 8 am", () => {
    const w = mk();
    runTo(w, 1);
    w.clock.set(minuteOf(dayOf(2026, 10, 18), "22:00"));
    w.sendCheckIn("dev");
    expect(texts(w, "dev").length).toBe(2); // consent confirmation history only: no check-in yet
    w.advanceTo(minuteOf(dayOf(2026, 10, 19), "08:00"));
    expect(texts(w, "dev").at(-1)).toContain("How's the first bag going?");
    expect(last(w, "dev").hhmm).toBe("08:00");
    expect(last(w, "dev").atMinute).toBeGreaterThanOrEqual(minuteOf(dayOf(2026, 10, 19), "08:00"));
    void MIN_PER_DAY;
  });
});

describe("events", () => {
  it("deltas applied to a snapshot reproduce the server state, and every event validates", () => {
    const events: NewEvent[] = [];
    const w = new World({ artifactsDir, emit: (e) => events.push(e) });
    let state: DemoState | undefined = w.snapshot();
    let id = 0;
    const apply = () => {
      for (const e of events.splice(0)) {
        const ev = { ...e, id: ++id } as SseEvent;
        SseEventSchema.parse(JSON.parse(JSON.stringify(ev)));
        state = applyEvent(state, ev);
      }
    };
    for (let i = 0; i < 7; i++) {
      w.next();
      apply();
    }
    const server = w.snapshot();
    expect(state!.step).toBe(server.step);
    expect(state!.threads.maya.messages).toEqual(server.threads.maya.messages);
    expect(state!.threads.priya.state).toBe(server.threads.priya.state);
    expect(state!.humanQueue).toEqual(server.humanQueue);
    expect(fmtShort(state!.threads.maya.currentArrival)).toBe("Wed Nov 11");
  });
});

describe("copy deck golden", () => {
  it("renders every template with the scenario's dates and names", () => {
    expect(COPY.checkIn({ name: "Maya" })).toBe("Hi Maya, Classic Cup (Athens) here. So your next delivery lands when you need it: about how many weeks of coffee do you have left? Reply a number (0 = out). Automated; reply STOP to end texts.");
    expect(COPY.reminder({ new: nov11 })).toBe("Your coffee arrives Wed Nov 11. Running low? Reply SOONER and we'll check what we can do.");
    expect(COPY.soonerProposal({ old: oct28, sooner: dayOf(2026, 10, 21), amount: 34 })).toBe("You may run out before Wed Oct 28. Ship sooner, on Wed Oct 21 ($34 charged then)? Reply YES. No reply keeps Wed Oct 28.");
    expect(COPY.why({ weeks: 6, date: dayOf(2026, 10, 18), old: oct28 })).toBe("Your last check-in said about 6 weeks left on Oct 18, and your deliveries have been landing with coffee still in the pantry. Reply OLD to keep Wed Oct 28.");
    expect(COPY.stop()).toBe("You won't get any more texts from us. Your coffee deliveries are not affected. Reply START to get texts again.");
    expect(COPY.unknown()).toBe("Thanks. A person on the Classic Cup team will reply by 5 pm the next business day.");
    expect(COPY.consent()).toContain("we never charge you earlier without your YES");
  });
});
