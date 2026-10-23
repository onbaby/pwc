import { Area, CartesianGrid, ComposedChart, LabelList, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Scatter, XAxis, YAxis } from "recharts";
import type { CustomerProfile } from "../../shared/types.ts";
import { fmtMonthDay } from "../format.ts";

const INK = "#141414";
const ACCENT = "#F16A21";

/**
 * The pantry chart (spec 3.2): labelled directly on the chart, no legend. Past deliveries (ink markers), replies
 * (dots labelled "6 wks"), estimated days on hand (ink line at 60%), likely run-out range (orange band at 20%),
 * the scheduled next delivery (hollow ink marker) and the proposed one (solid orange marker) joined by a dashed
 * line, and a "today" line in muted. Orange is only ever a fill or marker, never text.
 */
export function PantryChart({ pantry }: { pantry: CustomerProfile["pantry"] }) {
  const { estimate, deliveries, replies, runOut, today, scheduled, proposed } = pantry;
  if (!estimate.length) return <div className="grid h-[300px] place-items-center text-[14px] text-muted">No deliveries yet.</div>;
  const first = estimate[0]!.day;
  const last = Math.max(runOut ? runOut.hi : today, proposed ?? 0, scheduled ?? 0, today) + 7;
  const byDay = new Map(estimate.map((e) => [e.day, e.days]));
  const at = (d: number): number => {
    if (byDay.has(d)) return byDay.get(d)!;
    const prev = [...estimate].reverse().find((e) => e.day <= d);
    const next = estimate.find((e) => e.day >= d);
    if (prev && next && next.day !== prev.day) return prev.days + ((next.days - prev.days) * (d - prev.day)) / (next.day - prev.day);
    return (prev ?? next)?.days ?? 0;
  };
  const ymax = Math.max(10, Math.ceil(Math.max(...estimate.map((e) => e.days), ...replies.map((r) => r.weeks * 7)) / 10) * 10);
  const rows: Array<{ day: number; est: number | null; band: [number, number] | null; link: number | null }> = [];
  for (let d = first; d <= last; d++) {
    rows.push({
      day: d,
      est: d <= today ? Math.round(at(d) * 10) / 10 : null,
      band: runOut && d >= runOut.lo && d <= runOut.hi ? [0, ymax] : null,
      link: scheduled !== null && proposed !== null && d >= Math.min(scheduled, proposed) && d <= Math.max(scheduled, proposed) ? 0 : null,
    });
  }
  const ticks: number[] = [];
  const stepDays = last - first > 150 ? 28 : 14;
  for (let d = first; d <= last; d += stepDays) ticks.push(d);
  const deliveryDots = deliveries.map((d) => ({ day: d.day, y: Math.round(at(d.day) * 10) / 10 }));
  const replyDots = replies.map((r) => ({ day: r.day, y: r.weeks * 7, label: `${r.weeks} wks` }));
  const lastEst = estimate[estimate.length - 1]!;
  return (
    <div className="h-[320px] w-full" role="img" aria-label={pantry.title}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 22, right: 28, bottom: 6, left: 0 }}>
          <CartesianGrid stroke="#ECEAE7" vertical={false} />
          <XAxis dataKey="day" type="number" domain={[first, last]} ticks={ticks} tickFormatter={(d: number) => fmtMonthDay(d)} tick={{ fontSize: 12, fill: "#6E6E6A" }} axisLine={{ stroke: "#ECEAE7" }} tickLine={false} />
          <YAxis yAxisId="y" domain={[0, ymax]} ticks={Array.from({ length: 5 }, (_, i) => (ymax * i) / 4)} tickFormatter={(v: number) => String(Math.round(v))} tick={{ fontSize: 12, fill: "#6E6E6A" }} axisLine={false} tickLine={false} width={34} />
          <Area yAxisId="y" dataKey="band" type="stepAfter" connectNulls={false} stroke="none" fill={ACCENT} fillOpacity={0.2} isAnimationActive={false} />
          <Area yAxisId="y" dataKey="est" type="monotone" stroke="rgba(20,20,20,0.6)" strokeWidth={2.5} fill="rgba(20,20,20,0.06)" connectNulls={false} dot={false} isAnimationActive={false} />
          <Line yAxisId="y" dataKey="link" stroke={INK} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} isAnimationActive={false} />
          <Scatter yAxisId="y" data={deliveryDots} dataKey="y" fill={INK} isAnimationActive={false} shape={(p: { cx?: number; cy?: number }) => <circle cx={p.cx} cy={p.cy} r={5} fill={INK} stroke="#fff" strokeWidth={1.5} />} />
          {replyDots.length > 0 && (
            <Scatter yAxisId="y" data={replyDots} dataKey="y" fill={INK} isAnimationActive={false} shape={(p: { cx?: number; cy?: number }) => <circle cx={p.cx} cy={p.cy} r={5} fill="#fff" stroke={INK} strokeWidth={2} />}>
            <LabelList dataKey="label" position="top" style={{ fontSize: 12, fill: "#141414", fontWeight: 600 }} />
          </Scatter>
          )}
          <ReferenceLine yAxisId="y" x={today} stroke="#6E6E6A" strokeDasharray="3 3" label={{ value: "today", position: "insideTopRight", fontSize: 12, fill: "#6E6E6A" }} />
          {runOut && <ReferenceLine yAxisId="y" x={runOut.mid} stroke="transparent" label={{ value: "Likely runs out", position: "top", fontSize: 12, fill: "#141414", fontWeight: 600 }} />}
          <ReferenceDot yAxisId="y" x={lastEst.day} y={lastEst.days} r={0} label={{ value: "Estimated coffee on hand", position: "right", fontSize: 12, fill: "#141414" }} />
          {scheduled !== null && <ReferenceDot yAxisId="y" x={scheduled} y={0} r={7} fill="#fff" stroke={INK} strokeWidth={2} label={{ value: proposed !== null ? `was ${fmtMonthDay(scheduled)}` : `scheduled ${fmtMonthDay(scheduled)}`, position: proposed !== null ? "left" : "top", fontSize: 12, fill: "#141414" }} />}
          {proposed !== null && <ReferenceDot yAxisId="y" x={proposed} y={0} r={7} fill={ACCENT} stroke="#fff" strokeWidth={1.5} label={{ value: `now ${fmtMonthDay(proposed)}`, position: "right", fontSize: 12, fill: "#141414", fontWeight: 600 }} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
