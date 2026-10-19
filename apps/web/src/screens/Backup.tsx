import type { DemoState, ParseLogEntry, PolicyName } from "@rot/contracts";
import { normPpf } from "@rot/core";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { post, useJson } from "../api.ts";
import { defaultPaced, interpolate, type Artifacts } from "../artifacts.ts";
import { PhoneMock } from "../components/PhoneMock.tsx";

export const TILES = [
  "What happens with no history?",
  "Can they leave?",
  "What if the AI is wrong?",
  "Which assumption matters most?",
  "Is the synthetic world realistic?",
  "Is it just ChatGPT?",
  "What does the statistics add over a simple rule?",
  "How big a pilot?",
] as const;

export function Backup({ state, art, tile, setTile }: { state: DemoState; art: Artifacts; tile: number; setTile: (n: number) => void }) {
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(240px,0.6fr)_minmax(0,2.4fr)] gap-4">
      <div className="card overflow-y-auto p-3">
        <div className="mb-2 text-[0.72rem] font-bold uppercase tracking-wide text-muted">Backup: press 1–8</div>
        {TILES.map((t, i) => (
          <button key={t} onClick={() => setTile(i + 1)} className={`mb-1 block w-full rounded-lg px-3 py-2 text-left text-[0.88rem] ${tile === i + 1 ? "bg-blue text-white" : "hover:bg-[#f2f6fa]"}`}>
            <b>{i + 1}</b> · {t}
          </button>
        ))}
        <a href="/" className="mt-3 block text-[0.8rem] text-blue">← Back to the demo (Esc)</a>
      </div>
      <div className="card min-h-0 overflow-y-auto p-4">
        {tile === 1 && <NoHistory art={art} />}
        {tile === 2 && <CanTheyLeave state={state} />}
        {tile === 3 && <AiWrong art={art} />}
        {tile === 4 && <Tornado art={art} />}
        {tile === 5 && <Realistic art={art} />}
        {tile === 6 && <NotChatGpt state={state} />}
        {tile === 7 && <Policies art={art} />}
        {tile === 8 && <PilotSize art={art} />}
      </div>
    </div>
  );
}

