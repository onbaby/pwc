import { useState } from "react";
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { CHANNELS, EXHIBITS, GROCERY, QR, SOURCE_LABEL, type Source } from "../../shared/constants.ts";
import { opportunity, type whyDtc } from "../../shared/opportunity.ts";
import type { Day } from "../../shared/dates.ts";
import type { ImpactArtifact } from "../../sim/impact.ts";
import { useApi } from "../api.tsx";
import { Card, Empty, PageTitle, SectionTitle } from "../components/ui.tsx";
import { fmtDay, nf, pct, usd } from "../format.ts";
import { href } from "../router.ts";

interface BacktestRow {
  k: string;
  n: number;
  customers: number;
  pinballMean: { model: number; bc: number };
  coverage80: { model: number; bc: number };
  medianWidthDays: { model: number; bc: number };
  diff: { mean: number; lo: number; hi: number };
}
interface Backtest {
  protocol: { path: string; commit: string; committedAt: string; committedBeforeRun: boolean; cutoffDay: number };
  dataset: { name: string; citation: string; license: string; counts: { rows: number } };
  splits: { testCustomers: number; testPredictions: number };
  rows: BacktestRow[];
  pooledCoverage80: number;
  success: { passed: boolean; line: string };
}
interface ImpactDTO {
  impact: ImpactArtifact | null;
  backtest: Backtest | null;
  ledger: Array<{ parameter: string; value: string; range: string; source: string }>;
  exhibits: { newSubsPerYear: number; sources: Record<Source, { newSubs: number; ret90: number; ret12: number; aov: number; reason: string }> };
  pilot: { status: string; weeks: number; minReplyRate: number; freezeFrom: Day; freezeTo: Day; decemberIndex: number };
  offerExperiments: Array<{ id: number; name: string; status: string; statusLine: string; sends: number }>;
  whyDtc: ReturnType<typeof whyDtc>;
  opportunityDefaults: { retentionLift: number; groceryConversion: number; bagsPerBuyerPerYear: number };
  freshness: { bestByDays: number; peakEndDays: number; roastToDoorDays: number };
}

const CAFE_WEB_SIGNUPS = EXHIBITS.sources.in_cafe.newSubs + EXHIBITS.sources.website.newSubs;
const ESPRESSO = "#643A2B";
const ORANGE = "#F16A21";
const PLUM = "#7F2754";
const TICK = { fontSize: 12, fill: "#6B5A50" };

const at = (phi: number): string => `${Math.round(phi * 100)} of every 100`;

/** One generated sentence from the data (spec 10): the claim always matches the lines on the chart. */
export function headline(d: ImpactArtifact): string {
  const pacing = d.paced.breakEvenPhi === null ? "Pacing alone never breaks even, at any setting from 0 to 100 of every 100" : `Pacing alone breaks even at ${at(d.paced.breakEvenPhi)}`;
  const perfect = d.ceiling.breakEvenPhi === null ? "perfect knowledge never does either" : `perfect knowledge breaks even at ${at(d.ceiling.breakEvenPhi)}`;
  const base = d.better[0]?.gainAtDefaultPP ?? 0;
  const lever = (match: (l: string) => boolean): number => Math.max(0, ...d.better.slice(1).filter((b) => match(b.label)).map((b) => b.gainAtDefaultPP - base));
  const reply = lever((l) => l.startsWith("Reply rate"));
  const acc = lever((l) => l.startsWith("Replies accurate"));
  const biggest = reply === 0 && acc === 0 ? "" : reply >= acc ? "; reply rate is the biggest lever" : "; accuracy is the biggest lever";
  return `${pacing}; ${perfect}${biggest}.`;
}

