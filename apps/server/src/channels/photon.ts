import type { PersonaId } from "@rot/contracts";
import type { Channel } from "./types.ts";

/**
 * Photon Spectrum iMessage (spec 7.2, from Photon's own docs, opened Oct 18, 2026).
 * Credentials come from the environment: SPECTRUM_PROJECT_ID, SPECTRUM_PROJECT_SECRET.
 * Team-member phones (E.164) come from PERSONA_*_PHONE env vars and are never written to the repo.
 *
 * Receive:  for await (const [space, message] of app.messages)  - skip outbound, handle text only.
 * Reply:    space.send(text)       (message.reply is NOT supported by the local iMessage provider).
 * First message to a number: im.user(phone) -> im.space.create(user) -> dm.send(text), wrapped in try/catch.
 * The SDK is imported lazily so the demo runs without it when CHANNEL is not photon.
 */
export function photonChannel(phones: Partial<Record<PersonaId, string>>): Channel {
  const byPhone = new Map<string, PersonaId>();
  for (const [p, num] of Object.entries(phones)) if (num) byPhone.set(normalise(num), p as PersonaId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let im: any;
  const spaces = new Map<PersonaId, { send(text: string): Promise<void> }>();

  return {
    name: "photon",
    async start(onInbound) {
      if (!process.env.SPECTRUM_PROJECT_ID || !process.env.SPECTRUM_PROJECT_SECRET) {
        throw new Error("SPECTRUM_PROJECT_ID / SPECTRUM_PROJECT_SECRET are not set");
      }
      const core = await import("spectrum-ts");
      const imessageMod = await import("spectrum-ts/providers/imessage");
      app = await core.Spectrum({ providers: [imessageMod.imessage.config()] });
      im = imessageMod.imessage(app);
      void (async () => {
        for await (const [space, message] of app.messages as AsyncIterable<[any, any]>) {
          if (message.direction === "outbound") continue;
          if (message.content?.type !== "text") continue; // tapbacks etc. arrive as non-text
          const sender = String(message.sender?.id ?? message.sender?.address ?? "");
          const persona = byPhone.get(normalise(sender));
          if (persona) spaces.set(persona, space);
          onInbound(persona, String(message.content.text ?? ""));
        }
      })().catch((e) => console.error("[photon] message loop ended:", e));
    },
    async send(persona, text) {
      try {
        let space = spaces.get(persona);
        if (!space) {
          const phone = phones[persona];
          if (!phone) return; // no real phone for this persona: on-screen only
          const user = await im.user(phone);
          space = await im.space.create(user);
          spaces.set(persona, space!);
        }
        await space!.send(text);
      } catch (e) {
        // provider constraints surface as UnsupportedError; never crash the demo
        console.error("[photon] send failed:", e instanceof Error ? e.message : e);
      }
    },
    async stop() {
      try {
        await app?.stop?.();
      } catch {
        /* ignore */
      }
    },
  };
}

function normalise(s: string): string {
  return s.replace(/[^\d+]/g, "");
}
