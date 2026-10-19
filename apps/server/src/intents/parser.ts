import * as chrono from "chrono-node";
import type { Intent } from "@rot/contracts";
import { dayOf, parts, type Day } from "@rot/core";

/**
 * Rule parser (spec 7.3-7.4). Case-insensitive keywords; chrono-node for date phrases, resolved relative to the virtual
 * today. Closed intent list; anything else is UNKNOWN and goes to a person. No network.
 */

const WORD_NUMBERS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

const EXACT: Array<[Set<string>, Intent["name"]]> = [
  [new Set(["stop", "stopall", "stop all", "unsubscribe", "end", "quit", "opt out", "optout"]), "STOP"],
  [new Set(["start", "unstop", "resume", "restart"]), "START"],
  [new Set(["help", "?", "info"]), "HELP"],
  [new Set(["yes", "y", "yeah", "yep", "yup", "yes please", "sure", "ya", "confirm"]), "YES"],
  [new Set(["ok", "okay", "k", "kk", "thanks", "thank you", "thx", "ty", "got it", "great", "sounds good", "perfect", "cool", "👍", "👍🏽", "👍🏻", "👍🏼", "👍🏾", "👍🏿"]), "OK"],
  [new Set(["old", "old date", "keep old", "undo"]), "OLD"],
  [new Set(["sooner", "sooner please", "earlier", "send sooner", "ship sooner"]), "SOONER"],
  [new Set(["skip", "skip this one", "skip it", "skip next", "skip this delivery"]), "SKIP"],
  [new Set(["back"]), "BACK"],
  [new Set(["why", "why?", "why was this moved", "why did you move it", "explain"]), "WHY"],
  [new Set(["what do you know", "what do you know about me"]), "WHAT_DO_YOU_KNOW"],
  [new Set(["delete my data", "delete data", "erase my data", "delete my info"]), "DELETE_MY_DATA"],
  [new Set(["human", "agent", "person", "representative", "talk to a person", "talk to a human", "speak to a person", "speak to a human", "real person", "customer service"]), "HUMAN"],
  [new Set(["cancel", "cancel subscription", "cancel my subscription", "cancel please", "please cancel", "cancel my order"]), "CANCEL"],
];

function normalise(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[.!,;:]+$/g, "")
    .replace(/\?+$/g, (m) => (m.length ? "?" : ""))
    .trim();
}

function refDate(today: Day): Date {
  const p = parts(today);
  return new Date(p.year, p.month - 1, p.date, 12, 0, 0);
}