function PacingCard({ d, cohort }: { d: ImpactArtifact; cohort: number }) {
  const grid = d.meta.phiGrid;
  const [i, setI] = useState(Math.max(0, grid.findIndex((p) => Math.abs(p - d.meta.defaultPhi) < 1e-9)));
  const rows = grid.map((p, k) => ({ phi: Math.round(p * 100), required: d.paced.requiredPP[k]!, requiredCeil: d.ceiling.requiredPP[k]!, paced: d.paced.gainPP[k]!, ceiling: d.ceiling.gainPP[k]! }));
  const top = Math.ceil(Math.max(...rows.map((r) => Math.max(r.ceiling, r.paced, r.required, r.requiredCeil))) / 2) * 2;
  const cur = rows[i]!;
  const profit = d.paced.profitDelta[i]!;
  const [pLo, pHi] = d.paced.profitDeltaCI[i]!;
  return (
    <Card>
      <SectionTitle>Is pacing paying for itself?</SectionTitle>
      <p className="m-0 mb-3 max-w-[820px] text-[16px] font-medium">{headline(d)}</p>
      <div className="h-[320px] w-full" role="img" aria-label="Retention gain against the retention gain needed, by how many cancellations are caused by too much coffee">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 14, right: 150, bottom: 22, left: 0 }}>
            <CartesianGrid stroke="#E9DFD6" vertical={false} />
            <XAxis dataKey="phi" type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={TICK} axisLine={{ stroke: "#E9DFD6" }} tickLine={false} label={{ value: "Of every 100 cancellations, how many are caused by too much coffee", position: "insideBottom", offset: -14, fontSize: 12, fill: "#6B5A50" }} />
            <YAxis domain={[0, top]} ticks={Array.from({ length: 5 }, (_, k) => (top * k) / 4)} tick={TICK} axisLine={false} tickLine={false} width={52} tickFormatter={(v: number) => `${Math.round(v * 10) / 10} pts`} />
            <ReferenceLine x={cur.phi} stroke="#6B5A50" strokeDasharray="2 3" />
            <Line dataKey="required" stroke={ESPRESSO} strokeWidth={2.5} strokeDasharray="8 5" dot={false} isAnimationActive={false} label={endLabel("Needed (pacing)", ESPRESSO, rows.length - 1, -7)} />
            <Line dataKey="requiredCeil" stroke={ESPRESSO} strokeOpacity={0.45} strokeWidth={1.5} strokeDasharray="3 4" dot={false} isAnimationActive={false} label={endLabel("Needed (perfect)", "#6B5A50", rows.length - 1)} />
            <Line dataKey="paced" stroke={ORANGE} strokeWidth={3} dot={false} isAnimationActive={false} label={endLabel("Paced", "#B34A12", rows.length - 1, 8)} />
            <Line dataKey="ceiling" stroke={PLUM} strokeWidth={3} strokeDasharray="1 5" strokeLinecap="round" dot={false} isAnimationActive={false} label={endLabel("Perfect knowledge", PLUM, rows.length - 1)} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 grid grid-cols-12 items-center gap-5">
        <label className="col-span-7 block text-[14px]">
          <span className="mb-1 block text-muted">
            Of every 100 cancellations among cafe and website sign-ups, how many are caused by too much coffee? <b className="tnum text-ink">{cur.phi}</b>
          </span>
          <input type="range" min={0} max={grid.length - 1} step={1} value={i} onChange={(e) => setI(Number(e.target.value))} className="w-full accent-[#643A2B]" aria-label="Cancellations caused by too much coffee, out of 100" aria-valuetext={`${cur.phi} of every 100`} />
          <span className="text-[13px] text-muted">In this simulation, {pct(d.fixed.stockpileShare[i]!)} of customers on a fixed schedule are holding a stockpile at this setting. Exhibit C does not say what the real number is; the pilot would measure it.</span>
        </label>
        <div className="col-span-5 grid grid-cols-2 gap-3 text-[14px]">
          <div className="rounded-lg bg-cream p-3">
            <div className="text-[13px] text-muted">Pacing keeps</div>
            <div className="tnum text-[20px] font-semibold text-espresso">{cur.paced.toFixed(1)} pts more</div>
            <div className="text-[13px] text-muted">needs {cur.required.toFixed(1)} pts to cover its cost</div>
          </div>
          <div className="rounded-lg bg-cream p-3">
            <div className="text-[13px] text-muted">Perfect knowledge keeps</div>
            <div className="tnum text-[20px] font-semibold text-espresso">{cur.ceiling.toFixed(1)} pts more</div>
            <div className="text-[13px] text-muted">needs {cur.requiredCeil.toFixed(1)} pts</div>
          </div>
          <div className="col-span-2 rounded-lg bg-cream p-3">
            <div className="text-[13px] text-muted">Profit per sign-up vs a fixed schedule</div>
            <div className="tnum text-[20px] font-semibold text-espresso">
              {usd(profit, 2)} <span className="text-[13px] font-normal text-muted">(95% range {usd(pLo, 2)} to {usd(pHi, 2)})</span>
            </div>
            <div className="text-[13px] text-muted">
              Retention gain is the 12-month difference in percentage points, cafe and website sign-ups. Across the {nf(cohort)} cafe and website sign-ups a year that is about {usd(profit * cohort)} a year.
            </div>
          </div>
        </div>
      </div>

      <h3 className="mb-2 mt-6 text-[16px] font-semibold text-espresso">What would make it better</h3>
      <table>
        <thead>
          <tr>
            <th>If the program had…</th>
            <th className="text-right">Replies</th>
            <th className="text-right">Keeps (pts)</th>
            <th className="text-right">Needs (pts)</th>
            <th className="text-right">Breaks even at</th>
          </tr>
        </thead>
        <tbody>
          {d.better.map((b, k) => (
            <tr key={b.label} className={k === 0 ? "row font-medium" : "row"}>
              <td>{b.label}</td>
              <td className="tnum text-right">{pct(b.replyRate)}</td>
              <td className="tnum text-right">{b.gainAtDefaultPP.toFixed(2)}</td>
              <td className="tnum text-right">{b.requiredAtDefaultPP.toFixed(2)}</td>
              <td className="tnum text-right">{b.breakEvenPhi === null ? "never" : `${Math.round(b.breakEvenPhi * 100)} of 100`}</td>
            </tr>
          ))}
          <tr className="row">
            <td>A simple rule on the reply alone (no pantry model)</td>
            <td className="tnum text-right">–</td>
            <td className="tnum text-right">{d.rule.gainPP[grid.findIndex((p) => Math.abs(p - d.meta.defaultPhi) < 1e-9)]!.toFixed(2)}</td>
            <td className="tnum text-right">{d.rule.requiredPP[grid.findIndex((p) => Math.abs(p - d.meta.defaultPhi) < 1e-9)]!.toFixed(2)}</td>
            <td className="tnum text-right">{d.rule.breakEvenPhi === null ? "never" : `${Math.round(d.rule.breakEvenPhi * 100)} of 100`}</td>
          </tr>
        </tbody>
      </table>
      <div className="mt-3 text-[13px] text-muted">
        {d.meta.note} The “needs” bar is model-free: how much 12-month retention the change must add to cover its program cost and the deliveries it removes. Table rows are read at the setting of {Math.round(d.meta.defaultPhi * 100)} of every 100.
      </div>
    </Card>
  );
}

