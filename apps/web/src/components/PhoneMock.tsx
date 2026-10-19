import type { Message, Thread } from "@rot/contracts";
import { fmtShort } from "@rot/core";
import { useEffect, useRef, useState } from "react";
import { post } from "../api.ts";

const TAG_LABEL: Record<Message["tag"], string> = { system: "system", customer: "customer (typed)", scripted: "customer (scripted)", live: "live phone" };

export function PhoneMock({ thread, canType = true }: { thread: Thread; canType?: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const optIn = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const t = setTimeout(() => {
      el.scrollTop = el.scrollHeight;
    }, 60);
    return () => clearTimeout(t);
  }, [thread.messages.length, thread.persona]);

  let lastDay = -1;
  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await post("/api/inbound", { persona: thread.persona, text });
  };

  return (
    <div className="card flex h-full min-h-0 flex-col overflow-hidden" aria-label={`Phone: ${thread.name}`}>
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <div>
          <div className="text-[1.05rem] font-semibold leading-tight">Classic Cup (Athens)</div>
          <div className="text-[0.7rem] text-muted">text thread with {thread.name} · {thread.state.replaceAll("_", " ").toLowerCase()}</div>
        </div>
      </div>
      <button
        className="mx-3 mt-2 rounded-lg bg-[#eef6fb] px-3 py-1.5 text-left text-[0.72rem] leading-snug text-ink"
        onClick={() => optIn.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
        title="Show the opt-in text"
      >
        {thread.consentChip}
      </button>
      <div ref={scroller} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-2">
        {thread.messages.map((m, i) => {
          const sep = m.day !== lastDay;
          lastDay = m.day;
          return (
            <div key={m.id}>
              {sep && <div className="my-2 text-center text-[0.68rem] font-semibold uppercase tracking-wide text-muted">{fmtShort(m.day)}</div>}
              <div ref={i === 0 ? optIn : undefined} className={`flex flex-col ${m.from === "customer" ? "items-end" : "items-start"}`}>
                <div className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-[0.82rem] leading-snug ${m.from === "customer" ? "bg-blue text-white" : "bg-[#eceef2] text-ink"}`}>{m.text}</div>
                <div className="mt-0.5 text-[0.62rem] text-muted">
                  {m.hhmm} · {TAG_LABEL[m.tag]}
                  {m.from === "system" ? " · delivered" : ""}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {canType && (
        <form
          className="flex gap-2 border-t border-line p-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Reply as ${thread.name}…`}
            className="min-w-0 flex-1 rounded-full border border-line px-3 py-1.5 text-[0.85rem] outline-none focus:border-blue"
            aria-label={`Reply as ${thread.name}`}
          />
          <button type="submit" className="rounded-full bg-blue px-4 text-[0.85rem] font-semibold text-white">
            Send
          </button>
        </form>
      )}
    </div>
  );
}
