import { hash32 } from "./rng.ts";

/**
 * The A/B pilot from the deck: new subscribers are split at random, half get AI timing and half stay on their fixed
 * schedule (the control). Assignment is a hash of the customer id, so it is random-looking, 50/50 over many customers, and
 * never changes for the same customer.
 */
export type Arm = "ai" | "fixed";

export const ARM_LABEL: Record<Arm, string> = { ai: "AI timing", fixed: "Fixed schedule (control)" };

export const armFor = (customerId: string): Arm => (hash32("pilot-arm", customerId) % 2 === 0 ? "ai" : "fixed");

export const PILOT = {
  /** the deck: months 2 to 4, about 13 weeks, then the month-3 stop rule */
  weeks: 13,
  /** the stop rule is read at the end of month 3 (week 13); the sandbox sits in week 5 */
  sandboxWeek: 5,
  /** a fixed-schedule customer's complaint rate in the seed is the same as an AI customer's: no effect is built in */
  seedComplaintShare: 0.012,
} as const;
