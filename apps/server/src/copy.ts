import { fmtMonthDay, fmtShort, type Day } from "@rot/core";

/**
 * The copy deck (spec 7.5). Pure functions of variables; dates and names always come from the scenario or the engine.
 * Tone: plain, local. Signed "Classic Cup (Athens)". First-person singular is avoided (automated).
 */
export const BRAND = "Classic Cup (Athens)";
export const TERMS_URL = "classiccup.example/texts";
export const HELP_URL = "classiccup.example/help";

export const COPY = {
  consent: () =>
    `${BRAND}: want texts to time your coffee deliveries? About 2 per delivery, automated. We may suggest moving a date LATER and you can always undo it; we never charge you earlier without your YES. Msg and data rates may apply. Reply YES to join, HELP for help, STOP to end. Terms: ${TERMS_URL}`,
  optInConfirmed: () => `You're in. ${BRAND} will text about 2 times per delivery. Reply STOP anytime to end texts.`,
  checkIn: (v: { name: string }) =>
    `Hi ${v.name}, ${BRAND} here. So your next delivery lands when you need it: about how many weeks of coffee do you have left? Reply a number (0 = out). Automated; reply STOP to end texts.`,
  laterProposal: (v: { name: string; weeks: number; old: Day; new: Day }) =>
    `${v.name}, you said about ${v.weeks} weeks left, so we've moved your delivery from ${fmtShort(v.old)} to ${fmtShort(v.new)}. Nothing to do. Want ${fmtShort(v.old)} instead? Reply OLD.`,
  laterNeedsOk: (v: { name: string; weeks: number; old: Day; new: Day }) =>
    `${v.name}, you said about ${v.weeks} weeks left. Want your delivery moved from ${fmtShort(v.old)} to ${fmtShort(v.new)}? Reply YES. No reply keeps ${fmtShort(v.old)}.`,
  reminder: (v: { new: Day }) => `Your coffee arrives ${fmtShort(v.new)}. Running low? Reply SOONER and we'll check what we can do.`,
  soonerProposal: (v: { old: Day; sooner: Day; amount: number }) =>
    `You may run out before ${fmtShort(v.old)}. Ship sooner, on ${fmtShort(v.sooner)} ($${v.amount} charged then)? Reply YES. No reply keeps ${fmtShort(v.old)}.`,
  expediteProposal: (v: { old: Day; amount: number }) =>
    `You may run out before ${fmtShort(v.old)}. Ship today instead ($${v.amount} charged now)? Reply YES. No reply keeps ${fmtShort(v.old)}.`,
  keepDate: (v: { name: string; old: Day }) => `Thanks, ${v.name}. Your delivery stays on ${fmtShort(v.old)}.`,
  holdOff: (v: { name: string }) =>
    `Hi ${v.name}, Classic Cup here. How's the first bag going? About how many weeks of coffee do you have left? We won't change your schedule until you tell us. Reply STOP to end texts.`,
  away: (v: { place?: string; date: Day; old: Day; ship: Day }) =>
    `Got it, ${v.place ? `${v.place} until ${fmtShort(v.date)}` : `away until ${fmtShort(v.date)}`}. We'll hold your ${fmtShort(v.old)} delivery and ship it ${fmtShort(v.ship)} so it isn't sitting on your porch. Reply OLD to ship ${fmtShort(v.old)} anyway.`,
  awayNoChange: (v: { date: Day }) => `Got it, away until ${fmtShort(v.date)}. Your next delivery already lands after you're back, so nothing changes.`,
  pause: (v: { old: Day; new: Day }) => `Paused. We'll move your ${fmtShort(v.old)} delivery to ${fmtShort(v.new)}. Reply OLD to ship ${fmtShort(v.old)} anyway.`,
  skip: (v: { old: Day; new: Day }) => `Skipped. Your ${fmtShort(v.old)} delivery won't ship or be charged; the next one lands ${fmtShort(v.new)}. Reply OLD to undo.`,
  why: (v: { weeks: number; date: Day; old: Day }) =>
    `Your last check-in said about ${v.weeks} weeks left on ${fmtMonthDay(v.date)}, and your deliveries have been landing with coffee still in the pantry. Reply OLD to keep ${fmtShort(v.old)}.`,
  whyNoReply: () => `Your deliveries land on the schedule you chose. When you tell us how much coffee is left, we may suggest a better date, and you can always undo it.`,
  oldReverted: (v: { old: Day }) => `Done. Your delivery is back on ${fmtShort(v.old)}.`,
  nothingToUndo: () => `Nothing to undo right now.`,
  cancel: () =>
    `Done. Your subscription is cancelled and you won't be charged again. Any delivery already shipped is on its way. Changed your mind? Reply BACK within 24 hours.`,
  cancelClarify: () => `Just checking: do you want to cancel your subscription? Reply CANCEL to cancel it, or OK to keep it as it is.`,
  back: () => `Welcome back. Your subscription is active again.`,
  backTooLate: () => `That cancellation can't be undone by text any more. You can start a new subscription at classiccup.example.`,
  cancelledReminder: () => `Your subscription is cancelled. Reply BACK within 24 hours to undo it.`,
  stop: () => `You won't get any more texts from us. Your coffee deliveries are not affected. Reply START to get texts again.`,
  start: () => `Texts are back on. Reply STOP anytime to end them.`,
  alreadyOn: () => `Texts are already on. Reply STOP anytime to end them.`,
  help: () => `${BRAND}: automated texts about your delivery dates. Reply WHY, OLD, SOONER, SKIP or HUMAN anytime, or STOP to end texts. More: ${HELP_URL}`,
  whatDoYouKnow: () =>
    `We use: your delivery dates, your weeks-left replies, and the answers you gave when you signed up. Reply DELETE MY DATA to erase them.`,
  deleteMyData: () =>
    `Done. We erased your weeks-left replies and signup answers, and you won't get more texts. Your subscription itself is unchanged; reply HUMAN or visit ${HELP_URL} for anything else.`,
  needNumber: () => `Roughly how many weeks? A number is fine.`,
  unknown: () => `Thanks. A person on the Classic Cup team will reply by 5 pm the next business day.`,
  weeksAcknowledged: (v: { weeks: number }) => `Thanks, about ${v.weeks} weeks noted.`,
} as const;

export const BANNERS = {
  confirmed: (hours: number) => `+${hours} h, no reply: new date confirmed`,
} as const;
