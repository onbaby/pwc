import { z } from "zod";
import { PersonaIdSchema, StepIdSchema } from "./domain.ts";
import { SourceSchema } from "./common.ts";

/** The scenario file's shape. Every date and day count shown anywhere is generated from one object of this type. */
export const PersonaSchema = z.object({
  id: PersonaIdSchema,
  name: z.string(),
  descriptor: z.string(),
  householdSize: z.number().int(),
  brew: z.string(),
  source: SourceSchema,
  cadenceDays: z.number().int(),
  payAsYouGo: z.boolean(),
  /** ISO dates of deliveries that have already landed */
  deliveriesISO: z.array(z.string()),
  nextArrivalISO: z.string(),
  optedInISO: z.string(),
  prior: z.object({ medianDays: z.number(), tau: z.number() }),
  /** synthetic truth: days one delivery really lasts (drives the pantry picture, never the engine) */
  truthDaysPerDelivery: z.number(),
  /** env var holding this persona's opted-in team phone, for live iMessage */
  phoneEnv: z.string(),
});
export type PersonaSpec = z.infer<typeof PersonaSchema>;

export const ScenarioSchema = z.object({
  name: z.string(),
  todayISO: z.string(),
  checkInHHMM: z.string(),
  /** 0 = Sunday ... 3 = Wednesday */
  shipWeekday: z.number().int(),
  freezeFromISO: z.string(),
  freezeToISO: z.string(),
  personas: z.array(PersonaSchema),
  /** the scripted inbound texts used in Replay */
  script: z.record(z.string(), z.string()),
  stepOrder: z.array(StepIdSchema),
  cohortSize: z.number().int(),
  pilotWeeks: z.number().int(),
  decemberIndex: z.number(),
  programName: z.string(),
  timeBudgetSeconds: z.object({ screen2By: z.number(), screen3By: z.number(), total: z.number() }),
});
export type Scenario = z.infer<typeof ScenarioSchema>;
