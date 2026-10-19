import { z } from "zod";
import {
  CountersSchema,
  DemoStateSchema,
  HumanQueueItemSchema,
  MessageSchema,
  PersonaIdSchema,
  ThreadSchema,
  ModeSchema,
  ChannelNameSchema,
  ParserModeSchema,
  StepIdSchema,
  type DemoState,
} from "./domain.ts";

/** Server-sent events. Every event has an id. `snapshot` always comes first; the rest are deltas. */
const base = { id: z.number().int() };

export const SseEventSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("snapshot"), state: DemoStateSchema }),
  z.object({ ...base, type: z.literal("message"), persona: PersonaIdSchema, message: MessageSchema }),
  z.object({ ...base, type: z.literal("thread"), persona: PersonaIdSchema, thread: ThreadSchema }),
  z.object({ ...base, type: z.literal("clock"), clockMinute: z.number().int(), clockDay: z.number().int() }),
  z.object({
    ...base,
    type: z.literal("mode"),
    mode: ModeSchema,
    channel: ChannelNameSchema,
    parser: ParserModeSchema,
    modeNote: z.string().optional(),
  }),
  z.object({ ...base, type: z.literal("step"), step: z.number().int(), stepId: StepIdSchema, activePersona: PersonaIdSchema }),
  z.object({ ...base, type: z.literal("queue"), humanQueue: z.array(HumanQueueItemSchema) }),
  z.object({ ...base, type: z.literal("counters"), counters: CountersSchema }),
  z.object({ ...base, type: z.literal("banner"), banner: z.string().optional() }),
  z.object({ ...base, type: z.literal("hint"), hint: z.string().optional() }),
]);
export type SseEvent = z.infer<typeof SseEventSchema>;

/** The one reducer, used by the browser and by server tests. */
export function applyEvent(state: DemoState | undefined, ev: SseEvent): DemoState | undefined {
  if (ev.type === "snapshot") return { ...ev.state, lastEventId: ev.id };
  if (!state) return state;
  const next: DemoState = { ...state, lastEventId: ev.id };
  switch (ev.type) {
    case "message": {
      const t = state.threads[ev.persona];
      next.threads = { ...state.threads, [ev.persona]: { ...t, messages: [...t.messages, ev.message] } };
      return next;
    }
    case "thread":
      next.threads = { ...state.threads, [ev.persona]: ev.thread };
      return next;
    case "clock":
      next.clockMinute = ev.clockMinute;
      next.clockDay = ev.clockDay;
      return next;
    case "mode":
      next.mode = ev.mode;
      next.channel = ev.channel;
      next.parser = ev.parser;
      next.modeNote = ev.modeNote;
      return next;
    case "step":
      next.step = ev.step;
      next.stepId = ev.stepId;
      next.activePersona = ev.activePersona;
      return next;
    case "queue":
      next.humanQueue = ev.humanQueue;
      return next;
    case "counters":
      next.counters = ev.counters;
      return next;
    case "banner":
      next.banner = ev.banner;
      return next;
    case "hint":
      next.hint = ev.hint;
      return next;
  }
}
