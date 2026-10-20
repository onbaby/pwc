import type { ReactNode } from "react";
import type { Confidence } from "../../engine/decision.ts";
import type { StatusChip } from "../../shared/types.ts";

export function Card({ children, className = "", pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <div className={`card ${pad ? "p-4" : ""} ${className}`}>{children}</div>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="m-0 text-[20px] font-semibold leading-tight text-espresso">{children}</h2>
      {right}
    </div>
  );
}

export function PageTitle({ children, sub, right }: { children: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h1 className="m-0 text-[28px] font-semibold leading-tight text-espresso">{children}</h1>
        {sub && <div className="mt-1 text-[14px] text-muted">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-center text-[14px] text-muted">{children}</div>;
}

export function HowSure({ value }: { value: Confidence | null | undefined }) {
  if (!value) return <span className="text-[13px] text-muted">–</span>;
  const cls = value === "High" ? "ok" : value === "Medium" ? "warn" : "";
  return <span className={`chip ${cls}`} title={value === "High" ? "High ≈ the range is within ±25%" : value === "Medium" ? "Medium ≈ the range is within ±50%" : "Not yet sure: no reply this cycle, or the range is too wide"}>{value}</span>;
}

export function Status({ value }: { value: StatusChip }) {
  const cls = value === "Move proposed" ? "plum" : value === "Reply received" ? "ok" : value === "Cancelled" || value === "Texts off" ? "bad" : value === "Holding off" || value === "Held" || value === "Paused" ? "warn" : "";
  return <span className={`chip ${cls}`}>{value}</span>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: ReactNode }>; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`-mb-px border-0 border-b-2 bg-transparent px-4 py-2.5 text-[15px] ${value === t.id ? "border-espresso font-semibold text-espresso" : "border-transparent text-muted hover:text-espresso"}`}
          style={{ borderBottomStyle: "solid" }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Delta({ now, prev, good = "up" }: { now: number; prev: number; good?: "up" | "down" }) {
  const d = now - prev;
  if (d === 0) return <span className="text-[13px] text-muted">no change vs last week</span>;
  const up = d > 0;
  const ok = (up && good === "up") || (!up && good === "down");
  return (
    <span className={`text-[13px] font-medium ${ok ? "text-success" : "text-muted"}`}>
      {up ? "▲" : "▼"} {Math.abs(d).toLocaleString("en-US")} vs last week
    </span>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="card w-full max-w-md p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="m-0 text-[20px] font-semibold text-espresso">{title}</h3>
          <button className="btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConsentChip({ label, yes }: { label: string; yes: boolean }) {
  return (
    <span className={`chip ${yes ? "ok" : "bad"}`}>
      {label}: {yes ? "yes" : "no"}
    </span>
  );
}
