import { readFileSync } from "node:fs";
import type {
  ChannelName,
  ConvState,
  DemoState,
  ExplanationCard,
  HumanQueueItem,
  Intent,
  Message,
  Mode,
  ParseLogEntry,
  PersonaId,
  PersonaSpec,
  ProposalView,
  Scenario,
  SseEvent,
  StepId,
  Thread,
} from "@rot/contracts";
import {
  EXHIBITS,
  between,
  decide,
  expediteOffer,
  explain,
  fmtMonthDay,
  forecast,
  nextShipDay,
  parseISO,
  replayFilter,
  whatIfReplies,
  DECISION,
  type Day,
  type Decision,
  type Forecast,
  type SubscriberHistory,
} from "@rot/core";
import { BANNERS, COPY } from "./copy.ts";
import { DemoClock, MIN_PER_DAY, inQuietHours, minuteOf, nextSendableMinute } from "./clock.ts";
import { parseIntent } from "./intents/parser.ts";
import { SAM_SCRIPT_KEYS, SCENARIO } from "./scenario/scenario.ts";
import { forecastView, pantryView } from "./views.ts";

type Distribute<E> = E extends { id: number } ? Omit<E, "id"> : never;
export type NewEvent = Distribute<SseEvent>;

interface Proposal extends ProposalView {
  weeks?: number;
  replyDay?: Day;
}

interface Cycle {
  n: number;
  startDay: Day;
  baseArrival: Day;
  textsSent: number;
  askedNumber: boolean;
  askedCancel: boolean;
  freshReply: boolean;
  replyWeeks?: number;
  replyDay?: Day;
}

interface Sub {
  spec: PersonaSpec;
  id: PersonaId;
  state: ConvState;
  stateBeforeStop?: ConvState;
  history: SubscriberHistory;
  oldArrival: Day;
  currentArrival: Day;
  messages: Message[];
  cycle: Cycle;
  proposal?: Proposal;
  cancel?: { atMinute: number; prevState: ConvState; prevArrival: Day };
  explanation?: ExplanationCard;
  erased: boolean;
  optedInDay: Day;
}

type DueKind = "confirm" | "expire" | "reminder" | "cancel_final" | "away_end" | "pause_end" | "deferred_send" | "delivery" | "checkin";
interface Due {
  seq: number;
  at: number;
  kind: DueKind;
  persona: PersonaId;
  text?: string;
  /** guards against stale items after an undo */
  token?: number;
}

export interface WorldOptions {
  scenario?: Scenario;
  artifactsDir?: string;
  emit?: (ev: NewEvent) => void;
  /** outbound text for live channels (Photon); the on-screen thread is always updated */
  outbound?: (persona: PersonaId, text: string) => void;
}

const HOURS_48 = 48 * 60;

export class World {
  readonly scenario: Scenario;
  readonly today: Day;
  clock: DemoClock;
  subs = {} as Record<PersonaId, Sub>;
  due: Due[] = [];
  humanQueue: HumanQueueItem[] = [];
  parseLog: ParseLogEntry[] = [];
  step = 0;
  mode: Mode = "replay";
  channel: ChannelName = "replay";
  parser: "RULES" | "RULES+LLM" = "RULES";
  modeNote: string | undefined;
  noNetwork = false;
  activePersona: PersonaId = "maya";
  banner: string | undefined;
  hint: string | undefined;
  samIndex = 0;
  counters = { heldOff: 0, cohort: 100 };
  budgetBlocked = 0;
  private msgId = 0;
  private qId = 0;
  private logId = 0;
  private dueSeq = 0;
  private token = 0;
  private silent = false;
  private lastEventId = 0;
  private readonly emitFn: (ev: NewEvent) => void;
  private readonly outbound?: (persona: PersonaId, text: string) => void;
  private readonly artifactsDir?: string;

  constructor(opts: WorldOptions = {}) {
    this.scenario = opts.scenario ?? SCENARIO;
    this.today = parseISO(this.scenario.todayISO);
    this.emitFn = opts.emit ?? (() => {});
    this.outbound = opts.outbound;
    this.artifactsDir = opts.artifactsDir;
    this.clock = new DemoClock(0);
    this.reset();
  }

  // ---------------------------------------------------------------- lifecycle

