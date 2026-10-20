import { useState } from "react";
import type { MessageDTO } from "../../shared/types.ts";
import { fmtDateTime } from "../../shared/dates.ts";

function Why({ m }: { m: MessageDTO }) {
  const [open, setOpen] = useState(false);
  const [tech, setTech] = useState(false);
  if (!m.whySentence) return null;
  return (
    <div className="mt-1">
      <button className="border-0 bg-transparent p-0 text-[13px] font-medium text-orange-ink underline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "Hide" : "Why we sent this"}
      </button>
      {open && (
        <div className="mt-1 rounded-lg bg-cream p-3 text-[13px] leading-relaxed text-ink">
          <div>{m.whySentence}</div>
          {m.why?.blockedBy && m.why.blockedBy.length > 0 && <div className="mt-1 text-muted">Held for review because: {m.why.blockedBy.join(", ").replaceAll("_", " ").toLowerCase()}.</div>}
          <button className="mt-2 border-0 bg-transparent p-0 text-[12px] text-muted underline" onClick={() => setTech((t) => !t)} aria-expanded={tech}>
            Technical details
          </button>
          {tech && <pre className="mt-1 overflow-x-auto rounded bg-white p-2 text-[12px]">{JSON.stringify({ reason: m.reasonCode, ...(m.why?.technical ?? {}), runOut: m.why?.runOutDates, confidence: m.why?.confidence }, null, 2)}</pre>}
        </div>
      )}
    </div>
  );
}

const statusText: Record<string, string> = { delivered: "Delivered", sent: "Sent", failed: "Failed", held: "On hold", pending_approval: "Waiting for approval", queued: "Queued", skipped: "Not sent", cancelled: "Cancelled", received: "", needs_person: "Needs a person", resolved: "Resolved" };

export function MessageThread({ messages }: { messages: MessageDTO[] }) {
  if (!messages.length) return <div className="py-8 text-center text-[14px] text-muted">No messages yet.</div>;
  return (
    <ol className="m-0 flex list-none flex-col gap-3 p-0">
      {messages.map((m) => (
        <li key={m.id} className={`flex flex-col ${m.direction === "in" ? "items-end" : "items-start"}`}>
          <div className={`max-w-[78%] rounded-2xl border px-3.5 py-2 text-[15px] leading-snug ${m.direction === "in" ? "border-[#E3D3C8] bg-[#F4E9E1]" : m.status === "pending_approval" ? "border-dashed border-plum bg-plum-tint" : "border-line bg-white"}`}>
            {m.body || <span className="text-muted">(text is composed when it goes out)</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">
            {m.reasonChip && m.direction === "out" && <span className={`chip ${m.status === "pending_approval" ? "plum" : ""}`}>{m.reasonChip}</span>}
            <span className="tnum">{fmtDateTime(m.at)}</span>
            {statusText[m.status] && m.direction === "out" && <span>· {statusText[m.status]}</span>}
            {m.status === "needs_person" && <span className="chip plum">Needs a person</span>}
          </div>
          {m.direction === "out" && <Why m={m} />}
        </li>
      ))}
    </ol>
  );
}
