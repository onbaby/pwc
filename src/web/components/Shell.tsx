import { Bell, ChatLines, Gift, GraphUp, Group, HomeSimple, QrCode, Search as SearchIcon, Settings, StatsUpSquare } from "iconoir-react";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { api, post, toast, useApi, useLive, useProgress, useToasts } from "../api.tsx";
import { fmtDay, fmtTime, etParts } from "../format.ts";
import { go, href, type Route } from "../router.ts";
import type { CustomerListItem } from "../../shared/types.ts";
import { SandboxDrawer } from "./SandboxDrawer.tsx";

type Icon = ComponentType<{ width?: number; height?: number; strokeWidth?: number; "aria-hidden"?: boolean }>;

interface NavItem {
  id: string;
  label: string;
  icon: Icon;
  hint: string;
}

// grouped by when you reach for them: the daily loop first, then growth, then planning
const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: "Daily work",
    items: [
      { id: "today", label: "Today", icon: HomeSimple, hint: "What needs you today" },
      { id: "inbox", label: "Inbox", icon: ChatLines, hint: "Replies and approvals waiting on you" },
      { id: "customers", label: "Customers", icon: Group, hint: "Every subscriber and their schedule" },
    ],
  },
  {
    group: "Grow",
    items: [
      { id: "offers", label: "Offers", icon: Gift, hint: "Targeted offers and how they are doing" },
      { id: "qr", label: "Bag QR", icon: QrCode, hint: "Grocery bags that turn buyers into subscribers" },
    ],
  },
  {
    group: "Plan",
    items: [
      { id: "outlook", label: "Roast outlook", icon: StatsUpSquare, hint: "How much to roast in the coming weeks" },
      { id: "impact", label: "Impact", icon: GraphUp, hint: "What the program is worth, and the pilot plan" },
    ],
  },
];

function NavLink({ to, label, icon: I, active, hint, badge }: { to: string; label: string; icon: Icon; active: boolean; hint?: string; badge?: number }) {
  return (
    <a href={href(to)} title={hint} aria-current={active ? "page" : undefined} className={`nav-link mb-0.5 flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[15px] no-underline ${active ? "bg-accent-tint font-medium text-accent-ink" : "text-muted hover:bg-[var(--hover)] hover:text-strong"}`}>
      <I width={19} height={19} strokeWidth={1.6} aria-hidden />
      <span className="flex-1">{label}</span>
      {!!badge && (
        <span className="tnum min-w-[22px] rounded-full bg-accent-ink px-1.5 text-center text-[12px] font-semibold leading-[20px] text-white" aria-label={`${badge} waiting`}>
          {badge}
        </span>
      )}
    </a>
  );
}

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
      <SearchIcon width={17} height={17} strokeWidth={1.6} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
      <input aria-label="Search customers" placeholder="Find a customer…" value={q} onChange={(e) => (setQ(e.target.value), setOpen(true))} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} className="h-10 w-full rounded-xl border-line bg-surface pl-10" />
      {open && items.length > 0 && (
        <div className="card anim-pop absolute left-0 right-0 top-[44px] z-40 overflow-hidden p-1 shadow-lg">
          {items.map((i) => (
            <a key={i.id} href={href(`/customers/${i.id}`)} onClick={() => (setQ(""), setOpen(false))} className="flex items-center justify-between rounded-md px-3 py-2 text-[14px] text-ink no-underline transition-colors hover:bg-cream">
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
  const counts = useApi<{ needs: number; approvals: number }>("/api/inbox/counts", ["message", "queue", "offer"]).data;
  const waiting = counts ? counts.needs + counts.approvals : 0;
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
      <aside className="flex w-[232px] shrink-0 flex-col border-r border-line bg-surface px-4 pb-4 pt-6">
        <a href={href("/today")} className="mb-6 flex items-center gap-2.5 px-2 text-strong no-underline" aria-label="Classic Cup: Right on Time, home">
          <img src="/logo.png" alt="" width={60} height={28} className="h-7 w-auto" />
          <span className="leading-tight">
            <span className="block text-[17px] font-semibold tracking-tight">Classic Cup</span>
            <span className="block text-[12px] text-muted">Right on Time</span>
          </span>
        </a>
        <nav className="flex-1 space-y-5" aria-label="Main">
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="mb-1.5 px-3.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{g.group}</div>
              {g.items.map((n) => (
                <NavLink key={n.id} to={`/${n.id}`} label={n.label} icon={n.icon} hint={n.hint} active={section === n.id} badge={n.id === "inbox" ? waiting : undefined} />
              ))}
            </div>
          ))}
        </nav>
        <NavLink to="/settings" label="Settings" icon={Settings} active={section === "settings"} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[76px] shrink-0 items-center justify-between gap-4 px-6 pt-2">
          <Search />
          <div className="flex items-center gap-3">
            <div className="relative">
              <button className="chip warn h-10 rounded-xl px-3.5" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} title="Everything here runs on sample customers">
                Sandbox · sample data
              </button>
              {menu && (
                <div className="card anim-pop absolute right-0 top-12 z-40 w-64 p-3 text-[14px] shadow-lg" role="menu">
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
            <a href={href("/inbox")} className="icon-btn relative" aria-label={`Inbox: ${waiting} waiting`} title={counts ? `${counts.needs} replies need a person · ${counts.approvals} waiting for approval` : "Inbox"}>
              <Bell width={18} height={18} strokeWidth={1.6} aria-hidden />
              {waiting > 0 && (
                <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent ring-2 ring-white">
                  <span className="anim-ping" aria-hidden />
                </span>
              )}
            </a>
            <div className="flex items-center gap-2.5 pl-1">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-strong text-[14px] font-semibold text-white">J</span>
              <span className="leading-tight">
                <span className="block text-[15px] font-medium text-strong">Jordan</span>
                <span className="block text-[12px] text-muted">Subscriptions</span>
              </span>
            </div>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-4">
          <div key={route.path.join("/")} className="page-enter mx-auto max-w-[1440px]">
            {children}
          </div>
        </main>
      </div>
      {drawer && <SandboxDrawer onClose={() => setDrawer(false)} />}
      <div className="fixed bottom-4 right-4 z-[70] flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={`card anim-toast flex items-center gap-3 px-4 py-2.5 text-[14px] shadow-lg ${t.tone === "error" ? "border-danger text-danger" : ""}`}>
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