  /** Atomic reset: server state, clock, lists, counters. The caller broadcasts a snapshot. */
  reset(): void {
    this.clock = new DemoClock(minuteOf(this.today, "09:55"));
    this.due = [];
    this.humanQueue = [];
    this.parseLog = [];
    this.step = 0;
    this.activePersona = "maya";
    this.banner = undefined;
    this.hint = undefined;
    this.samIndex = 0;
    this.budgetBlocked = 0;
    this.msgId = 0;
    this.qId = 0;
    this.logId = 0;
    this.dueSeq = 0;
    this.token = 0;
    this.counters = { heldOff: this.heldOffFromArtifact(), cohort: this.scenario.cohortSize };
    for (const spec of this.scenario.personas) this.subs[spec.id] = this.makeSub(spec);
    this.runStep(this.scenario.stepOrder[0]!);
  }

  private heldOffFromArtifact(): number {
    try {
      if (!this.artifactsDir) return 0;
      const g = JSON.parse(readFileSync(`${this.artifactsDir}/sim_grid.json`, "utf8")) as { cells: Array<{ key: { replyBase: number; replyAccuracySd: number; cautiousness: number }; paced: { diag: { holdOffShare: number } } }> };
      const c = g.cells.find((x) => x.key.replyBase === 0.45 && x.key.replyAccuracySd === 0.35 && x.key.cautiousness === 0.1);
      return c ? Math.round(c.paced.diag.holdOffShare * this.scenario.cohortSize) : 0;
    } catch {
      return 0;
    }
  }

  private makeSub(spec: PersonaSpec): Sub {
    const deliveries = spec.deliveriesISO.map(parseISO);
    const next = parseISO(spec.nextArrivalISO);
    const optedInDay = parseISO(spec.optedInISO);
    const sub: Sub = {
      spec,
      id: spec.id,
      state: "ACTIVE",
      history: { id: spec.id, deliveries, replies: [], skips: [], away: [] },
      oldArrival: next,
      currentArrival: next,
      messages: [],
      cycle: { n: 0, startDay: this.today, baseArrival: next, textsSent: 0, askedNumber: false, askedCancel: false, freshReply: false },
      erased: false,
      optedInDay,
    };
    const at = minuteOf(optedInDay, "10:12");
    sub.messages.push(this.mkMessage(at, "system", "system", COPY.consent()));
    sub.messages.push(this.mkMessage(at + 1, "customer", "scripted", "YES"));
    sub.messages.push(this.mkMessage(at + 1, "system", "system", COPY.optInConfirmed()));
    this.scheduleDelivery(sub);
    return sub;
  }

  // ---------------------------------------------------------------- events

  private emit(ev: NewEvent): void {
    if (!this.silent) this.emitFn(ev);
  }

  /** Run `fn` without emitting; the caller then broadcasts a snapshot (used for goto / prev). */
  quietly<T>(fn: () => T): T {
    const prev = this.silent;
    this.silent = true;
    try {
      return fn();
    } finally {
      this.silent = prev;
    }
  }

  setLastEventId(id: number): void {
    this.lastEventId = id;
  }

  snapshot(): DemoState {
    const threads = {} as Record<PersonaId, Thread>;
    for (const id of Object.keys(this.subs) as PersonaId[]) threads[id] = this.threadView(this.subs[id]);
    return {
      mode: this.mode,
      channel: this.channel,
      parser: this.parser,
      modeNote: this.modeNote,
      noNetwork: this.noNetwork,
      clockMinute: this.clock.minute,
      clockDay: this.clock.day,
      step: this.step,
      stepCount: this.scenario.stepOrder.length,
      stepId: this.scenario.stepOrder[this.step]!,
      activePersona: this.activePersona,
      threads,
      humanQueue: [...this.humanQueue],
      counters: { ...this.counters },
      banner: this.banner,
      hint: this.hint,
      lastEventId: this.lastEventId,
    };
  }

  private mkMessage(atMinute: number, from: "system" | "customer", tag: Message["tag"], text: string): Message {
    return { id: ++this.msgId, atMinute, day: Math.floor(atMinute / MIN_PER_DAY), hhmm: this.clock.hhmm(atMinute), from, tag, text };
  }

  private pushMessage(sub: Sub, from: "system" | "customer", tag: Message["tag"], text: string): Message {
    const m = this.mkMessage(this.clock.minute, from, tag, text);
    sub.messages.push(m);
    this.emit({ type: "message", persona: sub.id, message: m });
    return m;
  }

  private refresh(sub: Sub): void {
    this.emit({ type: "thread", persona: sub.id, thread: this.threadView(sub) });
  }

  private emitClock(): void {
    this.emit({ type: "clock", clockMinute: this.clock.minute, clockDay: this.clock.day });
  }

  private emitQueue(): void {
    this.emit({ type: "queue", humanQueue: [...this.humanQueue] });
  }

  setBanner(text: string | undefined): void {
    this.banner = text;
    this.emit({ type: "banner", banner: text });
  }

