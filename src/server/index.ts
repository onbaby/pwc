import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { consoleChannel, replayChannel } from "./channels/channels.ts";
import { photonChannel } from "./channels/photon.ts";
import { openDb, get } from "./db.ts";
import type { AppCtx, Channel } from "./flows/context.ts";
import { handleInbound } from "./flows/inbound.ts";
import { loadScenario, Sandbox } from "./sandbox.ts";
import { Hub } from "./sse.ts";

const root = resolve(import.meta.dirname, "../..");

// NO_NETWORK=1: any fetch throws (the demo must run with the network off; Photon is excluded)
if (process.env.NO_NETWORK === "1") {
  globalThis.fetch = (() => {
    throw new Error("NO_NETWORK=1: network access is disabled");
  }) as typeof fetch;
}

const wanted = (process.env.CHANNEL ?? "replay") as Channel["name"];
if (!["replay", "console", "photon"].includes(wanted)) {
  console.error(`CHANNEL must be replay, console or photon (got "${wanted}")`);
  process.exit(1);
}
if (wanted === "photon" && process.env.NO_NETWORK === "1") {
  console.error("CHANNEL=photon cannot run with NO_NETWORK=1");
  process.exit(1);
}

const dbPath = resolve(root, process.env.DB_PATH ?? "data/console.db");
const db = openDb(dbPath);
const hub = new Hub();
const ctx: AppCtx = { db, emit: (e) => hub.publish(e), channel: wanted === "console" ? consoleChannel() : replayChannel() };
const sandboxOn = process.env.SANDBOX !== "0";
const sandbox = sandboxOn ? new Sandbox(ctx, loadScenario(resolve(root, "scenarios/demo.json"))) : undefined;

const isEmpty = !get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM customers")?.n;
if (sandbox && (isEmpty || process.env.KEEP_DATA !== "1")) {
  console.log("Resetting the sandbox (sample data, deterministic)…");
  const r = sandbox.reset();
  console.log(`  ${r.customers} customers (${r.active} active), ${r.projections} projections, ${r.seconds.toFixed(1)} s`);
} else if (isEmpty) {
  console.error("The database is empty and SANDBOX is off: run `pnpm seed` first.");
  process.exit(1);
}

const phones = { "maya-thompson": process.env.PHONE_MAYA, "dev-patel": process.env.PHONE_DEV };

/** Try Photon for up to 5 s; on failure the caller falls back to replay with a toast (spec 11.1). */
async function connectPhoton(): Promise<boolean> {
  const photon = photonChannel(phones);
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("did not connect within 5 s")), 5000).unref?.());
  try {
    await Promise.race([
      photon.start((customerId, text) => {
        try {
          handleInbound(ctx, customerId, text, { via: "photon" });
        } catch (e) {
          console.error("[photon] inbound failed:", e);
        }
      }),
      timeout,
    ]);
    ctx.channel = photon;
    ctx.emit({ type: "toast", message: "Channel: Photon (live iMessage on team phones)" });
    return true;
  } catch (e) {
    console.error("[photon]", e instanceof Error ? e.message : e);
    return false;
  }
}

const app = createApp({ ctx, hub, sandbox: sandbox, artifactsDir: resolve(root, "artifacts"), webDist: resolve(root, "dist"), connectPhoton });
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Right on Time: http://localhost:${port}  (channel ${ctx.channel.name}${sandbox ? ", sandbox" : ""}${process.env.NO_NETWORK === "1" ? ", NO_NETWORK" : ""})`);
  if (wanted === "photon") {
    void connectPhoton().then((ok) => {
      if (!ok) ctx.emit({ type: "toast", message: "Photon did not connect within 5 s: fell back to replay" });
    });
  }
});
