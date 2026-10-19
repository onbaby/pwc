import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { PersonaIdSchema, type ChannelName, type PersonaId } from "@rot/contracts";
import { consoleChannel } from "./channels/console.ts";
import { photonChannel } from "./channels/photon.ts";
import { replayChannel } from "./channels/replay.ts";
import { smsStubChannel } from "./channels/sms-stub.ts";
import type { Channel } from "./channels/types.ts";
import { createApp } from "./http.ts";
import { SseHub } from "./sse.ts";
import { World } from "./world.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// `pnpm demo CHANNEL=replay` or `CHANNEL=replay pnpm demo`
for (const a of process.argv.slice(2)) {
  const m = /^CHANNEL=(.*)$/.exec(a);
  if (m) process.env.CHANNEL = m[1];
}
const wanted = process.env.CHANNEL as ChannelName | undefined;
if (!wanted || !["photon", "console", "replay", "sms-stub"].includes(wanted)) {
  console.error("Refusing to start without an explicit channel.\n  CHANNEL=replay pnpm demo      (scripted texts, always works)\n  CHANNEL=console pnpm demo     (type as the customer)\n  CHANNEL=photon pnpm demo      (real iMessage on team phones; needs .env)\n  CHANNEL=sms-stub pnpm demo    (shape-only stub)");
  process.exit(1);
}

const noNetwork = process.env.NO_NETWORK === "1";
if (noNetwork) {
  globalThis.fetch = (() => {
    throw new Error("NO_NETWORK=1: network access is disabled");
  }) as typeof fetch;
  if (wanted === "photon") {
    console.error("CHANNEL=photon cannot run with NO_NETWORK=1");
    process.exit(1);
  }
}

const hub = new SseHub();
const phones: Partial<Record<PersonaId, string>> = {};
for (const id of PersonaIdSchema.options) {
  const v = process.env[`PERSONA_${id.toUpperCase()}_PHONE`];
  if (v) phones[id] = v;
}

let channel: Channel;
let world: World;
const outbound = (persona: PersonaId, text: string) => {
  if (world.mode === "live") void channel.send(persona, text);
  else if (channel.name === "sms-stub" || channel.name === "console") void channel.send(persona, text);
};
world = new World({ artifactsDir: resolve(root, "artifacts"), emit: (e) => hub.publish(e), outbound });
world.noNetwork = noNetwork;

const onInbound = (persona: PersonaId | undefined, text: string) => {
  if (!persona) {
    console.warn("[inbound] ignoring text from an unknown sender");
    return;
  }
  world.inbound(persona, text, world.mode === "live" ? "live" : "customer");
  world.setLastEventId(hub.lastId);
};

switch (wanted) {
  case "photon":
    channel = photonChannel(phones);
    break;
  case "console":
    channel = consoleChannel(() => world.activePersona);
    break;
  case "sms-stub":
    channel = smsStubChannel();
    break;
  default:
    channel = replayChannel();
}

function setMode(mode: "live" | "replay" | "console", ch: ChannelName, note?: string) {
  world.setMode(mode, ch, note);
  world.setLastEventId(hub.lastId);
}

if (wanted === "photon") {
  setMode("replay", "photon", "Connecting to Photon…");
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("did not connect within 5 s")), 5000));
  Promise.race([channel.start(onInbound), timeout])
    .then(() => setMode("live", "photon", "iMessage on team phones"))
    .catch((e: Error) => {
      console.error("[photon]", e.message);
      setMode("replay", "photon", `Photon ${e.message}: fell back to replay`);
    });
} else {
  void channel.start(onInbound);
  setMode(wanted === "console" ? "console" : "replay", wanted);
}

const app = createApp({
  world,
  hub,
  artifactsDir: resolve(root, "artifacts"),
  docsDir: resolve(root, "docs"),
  webDist: resolve(root, "apps/web/dist"),
  onToggleMode: () => {
    if (world.mode === "live") setMode("replay", world.channel, "Switched to replay by the presenter");
    else if (world.mode === "replay") setMode("console", world.channel === "photon" ? "photon" : "console");
    else setMode("replay", world.channel === "console" ? "replay" : world.channel);
  },
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Right on Time: http://localhost:${port}  (channel ${wanted}${noNetwork ? ", NO_NETWORK" : ""}, parser RULES)`);
});