  setMode(mode: Mode, channel: ChannelName, note?: string): void {
    this.mode = mode;
    this.channel = channel;
    this.modeNote = note;
    this.emit({ type: "mode", mode, channel, parser: this.parser, modeNote: note });
  }

  // ---------------------------------------------------------------- sending

  /**
   * Send a text. `legal` responses (STOP, HELP, CANCEL confirmations) are never blocked. Everything else respects the
   * budget of 3 texts per cycle and quiet hours (none 9 pm - 8 am recipient time; deferred to 8 am).
   */
  private say(sub: Sub, text: string, opts: { legal?: boolean; proactive?: boolean } = {}): void {
    if (!opts.legal) {
      if (opts.proactive && inQuietHours(this.clock.minute)) {
        this.addDue({ at: nextSendableMinute(this.clock.minute), kind: "deferred_send", persona: sub.id, text });
        return;
      }
      if (sub.cycle.textsSent >= 3) {
        this.budgetBlocked++;
        return;
      }
      sub.cycle.textsSent++;
    }
    this.pushMessage(sub, "system", "system", text);
    this.outbound?.(sub.id, text);
  }

  // ---------------------------------------------------------------- due items

  private addDue(d: Omit<Due, "seq">): Due {
    const item = { ...d, seq: ++this.dueSeq };
    this.due.push(item);
    return item;
  }

  private dropDue(persona: PersonaId, kinds: DueKind[]): void {
    this.due = this.due.filter((d) => !(d.persona === persona && kinds.includes(d.kind)));
  }

  private scheduleDelivery(sub: Sub): void {
    this.dropDue(sub.id, ["delivery"]);
    this.addDue({ at: minuteOf(sub.currentArrival, "06:00"), kind: "delivery", persona: sub.id });
  }

