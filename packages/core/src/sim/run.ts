import { DECISION, SIM } from "../constants.ts";
import { decide, type Decision } from "../engine/decision.ts";
import { forecastFromFilter, type Forecast } from "../engine/forecast.ts";
import { PantryFilter } from "../engine/pantry.ts";
import { priorFor, type PriorModel } from "../engine/prior.ts";
import { Rng } from "../rng.ts";
import { normPpf } from "../stats.ts";
import type { SimParams } from "./params.ts";
import { H, featuresOf, type SimSubscriber } from "./world.ts";

export type SimPolicy = "fixed" | "quiz" | "rule" | "naive" | "paced" | "ceiling";

/** deliveries a single path can hold */
export const MAXD = 24;

/** Raw per-subscriber paths for one (policy, source) run, row-major (n x H). */
export interface SourcePaths {
  n: number;
  /** pantry at the end of each day, in days of coffee at the usual pace */
  stock: Float32Array;
  /** consumption each day in units of "one delivery" */
  cons: Float32Array;
  nDeliveries: Uint8Array;
  deliveryDay: Int16Array;
  /** days of coffee on hand just before the delivery landed; -1 for the first delivery */
  pile: Float32Array;
  /** delivery landed >= 3 days after the customer ran out */
  late: Uint8Array;
  counters: Counters;
}

export interface Counters {
  checkIns: number;
  replies: number;
  holdOffs: number;
  movedLater: number;
  movedSooner: number;
  applied: number;
  soonerAppliedWithoutYes: number;
}

function emptyCounters(): Counters {
  return { checkIns: 0, replies: 0, holdOffs: 0, movedLater: 0, movedSooner: 0, applied: 0, soonerAppliedWithoutYes: 0 };
}

export function allocatePaths(n: number): SourcePaths {
  return {
    n,
    stock: new Float32Array(n * H),
    cons: new Float32Array(n * H),
    nDeliveries: new Uint8Array(n),
    deliveryDay: new Int16Array(n * MAXD).fill(-1),
    pile: new Float32Array(n * MAXD).fill(-1),
    late: new Uint8Array(n * MAXD),
    counters: emptyCounters(),
  };
}

export interface RunContext {
  params: SimParams;
  seed: number;
  prior?: PriorModel;
}

function snapCadence(days: number): number {
  const c = Math.round(days / 7) * 7;
  return Math.min(84, Math.max(28, c));
}

/** Quiz-only: cadence recommended from the signup answers (service-level quantile of the prior); no texts. */
export function quizCadence(sub: SimSubscriber, ctx: RunContext): number {
  const prior = priorFor(ctx.prior!, featuresOf(sub));
  const sdTot = Math.sqrt(prior.tau ** 2 + ctx.prior!.sigmaB ** 2);
  const z = normPpf(ctx.params.serviceQ);
  return snapCadence(Math.exp(prior.mu + z * sdTot) + ctx.params.graceDays);
}

interface Pending {
  day: number;
  replied?: boolean;
}

/**
 * Simulate one subscriber for H days under one policy (no churn: cancelling only truncates the path, so survival is
 * applied analytically afterwards). Day 0 is signup and the first delivery.
 */
