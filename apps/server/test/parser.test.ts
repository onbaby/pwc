import { describe, expect, it } from "vitest";
import type { Intent } from "@rot/contracts";
import { dayOf } from "@rot/core";
import { parseIntent } from "../src/intents/parser.ts";

const today = dayOf(2026, 10, 18);
const p = (t: string): Intent => parseIntent(t, today);
const names = (xs: string[]) => xs.map((t) => p(t).name);

describe("rule parser: closed intent list", () => {
  it("handles the keywords case-insensitively", () => {
    expect(names(["STOP", "stop", "Stop.", "STOPALL", "unsubscribe", "end", "quit"])).toEqual(Array(7).fill("STOP"));
    expect(names(["YES", "yes", "Yes!", "y", "yep"])).toEqual(Array(5).fill("YES"));
    expect(names(["OLD", "old"])).toEqual(["OLD", "OLD"]);
    expect(names(["SOONER", "sooner please"])).toEqual(["SOONER", "SOONER"]);
    expect(names(["SKIP", "skip this one"])).toEqual(["SKIP", "SKIP"]);
    expect(names(["WHY", "why?", "Why"])).toEqual(["WHY", "WHY", "WHY"]);
    expect(names(["HELP", "help", "?"])).toEqual(["HELP", "HELP", "HELP"]);
    expect(names(["START", "start"])).toEqual(["START", "START"]);
    expect(names(["BACK", "back"])).toEqual(["BACK", "BACK"]);
    expect(names(["HUMAN", "talk to a person", "real person"])).toEqual(Array(3).fill("HUMAN"));
  });
  it("OK and thumbs-up acknowledge and are never OLD", () => {
    expect(names(["OK", "ok", "okay", "thanks", "sounds good", "👍", "👍🏽"])).toEqual(Array(7).fill("OK"));
    expect(p("ok").name).not.toBe("OLD");
  });
  it("privacy commands", () => {
    expect(p("WHAT DO YOU KNOW").name).toBe("WHAT_DO_YOU_KNOW");
    expect(p("what do you know?").name).toBe("WHAT_DO_YOU_KNOW");
    expect(p("DELETE MY DATA").name).toBe("DELETE_MY_DATA");
    expect(p("please delete my data").name).toBe("DELETE_MY_DATA");
  });
  it("exact CANCEL cancels; CANCEL among other words only clarifies", () => {
    expect(p("CANCEL").name).toBe("CANCEL");
    expect(p("cancel").name).toBe("CANCEL");
    expect(p("cancel my subscription").name).toBe("CANCEL");
    expect(p("please don't cancel, I love it").name).toBe("CANCEL_AMBIGUOUS");
    expect(p("can I cancel next month instead").name).toBe("CANCEL_AMBIGUOUS");
    expect(p("don't cancel").name).toBe("CANCEL_AMBIGUOUS");
  });
});

describe("rule parser: weeks of coffee left", () => {
  const w = (t: string) => {
    const i = p(t);
    return i.name === "WEEKS" ? i.weeks : i.name;
  };
  it("plain numbers and phrasings", () => {
    expect(w("6")).toBe(6);
    expect(w("about 6")).toBe(6);
    expect(w("6 weeks")).toBe(6);
    expect(w("about 6 weeks left")).toBe(6);
    expect(w("2 wks")).toBe(2);
    expect(w("0")).toBe(0);
    expect(w("12")).toBe(12);
    expect(w("a couple of weeks")).toBe(2);
    expect(w("a few weeks")).toBe(3);
    expect(w("one week")).toBe(1);
    expect(w("three weeks")).toBe(3);
  });
  it("days convert to weeks; big numbers clip to 12", () => {
    expect(w("about 14 days")).toBe(2);
    expect(w("3 days left")).toBe(0);
    expect(w("40")).toBe(12);
  });
  it("out / none mean 0; plenty needs a number", () => {
    expect(w("out")).toBe(0);
    expect(w("none")).toBe(0);
    expect(w("we ran out")).toBe(0);
    expect(w("plenty")).toBe("PLENTY");
    expect(w("lots left")).toBe("PLENTY");
  });
});

describe("rule parser: dates are resolved against the virtual today", () => {
  it("heading to Denver till Nov 2 (Appendix A)", () => {
    const i = p("heading to Denver till Nov 2");
    expect(i.name).toBe("AWAY");
    expect(i.to).toBe(dayOf(2026, 11, 2));
    expect(i.place).toBe("Denver");
  });
  it("till the 20th, until Nov 2, tomorrow, next week", () => {
    expect(p("away till the 20th").to).toBe(dayOf(2026, 10, 20));
    expect(p("travelling until Nov 2").to).toBe(dayOf(2026, 11, 2));
    expect(p("out of town until tomorrow").to).toBe(dayOf(2026, 10, 19));
    const nw = p("away until next week");
    expect(nw.name).toBe("AWAY");
    expect(nw.to!).toBeGreaterThan(today);
    expect(nw.to!).toBeLessThanOrEqual(today + 8);
  });
  it("for N weeks and pause phrases", () => {
    expect(p("I'm away for 2 weeks").to).toBe(today + 14);
    expect(p("pause for 2 weeks")).toEqual({ name: "PAUSE", days: 14 });
    expect(p("pause 10 days")).toEqual({ name: "PAUSE", days: 10 });
    expect(p("pause").name).toBe("UNKNOWN");
  });
  it("away without a usable date goes to a person", () => {
    expect(p("heading out of town soon").name).toBe("UNKNOWN");
  });
});

describe("rule parser: anything else is UNKNOWN", () => {
  it("is the fallback", () => {
    expect(names(["Is the Ethiopia coming back in stock?", "can I change my grind", "", "   ", "asdf", "lol"])).toEqual(Array(6).fill("UNKNOWN"));
  });
});

describe("parser phrase suite (40 phrases)", () => {
  const cases: Array<[string, string]> = [
    ["STOP", "STOP"], ["Stop texting me", "STOP"], ["YES", "YES"], ["yes please", "YES"], ["OK", "OK"], ["Okay", "OK"], ["thx", "OK"],
    ["OLD", "OLD"], ["WHY", "WHY"], ["SOONER", "SOONER"], ["SKIP", "SKIP"], ["HELP", "HELP"], ["CANCEL", "CANCEL"],
    ["please don't cancel, I love it", "CANCEL_AMBIGUOUS"], ["BACK", "BACK"], ["WHAT DO YOU KNOW", "WHAT_DO_YOU_KNOW"],
    ["DELETE MY DATA", "DELETE_MY_DATA"], ["HUMAN", "HUMAN"], ["6", "WEEKS"], ["about 6", "WEEKS"], ["2 weeks left", "WEEKS"],
    ["0", "WEEKS"], ["out", "WEEKS"], ["plenty", "PLENTY"], ["heading to Denver till Nov 2", "AWAY"], ["away till the 20th", "AWAY"],
    ["travelling until Nov 2", "AWAY"], ["on vacation until Nov 5", "AWAY"], ["pause for 2 weeks", "PAUSE"], ["pause for a month", "PAUSE"],
    ["is the Ethiopia coming back", "UNKNOWN"], ["can I change my grind", "UNKNOWN"], ["wrong number", "UNKNOWN"], ["who is this", "UNKNOWN"],
    ["4 wks", "WEEKS"], ["roughly 3", "WEEKS"], ["one week", "WEEKS"], ["start", "START"], ["unsubscribe", "STOP"], ["👍", "OK"],
  ];
  it.each(cases)("%s -> %s", (text, expected) => {
    expect(p(text).name).toBe(expected);
  });
  it("has at least 40 cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
  });
});
