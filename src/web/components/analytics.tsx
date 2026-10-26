import type { ComponentType, ReactNode } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { nf, pct } from "../format.ts";

/** Dashboard building blocks: tile, meter, half gauge and bar trend. Orange is a fill only; numbers and labels stay ink. */
export const INK = "#643A2B";
export const ACCENT = "#F16A21";
export const TRACK = "#EADFD5";

type Icon = ComponentType<{ width?: number; height?: number; strokeWidth?: number; "aria-hidden"?: boolean }>;

export function Eyebrow({ icon: I, children, right }: { icon?: Icon; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <h2 className="eyebrow">
        {I && <I aria-hidden />}
        {children}
      </h2>
      {right}
    </div>
  );
}

/** "+8%" next to a figure: green tint when the move is good, red tint when it is bad. */
export function DeltaBadge({ now, prev, good = "up" }: { now: number; prev: number; good?: "up" | "down" }) {
  if (prev === 0 || now === prev) return <span className="text-[12px] text-muted">flat</span>;
  const d = (now - prev) / prev;
  const ok = (d > 0) === (good === "up");
  return (
    <span className={`tnum rounded-md px-1.5 py-0.5 text-[12px] font-medium ${ok ? "bg-success-tint text-success" : "bg-danger-tint text-danger"}`} title="vs last week">
      {d > 0 ? "+" : "−"}
      {/* "+200%" on a count of 2 is noise: small counts change by a number, large ones by a share */}
      {prev < 30 ? Math.abs(now - prev) : pct(Math.abs(d), Math.abs(d) < 0.1 ? 1 : 0)}
    </span>
  );
}

/** A track with a filled share and a tick marker at its end. */
export function Meter({ value, tone = "accent", label }: { value: number; tone?: "accent" | "ink"; label?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="mt-auto">
      <div className="relative h-4" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} aria-label={label}>
        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full" style={{ background: TRACK }} />
        <div className="absolute left-0 top-1/2 h-[5px] -translate-y-1/2 rounded-full" style={{ width: `${v * 100}%`, background: tone === "accent" ? ACCENT : INK }} />
        <div className="absolute top-0 h-4 w-px bg-muted" style={{ left: `min(${v * 100}%, calc(100% - 1px))` }} />
        {v < 0.94 && <div className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-muted" style={{ left: `calc(${v * 100}% + 4px)` }} />}
      </div>
      {label && <div className="mt-1 text-[12px] text-muted">{label}</div>}
    </div>
  );
}

export function StatTile({ icon, label, value, delta, meter, href: to, title }: { icon: Icon; label: string; value: string; delta?: ReactNode; meter?: ReactNode; href?: string; title?: string }) {
  const body = (
    <>
      <Eyebrow icon={icon}>{label}</Eyebrow>
      <div className="mb-3 mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="tnum text-[30px] font-normal leading-none tracking-tight text-strong">{value}</span>
        {delta}
      </div>
      {meter}
    </>
  );
  const cls = "card flex min-h-[150px] flex-col p-4 text-ink no-underline";
  return to ? (
    <a href={to} className={`${cls} hover:border-muted`} title={title}>
      {body}
    </a>
  ) : (
    <div className={cls} title={title}>
      {body}
    </div>
  );
}

export interface GaugeSegment {
  label: string;
  value: number;
  color: string;
}

const polar = (cx: number, cy: number, r: number, a: number) => [cx + r * Math.cos(a), cy - r * Math.sin(a)] as const;

/** A half-circle split into segments left to right, with a dot capping the last one. */
export function HalfGauge({ segments, center, caption }: { segments: GaugeSegment[]; center: ReactNode; caption?: ReactNode }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const [w, h, r, sw, gap] = [280, 150, 118, 16, 0.035];
  const [cx, cy] = [w / 2, h - 10];
  let a = Math.PI;
  const arcs = segments.map((s) => {
    const span = (s.value / total) * Math.PI;
    const a0 = a;
    const a1 = a - span;
    a = a1;
    const [s0, s1] = [a0 - (a0 < Math.PI ? gap / 2 : 0), a1 + (a1 > 0 ? gap / 2 : 0)];
    if (span <= gap) return null;
    const [x0, y0] = polar(cx, cy, r, s0);
    const [x1, y1] = polar(cx, cy, r, s1);
    return { ...s, d: `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`, end: [x1, y1] as const };
  });
  const last = arcs.filter(Boolean).at(-1);
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-[13px] text-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label} <span className="tnum text-strong">{nf(s.value)}</span>
          </span>
        ))}
      </div>
      <div className="relative mx-auto w-full max-w-[300px]">
        <svg viewBox={`0 0 ${w} ${h}`} className="block w-full" role="img" aria-label={segments.map((s) => `${s.label} ${nf(s.value)}`).join(", ")}>
          {arcs.map((x) => x && <path key={x.label} d={x.d} fill="none" stroke={x.color} strokeWidth={sw} />)}
          {last && <circle cx={last.end[0]} cy={last.end[1]} r={9} fill={last.color} stroke="#fff" strokeWidth={3} />}
        </svg>
        <div className="absolute inset-x-0 bottom-1 text-center">
          <div className="tnum text-[32px] leading-none tracking-tight text-strong">{center}</div>
          {caption && <div className="mt-1 text-[12px] text-muted">{caption}</div>}
        </div>
      </div>
    </div>
  );
}

/** Thin vertical bars; the highlighted bar is orange, the rest ink. */
export function BarTrend({ data, highlight = 0, height = 170, unit = "" }: { data: Array<{ label: string; value: number }>; highlight?: number; height?: number; unit?: string }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} barCategoryGap="30%">
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#6B5A50" }} axisLine={false} tickLine={false} interval={0} />
          <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} contentStyle={{ borderRadius: 12, border: "1px solid #E9DFD6", fontSize: 13 }} formatter={(v) => [`${nf(Number(v))}${unit}`, ""]} separator="" />
          <Bar dataKey="value" radius={[6, 6, 6, 6]} maxBarSize={18} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={d.label} fill={i === highlight ? ACCENT : INK} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
