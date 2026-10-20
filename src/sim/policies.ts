import { decide, confidenceOf, type Confidence } from "../engine/decision.ts";
import { PantryTracker } from "../engine/pantryFilter.ts";
import { priorFor, type PriorModel } from "../engine/prior.ts";
import { ENGINE, WORLD } from "../shared/constants.ts";
import type { Day } from "../shared/dates.ts";
import { H, SIM_START, draw, priorFeatures, type SimCustomer } from "./world.ts";

export type PolicyName = "fixed" | "rule" | "paced" | "ceiling";

export interface PolicySettings {
  replyBase: number;
  replyAccuracySd: number;
  cautiousness: keyof typeof ENGINE.cautiousness;
  particles: number;
}

export const DEFAULT_SETTINGS: PolicySettings = { replyBase: WORLD.replyBase, replyAccuracySd: WORLD.replyAccuracySd, cautiousness: ENGINE.defaultCautiousness, particles: ENGINE.particles };

export const MAXD = 24;
const NO_FREEZE = { from: 1e9, to: 1e9 + 1 };

/** Layer B coverage bookkeeping: does the 80% run-out range contain the simulator's true days on hand? */
export interface CoverageCounts {
  /** key: `${deliveriesCompleted(1..4+)}|${replyState}` -> [inside, total] */
  byKey: Map<string, [number, number]>;
}

export interface Counters {
  checkIns: number;
  replies: number;
  holdOffs: number;
  movedLater: number;
  movedSooner: number;
  applied: number;
  soonerAppliedWithoutYes: number;
  autoSent: number;
  needApproval: number;
}

export interface PathSet {
  n: number;
  stock: Float32Array;
  cons: Float32Array;
  nDeliveries: Uint8Array;
  deliveryDay: Int16Array;
  /** days of coffee on hand just before a delivery landed; -1 for the first */
  pile: Float32Array;
  late: Uint8Array;
  counters: Counters;
  coverage: CoverageCounts;
}

export function allocatePaths(n: number): PathSet {
  return {
    n,
    stock: new Float32Array(n * H),
    cons: new Float32Array(n * H),
    nDeliveries: new Uint8Array(n),
    deliveryDay: new Int16Array(n * MAXD).fill(-1),
    pile: new Float32Array(n * MAXD).fill(-1),
    late: new Uint8Array(n * MAXD),
    counters: { checkIns: 0, replies: 0, holdOffs: 0, movedLater: 0, movedSooner: 0, applied: 0, soonerAppliedWithoutYes: 0, autoSent: 0, needApproval: 0 },
    coverage: { byKey: new Map() },
  };
}

export interface SimEnv {
  prior: PriorModel;
  settings: PolicySettings;
}

/**
 * Simulate one customer for H days under one policy. Cancelling only truncates a path, so churn is applied analytically
 * afterwards (churn.ts). Day 0 is sign-up and the first delivery (a Wednesday). Check-ins go out 10 days before the
 * scheduled arrival; a reply counts if it arrives within 5 days.
 */
