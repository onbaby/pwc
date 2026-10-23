import { useEffect, useState } from "react";
import { api, post, toast, useLive } from "../api.tsx";
import { fmtDay, fmtTime, etParts } from "../format.ts";
import type { CustomerListItem } from "../../shared/types.ts";

interface SandboxState {
  index: number;
  total: number;
  next: { id: string; label: string } | null;
  done: boolean;
  channel: string;
  now: number;
}

/** The sandbox drawer (spec 4): hidden by default; Ctrl+Alt+D or the badge menu. Never shown on a screen otherwise. */
export function SandboxDrawer({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<SandboxState>();
  const [text, setText] = useState("6");
  const [q, setQ] = useState("Maya");
  const [matches, setMatches] = useState<CustomerListItem[]>([]);
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>({ id: "maya-thompson", name: "Maya Thompson" });
  const [busy, setBusy] = useState(false);
  const { versions } = useLive();

  useEffect(() => {
    api<SandboxState>("/api/sandbox").then(setS).catch(() => undefined);
  }, [versions.clock, versions.queue]);
  useEffect(() => {
    if (q.trim().length < 2) return setMatches([]);
    const t = setTimeout(() => api<{ items: CustomerListItem[] }>(`/api/customers?q=${encodeURIComponent(q)}&pageSize=5&status=active`).then((r) => setMatches(r.items ?? [])), 200);
    return () => clearTimeout(t);
  }, [q]);

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast(done, { tone: "info" });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="anim-drawer fixed right-0 top-0 z-50 flex h-full w-[360px] flex-col border-l border-line bg-surface shadow-xl" aria-label="Sandbox controls">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <div className="text-[16px] font-medium tracking-tight text-strong">Sandbox controls</div>
          <div className="text-[13px] text-muted">Sample data only · Ctrl+Alt+D to hide</div>
        </div>
        <button className="btn" onClick={onClose} aria-label="Close sandbox controls">
          ✕
        </button>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto p-4 text-[14px]">
        <section>
          <div className="mb-1 text-[13px] font-semibold text-muted">Clock</div>
          <div className="tnum">{s ? `${fmtDay(etParts(s.now).day)}, ${fmtTime(s.now)}` : "…"}</div>
        </section>
        <section>
          <div className="mb-1 text-[13px] font-semibold text-muted">Scripted events ({s ? `${s.index} of ${s.total}` : "…"})</div>
          <div className="mb-2">{s?.done ? "All events have run." : s?.next ? <>Next: <b>{s.next.label}</b></> : "…"}</div>
          <button className="btn primary" disabled={busy || s?.done} onClick={() => run(() => post("/api/sandbox/advance"))}>
            Advance to next scripted event
          </button>
          <div className="mt-1 text-[12px] text-muted">Shortcut: Ctrl+Alt+→</div>
        </section>
        <section>
          <div className="mb-1 text-[13px] font-semibold text-muted">Inject a reply (as the customer)</div>
          <input aria-label="Find a customer" className="mb-1 w-full" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a customer" />
          {matches.length > 0 && (
            <div className="mb-1 rounded-md border border-line">
              {matches.map((m) => (
                <button key={m.id} className="block w-full border-0 bg-transparent px-3 py-1.5 text-left hover:bg-cream" onClick={() => (setCustomer({ id: m.id, name: m.name }), setQ(m.name), setMatches([]))}>
                  {m.name} <span className="text-muted">· {m.city}</span>
                </button>
              ))}
            </div>
          )}
          <div className="mb-1 text-[13px] text-muted">As: <b className="text-ink">{customer?.name ?? "none"}</b></div>
          <div className="flex gap-2">
            <input aria-label="Reply text" className="min-w-0 flex-1" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn primary" disabled={busy || !customer || !text} onClick={() => run(() => post("/api/sandbox/inject", { customerId: customer!.id, text }), "Reply sent")}>
              Send
            </button>
          </div>
        </section>
        <section>
          <div className="mb-1 text-[13px] font-semibold text-muted">Channel</div>
          <div className="flex gap-2">
            {[
              ["replay", "Replay"],
              ["console", "Console"],
              ["photon", "Live"],
            ].map(([id, label]) => (
              <button key={id} className={`btn ${s?.channel === id ? "primary" : ""}`} disabled={busy} onClick={() => run(async () => setS((await post<SandboxState>("/api/sandbox/channel", { name: id })) as SandboxState))}>
                {label}
              </button>
            ))}
          </div>
          <div className="mt-1 text-[12px] text-muted">Replay: scripted replies. Console: type replies above. Live: real iMessage on a team phone (falls back to replay after 5 s).</div>
        </section>
        <section>
          <div className="mb-1 text-[13px] font-semibold text-muted">Be a grocery shopper</div>
          <button className="btn" disabled={busy} onClick={() => run(async () => { const r = await api<{ latestLots: Array<{ code: string }> }>("/api/qr"); const code = r.latestLots[0]?.code; if (code) window.open(`#/q/${code}`, "_blank"); })}>
            Open the newest bag's QR page
          </button>
          <div className="mt-1 text-[12px] text-muted">Opens what a phone shows after scanning a bag in a store, in a new tab.</div>
        </section>
        <section>
          <div className="mb-1 text-[13px] font-semibold text-muted">Move the clock</div>
          <div className="flex gap-2">
            {[1, 24, 48].map((h) => (
              <button key={h} className="btn" disabled={busy} onClick={() => run(() => post("/api/sandbox/clock", { hours: h }))}>
                +{h} h
              </button>
            ))}
          </div>
        </section>
        <section>
          <div className="mb-1 text-[13px] font-semibold text-muted">Reset sandbox</div>
          <button className="btn danger" disabled={busy} onClick={() => confirm("Reset all sample data to its starting point? This takes a few seconds.") && run(() => post("/api/sandbox/reset"), "Sandbox reset")}>
            Reset sandbox
          </button>
        </section>
      </div>
    </aside>
  );
}
