import type { Channel } from "../flows/context.ts";

/**
 * Channels (spec 11.1). `replay` (default): scripted replies injected by the advance shortcut, model numbers computed
 * live. `console`: the presenter types a reply in the sandbox drawer. Neither sends anything off the laptop; the
 * screens show every text either way. Production would use a registered SMS provider through the same interface.
 */
export const replayChannel = (): Channel => ({
  name: "replay",
  async start() {},
  async send() {
    return { delivered: true };
  },
});

export const consoleChannel = (): Channel => ({
  name: "console",
  async start() {},
  async send() {
    return { delivered: true };
  },
});
