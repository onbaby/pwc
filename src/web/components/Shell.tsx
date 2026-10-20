import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, post, toast, useLive, useProgress, useToasts } from "../api.tsx";
import { fmtDay, fmtTime, etParts } from "../format.ts";
import { go, href, type Route } from "../router.ts";
import type { CustomerListItem } from "../../shared/types.ts";
import { SandboxDrawer } from "./SandboxDrawer.tsx";

const NAV: Array<{ id: string; label: string }> = [
  { id: "today", label: "Today" },
  { id: "customers", label: "Customers" },
  { id: "inbox", label: "Inbox" },
  { id: "offers", label: "Offers" },
  { id: "qr", label: "Bag QR" },
  { id: "outlook", label: "Roast outlook" },
  { id: "impact", label: "Impact" },
];

function Search() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<CustomerListItem[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) return setItems([]);
    const t = setTimeout(() => {
      api<{ items: CustomerListItem[] }>(`/api/customers?q=${encodeURIComponent(q.trim())}&pageSize=6&status=active`).then((r) => setItems(r.items ?? [])).catch(() => undefined);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="relative w-[340px]">
      <input aria-label="Search customers" placeholder="Search customers" value={q} onChange={(e) => (setQ(e.target.value), setOpen(true))} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} className="w-full" />
      {open && items.length > 0 && (
        <div className="card absolute left-0 right-0 top-[44px] z-40 overflow-hidden p-1 shadow-lg">
          {items.map((i) => (
            <a key={i.id} href={href(`/customers/${i.id}`)} onClick={() => (setQ(""), setOpen(false))} className="flex items-center justify-between rounded-md px-3 py-2 text-[14px] text-ink no-underline hover:bg-cream">
              <span className="font-medium">{i.name}</span>
              <span className="text-[13px] text-muted">{i.city}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const progress = useProgress();
  const { toasts, dismiss } = useToasts();
  const { now } = useLive();
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [sandbox, setSandbox] = useState(true);
  const section = route.path[0] ?? "today";
  const advancing = useRef(false);

  useEffect(() => {
    api<{ error?: string }>("/api/sandbox").then((r) => setSandbox(!r.error)).catch(() => setSandbox(false));
  }, []);

  // keyboard: Ctrl+Alt+Right = advance; Ctrl+Alt+D = sandbox drawer. Matched on event.code; ignored while a text input is focused.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.altKey)) return;
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (e.code === "KeyD") {
        e.preventDefault();
        setDrawer((d) => !d);
      } else if (e.code === "ArrowRight" && !typing) {
        e.preventDefault();
        if (advancing.current) return;
        advancing.current = true;
        post<{ event: { label: string } | null }>("/api/sandbox/advance")
          .then((r) => r.event && toast(r.event.label, { tone: "info" }))
          .finally(() => (advancing.current = false));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full">
      {progress && <div className="progress" role="progressbar" aria-label="Loading" />}
      <aside className="flex w-[216px] shrink-0 flex-col bg-espresso text-[#FBF6F1]">
        <div className="px-5 pb-4 pt-5">
          <div className="text-[20px] font-semibold tracking-tight">Classic Cup</div>
          <div className="text-[13px] opacity-80">Right on Time</div>
        </div>
        <nav className="flex-1 px-2" aria-label="Main">
          {NAV.map((n) => (
            <a key={n.id} href={href(`/${n.id}`)} className={`relative mb-0.5 flex items-center rounded-md px-4 py-2.5 text-[15px] no-underline ${section === n.id ? "bg-white/10 font-semibold text-white" : "text-[#FBF6F1] hover:bg-white/5"}`}>
              {section === n.id && <span className="absolute left-0 top-1.5 h-[calc(100%-12px)] w-1 rounded-r bg-brand-orange" />}
              {n.label}
            </a>
          ))}
        </nav>
        <div className="border-t border-white/15 p-3">
          <a href={href("/settings")} className="flex items-center gap-2 rounded-md px-3 py-2 text-[14px] text-[#FBF6F1] no-underline hover:bg-white/5" aria-label="Settings">
            <span aria-hidden>⚙</span> Settings
          </a>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface px-6">
          <Search />
          <div className="flex items-center gap-3">
            <div className="relative">
              <button className="chip warn" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} title="Everything here runs on sample customers">
                Sandbox · sample data
              </button>
              {menu && (
                <div className="card absolute right-0 top-9 z-40 w-64 p-3 text-[14px] shadow-lg" role="menu">
                  <div className="mb-2 text-[13px] text-muted">Sandbox clock: {now ? `${fmtDay(etParts(now).day)}, ${fmtTime(now)}` : "…"}</div>
                  {sandbox ? (
                    <button className="btn w-full justify-center" onClick={() => (setDrawer(true), setMenu(false))}>
                      Sandbox controls…
                    </button>
                  ) : (
                    <div className="text-muted">Sandbox controls are off (SANDBOX=0).</div>
                  )}
                  <div className="mt-2 text-[12px] text-muted">Shortcut: Ctrl+Alt+D</div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 text-[14px]">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-espresso text-[13px] font-semibold text-white">J</span>
              <span className="font-medium">Jordan · Subscriptions</span>
            </div>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-[1440px]">{children}</div>
        </main>
      </div>
      {drawer && <SandboxDrawer onClose={() => setDrawer(false)} />}
      <div className="fixed bottom-4 right-4 z-[70] flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={`card flex items-center gap-3 px-4 py-2.5 text-[14px] shadow-lg ${t.tone === "error" ? "border-danger text-danger" : ""}`}>
            <span>{t.message}</span>
            {t.retry && (
              <button className="btn" onClick={() => (t.retry?.(), dismiss(t.id))}>
                Retry
              </button>
            )}
            <button className="border-0 bg-transparent text-muted" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export { go };
