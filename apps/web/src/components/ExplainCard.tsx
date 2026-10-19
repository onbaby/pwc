import type { Thread } from "@rot/contracts";

export function ExplainCard({ thread }: { thread: Thread }) {
  const e = thread.explanation;
  if (!e) return null;
  const rows: Array<[string, string, string?]> = [
    ["Starting point", e.startingPoint.text, e.startingPoint.tag],
    [`${thread.name}'s own evidence`, e.evidence.text],
    ["What changes it", e.whatChangesIt.text],
  ];
  return (
    <div className="flex h-full flex-col justify-center gap-4">
      <div className="text-[1.1rem] font-semibold">Why {thread.name}'s date moved</div>
      {rows.map(([h, t, tag]) => (
        <div key={h} className="card p-4">
          <div className="text-[0.72rem] font-bold uppercase tracking-wide text-muted">{h}</div>
          <div className="mt-1 text-[1.1rem] leading-snug">{t}</div>
          {tag && <div className="mt-1 inline-block rounded-full bg-[#eceef2] px-2 py-0.5 text-[0.68rem] font-semibold text-muted">{tag}</div>}
        </div>
      ))}
      {thread.forecast && <div className="text-[0.85rem] text-muted">{thread.forecast.note}</div>}
    </div>
  );
}
