import { applyEvent, type DemoState, type Scenario, type SseEvent } from "@rot/contracts";
import { useEffect, useRef, useState } from "react";

export async function post(path: string, body: unknown = {}): Promise<unknown> {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json().catch(() => ({}));
}

/** Live demo state over SSE: a snapshot first, then deltas; the browser reconnects on its own with Last-Event-ID. */
export function useDemoState(): { state: DemoState | undefined; connected: boolean } {
  const [state, setState] = useState<DemoState | undefined>();
  const [connected, setConnected] = useState(false);
  const ref = useRef<DemoState | undefined>(undefined);
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data) as SseEvent;
      ref.current = applyEvent(ref.current, ev);
      setState(ref.current);
    };
    return () => es.close();
  }, []);
  return { state, connected };
}

export function useJson<T>(url: string): T | undefined {
  const [data, setData] = useState<T | undefined>();
  useEffect(() => {
    let alive = true;
    fetch(url)
      .then((r) => r.json())
      .then((d) => alive && setData(d as T))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [url]);
  return data;
}

export const useScenario = () => useJson<Scenario>("/api/scenario");