function endLabel(text: string, fill: string, lastIndex: number, dy = 0) {
  return (p: { x?: number | string; y?: number | string; index?: number }) =>
    p.index === lastIndex && p.x !== undefined && p.y !== undefined ? (
      <text x={Number(p.x) + 8} y={Number(p.y) + 4 + dy} fontSize={12} fontWeight={600} fill={fill}>
        {text}
      </text>
    ) : (
      <g />
    );
}

function PilotCard({ p }: { p: ImpactDTO["pilot"] }) {
  return (
    <Card>
      <SectionTitle right={<span className="chip">{p.status}</span>}>Pilot plan</SectionTitle>
      <div className="grid grid-cols-3 gap-4 text-[14px]">
        {[
          ["Control", "Today's fixed schedule, no check-in texts."],
          ["Check-in only", "The reminder and reply texts, no schedule changes: separates the effect of asking from the effect of moving."],
          ["Check-in + paced delivery", "The full program: moves proposed from replies; sooner moves need staff approval and the customer's YES."],
        ].map(([t, b]) => (
          <div key={t} className="rounded-lg border border-line p-3">
            <div className="mb-1 font-semibold text-espresso">{t}</div>
            <div className="text-muted">{b}</div>
          </div>
        ))}
      </div>
      <ul className="mb-0 mt-4 list-disc space-y-1 pl-5 text-[14px]">
        <li>Randomised by customer, stratified by sign-up source. Eligible: pay-as-you-go with at least 2 completed deliveries. Pilot customers are excluded from offers.</li>
        <li>{p.weeks}-week leading indicators: late deliveries, stockpiles, skip rate, reply rate. The 90-day retention read comes after about 6 months.</li>
        <li><b>Go</b> if late deliveries and stockpiles fall and the reply rate is at least {Math.round(p.minReplyRate * 100)}%. <b>Stop</b> if a guardrail (opt-outs, complaints, late deliveries) is breached two weeks running.</li>
        <li>December freeze: no moves {fmtDay(p.freezeFrom)} to {fmtDay(p.freezeTo)} (December runs at {p.decemberIndex}% of the average month).</li>
      </ul>
    </Card>
  );
}

