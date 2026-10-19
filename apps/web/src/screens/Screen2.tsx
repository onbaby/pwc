import type { DemoState, PhiResult } from "@rot/contracts";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { crossing, defaultPaced, interpolate, type Artifacts } from "../artifacts.ts";

const STEPS = ["s2a", "s2b", "s2c", "s2d"];

export function Screen2({ state, art }: { state: DemoState; art: Artifacts }) {
  const idx = STEPS.indexOf(state.stepId);
  const [slider, setSlider] = useState(40);
  const { grid, exhibits } = art;
  const paced = defaultPaced(grid);
  const phi = slider / 100;
  const pr = paced.results;
  const at = (pol: PhiResult[], pick: (r: PhiResult) => number) => interpolate(pol, phi, pick);
  const paceGain = at(pr, (r) => r.vsFixed!.retention12GainPP);
  const required = at(pr, (r) => r.vsFixed!.requiredGainNetOfCostPP);
  const requiredGross = at(pr, (r) => r.vsFixed!.requiredGainPP);
  const ceilGain = at(grid.ceiling.results, (r) => r.vsFixed!.retention12GainPP);
  const ceilRequired = at(grid.ceiling.results, (r) => r.vsFixed!.requiredGainNetOfCostPP);
  const pays = paceGain >= required;
  const needPaced = crossing(pr, (r) => r.vsFixed!.retention12GainPP - r.vsFixed!.requiredGainNetOfCostPP);
  const needCeil = crossing(grid.ceiling.results, (r) => r.vsFixed!.retention12GainPP - r.vsFixed!.requiredGainNetOfCostPP);
  const maxBar = Math.ceil(Math.max(...grid.ceiling.results.map((r) => r.vsFixed!.retention12GainPP), ...pr.map((r) => r.vsFixed!.requiredGainNetOfCostPP)) + 1);

  // histogram
  const h = grid.histogram;
  const histData = h.binLabels.map((label, i) => ({ label, fixed: h.per100.fixed![i]!, paced: h.per100.paced![i]! }));
  const stockFixed = h.stockpilePer100.fixed!;
  const stockPaced = h.stockpilePer100.paced!;
  const lateFixed = h.latePer100.fixed!;
  const latePaced = h.latePer100.paced!;
  const stockStart = h.binLabels.findIndex((l) => l.startsWith("14-"));

  const cafeWeb = exhibits.sources.in_cafe.newSubs + exhibits.sources.website.newSubs;
  const phiSel = (pol: PhiResult[]) => (pick: (r: PhiResult) => number) => interpolate(pol, phi, pick);
  const f = phiSel(grid.fixed.results);
  const p = phiSel(pr);

  const sentence = !pays
    ? "Pacing alone does not pay in our simulator at these settings. It pays only if more of every 100 cancellations are caused by too much coffee than our placeholder, and our reply system is better than we assume. That is exactly the number the pilot measures first."
    : paceGain < ceilGain
      ? `It pays if at least ${Math.round((needPaced ?? 1) * 100)} of every 100 cancellations are caused by too much coffee. Below that it loses money.`
      : "At the placeholder it pays, but the pilot has to confirm the placeholder; we show the break-even so you can see how fragile that is.";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="card px-4 py-2 text-[0.88rem]">
        Exhibit C: “too much coffee arriving” is the top cancellation reason in the two sources we control (in-cafe + website: {cafeWeb.toLocaleString("en-US")} of {exhibits.dtc.newSubsPerYear.toLocaleString("en-US")} new subscribers).
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(240px,0.9fr)_minmax(0,2fr)] grid-rows-[minmax(0,1fr)] gap-3">
        <div className={`card flex min-h-0 flex-col overflow-hidden p-3 ${idx < 1 ? "opacity-30" : ""}`}>
          <div className="text-[0.9rem] font-semibold leading-snug">Paced deliveries land with less coffee still in the pantry</div>
          <div className="text-[0.68rem] text-muted">Days of coffee still on hand when a delivery arrives, per 100 deliveries (cafe + website, if nobody cancelled)</div>
          <div className="min-h-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={histData} margin={{ top: 8, right: 4, bottom: 16, left: -18 }}>
                <CartesianGrid stroke="#e8ebef" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={1} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <ReferenceLine x={h.binLabels[stockStart]} stroke="#1b1f24" strokeDasharray="3 3" label={{ value: "2+ weeks", fontSize: 10, position: "top" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="fixed" name="Fixed schedule" fill="#0072b2" isAnimationActive={false}>
                  {histData.map((_, i) => <Cell key={i} fillOpacity={i >= stockStart ? 1 : 0.55} />)}
                </Bar>
                <Bar dataKey="paced" name="Paced to you" fill="#009e73" isAnimationActive={false}>
                  {histData.map((_, i) => <Cell key={i} fillOpacity={i >= stockStart ? 1 : 0.55} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[0.8rem] leading-snug">
            Stockpiles (2+ weeks left): <b>Fixed {stockFixed.toFixed(0)}</b> | <b>Paced {stockPaced.toFixed(0)}</b> per 100.<br />
            Late deliveries (out of coffee 3+ days before it arrives): <b>Fixed {lateFixed.toFixed(0)}</b> | <b>Paced {latePaced.toFixed(0)}</b> per 100.
            {latePaced >= lateFixed && <div className="mt-1 text-muted">We trade a few late deliveries for far fewer stockpiles; a LOW or 0-weeks reply gets a same-day expedite offer (customer says yes first).</div>}
          </div>
        </div>

        <div className={`card flex min-h-0 flex-col overflow-hidden p-3 ${idx < 2 ? "opacity-30" : ""}`}>
          <div className="text-[1.05rem] font-semibold leading-snug">Does it pay? It depends on one number.</div>
          <div className="text-[0.78rem] text-muted">Higher 12-month retention for cafe and website subscribers (percentage points). First year only, conservative: ignores value after month 12.</div>
          <div className="mt-2 flex min-h-0 flex-1 flex-col justify-center gap-2">
            <Bar3 label="Required to break even" sub={`after the $2 running cost · ${requiredGross.toFixed(1)} before it`} value={required} max={maxBar} color="#8a94a3" />
            <Bar3 label="Paced (our model)" sub={pays ? "above the line: pays" : "below the line: the idea does not pay by itself"} value={paceGain} max={maxBar} color={pays ? "#009e73" : "#d55e00"} marker={required} />
            <Bar3 label="Ceiling (perfect knowledge of the pantry)" sub={ceilGain >= ceilRequired ? "pays, but needs perfect knowledge" : "does not pay even with perfect knowledge"} value={ceilGain} max={maxBar} color="#0072b2" marker={ceilRequired} />
          </div>
          <div className="mt-2">
            <div className="flex items-baseline justify-between text-[0.9rem]">
              <span className="font-semibold">Of every 100 cancellations in those groups, how many are caused by too much coffee?</span>
              <span className="text-[1.3rem] font-bold">{slider}</span>
            </div>
            <input type="range" min={0} max={100} value={slider} onChange={(e) => setSlider(Number(e.target.value))} className="w-full" aria-label="Cancellations caused by too much coffee, out of 100" />
            <div className="flex justify-between text-[0.68rem] text-muted"><span>0</span><span style={{ marginLeft: "26%" }}>40 = our placeholder: unknown, to be measured</span><span>100</span></div>
          </div>
          <div className={`mt-1 rounded-lg border-l-4 px-3 py-1.5 text-[0.82rem] leading-snug ${pays ? "border-green bg-[#e6f6f1]" : "border-red bg-[#fdeee6]"}`}>
            {sentence}
            {needCeil !== undefined && !pays && <div className="mt-1 text-muted">With perfect knowledge of the pantry it would pay from about {Math.round(needCeil * 100)} of every 100.</div>}
          </div>
          <div className="mt-1 text-[0.62rem] leading-tight text-muted">The earlier $44–80K figure was a top-down ceiling (about +10 points of 12-month retention). Our simulator reaches that only with perfect knowledge and almost every cancellation caused by stockpiles.</div>
        </div>
      </div>
      <div className={`grid grid-cols-3 gap-3 ${idx < 3 ? "opacity-30" : ""}`}>
        <Kpi title="Profit per sign-up, after the cost of coffee, first year" a={`Fixed $${f((r) => r.group.gpShippedPerSub).toFixed(0)}`} b={`Paced $${p((r) => r.group.gpShippedNetPerSub).toFixed(0)}`} foot="Paced is net of an assumed $2 per active subscriber-year to run it" />
        <Kpi title="Deliveries per active subscriber-year" a={`Fixed ${f((r) => r.group.deliveriesPerActiveYear).toFixed(2)}`} b={`Paced ${p((r) => r.group.deliveriesPerActiveYear).toFixed(2)}`} />
        <Kpi title="Average age of coffee at the last cup" a={`Fixed ${f((r) => r.group.freshnessDays).toFixed(0)} days`} b={`Paced ${p((r) => r.group.freshnessDays).toFixed(0)} days`} foot="Mean days on hand + 5 days roast-to-door" />
      </div>
    </div>
  );
}

function Bar3({ label, sub, value, max, color, marker }: { label: string; sub: string; value: number; max: number; color: string; marker?: number }) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div className="text-[0.95rem] font-semibold">{label}</div>
        <div className="text-[1.05rem] font-bold" style={{ color }}>{value >= 0 ? "+" : ""}{value.toFixed(1)} pts</div>
      </div>
      <div className="relative h-6 rounded bg-[#eef0f3]">
        <div className="h-full rounded transition-[width] duration-300" style={{ width: pct(Math.max(value, 0)), background: color }} />
        {marker !== undefined && <div className="absolute w-[3px] bg-ink" style={{ left: pct(marker), top: -3, height: 30 }} title="Required to break even" />}
      </div>
      <div className="text-[0.72rem] text-muted">{sub}</div>
    </div>
  );
}

function Kpi({ title, a, b, foot }: { title: string; a: string; b: string; foot?: string }) {
  return (
    <div className="card p-3">
      <div className="text-[0.72rem] font-bold uppercase tracking-wide text-muted">{title}</div>
      <div className="mt-1 flex gap-4 text-[1.15rem] font-bold"><span className="text-blue">{a}</span><span className="text-green">{b}</span></div>
      {foot && <div className="text-[0.66rem] text-muted">{foot}</div>}
    </div>
  );
}