const usd = (v: number) => `${v < 0 ? "−" : "+"}$${Math.abs(Math.round(v / 1000))}K`;
const H = ({ children }: { children: React.ReactNode }) => <h2 className="mb-2 text-[1.2rem] font-semibold">{children}</h2>;
const T = ({ head, rows }: { head: string[]; rows: Array<Array<string | number>> }) => (
  <table className="w-full border-collapse text-[0.82rem]">
    <thead><tr>{head.map((h) => <th key={h} className="border-b border-line px-2 py-1 text-left font-semibold">{h}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border-b border-[#eef0f3] px-2 py-1">{c}</td>)}</tr>)}</tbody>
  </table>
);

function NoHistory({ art }: { art: Artifacts }) {
  const rows = art.backtest.rows;
  return (
    <>
      <H>With no history, the ranges are wide and honest</H>
      <p className="mb-2 text-[0.85rem] text-muted">Real data (Online Retail II), not coffee. “Earlier reorders” = completed gaps before the one we predict.</p>
      <div className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows.map((r) => ({ k: r.k, "Our 80% range width": r.medianWidthDays.model, "Calibrated last-gap range": r.medianWidthDays.b3 }))}>
            <CartesianGrid stroke="#e8ebef" vertical={false} /><XAxis dataKey="k" /><YAxis /><Tooltip /><Legend />
            <Bar dataKey="Our 80% range width" fill="#0072b2" isAnimationActive={false} /><Bar dataKey="Calibrated last-gap range" fill="#e69f00" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <T head={["Earlier reorders", "Predictions", "Customers", "Error: ours (days)", "Error: last gap", "Range width (days)", "80% range held", "Pinball ours vs calibrated baseline [95% interval]"]} rows={rows.map((r) => [r.k, r.n, r.customers, r.mae.model.toFixed(0), r.mae.b0.toFixed(0), r.medianWidthDays.model.toFixed(0), `${(r.coverage80.model * 100).toFixed(1)}%`, `${r.diffVsB3.mean.toFixed(2)} [${r.diffVsB3.lo.toFixed(2)}, ${r.diffVsB3.hi.toFixed(2)}]`])} />
      <p className="mt-2 text-[0.8rem]">Decision-level view (apply the ship rule to real gaps): late share {rows.map((r) => `k=${r.k}: rule ${(r.decision.rule.lateShare * 100).toFixed(0)}% vs last-gap ${(r.decision.b0.lateShare * 100).toFixed(0)}%`).join(" · ")}. The rule waits longer on purpose: it trades fewer late arrivals for more days early.</p>
    </>
  );
}

function CanTheyLeave({ state }: { state: DemoState }) {
  const sam = state.threads.sam;
  return (
    <div className="grid h-full grid-cols-[minmax(280px,1fr)_1fr] gap-4">
      <div className="h-[560px]"><PhoneMock thread={sam} canType /></div>
      <div>
        <H>Can they leave?</H>
        <p className="mb-3 text-[0.9rem]">One scripted phone scenario through the real flow: WHAT DO YOU KNOW, STOP, START, CANCEL, BACK (inside the 24-hour undo), CANCEL again, DELETE MY DATA.</p>
        <button className="rounded-lg bg-blue px-4 py-2 font-semibold text-white" onClick={() => post("/api/sam/next")}>Play the next text ▸</button>
        <ul className="mt-3 list-disc pl-5 text-[0.85rem] leading-relaxed">
          <li>STOP ends texts at once; nothing but START or HELP gets a reply afterwards.</li>
          <li>Exact CANCEL cancels immediately with no retention offer; text such as “please don’t cancel” only triggers one clarifying question.</li>
          <li>BACK works for 24 hours; after that the thread says so.</li>
          <li>DELETE MY DATA erases replies and signup answers and stops texts.</li>
        </ul>
        <p className="mt-2 text-[0.75rem] text-muted">Production note: on SMS, carriers treat CANCEL as an opt-out keyword too, so it also stops texts.</p>
      </div>
    </div>
  );
}

function AiWrong({ art }: { art: Artifacts }) {
  const g = art.grid;
  const dp = g.meta.defaultCell;
  const ph = g.meta.defaultPhi;
  const rows = [0.05, 0.1, 0.2].map((q) => {
    const c = g.cells.find((x) => x.key.replyBase === dp.replyBase && x.key.replyAccuracySd === dp.replyAccuracySd && x.key.cautiousness === q)!.paced;
    const r = c.results.find((x) => x.phi === ph)!;
    return [q === 0.05 ? "Cautious (1 in 20)" : q === 0.1 ? "Balanced (1 in 10)" : "Aggressive (1 in 5)", `${(r.group.lateShare * 100).toFixed(0)}%`, `${(r.group.stockpileShare * 100).toFixed(0)}%`, r.group.deliveriesPerActiveYear.toFixed(2), `${(c.diag.holdOffShare * 100).toFixed(0)}%`, `${(c.diag.movedLaterShare * 100).toFixed(0)}%`, `${(c.diag.movedSoonerShare * 100).toFixed(1)}%`];
  });
  const fx = g.fixed.results.find((x) => x.phi === ph)!;
  return (
    <>
      <H>If the model is wrong, a date moves by at most two weeks, and a person can undo it</H>
      <T head={["Setting", "Late deliveries", "Stockpiles", "Deliveries / active year", "Check-ins that held off", "Proposed later", "Proposed sooner (needs YES)"]} rows={[["Fixed schedule (today)", `${(fx.group.lateShare * 100).toFixed(0)}%`, `${(fx.group.stockpileShare * 100).toFixed(0)}%`, fx.group.deliveriesPerActiveYear.toFixed(2), "n/a", "n/a", "n/a"], ...rows]} />
      <ul className="mt-3 list-disc pl-5 text-[0.85rem] leading-relaxed">
        <li>Late = out of coffee 3+ days before the delivery arrives. The simulator does <b>not</b> credit the same-day expedite offer, so these late rates are conservative.</li>
        <li>A LOW or 0-weeks reply gets a same-day expedite offer; the customer says yes first.</li>
        <li>No reply means no change: the model abstains (“we hold off and ask”) in about {(defaultPaced(g).diag.holdOffShare * 100).toFixed(0)}% of check-ins at a {(dp.replyBase * 100).toFixed(0)}% reply rate.</li>
        <li>Group: in-cafe + website. Reply rate {(dp.replyBase * 100).toFixed(0)}%, reply accuracy ±{(dp.replyAccuracySd * 100).toFixed(0)}%.</li>
      </ul>
    </>
  );
}

function Tornado({ art }: { art: Artifacts }) {
  const rows = [...art.grid.tornado].sort((a, b) => Math.abs(b.highUSD - b.lowUSD) - Math.abs(a.highUSD - a.lowUSD));
  const data = rows.map((r) => ({ name: r.parameter, low: r.lowUSD / 1000, high: r.highUSD / 1000, lowLabel: r.lowLabel, highLabel: r.highLabel }));
  const base = rows[0]!.baseUSD / 1000;
  return (
    <>
      <H>Which assumption matters most?</H>
      <p className="mb-2 text-[0.85rem] text-muted">Paced minus Fixed, first-year gross profit, net of running cost, whole new cohort, in $ thousands a year. One assumption changes at a time from the defaults (dashed line = defaults).</p>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 200, right: 20 }}>
            <CartesianGrid stroke="#e8ebef" horizontal={false} />
            <XAxis type="number" tickFormatter={(v: number) => `$${v}K`} /><YAxis type="category" dataKey="name" width={200} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => `$${Number(v).toFixed(1)}K`} /><Legend />
            <ReferenceLine x={base} stroke="#1b1f24" strokeDasharray="4 3" />
            <Bar dataKey="low" name="first setting" fill="#d55e00" isAnimationActive={false} /><Bar dataKey="high" name="second setting" fill="#0072b2" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <T head={["Assumption", "First setting", "Second setting", "Paced − Fixed ($K)", "Paced vs Required (pts)"]} rows={rows.map((r) => [r.parameter, r.lowLabel, r.highLabel, `${(r.lowUSD / 1000).toFixed(1)} / ${(r.highUSD / 1000).toFixed(1)}`, `${r.lowGapPP.toFixed(2)} / ${r.highGapPP.toFixed(2)}`])} />
    </>
  );
}

