import type { DemoState, Scenario } from "@rot/contracts";
import { fmtMonthDay, parseISO } from "@rot/core";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Artifacts } from "../artifacts.ts";

const STEPS = ["s3a", "s3b", "s3c"];

export function Screen3({ state, art, scenario }: { state: DemoState; art: Artifacts; scenario: Scenario }) {
  const idx = STEPS.indexOf(state.stepId);
  const bt = art.backtest;
  const data = bt.rows.map((r) => ({ k: r.k, "Last gap": r.mae.b0, "Our method": r.mae.model }));
  const pooled = Math.round(bt.pooledCoverage80.model * 100);
  const weeks = scenario.pilotWeeks;
  const freeze = `${fmtMonthDay(parseISO(scenario.freezeFromISO))} to ${fmtMonthDay(parseISO(scenario.freezeToISO))}`;
  const when = bt.protocol.committedAt ? fmtMonthDay(parseISO(bt.protocol.committedAt)) : "";
  const phases: Array<[string, string, string]> = [
    ["Weeks 0–2", "Get the 8 data fields and counsel sign-off", "bg-[#e8f3fa]"],
    ["Weeks 3–4", "Opt-in drive", "bg-[#e8f3fa]"],
    [`Weeks 5–${weeks}`, "Three arms, randomized by subscriber, stratified by sign-up source: control · text check-in only · check-in + paced delivery", "bg-[#e6f6f1]"],
    [`Week ${weeks + 1}`, "Stop / modify / scale", "bg-[#fff5dd]"],
  ];
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className={`card flex min-h-0 flex-1 flex-col p-4 ${idx < 0 ? "opacity-30" : ""}`}>
        <div className="flex items-baseline justify-between gap-4">
          <div className="text-[1.15rem] font-semibold">How do we know it works with no client data? We check the method on real repeat-purchase data.</div>
          <div className="whitespace-nowrap rounded-full bg-[#e6f6f1] px-3 py-1 text-[0.85rem] font-bold text-[#006b4e]">Our 80% ranges held the real next gap {pooled}% of the time</div>
        </div>
        <div className="text-[0.78rem] text-muted">Error in days, by number of earlier reorders: last-gap rule vs our method (lower is better)</div>
        <div className="min-h-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 10, bottom: 18, left: 0 }}>
              <CartesianGrid stroke="#e8ebef" vertical={false} />
              <XAxis dataKey="k" label={{ value: "earlier reorders", position: "insideBottom", offset: -8, fontSize: 12 }} />
              <YAxis label={{ value: "days off", angle: -90, position: "insideLeft", fontSize: 12 }} />
              <Tooltip formatter={(v) => `${Number(v).toFixed(0)} days`} />
              <Legend verticalAlign="top" />
              <Bar dataKey="Last gap" fill="#e69f00" isAnimationActive={false} />
              <Bar dataKey="Our method" fill="#0072b2" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="text-[0.82rem] italic">Real data, not coffee, no text replies. This checks one thing: do our ranges mean what they say? It cannot tell us whether Classic Cup customers reply or how fast they drink. The pilot does.</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 text-[0.72rem] text-muted">
          <span>Rule written down {when ? `on ${when} ` : ""}before we looked: commit <code>{bt.protocol.commit.slice(0, 10)}</code></span>
          <span>{bt.success.passed ? "Verdict: passed its written-down rule." : "Verdict: failed its written-down rule."} {bt.success.line}</span>
          <span>Coverage by reorder: {bt.success.coverageWithinBand.map((c) => `${c.k}: ${(c.coverage * 100).toFixed(1)}%`).join(" · ")} (allowed 75–85%)</span>
          <span>UCI Online Retail II, CC BY 4.0, Chen (2012)</span>
        </div>
      </div>
      <div className={`card p-4 ${idx < 1 ? "opacity-30" : ""}`}>
        <div className="mb-2 text-[1.05rem] font-semibold">How we would find out: a {weeks}-week pilot that can be stopped</div>
        <div className="grid grid-cols-[1fr_1fr_3fr_1.2fr] gap-2">
          {phases.map(([h, t, cls]) => (
            <div key={h} className={`rounded-lg p-2 ${cls}`}>
              <div className="text-[0.82rem] font-bold">{h}</div>
              <div className="text-[0.74rem] leading-snug">{t}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-3 text-[0.78rem] leading-snug">
          <div><b>Primary:</b> 12-week signal on leading indicators (late deliveries, stockpiles, skip rate, reply rate); 90-day retention read after about 6 months.</div>
          <div><b>Guardrails:</b> support contacts, missed deliveries, revenue per active subscriber. <b>Stop rule:</b> guardrail breached two weeks running.</div>
          <div><b>Eligibility:</b> pay-as-you-go only (prepaid and gift excluded); at least two completed deliveries before any date change. <b>Freeze:</b> no moves {freeze} (gift season, DTC peak, Exhibit D index {scenario.decemberIndex}).</div>
        </div>
      </div>
      <div className={`card px-4 py-2 text-[0.95rem] ${idx < 2 ? "opacity-30" : ""}`}>
        The same text-as-sensor idea fits the 744 wholesale accounts that already reorder by text to a rep. DTC is where we can prove it in about {weeks} weeks.
      </div>
    </div>
  );
}
