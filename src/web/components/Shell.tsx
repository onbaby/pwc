import { Bell, ChatLines, Gift, GraphUp, Group, HomeSimple, QrCode, Search as SearchIcon, Settings, StatsUpSquare } from "iconoir-react";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { api, post, toast, useApi, useLive, useProgress, useToasts } from "../api.tsx";
import { fmtDay, fmtTime, etParts } from "../format.ts";
import { go, href, type Route } from "../router.ts";
import type { CustomerListItem } from "../../shared/types.ts";
import { SandboxDrawer } from "./SandboxDrawer.tsx";
import { Dialog } from "./ui.tsx";

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
    <div className="global-search relative min-w-0 w-full">
      <SearchIcon width={17} height={17} strokeWidth={1.6} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
      <input aria-label="Search customers" placeholder="Find a customer…" value={q} onChange={(e) => (setQ(e.target.value), setOpen(true))} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} className="h-10 w-full rounded-xl border-line bg-surface pl-10" />
      {open && items.length > 0 && (
        <div className="card anim-pop absolute left-0 right-0 top-[44px] z-40 overflow-hidden p-1 shadow-lg">
          {items.map((i) => (
            <a key={i.id} href={href(`/customers/${i.id}`)} onClick={() => (setQ(""), setOpen(false))} className="flex flex-wrap items-center justify-between gap-x-2 rounded-md px-3 py-2 text-[14px] text-ink no-underline transition-colors hover:bg-cream">
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
  const [navigation, setNavigation] = useState(false);
  const [menu, setMenu] = useState(false);
  const [sandbox, setSandbox] = useState(true);
  const section = route.path[0] ?? "today";
  const counts = useApi<{ needs: number; approvals: number }>("/api/inbox/counts", ["message", "queue", "offer"]).data;
  const waiting = counts ? counts.needs + counts.approvals : 0;
  const advancing = useRef(false);
  const main = useRef<HTMLElement>(null);
  const routeKey = route.path.join("/");

  useEffect(() => {
    main.current?.scrollTo({ top: 0, left: 0 });
    setMenu(false);
  }, [routeKey]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1280px)");
    const closeOnDesktop = () => { if (desktop.matches) setNavigation(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

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

  const navigationContent = (
    <>

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
              <div className="mb-1.5 px-3.5 text-[12px] font-medium text-muted">{g.group}</div>
              {g.items.map((n) => (
                <NavLink key={n.id} to={`/${n.id}`} label={n.label} icon={n.icon} hint={n.hint} active={section === n.id} badge={n.id === "inbox" ? waiting : undefined} />
              ))}
            </div>
          ))}
        </nav>
        <NavLink to="/settings" label="Settings" icon={Settings} active={section === "settings"} />
    </>
  );

  return (
    <div className="app-shell flex h-dvh overflow-hidden">
      {progress && <div className="progress" role="progressbar" aria-label="Loading" />}
      <aside className="hidden w-[232px] shrink-0 flex-col overflow-y-auto border-r border-line bg-surface px-4 pb-4 pt-6 xl:flex">
        {navigationContent}
      </aside>
      {navigation && (
        <Dialog title="Main navigation" onClose={() => setNavigation(false)} className="navigation-drawer anim-drawer fixed inset-y-0 left-0 m-0 flex h-dvh max-h-none w-[min(320px,100%)] max-w-full flex-col overflow-y-auto border-0 border-r border-line bg-surface p-4 shadow-xl">
          <button className="icon-btn mb-3 self-end shrink-0" onClick={() => setNavigation(false)} aria-label="Close navigation">✕</button>
          <div className="flex flex-1 flex-col" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setNavigation(false); }}>{navigationContent}</div>
        </Dialog>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="app-header grid shrink-0 grid-cols-[1fr_auto] items-center gap-3 px-3 pb-3 pt-3 sm:grid-cols-[auto_minmax(0,340px)_1fr] sm:px-6 xl:min-h-[76px] xl:grid-cols-[minmax(0,340px)_1fr]">
          <div className="flex items-center gap-2 xl:hidden">
            <button className="icon-btn shrink-0" aria-label="Open navigation" aria-haspopup="dialog" aria-expanded={navigation} onClick={() => setNavigation(true)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <span className="text-[14px] font-semibold sm:hidden">Classic Cup</span>
          </div>
          <div className="order-last col-span-2 min-w-0 sm:order-none sm:col-span-1"><Search /></div>
          <div className="flex items-center justify-end gap-2 sm:gap-3">
            <div className="hidden">
              <button className="chip warn h-10 rounded-xl px-3.5" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} title="Everything here runs on sample customers">
                <span className="hidden sm:inline">Sandbox · sample data</span><span className="sm:hidden">Sandbox</span>
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
                <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent ring-2 ring-white" aria-hidden />
              )}
            </a>
            <div className="hidden items-center gap-2.5 pl-1 md:flex">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-strong text-[14px] font-semibold text-white">J</span>
              <span className="hidden leading-tight lg:block">
                <span className="block text-[15px] font-medium text-strong">Jordan</span>
                <span className="block text-[12px] text-muted">Subscriptions</span>
              </span>
            </div>
          </div>
        </header>
        <main ref={main} id="main-content" className="app-main min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain px-3 pb-8 pt-4 sm:px-6">
          <div key={routeKey} className="page-enter mx-auto max-w-[1440px]">
            {children}
          </div>
        </main>
      </div>
      {drawer && <SandboxDrawer onClose={() => setDrawer(false)} />}
      <div className="toast-stack fixed bottom-4 right-3 z-[70] flex max-h-[50dvh] w-[calc(100%-1.5rem)] max-w-md flex-col gap-2 overflow-y-auto sm:right-4 sm:w-auto">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={`card anim-toast flex items-center gap-3 px-4 py-2.5 text-[14px] shadow-lg ${t.tone === "error" ? "border-danger text-danger" : ""}`}>
            <span className="min-w-0 flex-1 break-words">{t.message}</span>
            {t.retry && (
              <button className="btn" onClick={() => (t.retry?.(), dismiss(t.id))}>
                Retry
              </button>
            )}
            <button className="icon-btn shrink-0" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export { go };
