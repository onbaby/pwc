import { fmtDay, fmtMonthDay, type Day } from "../shared/dates.ts";

/**
 * The copy deck (spec 11.4). Pure functions of variables; dates, names and amounts always come from data. Signed
 * "Classic Cup (Athens)". First-person singular is avoided (automated texts).
 */
export const BRAND = "Classic Cup (Athens)";

export const COPY = {
  consentDelivery: () =>
    `${BRAND}: want texts to time your coffee deliveries? Up to 3 per delivery, automated. We may move a date LATER and you can always undo it; we never charge you earlier without your YES. Msg & data rates may apply. Reply YES to join, HELP for help, STOP to end.`,
  consentOffers: () =>
    `${BRAND}: want occasional offers by automated text? At most one a month, added to a delivery text you'd get anyway. Consent isn't required to buy. Msg & data rates may apply. Reply YES to join. Reply NO OFFERS anytime to stop offers only, STOP to stop all texts, HELP for help.`,
  checkIn: (v: { name: string }) =>
    `Hi ${v.name}, ${BRAND} here. So your next delivery lands when you need it: about how many weeks of coffee do you have left? Reply a number (0 = out).`,
  checkInHoliday: (v: { name: string; holiday: string }) =>
    `Hi ${v.name}, ${BRAND} here. So your next delivery lands when you need it: about how many weeks of coffee do you have left? Reply a number (0 = out). Away for ${v.holiday}? Reply AWAY and it waits until you're back.`,
  newSubscriberHoliday: (v: { name: string; holiday: string }) =>
    `Hi ${v.name}, ${BRAND} here. How's your first coffee going? About how many weeks do you have left? We won't change your schedule until you tell us. Away for ${v.holiday}? Reply AWAY and it waits until you're back.`,
  laterMove: (v: { name: string; weeks: number; old: Day; new: Day }) =>
    `${v.name}, you said about ${v.weeks} weeks left, so we've moved your delivery from ${fmtDay(v.old)} to ${fmtDay(v.new)}, so it's fresh when you open it. Nothing to do. Want ${fmtDay(v.old)} instead? Reply OLD.`,
  away: (v: { holiday: string; old: Day; new: Day }) =>
    `Got it: enjoy ${v.holiday}. We'll hold your ${fmtDay(v.old)} delivery and bring it ${fmtDay(v.new)}, freshly roasted, once you're back. Reply OLD to keep ${fmtDay(v.old)}.`,
  reminder: (v: { new: Day }) => `Your coffee arrives ${fmtDay(v.new)}. Running low? Reply SOONER.`,
  reminderRotation: (v: { new: Day }) =>
    `Your coffee arrives ${fmtDay(v.new)}. Want a different Athens roast each delivery, same price? Reply ROTATE. Running low? Reply SOONER. No more offers? Reply NO OFFERS.`,
  reminderSmaller: (v: { new: Day }) => `Your coffee arrives ${fmtDay(v.new)}. Coffee piling up? Reply SMALLER for a smaller bag at a lower price. No more offers? Reply NO OFFERS.`,
  reminderSwap: (v: { new: Day }) => `Your coffee arrives ${fmtDay(v.new)}. Want this month's roast instead of your usual, same price? Reply SWAP. Running low? Reply SOONER. No more offers? Reply NO OFFERS.`,
  reminderGiftToOwn: (v: { new: Day; percent: number }) =>
    `Your coffee arrives ${fmtDay(v.new)}. Keep it coming yourself? Reply YES for ${v.percent}% off your first delivery. Running low? Reply SOONER. No more offers? Reply NO OFFERS.`,
  sooner: (v: { old: Day; sooner: Day; amount: number }) => `You may run out before ${fmtDay(v.old)}. Get it on ${fmtDay(v.sooner)} ($${v.amount} charged then)? Reply YES. No reply keeps ${fmtDay(v.old)}.`,
  newSubscriber: (v: { name: string }) =>
    `Hi ${v.name}, ${BRAND} here. How's your first coffee going? About how many weeks do you have left? We won't change your schedule until you tell us.`,
  staffHold: (v: { old: Day; new: Day }) => `Got it: we'll hold your ${fmtDay(v.old)} delivery and bring it ${fmtDay(v.new)} so it isn't sitting on your porch. Reply OLD to keep ${fmtDay(v.old)}.`,
  why: (v: { date: Day; weeks: number }) => `Your check-in on ${fmtMonthDay(v.date)} said about ${v.weeks} weeks left, and your deliveries have been landing with coffee still in the pantry.`,
  whyNoReply: () => `Your deliveries land on the schedule you chose. When you tell us how much coffee is left, we may suggest a better date, and you can always undo it.`,
  cancel: () => `Done. Your subscription is cancelled and you won't be charged again. Changed your mind? Reply BACK within 24 hours.`,
  back: () => `Welcome back. Your subscription is active again.`,
  backTooLate: () => `That cancellation can't be undone by text any more. You can start a new subscription at classiccup.example.`,
  stop: () => `You won't get any more texts from us. Your deliveries are not affected. Reply START to get texts again.`,
  start: () => `Texts are back on. Reply STOP anytime to end them.`,
  noOffers: () => `Done: no more offers. You'll still get delivery texts.`,
  help: () => `${BRAND}: automated texts about your delivery dates. Reply WHY, OLD, SOONER, SKIP or HUMAN anytime, NO OFFERS to stop offers only, or STOP to end texts.`,
  needNumber: () => `Roughly how many weeks? A number is fine.`,
  person: () => `Thanks. A person on the Classic Cup team will reply by 5 pm the next business day.`,
  oldRestored: (v: { old: Day }) => `Done. Your delivery is back on ${fmtDay(v.old)}.`,
  nothingToUndo: () => `Nothing to undo right now.`,
  skipped: (v: { old: Day; new: Day }) => `Skipped. Your ${fmtDay(v.old)} delivery won't ship or be charged; the next one lands ${fmtDay(v.new)}. Reply OLD to undo.`,
  paused: (v: { old: Day; new: Day }) => `Paused. We'll move your ${fmtDay(v.old)} delivery to ${fmtDay(v.new)}. Reply OLD to keep ${fmtDay(v.old)}.`,
  offerAccepted: (v: { what: string }) => `Done: ${v.what}. Reply NO OFFERS anytime to stop offers.`,
  soonerDone: (v: { sooner: Day }) => `Done. Your delivery is now ${fmtDay(v.sooner)}.`,
  yesNothing: () => `Thanks. Nothing needs a yes right now.`,
  staffReply: (body: string) => body,
} as const;

/** Time-of-day for check-ins: spread over the morning, deterministic per customer. */
export const CHECKIN_WINDOW = { fromMinute: 9 * 60, toMinute: 11 * 60 + 30 };