function Realistic({ art }: { art: Artifacts }) {
  const [disclosure, setDisclosure] = useState("");
  useEffect(() => {
    fetch("/api/docs/disclosure.md").then((r) => r.text()).then((t) => setDisclosure(t.replace(/^# Disclosure\s*>\s*/, ""))).catch(() => undefined);
  }, []);
  return (
    <>
      <H>Is the synthetic world realistic?</H>
      <p className="mb-2 rounded-lg bg-[#fff5dd] p-3 text-[0.88rem]">{art.grid.meta.disclosure || disclosure}</p>
      <div className="mb-1 font-semibold">Calibration (a code check, not validation): Fixed reproduces Exhibit C by construction</div>
      <T head={["Source", "90-day: Exhibit C", "90-day: simulated", "12-month: Exhibit C", "12-month: simulated"]} rows={art.grid.calibration.map((c) => [c.source.replace("_", "-"), `${(c.ret90Target * 100).toFixed(1)}%`, `${(c.ret90Sim * 100).toFixed(1)}%`, `${(c.ret12Target * 100).toFixed(1)}%`, `${(c.ret12Sim * 100).toFixed(1)}%`])} />
      <div className="mb-1 mt-3 font-semibold">Assumptions ledger</div>
      <T head={["Parameter", "Value", "Range", "Source"]} rows={art.ledger.map((l) => [l.parameter, l.value, l.range, l.source])} />
    </>
  );
}

const INTENTS: Array<[string, string, string]> = [
  ["YES / OK", "YES, yep, OK, 👍", "YES accepts a pending move; OK only acknowledges and never reverts"],
  ["STOP / START", "STOP, unsubscribe, START", "ends / resumes texts"],
  ["OLD", "OLD", "puts the earlier date back"],
  ["SOONER / SKIP", "SOONER, skip this one", "offer (needs YES) / skip the next delivery"],
  ["WEEKS(n)", "6, about 6 weeks, a couple of weeks, out", "the pantry reading, 0–12"],
  ["AWAY(from, to)", "heading to Denver till <a date>", "dates read by chrono-node against the virtual today"],
  ["PAUSE(days)", "pause for 2 weeks", "moves the next delivery"],
  ["CANCEL / BACK", "CANCEL (exact), BACK", "free text containing “cancel” only clarifies once"],
  ["WHY / WHAT DO YOU KNOW / DELETE MY DATA", "WHY", "explanation, data use, erase"],
  ["HUMAN / UNKNOWN", "anything else", "goes to a person; nothing is guessed"],
];

function NotChatGpt({ state }: { state: DemoState }) {
  const log = useJson<ParseLogEntry[]>(`/api/parselog?step=${state.step}&clock=${state.clockMinute}&n=${Object.values(state.threads).reduce((a, t) => a + t.messages.length, 0)}`);
  return (
    <>
      <H>Is it just ChatGPT?</H>
      <p className="mb-2 text-[0.88rem]">No. A closed list of intents; rules read the text and rules execute it. An LLM fallback is an optional upgrade that is <b>off</b> in this demo (the pill shows <b>{state.parser}</b>). If switched on, it would see only the message text and today’s date, must return JSON matching the intent schema, and any failure becomes UNKNOWN (a person). It could never choose or change a delivery date.</p>
      <T head={["Intent", "Examples", "What happens"]} rows={INTENTS} />
      <div className="mb-1 mt-3 font-semibold">Parse log (this session)</div>
      <T head={["Who", "Text", "Parsed by", "Intent"]} rows={(log ?? []).slice(-14).map((l) => [l.persona, l.text, l.parser, `${l.intent.name}${l.intent.weeks !== undefined ? `(${l.intent.weeks})` : ""}`])} />
    </>
  );
}

function Policies({ art }: { art: Artifacts }) {
  const g = art.grid;
  const ph = g.meta.defaultPhi;
  const paced = defaultPaced(g);
  const names: Array<[string, PolicyName, typeof g.fixed]> = [
    ["Fixed schedule (today)", "fixed", g.fixed],
    ["Quiz-only cadence", "quiz", g.quiz],
    ["RuleText (an intern’s rule)", "rule", g.rule],
    ["NaiveLater (+7 days for everyone)", "naive", g.naive],
    ["Paced (ours)", "paced", paced],
    ["Ceiling (perfect pantry knowledge)", "ceiling", g.ceiling],
  ];
  const rows = names.map(([label, , pr]) => {
    const r = pr.results.find((x) => x.phi === ph)!;
    return [label, `${(r.group.lateShare * 100).toFixed(0)}%`, `${(r.group.stockpileShare * 100).toFixed(0)}%`, r.group.deliveriesPerActiveYear.toFixed(2), r.vsFixed ? `${r.vsFixed.retention12GainPP.toFixed(2)}` : "–", r.vsFixed ? `${r.vsFixed.requiredGainNetOfCostPP.toFixed(2)}` : "–", r.vsFixed ? usd(r.vsFixed.cohortDeltaShippedNetUSD) : "–", r.vsFixed ? usd(r.vsFixed.cohortDeltaConsumedNetUSD) : "–"];
  });
  void interpolate;
  return (
    <>
      <H>What does the statistics add over a simple rule?</H>
      <T head={["Policy", "Late", "Stockpile", "Deliveries / active yr", "12-mo retention gain (pts)", "Needed to break even (pts)", "Cohort Δ profit (shipped view)", "Cohort Δ profit (consumed view)"]} rows={rows} />
      <p className="mt-3 text-[0.88rem]">Cafe + website group at the {Math.round(ph * 100)}-of-100 placeholder. What the statistics add over the intern’s rule is mostly <b>on-time reliability and calibrated uncertainty</b> (a stated range and a reason to hold off), not a large dollar gain. NaiveLater shows how much of any “gain” is just shipping less.</p>
      <p className="mt-2 text-[0.85rem] text-muted">On the $44–80K figure: that was our top-down ceiling, about +10 points of 12-month retention on cafe and website signups. Our own simulator reaches that only with perfect knowledge of the pantry and almost every cancellation caused by stockpiles. The realistic case is smaller, and the pilot will tell us how much.</p>
    </>
  );
}

function PilotSize({ art }: { art: Artifacts }) {
  const base90 = (art.exhibits.sources.in_cafe.ret90 * art.exhibits.sources.in_cafe.newSubs + art.exhibits.sources.website.ret90 * art.exhibits.sources.website.newSubs) / (art.exhibits.sources.in_cafe.newSubs + art.exhibits.sources.website.newSubs);
  const [p1, setP1] = useState(Math.round(base90 * 100));
  const [delta, setDelta] = useState(5);
  const [power, setPower] = useState(80);
  const [arms, setArms] = useState(3);
  const a = p1 / 100;
  const b = Math.min(0.999, a + delta / 100);
  const za = normPpf(1 - 0.05 / 2);
  const zb = normPpf(power / 100);
  const n = Math.ceil(((za * Math.sqrt(2 * ((a + b) / 2) * (1 - (a + b) / 2)) + zb * Math.sqrt(a * (1 - a) + b * (1 - b))) ** 2) / (b - a) ** 2);
  const sources = art.exhibits.sources.in_cafe.newSubs + art.exhibits.sources.website.newSubs;
  const months = (n * arms) / (sources / 12);
  return (
    <>
      <H>How big a pilot?</H>
      <p className="mb-2 text-[0.85rem] text-muted">Two-proportion sample size per arm for 90-day retention (two-sided 5%). Baseline starts at the Exhibit C cafe + website figure.</p>
      <div className="grid max-w-xl grid-cols-[220px_1fr_50px] items-center gap-2 text-[0.9rem]">
        <span>Baseline 90-day retention</span><input type="range" min={30} max={90} value={p1} onChange={(e) => setP1(+e.target.value)} /><b>{p1}%</b>
        <span>Improvement to detect (pts)</span><input type="range" min={1} max={15} value={delta} onChange={(e) => setDelta(+e.target.value)} /><b>+{delta}</b>
        <span>Power</span><input type="range" min={70} max={95} step={5} value={power} onChange={(e) => setPower(+e.target.value)} /><b>{power}%</b>
        <span>Arms</span><input type="range" min={2} max={3} value={arms} onChange={(e) => setArms(+e.target.value)} /><b>{arms}</b>
      </div>
      <div className="mt-4 rounded-lg bg-[#e8f3fa] p-4 text-[1.1rem]">
        <b>{n.toLocaleString("en-US")}</b> subscribers per arm · <b>{(n * arms).toLocaleString("en-US")}</b> in total · about <b>{months.toFixed(1)}</b> months of cafe + website sign-ups ({sources.toLocaleString("en-US")} a year).
      </div>
      <p className="mt-2 text-[0.8rem] text-muted">So the pilot’s first read is on leading indicators (late deliveries, stockpiles, skips, replies), which need far fewer people; 90-day retention is read after about 6 months.</p>
    </>
  );
}