function toDay(d: Date): Day {
  return dayOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** chrono does not read a bare ordinal ("till the 20th"): the next occurrence of that day of the month. */
function parseOrdinalDay(text: string, today: Day): Day | undefined {
  const m = /\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/i.exec(text);
  if (!m) return undefined;
  const dom = Number(m[1]);
  if (dom < 1 || dom > 31) return undefined;
  const t = parts(today);
  for (let add = 0; add < 3; add++) {
    const month0 = t.month - 1 + add;
    const d = new Date(Date.UTC(t.year, month0, dom));
    if (d.getUTCDate() !== dom) continue; // month has no such day
    const day = dayOf(d.getUTCFullYear(), d.getUTCMonth() + 1, dom);
    if (day >= today) return day;
  }
  return undefined;
}

function parseDates(text: string, today: Day): Day[] {
  const results = chrono.parse(text, refDate(today), { forwardDate: true });
  const days: Day[] = [];
  for (const r of results) {
    days.push(toDay(r.start.date()));
    if (r.end) days.push(toDay(r.end.date()));
  }
  if (days.length === 0) {
    const o = parseOrdinalDay(text, today);
    if (o !== undefined) days.push(o);
  }
  return days;
}

function clampWeeks(n: number): number {
  return Math.max(0, Math.min(12, Math.round(n)));
}

function numberFromWords(n: string): number | undefined {
  const m = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/.exec(n);
  return m ? WORD_NUMBERS[m[1]!] : undefined;
}

const AWAY_WORDS = /\b(heading|headed|away|travel(?:l?ing)?|trip|vacation|holiday|out of town|out of the country|gone|visiting|leaving|be back|back on|back in|abroad|going to|off to|on the road)\b/;

function extractPlace(text: string): string | undefined {
  const m = /\b(?:to|in|at|visiting)\s+([A-Z][a-zA-Z.]+(?:\s+[A-Z][a-zA-Z.]+)?)/.exec(text);
  if (!m) return undefined;
  const place = m[1]!.trim();
  if (/^(?:Next|The|My|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.test(place)) return undefined;
  return place;
}

export function parseIntent(text: string, today: Day): Intent {
  const raw = text.trim();
  const n = normalise(raw);
  if (!n) return { name: "UNKNOWN" };

  // 1. closed list of exact phrases
  for (const [set, name] of EXACT) if (set.has(n)) return { name };
  if (/^(👍|👌|🙏)+$/u.test(raw)) return { name: "OK" };

  // 2. "cancel" among other words: one clarifying text, never an automatic cancel
  if (/\bcancel/.test(n)) return { name: "CANCEL_AMBIGUOUS" };

  // 3. other explicit requests inside longer sentences
  if (/\bdelete (all )?my (data|info|information)\b/.test(n)) return { name: "DELETE_MY_DATA" };
  if (/\bwhat do you know\b/.test(n)) return { name: "WHAT_DO_YOU_KNOW" };
  if (/^(please )?stop( texting| messaging| texts| the texts)?( me)?( please)?$/.test(n)) return { name: "STOP" };
  if (/\b(talk|speak|chat) (to|with) (a |an )?(human|person|someone|agent|rep)\b/.test(n)) return { name: "HUMAN" };

  // 4. away / pause (before the weeks parser so "away for 2 weeks" is not a pantry reply)
  if (/\bpause\b/.test(n)) {
    const untilDates = parseDates(raw, today);
    const w = /(\d{1,3})\s*(day|week|wk|month)s?/.exec(n);
    if (w) {
      const unit = w[2]!;
      const days = Number(w[1]) * (unit.startsWith("day") ? 1 : unit.startsWith("month") ? 30 : 7);
      return { name: "PAUSE", days };
    }
    if (/\ba month\b/.test(n)) return { name: "PAUSE", days: 30 };
    if (/\b(a|one) week\b/.test(n)) return { name: "PAUSE", days: 7 };
    if (/\b(a couple|couple of|two) weeks\b/.test(n)) return { name: "PAUSE", days: 14 };
    if (untilDates.length) return { name: "PAUSE", days: Math.max(1, untilDates[untilDates.length - 1]! - today) };
    return { name: "UNKNOWN" };
  }
  if (AWAY_WORDS.test(n) || /\b(?:till|until|through|thru)\b/.test(n)) {
    const dates = parseDates(raw, today).filter((d) => d >= today);
    const place = extractPlace(raw);
    const forWeeks = /\bfor (?:about |around )?(\d{1,2}|a|one|two|three|four) (day|week|wk)s?\b/.exec(n);
    if (dates.length >= 2) return { name: "AWAY", from: dates[0]!, to: dates[dates.length - 1]!, place };
    if (dates.length === 1) return { name: "AWAY", from: today, to: dates[0]!, place };
    if (forWeeks) {
      const q = forWeeks[1]!;
      const count = /^\d/.test(q) ? Number(q) : q === "a" || q === "one" ? 1 : q === "two" ? 2 : q === "three" ? 3 : 4;
      const days = count * (forWeeks[2]!.startsWith("day") ? 1 : 7);
      return { name: "AWAY", from: today, to: today + days, place };
    }
    if (AWAY_WORDS.test(n)) return { name: "UNKNOWN" };
  }

  // 5. weeks of coffee left
  if (/^(out|none|empty|nothing|zero|0)( left)?$/.test(n) || /\b(ran out|run out|am out|are out|we're out|i'm out|out of coffee|no coffee|none left|nothing left|all gone)\b/.test(n)) {
    return { name: "WEEKS", weeks: 0 };
  }
  if (/\b(plenty|lots|loads|tons|a lot|heaps|stocked|more than enough|too much)\b/.test(n) && !/\d/.test(n)) return { name: "PLENTY" };
  let m = /^(?:about |around |roughly |approx(?:imately)? |~|like )?(\d{1,2}(?:\.\d)?)(?:\s*(?:weeks?|wks?|w))?(?: left)?$/.exec(n);
  if (m) return { name: "WEEKS", weeks: clampWeeks(Number(m[1])) };
  m = /(\d{1,2}(?:\.\d)?)\s*(?:-|to)?\s*(?:\d{1,2}\s*)?(?:weeks?|wks?)\b/.exec(n);
  if (m) return { name: "WEEKS", weeks: clampWeeks(Number(m[1])) };
  m = /(\d{1,3})\s*days?\b/.exec(n);
  if (m) return { name: "WEEKS", weeks: clampWeeks(Number(m[1]) / 7) };
  if (/\b(a couple|couple of|couple)\b.*\bweeks?\b/.test(n)) return { name: "WEEKS", weeks: 2 };
  if (/\ba few weeks\b|\bfew weeks\b/.test(n)) return { name: "WEEKS", weeks: 3 };
  if (/\b(a|one) week\b/.test(n)) return { name: "WEEKS", weeks: 1 };
  const word = numberFromWords(n);
  if (word !== undefined && /\bweeks?\b/.test(n)) return { name: "WEEKS", weeks: clampWeeks(word) };
  if (word !== undefined && n.split(" ").length <= 2) return { name: "WEEKS", weeks: clampWeeks(word) };
  m = /\b(?:about|around|roughly|approx(?:imately)?)\s+(\d{1,2})\b/.exec(n);
  if (m) return { name: "WEEKS", weeks: clampWeeks(Number(m[1])) };

  return { name: "UNKNOWN" };
}
