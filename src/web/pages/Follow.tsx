import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PageFor } from "../PageFor.tsx";
import { useApi, useLive } from "../api.tsx";
import { fmtDay, fmtTime, etParts } from "../format.ts";
import { TOUR } from "../tour.ts";

interface FollowDTO {
  path: string;
  query: string;
  at: number;
}

/** the width the console is laid out at before it is shrunk to a phone screen */
const DESK = 900;

/** The name of a stop and the one line the host says about it, for the page being shown. */
function stopFor(path: string, query: string): { label: string; say: string } | undefined {
  const full = query ? `${path}?${query}` : path;
  const exact = TOUR.find((t) => t.to === full) ?? TOUR.find((t) => t.to.split("?")[0] === path);
  if (exact) return { label: exact.label, say: exact.say };
  const first = TOUR.find((t) => t.to.split("?")[0]!.split("/")[1] === path.split("/")[1]);
  return first && path.split("/").length <= 2 ? { label: first.label, say: first.say } : undefined;
}

/**
 * What a judge sees on their own phone: the same page the host has up, kept in step as the host moves, with the
 * data updating live. Read-only: taps do nothing. No console around it, so the page gets the whole screen.
 */
export function Follow() {
  const { data } = useApi<FollowDTO>("/api/follow", ["follow"]);
  const { connected, now } = useLive();
  const [fit, setFit] = useState(true);
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ scale: 0.4, height: 600 });

  // shrink the page to the phone's width (or show it at full size and let the guest scroll sideways)
  useLayoutEffect(() => {
    const measure = () => {
      const w = outer.current?.clientWidth ?? DESK;
      const scale = fit ? Math.min(1, w / DESK) : 1;
      setBox({ scale, height: (inner.current?.scrollHeight ?? 600) * scale });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (outer.current) ro.observe(outer.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, [fit, data?.path]);

  // a new page starts at the top
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [data?.path]);

  const path = data?.path ?? "/today";
  const query = data?.query ?? "";
  const stop = stopFor(path, query);
  const parts = path.split("/").filter(Boolean);

  return (
    <div className="min-h-full bg-cream">
      <header className="sticky top-0 z-20 border-b border-line bg-espresso px-4 py-2.5 text-[#FBF6F1]">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[16px] font-semibold">Classic Cup · following along</div>
          <div className="flex items-center gap-2 text-[12px]" role="status">
            <span className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-[#7FB89C]" : "bg-[#F5B7A8]"}`} aria-hidden />
            {connected ? "Live" : "Reconnecting…"}
          </div>
        </div>
        <div className="text-[12px] opacity-80">Sandbox · sample data{now ? ` · clock ${fmtDay(etParts(now).day)}, ${fmtTime(now)}` : ""}</div>
      </header>

      <section className="px-4 pb-2 pt-4" aria-live="polite">
        <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">On screen now</div>
        <div className="text-[22px] font-medium leading-tight text-strong">{stop?.label ?? parts.join(" / ")}</div>
        {stop && <p className="mb-0 mt-1 text-[15px]">{stop.say}</p>}
      </section>

      <div className="flex items-center justify-between px-4 pb-2 pt-1 text-[13px] text-muted">
        <span>This mirrors the host's screen. Pinch to zoom.</span>
        <button className="btn h-8 px-3 text-[13px]" onClick={() => setFit((f) => !f)} aria-pressed={!fit}>
          {fit ? "Full size" : "Fit to screen"}
        </button>
      </div>

      <div ref={outer} className="relative overflow-x-auto border-t border-line bg-cream" style={{ height: box.height }}>
        <div ref={inner} className="pointer-events-none select-none px-6 py-4" style={{ width: DESK, transform: `scale(${box.scale})`, transformOrigin: "top left" }} aria-label="Mirror of the host's screen">
          <PageFor path={parts} query={new URLSearchParams(query)} />
        </div>
      </div>
      <p className="px-4 py-4 text-[12px] text-muted">Read-only. Nothing you tap here changes the demo.</p>
    </div>
  );
}
