import { useCallback, useEffect, useRef, useState } from "react";
import { fmtShort } from "@rot/core";
import { post, useDemoState, useScenario } from "./api.ts";
import { useArtifacts } from "./artifacts.ts";
import { Pills } from "./components/Pills.tsx";
import { Backup, TILES } from "./screens/Backup.tsx";
import { Screen1 } from "./screens/Screen1.tsx";
import { Screen2 } from "./screens/Screen2.tsx";
import { Screen3 } from "./screens/Screen3.tsx";

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
};

function usePath(): [string, (p: string) => void] {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return [path, (p) => { window.history.pushState({}, "", p); setPath(p.split("#")[0]!); }];
}

export function App() {
  const { state, connected } = useDemoState();
  const scenario = useScenario();
  const art = useArtifacts();
  const [path, go] = usePath();
  const backup = path.startsWith("/backup");
  const [tile, setTile] = useState(() => Number(window.location.hash.slice(1)) || 1);
  const startedAt = useRef<number | undefined>(undefined);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!state) return;
    if (state.step === 0) startedAt.current = undefined;
    else if (startedAt.current === undefined) startedAt.current = Date.now();
  }, [state?.step]);

  const next = useCallback(() => void post("/api/step", { dir: "next" }), []);
  const prev = useCallback(() => void post("/api/step", { dir: "prev" }), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey) {
        if (e.code === "KeyR") { e.preventDefault(); void post("/api/mode/toggle"); }
        else if (e.code === "KeyB") { e.preventDefault(); go(backup ? "/" : "/backup"); }
        else if (e.code === "Digit0") { e.preventDefault(); void post("/api/reset"); go("/"); }
        return;
      }
      if (isTyping(e.target)) return;
      if (backup) {
        if (e.key >= "1" && e.key <= "8") setTile(Number(e.key));
        else if (e.key === "Escape") go("/");
        return;
      }
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); prev(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [backup, next, prev, go]);

  if (!state || !scenario || !art) {
    return <div className="grid h-screen place-items-center text-muted">{connected ? "Loading…" : "Connecting to the demo server…"}</div>;
  }

  const screen = state.stepId.startsWith("s1") ? 1 : state.stepId.startsWith("s2") ? 2 : 3;
  const title = backup ? "Backup" : screen === 1 ? `${state.threads[state.activePersona].name}'s next delivery` : screen === 2 ? "Does it pay? It depends on one number" : "How we'd find out";
  const elapsed = startedAt.current ? Math.max(0, Math.floor((now - startedAt.current) / 1000)) : 0;
  const late = (screen < 2 && elapsed > scenario.timeBudgetSeconds.screen2By) || (screen < 3 && elapsed > scenario.timeBudgetSeconds.screen3By);
  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <div className="flex h-screen flex-col px-5 py-3">
      <header className="mb-3 flex shrink-0 items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[0.7rem] font-bold uppercase tracking-widest text-muted">{scenario.programName} · Classic Cup Coffee</div>
          <h1 className="m-0 truncate text-[1.6rem] font-bold leading-tight">{title}</h1>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Pills state={state} connected={connected} />
          <div className="flex items-center gap-3 text-[0.72rem] text-muted">
            <span title="Virtual clock">🕙 {fmtShort(state.clockDay)}</span>
            <span>step {state.step + 1}/{state.stepCount}</span>
            {!backup && <span className={late ? "font-bold text-red" : ""} title="Time rule: Screen 2 by 4:30, Screen 3 by 5:00">⏱ {mmss}</span>}
          </div>
        </div>
      </header>
      {state.banner && <div className="mb-2 shrink-0 rounded-lg bg-ink px-4 py-2 text-center text-[1.05rem] font-semibold text-white">{state.banner}</div>}
      <main className="min-h-0 flex-1">
        {backup ? (
          <Backup state={state} art={art} tile={tile} setTile={setTile} />
        ) : screen === 1 ? (
          <Screen1 state={state} stepIndex={state.step} />
        ) : screen === 2 ? (
          <Screen2 state={state} art={art} />
        ) : (
          <Screen3 state={state} art={art} scenario={scenario} />
        )}
      </main>
      <footer className="mt-2 flex shrink-0 items-center justify-between text-[0.8rem]">
        <span className="font-semibold">Nothing is ever charged earlier without a yes. Every change can be undone.</span>
        <span className="text-muted">Demo: iMessage on team phones. Production: a registered SMS campaign (same flow). Synthetic subscribers; no client data.</span>
        <span className="flex gap-2">
          <button className="rounded border border-line px-2 py-0.5" onClick={prev}>◀ back</button>
          <button className="rounded bg-blue px-3 py-0.5 font-semibold text-white" onClick={next}>next ▶</button>
          <button className="rounded border border-line px-2 py-0.5" onClick={() => go(backup ? "/" : "/backup")}>{backup ? "demo" : "backup"}</button>
        </span>
      </footer>
      <span className="sr-only">{TILES.length} backup tiles</span>
    </div>
  );
}
