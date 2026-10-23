import { useState } from "react";
import type { MessageDTO } from "../../shared/types.ts";
import { fmtDateTime } from "../../shared/dates.ts";

function Why({ m }: { m: MessageDTO }) {
  const [open, setOpen] = useState(false);
  const [tech, setTech] = useState(false);
  if (!m.whySentence) return null;
  return (
    <div className="mt-1 flex max-w-[78%] flex-col items-end">
      <button className="imsg-link border-0 bg-transparent p-0 text-[13px] font-medium underline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "Hide" : "Why we sent this"}
      </button>
      {open && (
        <div className="imsg-why mt-1 rounded-xl p-3 text-[13px] leading-relaxed">
          <div>{m.whySentence}</div>
          {m.why?.blockedBy && m.why.blockedBy.length > 0 && <div className="imsg-meta mt-1">Held for review because: {m.why.blockedBy.join(", ").replaceAll("_", " ").toLowerCase()}.</div>}
          <button className="imsg-meta mt-2 border-0 bg-transparent p-0 text-[12px] underline" onClick={() => setTech((t) => !t)} aria-expanded={tech}>
            Technical details
          </button>
          {tech && <pre className="mt-1 overflow-x-auto rounded-lg bg-black/40 p-2 text-[12px]">{JSON.stringify({ reason: m.reasonCode, ...(m.why?.technical ?? {}), runOut: m.why?.runOutDates, confidence: m.why?.confidence }, null, 2)}</pre>}
        </div>
      )}
    </div>
  );
}

const statusText: Record<string, string> = { delivered: "Delivered", sent: "Sent", failed: "Failed", held: "On hold", pending_approval: "Waiting for approval", queued: "Queued", skipped: "Not sent", cancelled: "Cancelled", received: "", needs_person: "Needs a person", resolved: "Resolved" };

// iOS Messages look: our texts are blue on the right, the customer's replies grey on the left
export function MessageThread({ messages }: { messages: MessageDTO[] }) {
  if (!messages.length) return <div className="imsg rounded-2xl py-8 text-center text-[14px]"><span className="imsg-meta">No messages yet.</span></div>;
  return (
    <ol className="imsg m-0 flex list-none overflow-hidden flex-col gap-3 rounded-2xl px-4 py-5">
      {messages.map((m) => {
        const out = m.direction === "out";
        return (
          <li key={m.id} className={`flex flex-col ${out ? "items-end" : "items-start"}`}>
            <div className={`imsg-bubble ${out ? "out" : "in"} ${m.status === "pending_approval" ? "pending" : ""} max-w-[78%] px-3.5 py-2 text-[15px] leading-snug`}>
              {m.body || <span className="opacity-70">(text is composed when it goes out)</span>}
            </div>
            <div className={`imsg-meta mt-1 flex flex-wrap items-center gap-2 px-1 text-[12px] ${out ? "justify-end" : ""}`}>
              <span className="tnum">{fmtDateTime(m.at)}</span>
              {statusText[m.status] && out && <span>· {statusText[m.status]}</span>}
              {m.status === "needs_person" && <span className="chip plum">Needs a person</span>}
            </div>
            {out && <Why m={m} />}
          </li>
        );
      })}
    </ol>
  );
}
