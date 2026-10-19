import type { Thread } from "@rot/contracts";
import { fmtMonthDay } from "@rot/core";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";

/** "Coffee left in {name}'s pantry (synthetic truth)" with the engine's likely run-out window once there is a reply. */
export function PantryChart({ thread, showWindow, showNew }: { thread: Thread; showWindow: boolean; showNew: boolean }) {
  const p = thread.pantry;
  if (!p) return null;
  const f = thread.forecast;
  const moved = showNew && thread.currentArrival !== thread.oldArrival;
  const firstDay = p.points[0]!.day;
  const lastDay = p.points[p.points.length - 1]!.day;
  const piles = p.piles.filter((x) => x.day <= p.today);
  const pileText = piles.length ? piles.map((x) => `${x.days} days`).join(", ") : "";
  const win = showWindow && f && f.freshReply ? { lo: f.windowLo, hi: f.windowHi } : undefined;
  const data = p.points.map((x) => ({ day: x.day, fixed: x.fixed, paced: moved ? x.paced : undefined, win: win && x.day >= win.lo && x.day <= win.hi ? 1 : 0 }));
  const yMax = Math.ceil(Math.max(...p.points.map((x) => Math.max(x.fixed, x.paced ?? 0))) / 10) * 10;
  const ticks: number[] = [];
  for (let d = firstDay; d <= lastDay; d += 14) ticks.push(d);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-1 text-[0.95rem] font-semibold leading-snug">
        {showWindow && thread.explanation ? thread.explanation.rangeTitle : `Coffee left in ${thread.name}'s pantry never reaches zero: ${piles.length ? `deliveries landed with ${pileText} still on the shelf` : "a stockpile builds up"}`}
      </div>
      <div className="text-[0.72rem] text-muted">
        Coffee left in {thread.name}'s pantry, in days (synthetic truth). Fixed schedule: every {Math.round((thread.oldArrival - thread.lastDelivery) / 7)} weeks.
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 16, bottom: 6, left: 0 }}>
            <CartesianGrid stroke="#e8ebef" vertical={false} />
            <XAxis dataKey="day" type="number" domain={[firstDay, lastDay]} ticks={ticks} tickFormatter={(d: number) => fmtMonthDay(d)} tick={{ fontSize: 11 }} />
            <YAxis yAxisId="w" hide domain={[0, 1]} />
            <YAxis domain={[0, yMax]} tick={{ fontSize: 11 }} width={36} label={{ value: "days of coffee", angle: -90, position: "insideLeft", fontSize: 11, dx: 10 }} />
            <ReferenceLine x={p.today} stroke="#1b1f24" strokeDasharray="3 3" label={{ value: "today", fontSize: 11, position: "top" }} />
            <ReferenceLine x={thread.oldArrival} stroke="#8a94a3" strokeDasharray="4 3" label={{ value: `${moved ? "was " : ""}${fmtMonthDay(thread.oldArrival)}`, fontSize: 11, position: "insideTopRight" }} />
            {moved && <ReferenceLine x={thread.currentArrival} stroke="#009e73" strokeWidth={2} label={{ value: `now ${fmtMonthDay(thread.currentArrival)}`, fontSize: 11, position: "insideTopLeft", fill: "#006b4e" }} />}
            {win && <Area type="stepAfter" dataKey="win" yAxisId="w" stroke="none" fill="#009e73" fillOpacity={0.18} isAnimationActive={false} name="Likely run-out window" />}
            <Area type="linear" dataKey="fixed" stroke="#0072b2" strokeWidth={2} fill="#0072b2" fillOpacity={0.1} dot={false} isAnimationActive={false} name="Fixed schedule" />
            {moved && <Line type="linear" dataKey="paced" stroke="#009e73" strokeWidth={2.5} dot={false} isAnimationActive={false} name="Paced to you" connectNulls />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex gap-4 text-[0.72rem] text-muted">
        <span><span className="mr-1 inline-block h-2 w-4 rounded bg-blue align-middle" />Fixed schedule</span>
        {moved && <span><span className="mr-1 inline-block h-2 w-4 rounded bg-green align-middle" />Paced to you</span>}
        {win && <span><span className="mr-1 inline-block h-2 w-4 rounded bg-green/25 align-middle" />Likely run-out window (the engine's range after the reply)</span>}
      </div>
    </div>
  );
}
