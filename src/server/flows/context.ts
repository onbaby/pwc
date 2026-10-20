import type { Db } from "../db.ts";

/** Everything a flow needs: the database, a way to tell the screens something changed, and the messaging channel. */
export type ConsoleEvent =
  | { type: "message"; customerId: string; messageId: number }
  | { type: "projection"; customerId: string }
  | { type: "queue" }
  | { type: "offer"; offerId: number }
  | { type: "clock"; now: number };

export interface Channel {
  name: "photon" | "console" | "replay";
  start(onInbound: (customerId: string, text: string) => void): Promise<void>;
  send(customerId: string, text: string): Promise<{ delivered: boolean }>;
  stop?(): Promise<void>;
}

export interface AppCtx {
  db: Db;
  emit: (e: ConsoleEvent) => void;
  channel: Channel;
}

export const noopChannel = (name: Channel["name"] = "replay"): Channel => ({
  name,
  async start() {},
  async send() {
    return { delivered: true };
  },
});
