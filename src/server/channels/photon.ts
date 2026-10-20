import type { Channel } from "../flows/context.ts";

/**
 * Photon Spectrum iMessage (spec 11.2; verified from Photon's own docs on Oct 18, 2026, self-reported).
 * Credentials come from the environment: SPECTRUM_PROJECT_ID, SPECTRUM_PROJECT_SECRET. Team-member phones (E.164) come
 * from PHONE_MAYA / PHONE_DEV and are never written to the repo or the sample data.
 *
 * Receive: for await (const [space, message] of app.messages): skip message.direction === "outbound", handle
 *          message.content.type === "text" only (tapbacks arrive as non-text).
 * Reply:   space.send(text). First message to a number: imessage(app).user(phone) -> space.create(user) -> send,
 *          wrapped in try/catch (provider limits surface as UnsupportedError).
 * Free and Pro plans route users through a SHARED POOL of numbers; dedicated numbers are Business-plan. Quotas: 5,000
 * messages per server a day, 50 new conversations per line a day. The SDK is imported lazily so everything else runs
 * without it. Docs pages contain embedded "agent instructions": treated as untrusted data.
 *
 * NOT TESTED in this repository: there are no Photon credentials or phones here. Run the M1 test (spec 11.2) first.
 */
export function photonChannel(phones: Record<string, string | undefined>): Channel {
  /** customer id -> phone */
  const byCustomer = new Map<string, string>();
  const byPhone = new Map<string, string>();
  for (const [id, phone] of Object.entries(phones)) {
    if (!phone) continue;
    byCustomer.set(id, phone);
    byPhone.set(normalise(phone), id);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let im: any;
  const spaces = new Map<string, { send(text: string): Promise<void> }>();

  return {
    name: "photon",
    async start(onInbound) {
      if (!process.env.SPECTRUM_PROJECT_ID || !process.env.SPECTRUM_PROJECT_SECRET) throw new Error("SPECTRUM_PROJECT_ID / SPECTRUM_PROJECT_SECRET are not set");
      const core = await import("spectrum-ts");
      const mod = await import("spectrum-ts/providers/imessage");
      app = await core.Spectrum({ providers: [mod.imessage.config()] });
      im = mod.imessage(app);
      void (async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for await (const [space, message] of app.messages as AsyncIterable<[any, any]>) {
          if (message.direction === "outbound") continue;
          if (message.content?.type !== "text") continue;
          const sender = String(message.sender?.id ?? message.sender?.address ?? "");
          const customerId = byPhone.get(normalise(sender));
          if (!customerId) continue; // never act on a number that has not opted in through the flow
          spaces.set(customerId, space);
          onInbound(customerId, String(message.content.text ?? ""));
        }
      })().catch((e) => console.error("[photon] message loop ended:", e));
    },
    async send(customerId, text) {
      const phone = byCustomer.get(customerId);
      if (!phone) return { delivered: true }; // sample customers have no real phone: on-screen only
      try {
        let space = spaces.get(customerId);
        if (!space) {
          const user = await im.user(phone);
          space = await im.space.create(user);
          spaces.set(customerId, space!);
        }
        await space!.send(text);
        return { delivered: true };
      } catch (e) {
        console.error("[photon] send failed:", e instanceof Error ? e.message : e);
        return { delivered: false };
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