export function simulateCustomer(c: SimCustomer, policy: PolicyName, env: SimEnv, out: PathSet, row: number): void {
  const s = env.settings;
  const base = row * H;
  const dbase = row * MAXD;
  const cnt = out.counters;
  let R = 0;
  let nextArr = 0;
  let k = 0; // draw index for deliveries / skips
  let cyc = 0; // draw index for check-ins
  let zrun = 0;
  let lastArr = -1;
  let ndel = 0;
  let cycleBase = 0;
  let checkDay = -1;
  let pendingDay = -1;
  const texting = policy !== "fixed";
  const tracker = policy === "paced" ? new PantryTracker(priorFor(env.prior, priorFeatures(c)), c.pfSeed, SIM_START, { particles: s.particles }) : null;

  const record = (state: string, lo: number, hi: number): void => {
    const key = `${Math.min(ndel, 4)}|${state}`;
    const e = out.coverage.byKey.get(key) ?? [0, 0];
    e[1]++;
    if (R >= lo && R <= hi) e[0]++;
    out.coverage.byKey.set(key, e);
  };
  const setCycle = (t: number): void => {
    nextArr = t + c.rhythmDays;
    cycleBase = nextArr;
    checkDay = texting ? nextArr - ENGINE.checkInDaysBefore : -1;
    pendingDay = -1;
  };
  const weeksFor = (): number => {
    if (draw.garbage(c, cyc) < WORLD.replyGarbage) return Math.floor(draw.garbageWeeks(c, cyc) * 13);
    return Math.min(12, Math.max(0, Math.round((Math.max(R, 0) * Math.exp(s.replyAccuracySd * draw.noise(c, cyc))) / 7)));
  };
  const apply = (to: number, dir: "later" | "sooner", needsYes: boolean, today: number): void => {
    if (dir === "sooner") cnt.movedSooner++;
    else cnt.movedLater++;
    const accept = needsYes ? draw.accept(c, cyc) < WORLD.sooner.yes : draw.revert(c, cyc) >= WORLD.laterRevert;
    if (dir === "sooner" && !needsYes) cnt.soonerAppliedWithoutYes++;
    if (accept) {
      nextArr = to;
      cnt.applied++;
    }
    void today;
  };

  for (let t = 0; t < H; t++) {
    if (t === nextArr) {
      if (ndel > 0 && R >= ENGINE.skipThresholdDays && draw.skip(c, k) < WORLD.skipProb) {
        k++;
        if (tracker) {
          tracker.advance(SIM_START + t);
          tracker.skip();
        }
        setCycle(t);
      } else {
        out.pile[dbase + ndel] = ndel > 0 ? R : -1;
        out.late[dbase + ndel] = zrun >= ENGINE.lateDays ? 1 : 0;
        out.deliveryDay[dbase + ndel] = t;
        R += Math.exp(c.theta + WORLD.sigmaB * draw.box(c, k));
        k++;
        ndel++;
        lastArr = t;
        if (tracker) {
          tracker.advance(SIM_START + t);
          tracker.deliver();
        }
        setCycle(t);
      }
    }

    if (texting && t === checkDay) {
      cnt.checkIns++;
      if (policy === "ceiling") pendingDay = t;
      else pendingDay = t + Math.min(5, Math.floor(draw.delay(c, cyc) * 6));
      if (tracker) {
        // coverage with no reply yet at the check-in
        tracker.advance(SIM_START + t);
        const [lo, hi] = tracker.quantiles([0.1, 0.9]) as [number, number];
        record("none", lo, hi);
      }
    }

    if (texting && pendingDay === t) {
      pendingDay = -1;
      const d = cyc;
      const today: Day = SIM_START + t;
      if (policy === "ceiling") {
        cnt.replies++;
        const dec = decide({
          today,
          baseArrival: SIM_START + cycleBase,
          lastDelivery: SIM_START + lastArr,
          runOut: { q05: R, q10: R, q33: R, q50: R, q90: R },
          confidence: "High",
          trigger: "reply",
          // perfect knowledge: the latest weekly ship day that is not late (grace 2 < the 3-day late threshold)
          serviceQuantile: R - ENGINE.graceDays + (ENGINE.lateDays - 1),
          plan: { payAsYouGo: true, completedDeliveries: ndel },
          freeze: NO_FREEZE,
          proposalCount: 0,
          deliveredReceipt: true,
          repliedInPreviousTwoCycles: true,
        });
        const p = dec.proposal;
        if (p.direction !== "none") {
          if (p.direction === "later") cnt.movedLater++;
          else cnt.movedSooner++;
          nextArr = p.to - SIM_START;
          cnt.applied++;
        }
      } else {
        const cls = R > 14 ? WORLD.replyMultHigh : R > 3 ? WORLD.replyMultMid : WORLD.replyMultLow;
        const replied = draw.reply(c, d) < Math.min(WORLD.replyCap, s.replyBase * cls);
        if (!replied) cnt.holdOffs++;
        else {
          cnt.replies++;
          const wk = weeksFor();
          if (policy === "rule") {
            const step = wk >= 4 ? 14 : wk >= 2 ? 7 : wk === 1 ? 0 : -7;
            if (step !== 0) {
              let to = nextArr + step;
              if (lastArr >= 0) to = Math.max(lastArr + ENGINE.gapMinDays, Math.min(lastArr + ENGINE.gapMaxDays, to));
              if (to < t + ENGINE.minLeadDays) to = nextArr;
              if (to > nextArr) apply(to, "later", false, t);
              else if (to < nextArr) apply(to, "sooner", true, t);
            }
          } else {
            tracker!.advance(today);
            tracker!.reply(wk);
            const qC = ENGINE.cautiousness[s.cautiousness];
            const [q05, q10, q33, q50, q90, qS] = tracker!.quantiles([0.05, 0.1, 0.33, 0.5, 0.9, qC]) as [number, number, number, number, number, number];
            record("replied", q10, q90);
            const conf: Confidence = confidenceOf(q10, q90, true);
            const dec = decide({
              today,
              baseArrival: SIM_START + cycleBase,
              lastDelivery: SIM_START + lastArr,
              runOut: { q05, q10, q33, q50, q90 },
              confidence: conf,
              trigger: "reply",
              serviceQuantile: qS,
              plan: { payAsYouGo: true, completedDeliveries: ndel },
              freeze: NO_FREEZE,
              proposalCount: 0,
              deliveredReceipt: true,
              repliedInPreviousTwoCycles: true,
            });
            const p = dec.proposal;
            if (p.direction === "later") {
              if (p.autoSend) cnt.autoSent++;
              else cnt.needApproval++;
              apply(p.to - SIM_START, "later", false, t);
            } else if (p.direction === "sooner") {
              cnt.needApproval++;
              apply(p.to - SIM_START, "sooner", true, t);
            }
          }
        }
      }
      cyc++;
    }

    let Rn = R;
    if (ndel > 0) {
      Rn = Math.max(R - c.pace[t]!, 0);
      out.cons[base + t] = (R - Rn) / c.daysPerDelivery;
      R = Rn;
    }
    out.stock[base + t] = R;
    zrun = ndel > 0 && R <= 0 ? zrun + 1 : 0;
  }
  out.nDeliveries[row] = ndel;
}
