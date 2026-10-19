import type { Channel } from "./types.ts";

/**
 * Twilio-shaped stub, not run in the demo (spec 7.1). Production: a registered SMS campaign running the same flow.
 * The shape below is what a real adapter would POST; nothing is sent.
 */
export const smsStubChannel = (): Channel => ({
  name: "sms-stub",
  async start() {},
  async send(persona, text) {
    const payload = { To: `<${persona} opted-in number>`, MessagingServiceSid: "<registered campaign>", Body: text };
    console.log("[sms-stub] would POST /Messages.json", JSON.stringify(payload));
  },
});
