import { createInterface, type Interface } from "node:readline";
import type { PersonaId } from "@rot/contracts";
import type { Channel } from "./types.ts";

const PERSONAS: PersonaId[] = ["maya", "priya", "dev", "jo", "sam"];

/**
 * Console: zero dependencies. The phone mock's input box is the main way in; stdin also works:
 *   `maya: 6`  or just `6` (goes to the active persona).
 */
export const consoleChannel = (activePersona: () => PersonaId): Channel => {
  let rl: Interface | undefined;
  return {
    name: "console",
    async start(onInbound) {
      if (!process.stdin.isTTY) return;
      rl = createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        const m = /^\s*(maya|priya|dev|jo|sam)\s*:\s*(.*)$/i.exec(line);
        if (m && PERSONAS.includes(m[1]!.toLowerCase() as PersonaId)) onInbound(m[1]!.toLowerCase() as PersonaId, m[2]!);
        else if (line.trim()) onInbound(activePersona(), line);
      });
    },
    async send(persona, text) {
      console.log(`[console] -> ${persona}: ${text}`);
    },
    async stop() {
      rl?.close();
    },
  };
};
