import type { Scenario } from "@rot/contracts";
import { addDays, fmtMonthDay, parseISO } from "@rot/core";

/**
 * THE scenario file (spec 3 and Appendix A). Every date, day count, name and scripted text on every screen is generated
 * from this object; nothing is typed into copy. Dates in this file are relative to `todayISO` wherever they can be.
 */
const todayISO = "2026-10-18"; // Sun
const today = parseISO(todayISO);

/** Priya's trip: away until this many days from today (Appendix A: "heading to Denver till Nov 2"). */
const priyaBackOffset = 15;

export const SCENARIO: Scenario = {
  name: "Right on Time",
  todayISO,
  checkInHHMM: "10:00",
  shipWeekday: 3, // Wednesdays only (assumption; first question for the client)
  freezeFromISO: "2026-11-15",
  freezeToISO: "2027-01-05",
  cohortSize: 100,
  pilotWeeks: 16,
  decemberIndex: 141,
  programName: "Right on Time",
  timeBudgetSeconds: { screen2By: 270, screen3By: 300, total: 390 },
  stepOrder: ["s1a", "s1b1", "s1b2", "s1b3", "s1b4", "s1c", "s1d", "s1e", "s2a", "s2b", "s2c", "s2d", "s3a", "s3b", "s3c"],
  personas: [
    {
      id: "maya",
      name: "Maya",
      descriptor: "2-person home, pour-over, in-cafe signup, 4-week deliveries",
      householdSize: 2,
      brew: "pour-over",
      source: "in_cafe",
      cadenceDays: 28,
      payAsYouGo: true,
      deliveriesISO: ["2026-08-05", "2026-09-02", "2026-09-30"],
      nextArrivalISO: "2026-10-28",
      optedInISO: "2026-10-02",
      prior: { medianDays: 40, tau: 0.2 },
      truthDaysPerDelivery: 38,
      phoneEnv: "PERSONA_MAYA_PHONE",
    },
    {
      id: "priya",
      name: "Priya",
      descriptor: "1-person home, espresso, website signup, 4-week deliveries",
      householdSize: 1,
      brew: "espresso",
      source: "website",
      cadenceDays: 28,
      payAsYouGo: true,
      deliveriesISO: ["2026-08-05", "2026-09-02", "2026-09-30"],
      nextArrivalISO: "2026-10-28",
      optedInISO: "2026-10-02",
      prior: { medianDays: 45, tau: 0.2 },
      truthDaysPerDelivery: 36,
      phoneEnv: "PERSONA_PRIYA_PHONE",
    },
    {
      id: "dev",
      name: "Dev",
      descriptor: "2-person home, drip, website signup, 6-week deliveries",
      householdSize: 2,
      brew: "drip",
      source: "website",
      cadenceDays: 42,
      payAsYouGo: true,
      deliveriesISO: ["2026-10-14"],
      nextArrivalISO: "2026-11-25",
      optedInISO: "2026-10-11",
      prior: { medianDays: 45, tau: 0.25 },
      truthDaysPerDelivery: 40,
      phoneEnv: "PERSONA_DEV_PHONE",
    },
    {
      id: "jo",
      name: "Jo",
      descriptor: "background subscriber (an unclear reply for the helpdesk list)",
      householdSize: 3,
      brew: "French press",
      source: "social",
      cadenceDays: 56,
      payAsYouGo: true,
      deliveriesISO: ["2026-07-01", "2026-08-26"],
      nextArrivalISO: "2026-10-21",
      optedInISO: "2026-09-15",
      prior: { medianDays: 60, tau: 0.3 },
      truthDaysPerDelivery: 60,
      phoneEnv: "PERSONA_JO_PHONE",
    },
    {
      id: "sam",
      name: "Sam",
      descriptor: "2-person home, drip, in-cafe signup, 6-week deliveries (the 'Can they leave?' scenario)",
      householdSize: 2,
      brew: "drip",
      source: "in_cafe",
      cadenceDays: 42,
      payAsYouGo: true,
      deliveriesISO: ["2026-08-19", "2026-09-30"],
      nextArrivalISO: "2026-11-11",
      optedInISO: "2026-10-02",
      prior: { medianDays: 50, tau: 0.25 },
      truthDaysPerDelivery: 50,
      phoneEnv: "PERSONA_SAM_PHONE",
    },
  ],
  script: {
    maya_reply: "6",
    maya_why: "WHY",
    priya_message: `heading to Denver till ${fmtMonthDay(addDays(today, priyaBackOffset))}`,
    jo_message: "Is the Ethiopia coming back in stock?",
    sam_1: "WHAT DO YOU KNOW",
    sam_2: "STOP",
    sam_3: "START",
    sam_4: "CANCEL",
    sam_5: "BACK",
    sam_6: "CANCEL",
    sam_7: "DELETE MY DATA",
  },
};

export const SAM_SCRIPT_KEYS = ["sam_1", "sam_2", "sam_3", "sam_4", "sam_5", "sam_6", "sam_7"] as const;