export function simulateSubscriber(sub: SimSubscriber, policy: SimPolicy, ctx: RunContext, out: SourcePaths, row: number): void {
  const p = ctx.params;
  const stockOut = out.stock;
  const consOut = out.cons;
  const c = out.counters;
  const base = row * H;
  const dbase = row * MAXD;

  let cadence = sub.cadence;
  if (policy === "quiz") cadence = quizCadence(sub, ctx);
  const texting = policy === "rule" || policy === "paced" || policy === "ceiling" || policy === "naive";

  let pf: PantryFilter | null = null;
  let priorTheta: { mu: number; tau: number } | null = null;
  if (policy === "paced") {
    priorTheta = priorFor(ctx.prior!, featuresOf(sub));
    pf = new PantryFilter(priorTheta, new Rng(sub.pfSeed), { particles: p.particles });
  }

  let R = 0;
  let nextArr = 0;
  let nd = 0; // delivery / skip index into the random streams
  let cyc = 0;
  let zrun = 0;
  let lastArr = -1;
  let ndel = 0;
  let checkDay = -1;
  let pending: Pending | null = null;

  const setCycle = (t: number) => {
    nextArr = t + cadence;
    checkDay = texting ? nextArr - SIM.checkInDaysBefore : -1;
    pending = null;
  };

  const applyMove = (t: number, newArrival: number, dir: "later" | "sooner", needsYes: boolean, d: number) => {
    // later default-accepted moves are reverted with prob laterRevert; anything needing a YES is accepted with prob soonerAccept
    const accept = needsYes ? sub.uAccept[Math.min(d, 39)]! < p.soonerAccept : !(sub.uRevert[Math.min(d, 39)]! < p.laterRevert);
    if (dir === "sooner" && !needsYes) c.soonerAppliedWithoutYes++;
    if (dir === "later") c.movedLater++;
    else c.movedSooner++;
    if (accept) {
      nextArr = newArrival;
      c.applied++;
    }
    void t;
  };

  const weeksReply = (trueR: number, d: number): number => {
    if (sub.uGarbage[Math.min(d, 39)]! < p.replyGarbageShare) return Math.floor(sub.uGarbageWeeks[Math.min(d, 39)]! * 13);
    const w = Math.round((Math.max(trueR, 0) * Math.exp(p.replyAccuracySd * sub.zReply[Math.min(d, 39)]!)) / 7);
    return Math.min(12, Math.max(0, w));
  };

  const decideFor = (t: number, fc: Forecast): Decision =>
    decide({
      today: t,
      currentArrival: nextArr,
      lastDelivery: lastArr,
      forecast: fc,
      graceDays: p.graceDays,
      minArrival: t + 3,
      eligibility: {
        payAsYouGo: true,
        completedDeliveries: ndel,
        inDecemberFreeze: false,
        replyHistoryOk: true,
        textLeadDays: nextArr - t,
      },
    });

  const clampGap = (arr: number): number => {
    if (lastArr < 0) return arr;
    return Math.max(lastArr + DECISION.gapMinDays, Math.min(lastArr + DECISION.gapMaxDays, arr));
  };

  for (let t = 0; t < H; t++) {
    // 1. delivery or customer skip
    if (t === nextArr) {
      if (ndel > 0 && R >= p.skipThresholdDays && sub.uSkip[Math.min(nd, 39)]! < p.skipProb) {
        nd++;
        if (pf) {
          pf.advance(t);
          pf.observeSkip();
        }
        setCycle(t);
      } else {
        out.pile[dbase + ndel] = ndel > 0 ? R : -1;
        out.late[dbase + ndel] = zrun >= DECISION.lateDays ? 1 : 0;
        out.deliveryDay[dbase + ndel] = t;
        R += Math.exp(sub.theta + p.sigmaB * sub.zBox[Math.min(nd, 39)]!);
        nd++;
        ndel++;
        lastArr = t;
        if (pf) {
          pf.advance(t);
          pf.deliver();
        }
        setCycle(t);
      }
    }

    // 2. check-in goes out
    if (texting && t === checkDay) {
      c.checkIns++;
      if (policy === "naive") {
        const na = clampGap(nextArr + 7);
        if (na > nextArr) applyMove(t, na, "later", false, cyc);
        cyc++;
      } else if (policy === "ceiling") {
        pending = { day: t, replied: true };
      } else {
        pending = { day: t + Math.min(SIM.replyWindowDays, Math.floor(sub.uDelay[Math.min(cyc, 39)]! * (SIM.replyWindowDays + 1))) };
      }
    }

    // 3. the reply (or the silence) is processed
    const pend: Pending | null = pending;
    if (pend && t === pend.day && (policy === "rule" || policy === "paced" || policy === "ceiling")) {
      pending = null;
      const d = cyc;
      cyc++;
      if (policy === "ceiling") {
        c.replies++;
        const fc: Forecast = {
          asOf: t,
          runOutDays: { q05: R, q10: R, q33: R, q50: R, q90: R },
          qService: R,
          serviceQ: 0,
          ratio: 1,
          confidence: "High",
          freshReply: true,
        };
        const dec = decide({
          today: t,
          currentArrival: nextArr,
          lastDelivery: lastArr,
          forecast: fc,
          // latest ship day that is not late: rounding to the weekly lattice puts arrival within [run-out - 5, run-out + 2]
          graceDays: -1.5,
          minArrival: t + 3,
          eligibility: { payAsYouGo: true, completedDeliveries: ndel, inDecemberFreeze: false, replyHistoryOk: true, textLeadDays: nextArr - t },
        });
        if (dec.action === "propose") {
          if (dec.direction === "later") c.movedLater++;
          else c.movedSooner++;
          nextArr = dec.newArrival;
          c.applied++;
        }
      } else {
        const cls = R > 14 ? p.replyMultFar : R > 3 ? p.replyMultMid : p.replyMultNear;
        const prob = Math.min(p.replyCap, p.replyBase * cls);
        const replied = sub.uReply[Math.min(d, 39)]! < prob;
        if (!replied) {
          c.holdOffs++;
        } else {
          c.replies++;
          const wk = weeksReply(R, d);
          if (policy === "rule") {
            const step = wk >= 4 ? 14 : wk >= 2 ? 7 : wk === 1 ? 0 : -7;
            if (step !== 0) {
              let na = clampGap(nextArr + step);
              if (na < t + 3) na = nextArr;
              if (na > nextArr) applyMove(t, na, "later", false, d);
              else if (na < nextArr) applyMove(t, na, "sooner", true, d);
            }
          } else {
            pf!.advance(t);
            pf!.observeWeeks(wk);
            const fc = forecastFromFilter(pf!, t, true, p.serviceQ);
            const dec = decideFor(t, fc);
            if (dec.action === "propose") applyMove(t, dec.newArrival, dec.direction as "later" | "sooner", dec.requiresYes, d);
          }
        }
      }
    }

    // 4. consumption
    let Rn = R;
    if (ndel > 0) {
      const step = sub.pace[t]!;
      Rn = Math.max(R - step, 0);
      consOut[base + t] = (R - Rn) / sub.daysPerDelivery;
      R = Rn;
    }
    stockOut[base + t] = R;
    zrun = ndel > 0 && R <= 0 ? zrun + 1 : 0;
  }
  out.nDeliveries[row] = ndel;
}

export interface SimulateSourceOptions {
  policy: SimPolicy;
  n: number;
}

export function simulateSource(source: import("../exhibits.ts").SourceName, opts: SimulateSourceOptions, ctx: RunContext, makeSub: (idx: number) => SimSubscriber): SourcePaths {
  void source;
  const out = allocatePaths(opts.n);
  for (let i = 0; i < opts.n; i++) simulateSubscriber(makeSub(i), opts.policy, ctx, out, i);
  return out;
}
