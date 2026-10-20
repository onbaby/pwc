import { readFileSync } from "node:fs";
import { dayFromISO, etInstant } from "../shared/dates.ts";
import { generateSeed, type SeedData } from "../sim/seed.ts";
import { trainPrior } from "../sim/prior.ts";
import { consoleChannel, replayChannel } from "./channels/channels.ts";
import { type AppCtx, type Channel } from "./flows/context.ts";
import { handleInbound } from "./flows/inbound.ts";
import { advanceClock } from "./flows/schedule.ts";
import { get, getSetting, setSetting, type Db } from "./db.ts";
import { seedDatabase, type SeedReport } from "./seedDb.ts";
import { nowMs } from "./store.ts";

/** The sandbox (spec 4, 6): scripted events, reply injection, channel choice and reset. Only available with SANDBOX=1. */
export interface DemoEvent {
  id: string;
  label: string;
  type: "advance" | "inject";
  day: string;
  time: string;
  customerId?: string;
  text?: string;
}

export interface Scenario {
  name: string;
  note: string;
  clock: { day: string; time: string };
  events: DemoEvent[];
}

export const loadScenario = (path: string): Scenario => JSON.parse(readFileSync(path, "utf8")) as Scenario;

let seedCache: SeedData | undefined;

/** Generated once per process and reused by every reset (the generator is deterministic). */
export function cachedSeed(): SeedData {
  if (!seedCache) {
    const prior = trainPrior(4000);
    seedCache = generateSeed({ prior });
  }
  return seedCache;
}

export interface SandboxState {
  index: number;
  total: number;
  next: DemoEvent | null;
  done: boolean;
  channel: Channel["name"];
  now: number;
}

export class Sandbox {
  constructor(
    private readonly ctx: AppCtx,
    readonly scenario: Scenario,
    private readonly channels: Partial<Record<Channel["name"], Channel>> = { replay: replayChannel(), console: consoleChannel() },
  ) {}

  private get db(): Db {
    return this.ctx.db;
  }

  state(): SandboxState {
    const index = getSetting<number>(this.db, "scenarioIndex", 0);
    return { index, total: this.scenario.events.length, next: this.scenario.events[index] ?? null, done: index >= this.scenario.events.length, channel: this.ctx.channel.name, now: nowMs(this.db) };
  }

  /** Advance to the next scripted event: move the clock (everything that comes due runs in order) and inject the reply if any. */
  advance(): { event: DemoEvent | null; state: SandboxState } {
    const index = getSetting<number>(this.db, "scenarioIndex", 0);
    const ev = this.scenario.events[index];
    if (!ev) return { event: null, state: this.state() };
    const at = etInstant(dayFromISO(ev.day), Number(ev.time.slice(0, 2)), Number(ev.time.slice(3, 5)));
    if (at > nowMs(this.db)) advanceClock(this.ctx, at);
    if (ev.type === "inject" && ev.customerId && ev.text !== undefined) handleInbound(this.ctx, ev.customerId, ev.text, { via: this.ctx.channel.name === "photon" ? "photon" : "replay" });
    setSetting(this.db, "scenarioIndex", index + 1);
    this.ctx.emit({ type: "queue" });
    return { event: ev, state: this.state() };
  }

  /** The presenter types a reply as a customer (console channel, or to improvise during Q&A). */
  inject(customerId: string, text: string): void {
    if (!get(this.db, "SELECT 1 AS x FROM customers WHERE id = ?", customerId)) throw new Error("no such customer");
    handleInbound(this.ctx, customerId, text, { via: "console" });
    this.ctx.emit({ type: "queue" });
  }

  setChannel(name: Channel["name"], photon?: Channel): Channel["name"] {
    const ch = name === "photon" ? photon : this.channels[name];
    if (!ch) throw new Error(`channel ${name} is not available`);
    this.ctx.channel = ch;
    this.ctx.emit({ type: "toast", message: `Channel: ${name}` });
    return ch.name;
  }

  reset(): SeedReport {
    const report = seedDatabase(this.db, cachedSeed());
    setSetting(this.db, "scenarioIndex", 0);
    this.ctx.emit({ type: "clock", now: nowMs(this.db) });
    this.ctx.emit({ type: "queue" });
    this.ctx.emit({ type: "toast", message: "Sandbox reset" });
    return report;
  }
}
