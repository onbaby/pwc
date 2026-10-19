import type { DemoState } from "@rot/contracts";

export function Pills({ state, connected }: { state: DemoState; connected: boolean }) {
  const mode =
    state.mode === "live"
      ? { text: "LIVE iMessage, team phone", cls: "bg-green text-white" }
      : state.mode === "replay"
        ? { text: "REPLAY", cls: "bg-orange text-ink" }
        : { text: "CONSOLE", cls: "bg-grey text-white" };
  return (
    <div className="flex items-center gap-2 text-[0.72rem] font-bold tracking-wide">
      <span className={`rounded-full px-3 py-1 ${mode.cls}`} title={state.modeNote}>
        {mode.text}
      </span>
      <span className="rounded-full border border-ink px-3 py-1" title="How free-text replies are read">
        {state.parser}
      </span>
      <span className="rounded-full bg-ink px-3 py-1 text-white">SIMULATED: not a forecast</span>
      {!connected && <span className="rounded-full bg-red px-3 py-1 text-white">reconnecting…</span>}
    </div>
  );
}
