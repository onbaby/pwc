import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/** API layer: fetch with a progress bar after 300 ms, error toasts with retry, and the SSE stream (spec 5, 12.4). */
let pending = 0;
const progressListeners = new Set<(n: number) => void>();
const bump = (d: number) => {
  pending += d;
  progressListeners.forEach((l) => l(pending));
};

export type Toast = { id: number; message: string; retry?: () => void; tone?: "error" | "info" };
const toastListeners = new Set<(t: Toast) => void>();
let toastId = 0;
export const toast = (message: string, opts: { retry?: () => void; tone?: "error" | "info" } = {}): void => {
  const t = { id: ++toastId, message, ...opts };
  toastListeners.forEach((l) => l(t));
};

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  bump(1);
  try {
    const r = await fetch(path, init);
    const j = (await r.json().catch(() => ({}))) as T & { error?: string };
    if (!r.ok && (j as { error?: string }).error === undefined && r.status >= 500) throw new Error(`Server error (${r.status})`);
    return j as T;
  } finally {
    bump(-1);
  }
}

export async function post<T = { ok: boolean; error?: string }>(path: string, body: unknown = {}): Promise<T> {
  return api<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export function useProgress(): boolean {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const l = (n: number) => {
      if (n > 0) {
        if (!timer.current) timer.current = setTimeout(() => setOn(true), 300);
      } else {
        if (timer.current) clearTimeout(timer.current);
        timer.current = undefined;
        setOn(false);
      }
    };
    progressListeners.add(l);
    return () => void progressListeners.delete(l);
  }, []);
  return on;
}

export function useToasts(): { toasts: Toast[]; dismiss: (id: number) => void } {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    const l = (t: Toast) => {
      setToasts((x) => [...x, t]);
      setTimeout(() => setToasts((x) => x.filter((y) => y.id !== t.id)), t.retry ? 12_000 : 5_000);
    };
    toastListeners.add(l);
    return () => void toastListeners.delete(l);
  }, []);
  return { toasts, dismiss: (id) => setToasts((x) => x.filter((t) => t.id !== id)) };
}

// ---- live events (SSE) ------------------------------------------------------------------------------------------------
interface LiveState {
  versions: Record<string, number>;
  now: number | null;
  connected: boolean;
}
const LiveContext = createContext<LiveState>({ versions: {}, now: null, connected: false });

export function LiveProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LiveState>({ versions: {}, now: null, connected: false });
  useEffect(() => {
    const es = new EventSource("/api/stream");
    const types = ["message", "projection", "queue", "offer", "clock"];
    const timers: Record<string, ReturnType<typeof setTimeout> | undefined> = {};
    es.onopen = () => setState((s) => ({ ...s, connected: true }));
    es.onerror = () => setState((s) => ({ ...s, connected: false }));
    es.addEventListener("snapshot", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as { now: number };
      setState((s) => ({ ...s, now: d.now, connected: true }));
    });
    es.addEventListener("toast", (e) => toast((JSON.parse((e as MessageEvent).data) as { message: string }).message, { tone: "info" }));
    for (const t of types) {
      es.addEventListener(t, (e) => {
        const d = JSON.parse((e as MessageEvent).data) as { now?: number };
        // one advance sends hundreds of events: coalesce into one refresh per type
        if (timers[t]) return;
        timers[t] = setTimeout(() => {
          timers[t] = undefined;
          setState((s) => ({ ...s, versions: { ...s.versions, [t]: (s.versions[t] ?? 0) + 1 }, now: t === "clock" && d.now ? d.now : s.now }));
        }, 350);
      });
    }
    return () => es.close();
  }, []);
  return <LiveContext.Provider value={state}>{children}</LiveContext.Provider>;
}

export const useLive = (): LiveState => useContext(LiveContext);

/** Fetch JSON, refetching when any of the named event types arrive. */
export function useApi<T>(path: string | null, live: string[] = ["queue", "message", "clock", "projection"]): { data: T | undefined; error: string | undefined; reload: () => void; loading: boolean } {
  const { versions } = useLive();
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const stamp = live.map((l) => versions[l] ?? 0).join(",");
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    api<T>(path)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(undefined);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message);
        toast(`Could not load: ${e.message}`, { retry: () => setTick((t) => t + 1), tone: "error" });
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, stamp, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, reload, loading };
}
