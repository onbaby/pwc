import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Confidence } from "../../engine/decision.ts";
import type { StatusChip } from "../../shared/types.ts";

export function Card({ children, className = "", pad = true, id }: { children: ReactNode; className?: string; pad?: boolean; id?: string }) {
  return (
    <div id={id} className={`card ${pad ? "p-4 sm:p-5" : ""} ${className}`}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 className="m-0 text-[18px] font-medium leading-snug tracking-tight text-strong">{children}</h2>
      {right}
    </div>
  );
}

export function PageTitle({ children, sub, right }: { children: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
      <div className="min-w-0">
        <h1 className="m-0 text-[28px] font-normal leading-tight tracking-tight text-strong sm:text-[32px] lg:text-[36px]">{children}</h1>
        {sub && <div className="mt-2 max-w-[72ch] text-[15px] leading-relaxed text-muted">{sub}</div>}
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
    <div role="tablist" className="flex max-w-full gap-1.5 overflow-x-auto border-b border-line py-2">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`shrink-0 whitespace-nowrap rounded-lg border px-4 py-2 text-[14px] ${value === t.id ? "border-accent-tint bg-accent-tint font-medium text-accent-ink" : "border-transparent bg-transparent text-muted hover:bg-[var(--hover)] hover:text-strong"}`}
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

/** Native dialogs keep focus inside the overlay, make the background inert and support Escape on iPad keyboards. */
export function Dialog({ title, onClose, children, className = "" }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog ref={ref} aria-label={title} className={`app-dialog ${className}`} onKeyDown={(e) => {
      if (e.key !== "Tab") return;
      const controls = [...e.currentTarget.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')]
        .filter((el) => !el.matches(':disabled, [tabindex="-1"]') && el.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (e.shiftKey && (document.activeElement === first || document.activeElement === e.currentTarget)) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => {
      if (e.target !== e.currentTarget) return;
      const rect = e.currentTarget.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose();
    }}>
      {children}
    </dialog>, document.body,
  );
}

export function ScrollRegion({ children, label, hint, className }: { children: ReactNode; label: string; hint: string; className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const el = ref.current!;
    const measure = () => setOverflow(el.scrollWidth > el.clientWidth + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    measure();
    return () => observer.disconnect();
  }, []);
  return (
    <div className="min-w-0">
      {overflow && <div className="px-3 py-2 text-[12px] text-muted">{hint} →</div>}
      <div ref={ref} className={className} role="region" aria-label={label} tabIndex={overflow ? 0 : undefined}>{children}</div>
    </div>
  );
}

export function TableScroll({ children, label = "Data table" }: { children: ReactNode; label?: string }) {
  return <ScrollRegion label={label} hint="Scroll horizontally to see all columns" className="table-scroll">{children}</ScrollRegion>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Dialog title={title} onClose={onClose} className="card anim-modal m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto p-5 shadow-lg">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="m-0 text-[20px] font-medium tracking-tight text-strong">{title}</h3>
        <button className="btn shrink-0" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {children}
    </Dialog>
  );
}

export function ConsentChip({ label, yes }: { label: string; yes: boolean }) {
  return (
    <span className={`chip ${yes ? "ok" : "bad"}`}>
      {label}: {yes ? "yes" : "no"}
    </span>
  );
}
