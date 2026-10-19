import type { Channel } from "./types.ts";

/** Replay: scripted inbound texts drive the real engine (the world injects them on the step key). Nothing leaves the laptop. */
export const replayChannel = (): Channel => ({
  name: "replay",
  async start() {},
  async send() {},
});
