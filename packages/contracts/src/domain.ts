import { z } from "zod";
import { ConfidenceSchema, DaySchema, DirectionSchema } from "./common.ts";

/** Everything the engine, the server and the screens agree on. Dates are whole days since 1970-01-01 (UTC). */

export const PersonaIdSchema = z.enum(["maya", "priya", "dev", "jo", "sam"]);
export type PersonaId = z.infer<typeof PersonaIdSchema>;

export const ModeSchema = z.enum(["live", "replay", "console"]);
export type Mode = z.infer<typeof ModeSchema>;
export const ChannelNameSchema = z.enum(["photon", "console", "replay", "sms-stub"]);
export type ChannelName = z.infer<typeof ChannelNameSchema>;
export const ParserModeSchema = z.enum(["RULES", "RULES+LLM"]);

export const ConvStateSchema = z.enum(["OPT_IN_PENDING", "ACTIVE", "AWAITING_CHECKIN", "AWAITING_PROPOSAL", "AWAY", "PAUSED", "CANCELLED", "OPTED_OUT"]);
export type ConvState = z.infer<typeof ConvStateSchema>;

export const IntentNameSchema = z.enum([
  "YES",
  "STOP",
  "START",
  "HELP",
  "OK",
  "OLD",
  "SOONER",
  "SKIP",
  "WEEKS",
  "PLENTY",
  "AWAY",
  "PAUSE",
  "CANCEL",
  "CANCEL_AMBIGUOUS",
  "BACK",
  "WHY",
  "WHAT_DO_YOU_KNOW",
  "DELETE_MY_DATA",
  "HUMAN",
  "UNKNOWN",
]);
export type IntentName = z.infer<typeof IntentNameSchema>;

export const IntentSchema = z.object({
  name: IntentNameSchema,
  weeks: z.number().int().min(0).max(12).optional(),
  from: DaySchema.optional(),
  to: DaySchema.optional(),
  place: z.string().optional(),
  days: z.number().int().optional(),
});
export type Intent = z.infer<typeof IntentSchema>;

export const ParseLogEntrySchema = z.object({
  id: z.number().int(),
  atMinute: z.number().int(),
  persona: PersonaIdSchema,
  text: z.string(),
  parser: z.enum(["rules", "llm"]),
  intent: IntentSchema,
});
export type ParseLogEntry = z.infer<typeof ParseLogEntrySchema>;

export const BubbleTagSchema = z.enum(["system", "customer", "scripted", "live"]);
export const MessageSchema = z.object({
  id: z.number().int(),
  atMinute: z.number().int(),
  day: DaySchema,
  hhmm: z.string(),
  from: z.enum(["system", "customer"]),
  tag: BubbleTagSchema,
  text: z.string(),
});
export type Message = z.infer<typeof MessageSchema>;

export const RunOutViewSchema = z.object({
  q05: z.number(),
  q10: z.number(),
  q33: z.number(),
  q50: z.number(),
  q90: z.number(),
});

export const ForecastViewSchema = z.object({
  asOfDay: DaySchema,
  runOut: RunOutViewSchema,
  /** absolute days of the likely run-out window */
  windowLo: DaySchema,
  windowMid: DaySchema,
  windowHi: DaySchema,
  ratio: z.number(),
  confidence: ConfidenceSchema,
  freshReply: z.boolean(),
  /** "We hold off and ask" */
  abstain: z.boolean(),
  action: z.enum(["hold_off", "keep", "propose"]),
  direction: DirectionSchema,
  stepDays: z.number().int(),
  rawShiftDays: z.number(),
  note: z.string(),
});
export type ForecastView = z.infer<typeof ForecastViewSchema>;

export const ExplanationCardSchema = z.object({
  startingPoint: z.object({ text: z.string(), tag: z.string() }),
  evidence: z.object({ text: z.string() }),
  whatChangesIt: z.object({ text: z.string() }),
  rangeTitle: z.string(),
});

export type ExplanationCard = z.infer<typeof ExplanationCardSchema>;

export const PantryPointSchema = z.object({
  day: DaySchema,
  /** synthetic truth: days of coffee left under the schedule as it was before any change */
  fixed: z.number(),
  /** under the current (possibly moved) schedule, from today on */
  paced: z.number().optional(),
});

export const PantryViewSchema = z.object({
  points: z.array(PantryPointSchema),
  fixedDeliveries: z.array(DaySchema),
  currentDeliveries: z.array(DaySchema),
  today: DaySchema,
  /** days of coffee on hand when each delivery after the first arrived, under the fixed schedule */
  piles: z.array(z.object({ day: DaySchema, days: z.number() })),
});
export type PantryView = z.infer<typeof PantryViewSchema>;

export const ProposalViewSchema = z.object({
  kind: z.enum(["later", "sooner", "away", "pause", "skip"]),
  oldArrival: DaySchema,
  newArrival: DaySchema,
  status: z.enum(["pending", "applied", "confirmed", "reverted", "declined", "expired"]),
  requiresYes: z.boolean(),
  /** minute at which an applied later move counts as confirmed with no reply */
  confirmAtMinute: z.number().int().optional(),
});
export type ProposalView = z.infer<typeof ProposalViewSchema>;

export const ThreadSchema = z.object({
  persona: PersonaIdSchema,
  name: z.string(),
  descriptor: z.string(),
  state: ConvStateSchema,
  consentChip: z.string(),
  messages: z.array(MessageSchema),
  oldArrival: DaySchema,
  currentArrival: DaySchema,
  lastDelivery: DaySchema,
  deliveries: z.array(DaySchema),
  forecast: ForecastViewSchema.optional(),
  explanation: ExplanationCardSchema.optional(),
  proposal: ProposalViewSchema.optional(),
  pantry: PantryViewSchema.optional(),
  /** how many texts went out this cycle (budget 3) */
  textsThisCycle: z.number().int(),
});
export type Thread = z.infer<typeof ThreadSchema>;

export const HumanQueueItemSchema = z.object({
  id: z.number().int(),
  persona: PersonaIdSchema,
  name: z.string(),
  text: z.string(),
  reason: z.string(),
  atMinute: z.number().int(),
});
export type HumanQueueItem = z.infer<typeof HumanQueueItemSchema>;

export const CountersSchema = z.object({
  /** "Held off, waiting for data: X of N" from a synthetic cohort run through the same engine */
  heldOff: z.number().int(),
  cohort: z.number().int(),
});

export const StepIdSchema = z.enum(["s1a", "s1b1", "s1b2", "s1b3", "s1b4", "s1c", "s1d", "s1e", "s2a", "s2b", "s2c", "s2d", "s3a", "s3b", "s3c"]);
export type StepId = z.infer<typeof StepIdSchema>;

export const DemoStateSchema = z.object({
  mode: ModeSchema,
  channel: ChannelNameSchema,
  parser: ParserModeSchema,
  /** why the mode is what it is, e.g. "Photon did not connect within 5 s: fell back to replay" */
  modeNote: z.string().optional(),
  noNetwork: z.boolean(),
  clockMinute: z.number().int(),
  clockDay: DaySchema,
  step: z.number().int(),
  stepCount: z.number().int(),
  stepId: StepIdSchema,
  activePersona: PersonaIdSchema,
  threads: z.record(PersonaIdSchema, ThreadSchema),
  humanQueue: z.array(HumanQueueItemSchema),
  counters: CountersSchema,
  banner: z.string().optional(),
  /** set when the step key could not advance (for example the reply is still outstanding) */
  hint: z.string().optional(),
  lastEventId: z.number().int(),
});
export type DemoState = z.infer<typeof DemoStateSchema>;