  /** Advance the virtual clock, running every due item in time order (ties by creation order). */
  advanceTo(target: number): void {
    for (;;) {
      const next = this.due.filter((d) => d.at <= target).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!next) break;
      this.due = this.due.filter((d) => d !== next);
      if (next.at > this.clock.minute) this.clock.set(next.at);
      this.runDue(next);
    }
    if (target > this.clock.minute) this.clock.set(target);
    this.emitClock();
  }

  advanceHours(h: number): void {
    this.advanceTo(this.clock.minute + h * 60);
  }

  private runDue(d: Due): void {
    const sub = this.subs[d.persona];
    switch (d.kind) {
      case "confirm":
        if (sub.proposal?.status === "applied" && sub.proposal.confirmAtMinute === d.at) {
          sub.proposal.status = "confirmed";
          this.setBanner(BANNERS.confirmed(HOURS_48 / 60));
          this.refresh(sub);
        }
        break;
      case "expire":
        if (sub.proposal?.status === "pending" && d.token === sub.proposal.confirmAtMinute) {
          sub.proposal.status = "expired";
          this.refresh(sub);
        }
        break;
      case "reminder":
        if (sub.state !== "OPTED_OUT" && sub.state !== "CANCELLED" && sub.currentArrival === (d.token as number) && sub.proposal?.status !== "reverted") {
          this.say(sub, COPY.reminder({ new: sub.currentArrival }), { proactive: true });
          this.refresh(sub);
        }
        break;
      case "cancel_final":
        if (sub.cancel && sub.cancel.atMinute === d.token) {
          sub.cancel = undefined;
          this.refresh(sub);
        }
        break;
      case "away_end":
      case "pause_end":
        if (sub.state === "AWAY" || sub.state === "PAUSED") sub.state = "ACTIVE";
        this.refresh(sub);
        break;
      case "deferred_send":
        if (sub.state !== "OPTED_OUT") this.say(sub, d.text ?? "", { proactive: true });
        this.refresh(sub);
        break;
      case "delivery":
        this.onDelivery(sub);
        break;
      case "checkin":
        if (sub.state === "ACTIVE") this.sendCheckIn(sub.id);
        break;
    }
  }

  private onDelivery(sub: Sub): void {
    if (sub.state === "CANCELLED" || sub.state === "PAUSED") return;
    const day = this.clock.day;
    if (sub.currentArrival !== day) return;
    sub.history.deliveries.push(day);
    sub.currentArrival = day + sub.spec.cadenceDays;
    sub.oldArrival = sub.currentArrival;
    sub.proposal = undefined;
    sub.cycle = { n: sub.cycle.n, startDay: day, baseArrival: sub.currentArrival, textsSent: 0, askedNumber: false, askedCancel: false, freshReply: false };
    if (sub.state === "AWAITING_CHECKIN" || sub.state === "AWAITING_PROPOSAL") sub.state = "ACTIVE";
    this.scheduleDelivery(sub);
    this.addDue({ at: minuteOf(sub.currentArrival - 10, this.scenario.checkInHHMM), kind: "checkin", persona: sub.id });
    this.refresh(sub);
  }

  // ---------------------------------------------------------------- engine glue

  private prior(sub: Sub) {
    return { mu: Math.log(sub.spec.prior.medianDays), tau: sub.spec.prior.tau };
  }

  private inFreeze(sub: Sub): boolean {
    const from = parseISO(this.scenario.freezeFromISO);
    const to = parseISO(this.scenario.freezeToISO);
    const base = sub.cycle.baseArrival;
    return [this.clock.day, base, base + DECISION.maxStepDays].some((d) => between(d, from, to));
  }

  private completedDeliveries(sub: Sub): number {
    return sub.history.deliveries.filter((d) => d <= this.clock.day).length;
  }

  private decisionBase(sub: Sub) {
    const today = this.clock.day;
    const last = Math.max(...sub.history.deliveries.filter((d) => d <= today));
    return {
      today,
      currentArrival: sub.cycle.baseArrival,
      lastDelivery: last,
      minArrival: today + 3,
      eligibility: {
        payAsYouGo: sub.spec.payAsYouGo,
        completedDeliveries: this.completedDeliveries(sub),
        inDecemberFreeze: this.inFreeze(sub),
        replyHistoryOk: sub.history.replies.length > 0,
        textLeadDays: sub.cycle.baseArrival - today,
      },
    };
  }

  private evaluate(sub: Sub): { fc: Forecast; d: Decision } {
    const today = this.clock.day;
    const fc = forecast(this.prior(sub), sub.history, today, sub.cycle.startDay, sub.id);
    const d = decide({ ...this.decisionBase(sub), forecast: fc });
    return { fc, d };
  }

  // ---------------------------------------------------------------- views

  threadView(sub: Sub): Thread {
    const today = this.clock.day;
    const hasDelivery = sub.history.deliveries.some((d) => d <= today);
    let forecastV: Thread["forecast"];
    if (hasDelivery && !sub.erased) {
      const { fc, d } = this.evaluate(sub);
      forecastV = forecastView(fc, d, today);
    }
    const proposal: ProposalView | undefined = sub.proposal
      ? { kind: sub.proposal.kind, oldArrival: sub.proposal.oldArrival, newArrival: sub.proposal.newArrival, status: sub.proposal.status, requiresYes: sub.proposal.requiresYes, confirmAtMinute: sub.proposal.confirmAtMinute }
      : undefined;
    const delivered = sub.history.deliveries.filter((d) => d <= today);
    return {
      persona: sub.id,
      name: sub.spec.name,
      descriptor: sub.spec.descriptor,
      state: sub.state,
      consentChip: `Opted in ${fmtMonthDay(sub.optedInDay)} via checkout ('YES'). About 2 texts per delivery. STOP anytime.`,
      messages: [...sub.messages],
      oldArrival: sub.oldArrival,
      currentArrival: sub.currentArrival,
      lastDelivery: delivered.length ? Math.max(...delivered) : sub.history.deliveries[0]!,
      deliveries: delivered,
      forecast: forecastV,
      explanation: sub.explanation,
      proposal,
      pantry: pantryView(sub.spec, delivered, sub.oldArrival, sub.currentArrival, today, sub.spec.cadenceDays),
      textsThisCycle: sub.cycle.textsSent,
    };
  }

  // ---------------------------------------------------------------- outbound flows

  sendCheckIn(persona: PersonaId): void {
    const sub = this.subs[persona];
    if (sub.state === "OPTED_OUT" || sub.state === "CANCELLED" || sub.state === "OPT_IN_PENDING") return;
    const today = this.clock.day;
    sub.cycle = { n: sub.cycle.n + 1, startDay: today, baseArrival: sub.currentArrival, textsSent: 0, askedNumber: false, askedCancel: false, freshReply: false };
    sub.state = "AWAITING_CHECKIN";
    const text = this.completedDeliveries(sub) < 2 ? COPY.holdOff({ name: sub.spec.name }) : COPY.checkIn({ name: sub.spec.name });
    this.say(sub, text, { proactive: true });
    this.refresh(sub);
  }

  // ---------------------------------------------------------------- inbound

  inbound(persona: PersonaId, text: string, tag: "customer" | "scripted" | "live" = "customer"): void {
    const sub = this.subs[persona];
    this.pushMessage(sub, "customer", tag, text);
    const intent = parseIntent(text, this.clock.day);
    this.parseLog.push({ id: ++this.logId, atMinute: this.clock.minute, persona, text, parser: "rules", intent });
    this.dispatch(sub, intent, text);
    this.refresh(sub);
  }

  private toHuman(sub: Sub, text: string, reason: string): void {
    this.humanQueue.push({ id: ++this.qId, persona: sub.id, name: sub.spec.name, text, reason, atMinute: this.clock.minute });
    this.emitQueue();
  }

  private optOut(sub: Sub): void {
    if (sub.state === "OPTED_OUT") return;
    sub.stateBeforeStop = sub.state === "AWAITING_CHECKIN" || sub.state === "AWAITING_PROPOSAL" ? "ACTIVE" : sub.state;
    sub.state = "OPTED_OUT";
    this.dropDue(sub.id, ["reminder", "deferred_send", "checkin", "expire"]);
    if (sub.proposal?.status === "pending") sub.proposal.status = "declined";
    this.say(sub, COPY.stop(), { legal: true });
  }

  private dispatch(sub: Sub, intent: Intent, text: string): void {
    const st = sub.state;
    if (st === "OPTED_OUT") {
      if (intent.name === "START") {
        sub.state = sub.stateBeforeStop && sub.stateBeforeStop !== "OPTED_OUT" ? sub.stateBeforeStop : "ACTIVE";
        this.say(sub, COPY.start(), { legal: true });
      } else if (intent.name === "HELP") this.say(sub, COPY.help(), { legal: true });
      return; // STOP again, or anything else: silence
    }
    if (st === "OPT_IN_PENDING") {
      if (intent.name === "YES") {
        sub.state = "ACTIVE";
        this.say(sub, COPY.optInConfirmed(), { legal: true });
      } else if (intent.name === "STOP") this.optOut(sub);
      else if (intent.name === "HELP") this.say(sub, COPY.help(), { legal: true });
      return;
    }
    if (st === "CANCELLED") {
      if (intent.name === "BACK") this.undoCancel(sub);
      else if (intent.name === "STOP") this.optOut(sub);
      else if (intent.name === "HELP") this.say(sub, COPY.help(), { legal: true });
      else if (intent.name === "DELETE_MY_DATA") this.eraseData(sub);
      else this.say(sub, sub.cancel ? COPY.cancelledReminder() : COPY.backTooLate(), { legal: true });
      return;
    }
    switch (intent.name) {
      case "STOP":
        this.optOut(sub);
        return;
      case "START":
        this.say(sub, COPY.alreadyOn(), { legal: true });
        return;
      case "HELP":
        this.say(sub, COPY.help(), { legal: true });
        return;
      case "OK":
        return; // acknowledge only; never reverts, never accepts a charge
      case "YES":
        this.acceptPending(sub);
        return;
      case "OLD":
        this.revert(sub);
        return;
      case "WHY":
        this.why(sub);
        return;
      case "SOONER":
        this.askSooner(sub);
        return;
      case "SKIP":
        this.skipNext(sub);
        return;
      case "WEEKS":
        this.handleWeeks(sub, intent.weeks ?? 0);
        return;
      case "PLENTY":
        if (!sub.cycle.askedNumber) {
          sub.cycle.askedNumber = true;
          this.say(sub, COPY.needNumber());
        } else {
          this.toHuman(sub, text, "Reply without a number");
          this.say(sub, COPY.unknown());
        }
        return;
      case "AWAY":
        this.away(sub, intent);
        return;
      case "PAUSE":
        this.pause(sub, intent.days ?? 7);
        return;
      case "CANCEL":
        this.cancel(sub);
        return;
      case "CANCEL_AMBIGUOUS":
        if (!sub.cycle.askedCancel) {
          sub.cycle.askedCancel = true;
          this.say(sub, COPY.cancelClarify(), { legal: true });
        } else {
          this.toHuman(sub, text, "Unclear cancel request");
          this.say(sub, COPY.unknown(), { legal: true });
        }
        return;
      case "BACK":
        this.say(sub, COPY.nothingToUndo());
        return;
      case "WHAT_DO_YOU_KNOW":
        this.say(sub, COPY.whatDoYouKnow(), { legal: true });
        return;
      case "DELETE_MY_DATA":
        this.eraseData(sub);
        return;
      case "HUMAN":
        this.toHuman(sub, text, "Asked for a person");
        this.say(sub, COPY.unknown(), { legal: true });
        return;
      case "UNKNOWN":
        this.toHuman(sub, text, "Unclear reply");
        this.say(sub, COPY.unknown(), { legal: true });
        return;
    }
  }

  // ---------------------------------------------------------------- intent handlers

  private setArrival(sub: Sub, arrival: Day): void {
    sub.currentArrival = arrival;
    this.scheduleDelivery(sub);
  }

  private amount(sub: Sub): number {
    return EXHIBITS.sources[sub.spec.source].aov;
  }

  private handleWeeks(sub: Sub, weeks: number): void {
    const today = this.clock.day;
    if (sub.cycle.n === 0) {
      sub.cycle = { ...sub.cycle, n: 1, startDay: today, baseArrival: sub.currentArrival };
    }
    // a new reply replaces any move made earlier in this cycle
    if (sub.proposal && (sub.proposal.status === "applied" || sub.proposal.status === "confirmed" || sub.proposal.status === "pending")) {
      sub.proposal.status = "reverted";
      this.setArrival(sub, sub.cycle.baseArrival);
      sub.oldArrival = sub.cycle.baseArrival;
    }
    sub.history.replies.push({ day: today, weeks });
    sub.cycle.freshReply = true;
    sub.cycle.replyWeeks = weeks;
    sub.cycle.replyDay = today;

    const before: SubscriberHistory = { ...sub.history, replies: sub.history.replies.filter((r) => r.day < sub.cycle.startDay) };
    const base = this.decisionBase(sub);
    const { fc, d } = this.evaluate(sub);
    const filterBefore = replayFilter(this.prior(sub), before, today, sub.id);
    sub.explanation = explain({
      name: sub.spec.name,
      descriptor: sub.spec.descriptor,
      prior: this.prior(sub),
      replyWeeks: weeks,
      replyDay: today,
      forecast: fc,
      decision: d,
      oldArrival: sub.cycle.baseArrival,
      whatIf: whatIfReplies(filterBefore, base, DECISION.serviceQ),
    });

    const name = sub.spec.name;
    const daysToArrival = sub.cycle.baseArrival - today;
    sub.state = "AWAITING_PROPOSAL";
    if (d.action === "propose" && d.direction === "later") {
      sub.oldArrival = sub.cycle.baseArrival;
      if (d.defaultAccept) {
        const confirmAt = this.clock.minute + HOURS_48;
        sub.proposal = { kind: "later", oldArrival: sub.oldArrival, newArrival: d.newArrival, status: "applied", requiresYes: false, confirmAtMinute: confirmAt, weeks, replyDay: today };
        this.setArrival(sub, d.newArrival);
        this.addDue({ at: confirmAt, kind: "confirm", persona: sub.id });
        this.addDue({ at: minuteOf(d.newArrival - 3, this.scenario.checkInHHMM), kind: "reminder", persona: sub.id, token: d.newArrival });
        this.say(sub, COPY.laterProposal({ name, weeks, old: sub.oldArrival, new: d.newArrival }));
      } else {
        const expireAt = this.clock.minute + HOURS_48;
        sub.proposal = { kind: "later", oldArrival: sub.oldArrival, newArrival: d.newArrival, status: "pending", requiresYes: true, confirmAtMinute: expireAt, weeks, replyDay: today };
        this.addDue({ at: expireAt, kind: "expire", persona: sub.id, token: expireAt });
        this.say(sub, COPY.laterNeedsOk({ name, weeks, old: sub.oldArrival, new: d.newArrival }));
      }
    } else if (d.action === "propose" && d.direction === "sooner") {
      this.offerSooner(sub, weeks, d.newArrival, expediteOffer(weeks, daysToArrival));
    } else if (!d.blocked && expediteOffer(weeks, daysToArrival)) {
      this.offerSooner(sub, weeks, today + 2, true);
    } else {
      sub.state = "ACTIVE";
      this.say(sub, d.blocked ? COPY.weeksAcknowledged({ weeks }) : COPY.keepDate({ name, old: sub.cycle.baseArrival }));
    }
  }

  private offerSooner(sub: Sub, weeks: number, newArrival: Day, expedite: boolean): void {
    const expireAt = this.clock.minute + HOURS_48;
    sub.oldArrival = sub.cycle.baseArrival;
    sub.proposal = { kind: "sooner", oldArrival: sub.oldArrival, newArrival, status: "pending", requiresYes: true, confirmAtMinute: expireAt, weeks, replyDay: this.clock.day };
    this.addDue({ at: expireAt, kind: "expire", persona: sub.id, token: expireAt });
    this.say(sub, expedite ? COPY.expediteProposal({ old: sub.oldArrival, amount: this.amount(sub) }) : COPY.soonerProposal({ old: sub.oldArrival, sooner: newArrival, amount: this.amount(sub) }));
  }

  private acceptPending(sub: Sub): void {
    const p = sub.proposal;
    if (!p || p.status !== "pending") return;
    p.status = "confirmed";
    this.setArrival(sub, p.newArrival);
    this.dropDue(sub.id, ["expire"]);
    sub.state = "ACTIVE";
    this.say(sub, `Done. Your delivery is now ${fmtMonthDay(p.newArrival)}.`);
  }

  private revert(sub: Sub): void {
    const p = sub.proposal;
    if (!p || p.status === "reverted" || p.status === "declined" || p.status === "expired") {
      this.say(sub, COPY.nothingToUndo());
      return;
    }
    const wasPending = p.status === "pending";
    p.status = "reverted";
    this.dropDue(sub.id, ["reminder", "expire", "away_end", "pause_end"]);
    if (!wasPending) this.setArrival(sub, p.oldArrival);
    if (sub.state === "AWAY" || sub.state === "PAUSED" || sub.state === "AWAITING_PROPOSAL") sub.state = "ACTIVE";
    sub.history.away = [];
    this.say(sub, COPY.oldReverted({ old: p.oldArrival }));
  }

  private why(sub: Sub): void {
    if (sub.cycle.replyWeeks !== undefined && sub.cycle.replyDay !== undefined && !sub.erased) {
      this.say(sub, COPY.why({ weeks: sub.cycle.replyWeeks, date: sub.cycle.replyDay, old: sub.oldArrival }));
    } else {
      this.say(sub, COPY.whyNoReply());
      if (!sub.explanation && !sub.erased && sub.history.deliveries.length) {
        const { fc, d } = this.evaluate(sub);
        sub.explanation = explain({ name: sub.spec.name, descriptor: sub.spec.descriptor, prior: this.prior(sub), forecast: fc, decision: d, oldArrival: sub.currentArrival, whatIf: [] });
      }
    }
  }

  private askSooner(sub: Sub): void {
    const today = this.clock.day;
    const sooner = nextShipDay(today + 3, this.scenario.shipWeekday);
    if (sooner >= sub.currentArrival) {
      this.say(sub, `Your next delivery on ${fmtMonthDay(sub.currentArrival)} is already the soonest we can ship.`);
      return;
    }
    this.offerSooner(sub, 0, sooner, false);
    sub.state = "AWAITING_PROPOSAL";
  }

  private skipNext(sub: Sub): void {
    const old = sub.currentArrival;
    const next = old + sub.spec.cadenceDays;
    sub.history.skips.push(this.clock.day);
    sub.oldArrival = old;
    sub.proposal = { kind: "skip", oldArrival: old, newArrival: next, status: "applied", requiresYes: false };
    this.setArrival(sub, next);
    this.say(sub, COPY.skip({ old, new: next }));
  }

  private away(sub: Sub, intent: Intent): void {
    const to = intent.to ?? this.clock.day;
    const from = intent.from ?? this.clock.day;
    const old = sub.currentArrival;
    if (old > to) {
      this.say(sub, COPY.awayNoChange({ date: to }));
      return;
    }
    const ship = nextShipDay(to, this.scenario.shipWeekday);
    sub.history.away = [{ from, to }];
    sub.oldArrival = old;
    sub.proposal = { kind: "away", oldArrival: old, newArrival: ship, status: "applied", requiresYes: false };
    this.setArrival(sub, ship);
    sub.state = "AWAY";
    this.addDue({ at: minuteOf(to, "08:00"), kind: "away_end", persona: sub.id });
    this.say(sub, COPY.away({ place: intent.place, date: to, old, ship }));
  }

  private pause(sub: Sub, days: number): void {
    const old = sub.currentArrival;
    const next = nextShipDay(old + days, this.scenario.shipWeekday);
    sub.oldArrival = old;
    sub.proposal = { kind: "pause", oldArrival: old, newArrival: next, status: "applied", requiresYes: false };
    this.setArrival(sub, next);
    sub.state = "PAUSED";
    this.addDue({ at: minuteOf(next, "06:00") + 1, kind: "pause_end", persona: sub.id });
    this.say(sub, COPY.pause({ old, new: next }));
  }

  private cancel(sub: Sub): void {
    sub.cancel = { atMinute: this.clock.minute, prevState: sub.state, prevArrival: sub.currentArrival };
    sub.state = "CANCELLED";
    this.dropDue(sub.id, ["reminder", "delivery", "checkin", "expire", "confirm"]);
    this.addDue({ at: this.clock.minute + MIN_PER_DAY, kind: "cancel_final", persona: sub.id, token: sub.cancel.atMinute });
    this.say(sub, COPY.cancel(), { legal: true });
  }

  private undoCancel(sub: Sub): void {
    const c = sub.cancel;
    if (!c || this.clock.minute - c.atMinute > MIN_PER_DAY) {
      this.say(sub, COPY.backTooLate(), { legal: true });
      return;
    }
    sub.state = c.prevState === "CANCELLED" ? "ACTIVE" : c.prevState;
    sub.cancel = undefined;
    this.dropDue(sub.id, ["cancel_final"]);
    this.setArrival(sub, c.prevArrival);
    this.say(sub, COPY.back(), { legal: true });
  }

  private eraseData(sub: Sub): void {
    sub.history.replies = [];
    sub.history.skips = [];
    sub.history.away = [];
    sub.explanation = undefined;
    sub.proposal = undefined;
    sub.cycle.replyWeeks = undefined;
    sub.cycle.replyDay = undefined;
    sub.erased = true;
    this.say(sub, COPY.deleteMyData(), { legal: true });
    sub.stateBeforeStop = "ACTIVE";
    sub.state = "OPTED_OUT";
    this.dropDue(sub.id, ["reminder", "deferred_send", "checkin", "expire"]);
  }

  // ---------------------------------------------------------------- the scripted run

  private scene(persona: PersonaId, hhmm: string): void {
    this.activePersona = persona;
    this.clock.set(minuteOf(this.today, hhmm));
    this.emitClock();
  }

  /** Run one step of the main demo. Idempotent for scripted inbound texts (skipped if the reply is already there). */
  runStep(id: StepId): void {
    this.hint = undefined;
    const sc = this.scenario.script;
    const maya = this.subs.maya;
    switch (id) {
      case "s1a":
        this.scene("maya", "09:55");
        break;
      case "s1b1":
        this.setBanner(undefined);
        this.scene("maya", this.scenario.checkInHHMM);
        if (maya.cycle.n === 0) this.sendCheckIn("maya");
        break;
      case "s1b2":
        this.clock.set(this.clock.minute + 5);
        this.emitClock();
        if (!maya.cycle.freshReply) this.inbound("maya", sc.maya_reply!, "scripted");
        break;
      case "s1b3":
        this.advanceHours(48);
        break;
      case "s1b4":
        if (!maya.messages.some((m) => m.from === "customer" && /^why/i.test(m.text))) this.inbound("maya", sc.maya_why!, "scripted");
        break;
      case "s1c":
        this.setBanner(undefined);
        this.scene("priya", "10:20");
        if (!this.subs.priya.messages.some((m) => m.from === "customer" && m.text === sc.priya_message)) this.inbound("priya", sc.priya_message!, "scripted");
        break;
      case "s1d":
        this.scene("jo", "10:30");
        if (!this.subs.jo.messages.some((m) => m.text === sc.jo_message)) this.inbound("jo", sc.jo_message!, "scripted");
        this.scene("dev", "10:40");
        if (this.subs.dev.cycle.n === 0) this.sendCheckIn("dev");
        break;
      default:
        break;
    }
    this.refresh(this.subs[this.activePersona]);
  }

  private stepEvent(): void {
    this.emit({ type: "step", step: this.step, stepId: this.scenario.stepOrder[this.step]!, activePersona: this.activePersona });
  }

  next(): boolean {
    if (this.step >= this.scenario.stepOrder.length - 1) return false;
    this.step++;
    this.runStep(this.scenario.stepOrder[this.step]!);
    this.stepEvent();
    return true;
  }

  /** Go to a step by replaying from the start (the engine is seeded, so the result is identical). */
  goto(step: number): void {
    const target = Math.max(0, Math.min(this.scenario.stepOrder.length - 1, step));
    this.quietly(() => {
      this.reset();
      for (let i = 1; i <= target; i++) {
        this.step = i;
        this.runStep(this.scenario.stepOrder[i]!);
      }
    });
  }

  /** The "Can they leave?" backup scenario: Sam, one scripted text per call. Returns false when finished. */
  samNext(): boolean {
    if (this.samIndex >= SAM_SCRIPT_KEYS.length) return false;
    const key = SAM_SCRIPT_KEYS[this.samIndex]!;
    if (this.samIndex === 0) {
      this.scene("sam", "11:00");
    } else {
      this.activePersona = "sam";
    }
    // time passes between texts so the 24-hour undo window is visible but BACK still lands inside it
    this.clock.set(this.clock.minute + 2);
    this.samIndex++;
    this.inbound("sam", this.scenario.script[key]!, "scripted");
    this.emitClock();
    this.stepEvent();
    return true;
  }
}
