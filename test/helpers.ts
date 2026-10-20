import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../src/server/app.ts";
import { replayChannel } from "../src/server/channels/channels.ts";
import { openDb, type Db } from "../src/server/db.ts";
import type { AppCtx, ConsoleEvent } from "../src/server/flows/context.ts";
import { loadScenario, Sandbox } from "../src/server/sandbox.ts";
import { Hub } from "../src/server/sse.ts";

export interface TestConsole {
  db: Db;
  ctx: AppCtx;
  hub: Hub;
  events: ConsoleEvent[];
  sandbox: Sandbox;
  app: ReturnType<typeof createApp>;
  cleanup(): void;
}

const root = resolve(import.meta.dirname, "..");

/** A private copy of the seeded sandbox (the seed ran once in globalSetup). */
export function freshConsole(): TestConsole {
  const src = process.env.ROT_TEST_SEED_DB;
  if (!src) throw new Error("globalSetup did not run");
  const dir = mkdtempSync(join(tmpdir(), "rot-case-"));
  const path = join(dir, "c.db");
  copyFileSync(src, path);
  const db = openDb(path);
  const hub = new Hub();
  const events: ConsoleEvent[] = [];
  const ctx: AppCtx = { db, emit: (e) => { events.push(e); hub.publish(e); }, channel: replayChannel() };
  const sandbox = new Sandbox(ctx, loadScenario(resolve(root, "scenarios/demo.json")));
  const app = createApp({ ctx, hub, sandbox, artifactsDir: resolve(root, "artifacts"), webDist: resolve(root, "dist") });
  return { db, ctx, hub, events, sandbox, app, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

export async function getJson<T = any>(t: TestConsole, path: string): Promise<T> {
  const r = await t.app.request(path);
  if (r.status !== 200) throw new Error(`${path} -> ${r.status}: ${await r.text()}`);
  return (await r.json()) as T;
}

export async function postJson<T = any>(t: TestConsole, path: string, body: unknown = {}): Promise<{ status: number; json: T }> {
  const r = await t.app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as T };
}