function BacktestCard({ b }: { b: Backtest | null }) {
  return (
    <Card>
      <SectionTitle>Model check on real data</SectionTitle>
      {!b ? (
        <Empty>The real-data check has not been run. Run pnpm backtest.</Empty>
      ) : (
        <>
          <p className="m-0 mb-1 text-[14px] text-muted">Real data, not coffee, no text replies: checks that our ranges mean what they say.</p>
          <p className="m-0 mb-3 text-[16px] font-medium">{b.success.line}</p>
          <table>
            <thead>
              <tr>
                <th>Reorder</th>
                <th className="text-right">Predictions</th>
                <th className="text-right">Error: ours</th>
                <th className="text-right">Error: last-gap baseline</th>
                <th className="text-right">Ours minus baseline (95%)</th>
                <th className="text-right">80% range held</th>
                <th className="text-right">Median width (days)</th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r) => (
                <tr key={r.k} className="row">
                  <td>{r.k === "5+" ? "5th and later" : `After ${r.k} order${r.k === "1" ? "" : "s"}`}</td>
                  <td className="tnum text-right">{nf(r.n)}</td>
                  <td className="tnum text-right">{r.pinballMean.model.toFixed(2)}</td>
                  <td className="tnum text-right">{r.pinballMean.bc.toFixed(2)}</td>
                  <td className="tnum text-right">{r.diff.mean.toFixed(2)} ({r.diff.lo.toFixed(2)} to {r.diff.hi.toFixed(2)})</td>
                  <td className="tnum text-right">{pct(r.coverage80.model, 0)}</td>
                  <td className="tnum text-right">{nf(r.medianWidthDays.model)} vs {nf(r.medianWidthDays.bc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 space-y-1 text-[13px] text-muted">
            <div>Error is the pinball loss at the 10th, 50th and 90th percentiles, in days; lower is better. “Held” means the share of actual next orders that landed inside the model's 80% range (the target is 80%; pooled {pct(b.pooledCoverage80, 1)}).</div>
            <div>
              Plan committed before the first run: <code>{b.protocol.path}</code> at commit <code>{b.protocol.commit.slice(0, 10)}</code> on {b.protocol.committedAt}. Data: {b.dataset.name} ({b.dataset.license}), {nf(b.dataset.counts.rows)} rows, split by time and by customer; {nf(b.splits.testCustomers)} held-out customers.
            </div>
            <div>Limits: the buyers are mostly wholesale gift-ware accounts, not households; there is no consumption signal and no text replies; it says nothing about the reply model, the pantry estimate or the churn effect. The pilot tests those.</div>
          </div>
        </>
      )}
    </Card>
  );
}

function WhyDtcCard({ w, sources }: { w: ImpactDTO["whyDtc"]; sources: ImpactDTO["exhibits"]["sources"] }) {
  return (
    <Card>
      <SectionTitle>Why direct to consumer?</SectionTitle>
      <p className="m-0 mb-3 max-w-[900px] text-[16px] font-medium">
        The smallest channel ({pct(w.dtc.share)} of revenue) has the best margin ({pct(w.dtc.grossMargin)}) and grows fastest: +{pct(w.dtc.growth)}, {nf(w.growthMultiple.vsWholesaleCafes, 1)}× wholesale to cafes and {nf(w.growthMultiple.vsCompany, 1)}× the company. Classic Cup sees every DTC transaction and controls the schedule completely.
      </p>
      <div className="grid grid-cols-12 gap-5">
        <table className="col-span-7">
          <thead>
            <tr>
              <th>Channel (Exhibit A, FY25)</th>
              <th className="text-right">Revenue</th>
              <th className="text-right">Share</th>
              <th className="text-right">Gross margin</th>
              <th className="text-right">Growth</th>
            </tr>
          </thead>
          <tbody>
            {w.channels.map((c) => (
              <tr key={c.id} className={`row ${c.id === "dtc" ? "font-semibold text-espresso" : ""}`}>
                <td>{c.label}</td>
                <td className="tnum text-right">{usd(c.revenueUSD / 1e6, 1)}m</td>
                <td className="tnum text-right">{pct(c.share)}</td>
                <td className="tnum text-right">{pct(c.grossMargin)}</td>
                <td className="tnum text-right">{c.growth > 0 ? "+" : c.growth < 0 ? "−" : ""}{pct(Math.abs(c.growth))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="col-span-5">
          <div className="rounded-lg bg-cream p-3 text-[14px]">
            <div className="text-[13px] text-muted">The catch: growth is first-time subscribers who don't stay</div>
            <div className="tnum mt-1 text-[20px] font-semibold text-espresso">{nf(w.lostWithinYear)} of {nf(w.newSubs)}</div>
            <div className="text-muted">new subscribers a year are gone within twelve months ({pct(w.ret90)} kept at 90 days, {pct(w.ret12, 1)} at a year).</div>
          </div>
          <table className="mt-2">
            <thead>
              <tr>
                <th>Sign-up source (Exhibit C)</th>
                <th className="text-right">90 days</th>
                <th>Top cancel reason</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(sources) as Source[]).map((k) => (
                <tr key={k}>
                  <td className="text-[13px]">{SOURCE_LABEL[k]} · {nf(sources[k].newSubs)}</td>
                  <td className="tnum text-right text-[13px]">{pct(sources[k].ret90)}</td>
                  <td className="text-[13px] text-muted">{sources[k].reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-3 text-[13px] text-muted">The fix has two halves: keep the first-timers (deliveries timed to when they run out, so coffee isn't piling up or going stale) and bring in more of them from the grocery shelf (the bag QR code).</div>
    </Card>
  );
}

function OpportunityCard({ defaults }: { defaults: ImpactDTO["opportunityDefaults"] }) {
  const [lift, setLift] = useState(defaults.retentionLift);
  const [conv, setConv] = useState(defaults.groceryConversion);
  const [bags, setBags] = useState(defaults.bagsPerBuyerPerYear);
  const o = opportunity({ retentionLift: lift, groceryConversion: conv, bagsPerBuyerPerYear: bags });
  const d = o.detail;
  const slider = (label: string, value: string, input: React.ReactNode, note: string) => (
    <label className="block text-[14px]">
      <span className="mb-1 flex justify-between text-muted">
        <span>{label}</span>
        <b className="tnum text-ink">{value}</b>
      </span>
      {input}
      <span className="text-[12px] text-muted">{note}</span>
    </label>
  );
  return (
    <Card>
      <SectionTitle>What it could be worth</SectionTitle>
      <p className="m-0 mb-3 max-w-[900px] text-[16px] font-medium">
        Keep {pct(lift)} more subscribers and convert {pct(conv, 1)} of grocery buyers, and Classic Cup adds about {usd(o.totalGP)} in gross profit a year, with no new stores, no extra sales headcount and no price increase.
      </p>
      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-5 space-y-3">
          {slider("Subscribers kept: more than today", pct(lift), <input type="range" min={0} max={0.3} step={0.01} value={lift} onChange={(e) => setLift(Number(e.target.value))} className="w-full accent-[#643A2B]" aria-label="Relative increase in subscribers kept" />, "What pacing and offers must deliver; the pilot measures it.")}
          {slider("Grocery buyers who subscribe in a year", pct(conv, 1), <input type="range" min={0} max={0.1} step={0.005} value={conv} onChange={(e) => setConv(Number(e.target.value))} className="w-full accent-[#643A2B]" aria-label="Share of grocery buyers who subscribe" />, "What the bag QR funnel must deliver.")}
          {slider("Grocery bags per buyer per year", nf(bags), <input type="range" min={6} max={48} step={1} value={bags} onChange={(e) => setBags(Number(e.target.value))} className="w-full accent-[#643A2B]" aria-label="Grocery bags per buyer per year" />, "Assumption: turns Exhibit B pounds into buyers. Fewer bags each means more buyers.")}
        </div>
        <div className="col-span-7 grid grid-cols-2 gap-3 text-[14px]">
          <div className="rounded-lg bg-cream p-3">
            <div className="text-[13px] text-muted">Keeping more subscribers</div>
            <div className="tnum text-[20px] font-semibold text-espresso">{usd(o.retentionGP)}</div>
            <div className="text-[13px] text-muted">{pct(lift)} of today's DTC gross profit ({usd(d.dtcGrossProfit)}: Exhibit A revenue × {pct(EXHIBITS.dtc.grossMargin)} margin).</div>
          </div>
          <div className="rounded-lg bg-cream p-3">
            <div className="text-[13px] text-muted">Grocery buyers who subscribe</div>
            <div className="tnum text-[20px] font-semibold text-espresso">{usd(o.groceryGP)}</div>
            <div className="text-[13px] text-muted">
              {nf(d.converts)} new subscribers × {usd(d.netPerConvert)} each in their first year.
            </div>
          </div>
          <div className="col-span-2 rounded-lg border border-line p-3 text-[13px] text-muted">
            <div>
              Grocery volume (Exhibit B): {GROCERY.regionalChains.accounts} regional chains × {nf(GROCERY.regionalChains.lbsPerMonth)} lb + {GROCERY.independents.accounts} independents × {GROCERY.independents.lbsPerMonth} lb a month = {nf(d.groceryLbsPerYear)} lb a year ≈ {nf(d.groceryBags)} 12-oz bags ≈ {nf(d.buyers)} buyers at {nf(d.bagsPerBuyer)} bags each.
            </div>
            <div className="mt-1">
              A new subscriber behaves like a website sign-up (Exhibit C): subscribed {pct(d.activeShare)} of the first year ≈ {nf(d.deliveries, 1)} deliveries × {usd(EXHIBITS.sources[QR.cohortLike].aov)} × {pct(EXHIBITS.dtc.grossMargin)} = {usd(d.dtcGPPerConvert)}, minus the {usd(d.lostGroceryGPPerConvert)} of grocery margin those bags would have earned ({usd(d.groceryRevenuePerBag, 2)} a bag × {pct(CHANNELS.find((c) => c.id === "grocery")!.grossMargin)}).
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 text-[13px] text-muted">Arithmetic on the exhibits plus labelled assumptions (listed below); first-year value only. Not a forecast: the pacing pilot and the bag QR pilot each measure one of the two inputs.</div>
    </Card>
  );
}

function FreshnessSimCard({ d, f }: { d: ImpactArtifact; f: ImpactDTO["freshness"] }) {
  const i = Math.max(0, d.meta.phiGrid.findIndex((p) => Math.abs(p - d.meta.defaultPhi) < 1e-9));
  const fixed = d.fixed.freshnessDays[i];
  const paced = d.paced.freshnessDays[i];
  const ceil = d.ceiling.freshnessDays[i];
  if (fixed === undefined || paced === undefined || ceil === undefined) return null;
  return (
    <Card>
      <SectionTitle>Fresher at the cup?</SectionTitle>
      <p className="m-0 mb-3 max-w-[900px] text-[16px] font-medium">
        Average age of the coffee in the cup: {nf(fixed)} days on a fixed schedule, {nf(paced)} with pacing, {nf(ceil)} with perfect pantry knowledge. Timing alone buys a few days on average.
      </p>
      <div className="grid grid-cols-3 gap-3 text-[14px]">
        {[
          ["Fixed schedule", fixed],
          ["Paced", paced],
          ["Perfect knowledge", ceil],
        ].map(([label, v]) => (
          <div key={label as string} className="rounded-lg bg-cream p-3">
            <div className="text-[13px] text-muted">{label}</div>
            <div className="tnum text-[20px] font-semibold text-espresso">{nf(v as number)} days</div>
          </div>
        ))}
      </div>
      <div className="mt-3 text-[13px] text-muted">
        Why only a few days: a 12-oz bag that lasts a household two months keeps ageing after it is opened, whatever day it arrived. What timing does fix is the bag that waits a month behind a stockpile before it is even opened: each customer's profile shows that number against the {f.bestByDays}–{f.peakEndDays} day window. The other lever is bag size, which is why “smaller bag” is an offer. Projection from simulation · sample data; read at {Math.round(d.meta.defaultPhi * 100)} of every 100.
      </div>
    </Card>
  );
}

export function ImpactPage() {
  const { data } = useApi<ImpactDTO>("/api/impact", ["offer", "queue"]);
  return (
    <div>
      <PageTitle sub="Why this channel, what it could be worth, and whether each part pays, with the assumptions in plain sight.">Impact</PageTitle>
      {!data ? (
        <Empty>Loading…</Empty>
      ) : (
        <div className="space-y-5">
          <WhyDtcCard w={data.whyDtc} sources={data.exhibits.sources} />
          <OpportunityCard defaults={data.opportunityDefaults} />
          {data.impact ? <PacingCard d={data.impact} cohort={CAFE_WEB_SIGNUPS} /> : <Card><SectionTitle>Is pacing paying for itself?</SectionTitle><Empty>The simulation has not been run. Run pnpm impact.</Empty></Card>}
          {data.impact && <FreshnessSimCard d={data.impact} f={data.freshness} />}
          <PilotCard p={data.pilot} />
          <BacktestCard b={data.backtest} />
          <Card>
            <SectionTitle>Offer experiments</SectionTitle>
            {data.offerExperiments.length === 0 ? (
              <Empty>No offers are running. Schedule one from Offers.</Empty>
            ) : (
              <ul className="m-0 list-none p-0">
                {data.offerExperiments.map((o) => (
                  <li key={o.id} className="flex items-center justify-between border-b border-line py-2 text-[14px] last:border-0">
                    <a className="font-medium text-orange-ink" href={href(`/offers/${o.id}`)}>{o.name}</a>
                    <span className="text-muted">{o.statusLine}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 text-[13px] text-muted">Cancellation effects are read only at the pre-set sample size. Until then each offer shows acceptance, opt-outs and next check-in replies.</div>
          </Card>
          <details className="card p-4">
            <summary className="cursor-pointer text-[16px] font-semibold text-espresso">Every assumption behind the simulation ({data.ledger.length})</summary>
            <table className="mt-3">
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th>Value</th>
                  <th>Range tried</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {data.ledger.map((l) => (
                  <tr key={l.parameter} className="row align-top">
                    <td>{l.parameter}</td>
                    <td className="text-[13px]">{l.value}</td>
                    <td className="text-[13px]">{l.range}</td>
                    <td className="text-[13px] text-muted">{l.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </div>
  );
}
