import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { PersonaIdSchema, type SseEvent } from "@rot/contracts";
import { z } from "zod";
import type { SseHub } from "./sse.ts";
import type { World } from "./world.ts";

export interface AppContext {
  world: World;
  hub: SseHub;
  artifactsDir: string;
  docsDir: string;
  webDist: string;
  /** called when the presenter toggles the mode */
  onToggleMode: () => void;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
};

export function createApp(ctx: AppContext): Hono {
  const { world, hub } = ctx;
  const app = new Hono();
  const snapshotEvent = () => hub.publish({ type: "snapshot", state: world.snapshot() });
  const sync = () => world.setLastEventId(hub.lastId);

  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      const lastHeader = c.req.header("Last-Event-ID");
      const last = lastHeader ? Number(lastHeader) : NaN;
      const write = (ev: SseEvent) => stream.writeSSE({ id: String(ev.id), data: JSON.stringify(ev) });
      const missed = Number.isFinite(last) ? hub.since(last) : undefined;
      if (missed) for (const ev of missed) await write(ev);
      else await stream.writeSSE({ id: String(hub.lastId), data: JSON.stringify({ type: "snapshot", id: hub.lastId, state: { ...world.snapshot(), lastEventId: hub.lastId } }) });
      let closed = false;
      const queue: SseEvent[] = [];
      let wake: (() => void) | undefined;
      const unsub = hub.subscribe((ev) => {
        queue.push(ev);
        wake?.();
      });
      stream.onAbort(() => {
        closed = true;
        unsub();
        wake?.();
      });
      while (!closed) {
        while (queue.length) await write(queue.shift()!);
        await new Promise<void>((r) => {
          wake = r;
          setTimeout(r, 15_000);
        });
        if (!closed && !queue.length) await stream.writeSSE({ event: "ping", data: "{}" });
      }
    }),
  );

  app.get("/api/state", (c) => c.json(world.snapshot()));
  app.get("/api/scenario", (c) => c.json(world.scenario));
  app.get("/api/parselog", (c) => c.json(world.parseLog));

  const body = async <T extends z.ZodType>(c: { req: { json: () => Promise<unknown> } }, schema: T): Promise<z.infer<T>> => schema.parse(await c.req.json().catch(() => ({})));

  app.post("/api/step", async (c) => {
    const { dir } = await body(c, z.object({ dir: z.enum(["next", "prev"]) }));
    if (dir === "next") world.next();
    else {
      world.goto(world.step - 1);
      snapshotEvent();
    }
    sync();
    return c.json({ step: world.step });
  });
  app.post("/api/goto", async (c) => {
    const { step } = await body(c, z.object({ step: z.number().int() }));
    world.goto(step);
    snapshotEvent();
    sync();
    return c.json({ step: world.step });
  });
  app.post("/api/inbound", async (c) => {
    const { persona, text } = await body(c, z.object({ persona: PersonaIdSchema, text: z.string().min(1).max(500) }));
    world.inbound(persona, text, world.mode === "live" ? "live" : "customer");
    sync();
    return c.json({ ok: true });
  });
  app.post("/api/mode/toggle", (c) => {
    ctx.onToggleMode();
    return c.json({ mode: world.mode });
  });
  app.post("/api/reset", (c) => {
    world.reset();
    snapshotEvent();
    sync();
    return c.json({ ok: true });
  });
  app.post("/api/clock/advance", async (c) => {
    const { hours } = await body(c, z.object({ hours: z.number().min(0).max(24 * 60) }));
    world.advanceHours(hours);
    sync();
    return c.json({ clockMinute: world.clock.minute });
  });
  app.post("/api/sam/next", (c) => {
    const more = world.samNext();
    sync();
    return c.json({ more });
  });

  app.get("/api/artifacts/:name", (c) => {
    const name = c.req.param("name");
    if (!/^[a-z_.]+\.json$/.test(name)) return c.json({ error: "not found" }, 404);
    const p = join(ctx.artifactsDir, name);
    if (!existsSync(p)) return c.json({ error: "not found" }, 404);
    return c.body(readFileSync(p), 200, { "content-type": "application/json", "cache-control": "no-store" });
  });
  app.get("/api/docs/:name", (c) => {
    const name = c.req.param("name");
    if (!/^[a-z_]+\.md$/.test(name)) return c.json({ error: "not found" }, 404);
    const p = join(ctx.docsDir, name);
    if (!existsSync(p)) return c.json({ error: "not found" }, 404);
    return c.text(readFileSync(p, "utf8"));
  });

  // built web app, with SPA fallback to index.html
  app.get("*", (c) => {
    const root = resolve(ctx.webDist);
    const reqPath = normalize(decodeURIComponent(new URL(c.req.url).pathname)).replace(/^(\.\.[/\\])+/, "");
    let file = join(root, reqPath);
    if (!file.startsWith(root)) return c.text("forbidden", 403);
    if (!existsSync(file) || !extname(file)) file = join(root, "index.html");
    if (!existsSync(file)) return c.text("web app not built: run `pnpm demo` (it builds first) or `pnpm dev`", 404);
    return c.body(readFileSync(file), 200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  });
  return app;
}
