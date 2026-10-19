import type { DemoState } from "@rot/contracts";
import { PantryChart } from "../components/PantryChart.tsx";
import { ExplainCard } from "../components/ExplainCard.tsx";
import { PhoneMock } from "../components/PhoneMock.tsx";

const PROMISES = [
  ["Opt-in first", "Nobody is texted before they say YES at checkout."],
  ["STOP and CANCEL work immediately", "STOP ends texts; exact CANCEL cancels at once, with a 24-hour undo."],
  ["Nothing charged earlier without a yes", "A sooner delivery always waits for an explicit YES."],
  ["Unsure goes to a person", "Unclear replies go to the helpdesk list, not to a guess."],
] as const;

export function Screen1({ state, stepIndex }: { state: DemoState; stepIndex: number }) {
  const thread = state.threads[state.activePersona];
  const id = state.stepId;
  const reveal = (s: string) => stepIndex >= ["s1a", "s1b1", "s1b2", "s1b3", "s1b4", "s1c", "s1d", "s1e"].indexOf(s);
  const showExplain = id === "s1b4";
  const afterReply = state.activePersona === "maya" ? reveal("s1b2") : true;
  const f = thread.forecast;
  const showForecast = !!f && afterReply;
  const showHelpdesk = reveal("s1d");
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(300px,0.8fr)_minmax(0,2fr)] gap-4">
      <PhoneMock thread={thread} />
      <div className="flex min-h-0 flex-col gap-3">
        <div className="card min-h-0 flex-1 p-4">
          {showExplain ? (
            <ExplainCard thread={thread} />
          ) : (
            <PantryChart thread={thread} showWindow={showForecast && !!f?.freshReply} showNew={showForecast && thread.proposal !== undefined} />
          )}
        </div>
        <div className="flex flex-wrap items-stretch gap-2 text-[0.82rem]">
          {showForecast && f && (
            <>
              <Chip label="How sure we are" value={f.confidence} tone={f.confidence === "Not yet sure" ? "orange" : "green"} />
              <Chip label="Decision" value={f.note} tone={f.abstain ? "orange" : "blue"} wide />
            </>
          )}
          {showHelpdesk && state.activePersona === "dev" && <Chip label="Held off, waiting for data" value={`${state.counters.heldOff} of ${state.counters.cohort}`} tone="orange" />}
        </div>
        {showHelpdesk && (
          <div className="card p-3">
            <div className="text-[0.72rem] font-bold uppercase tracking-wide text-muted">A person looks at these</div>
            {state.humanQueue.length === 0 ? (
              <div className="text-[0.85rem] text-muted">Nothing needs a person right now.</div>
            ) : (
              state.humanQueue.map((q) => (
                <div key={q.id} className="mt-1 text-[0.88rem]">
                  <span className="font-semibold">{q.name}</span>: “{q.text}” <span className="text-muted">({q.reason})</span>
                </div>
              ))
            )}
            <div className="mt-1 text-[0.66rem] text-muted">In production, a tag in the helpdesk Classic Cup already uses.</div>
          </div>
        )}
        {reveal("s1e") && (
          <div className="card p-3">
            <div className="grid grid-cols-4 gap-2">
              {PROMISES.map(([h, t], i) => (
                <a key={h} href={`/backup#${i === 0 ? 2 : i === 1 ? 2 : i === 2 ? 3 : 6}`} className="rounded-lg border border-line p-2 text-ink no-underline hover:bg-[#f2f6fa]" title="Open the backup tile">
                  <div className="text-[0.85rem] font-semibold">✓ {h}</div>
                  <div className="text-[0.68rem] leading-snug text-muted">{t}</div>
                </a>
              ))}
            </div>
            <div className="mt-2 text-[0.8rem] font-semibold">AI element: a pantry model that learns from each reply.</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ label, value, tone, wide }: { label: string; value: string; tone: "green" | "orange" | "blue"; wide?: boolean }) {
  const cls = tone === "green" ? "border-green bg-[#e6f6f1]" : tone === "orange" ? "border-orange bg-[#fff5dd]" : "border-blue bg-[#e8f3fa]";
  return (
    <div className={`rounded-xl border px-3 py-1.5 ${cls} ${wide ? "flex-1" : ""}`}>
      <div className="text-[0.62rem] font-bold uppercase tracking-wide text-muted">{label}</div>
      <div className="font-semibold leading-snug">{value}</div>
    </div>
  );
}
