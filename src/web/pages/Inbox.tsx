import { NavArrowDown } from "iconoir-react";
import { useState } from "react";
import { dayFromISO } from "../../shared/dates.ts";
import type { MessageDTO } from "../../shared/types.ts";
import type { TraceCode } from "../../engine/decision.ts";
import { checkSentence } from "../../engine/explain.ts";
import { post, toast, useApi, useLive } from "../api.tsx";
import { Card, Empty, PageTitle, Tabs } from "../components/ui.tsx";
import { fmtDateTime, nf, relativeTime } from "../format.ts";
import { go, href } from "../router.ts";

type Tab = "needs" | "approvals" | "all";

interface Needs {
  items: Array<{ messageId: number; customerId: string; name: string; text: string; at: number; reason: string }>;
  total: number;
}
interface Approvals {
  items: Array<MessageDTO & { customerName: string }>;
  total: number;
  offers: Array<{ id: number; name: string; typeLabel: string; discountPct: number; budget: number; audienceSize: number }>;
}
interface AllMsgs {
  items: MessageDTO[];
  total: number;
  page: number;
}

const act = async (customerId: string, payload: Record<string, unknown>, ok: string) => {
  const r = await post<{ ok: boolean; error?: string }>(`/api/customers/${customerId}/actions`, payload);
  toast(r.ok ? ok : (r.error ?? "That didn't work"), { tone: r.ok ? "info" : "error" });
};

const HELP: Record<Tab, string> = {
  needs: "Customers wrote something the texts can't handle on their own. Reply, or take an action, then mark it resolved.",
  approvals: "Changes the system wants to make that need a yes from you first. Approve to send, or hold to keep things as they are.",
  all: "Every text sent and received, newest first.",
};

function NeedsRow({ n, now }: { n: Needs["items"][number]; now: number }) {
  const [reply, setReply] = useState("");
  const [holdUntil, setHoldUntil] = useState("");
  const [open, setOpen] = useState<"reply" | "hold" | null>(null);
  const [more, setMore] = useState(false);
  return (
    <li className="border-b border-line px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <a className="text-[15px] font-semibold text-link" href={href(`/customers/${n.customerId}`)}>
              {n.name}
            </a>
            <span className="chip plum">{n.reason}</span>
            <span className="text-[13px] text-muted">{relativeTime(n.at, now)}</span>
          </div>
          <div className="mt-1 text-[15px]">“{n.text}”</div>
        </div>
        <div className="flex shrink-0 items-start gap-2">
          <button className="btn primary" onClick={() => setOpen(open === "reply" ? null : "reply")}>Reply</button>
          <button className="btn" onClick={() => act(n.customerId, { action: "resolve", messageId: n.messageId }, "Marked resolved")} title="Nothing more to do: take it off the list">
            Resolve
          </button>
          <div className="relative" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMore(false)}>
            <button className="btn" aria-haspopup="menu" aria-expanded={more} onClick={() => setMore(!more)}>
              More <NavArrowDown width={14} height={14} aria-hidden />
            </button>
            {more && (
              <div role="menu" className="card absolute right-0 top-10 z-30 w-56 p-1 shadow-lg">
                <button role="menuitem" className="block w-full rounded-lg border-0 bg-transparent px-3 py-2 text-left text-[14px] hover:bg-[var(--hover)]" onClick={() => (setOpen("hold"), setMore(false))}>
                  Hold delivery until…
                </button>
                <button role="menuitem" className="block w-full rounded-lg border-0 bg-transparent px-3 py-2 text-left text-[14px] hover:bg-[var(--hover)]" onClick={() => (act(n.customerId, { action: "pause", days: 28 }, "Paused for four weeks"), setMore(false))}>
                  Pause for 4 weeks
                </button>
                <a role="menuitem" className="block rounded-lg px-3 py-2 text-[14px] text-ink no-underline hover:bg-[var(--hover)]" href={href(`/customers/${n.customerId}`)}>
                  Move delivery (opens profile)
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
      {open === "reply" && (
        <div className="mt-2 flex gap-2">
          <input aria-label={`Reply to ${n.name}`} className="min-w-0 flex-1" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Type a reply (sent as Classic Cup)" />
          <button className="btn primary" disabled={!reply.trim()} onClick={async () => { await act(n.customerId, { action: "reply", body: reply, messageId: n.messageId }, "Reply sent"); setReply(""); setOpen(null); }}>
            Send
          </button>
        </div>
      )}
      {open === "hold" && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[14px] text-muted">Hold the delivery until</span>
          <input type="date" aria-label="Hold until" value={holdUntil} onChange={(e) => setHoldUntil(e.target.value)} />
          <button className="btn primary" disabled={!holdUntil} onClick={async () => { await act(n.customerId, { action: "hold", until: dayFromISO(holdUntil), messageId: n.messageId }, "Held, and the customer has been told"); setOpen(null); }}>
            Confirm
          </button>
        </div>
      )}
    </li>
  );
}

export function Inbox({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const needs = useApi<Needs>(tab === "needs" ? "/api/inbox?tab=needs" : null);
  const approvals = useApi<Approvals>(tab === "approvals" ? "/api/inbox?tab=approvals" : null);
  const all = useApi<AllMsgs>(tab === "all" ? `/api/inbox?tab=all&page=${page}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}` : null);
  const counts = useApi<{ needs: number; approvals: number }>("/api/inbox/counts", ["message", "queue", "offer"]).data;
  const { now: liveNow } = useLive();
  const now = liveNow ?? Date.now();
  return (
    <div>
      <PageTitle sub="Everything waiting on a person, in one place.">Inbox</PageTitle>
      <Card pad={false}>
        <div className="px-4 pt-2">
          <Tabs
            value={tab}
            onChange={(t) => (setTab(t), go(`/inbox?tab=${t}`))}
            tabs={[
              { id: "needs", label: `Needs a person${counts ? ` (${counts.needs})` : ""}` },
              { id: "approvals", label: `Approvals${counts ? ` (${counts.approvals})` : ""}` },
              { id: "all", label: "All messages" },
            ]}
          />
          <p className="mb-2 mt-0 text-[13px] text-muted">{HELP[tab]}</p>
        </div>

        {tab === "needs" &&
          (!needs.data ? (
            <Empty>Loading…</Empty>
          ) : needs.data.items.length === 0 ? (
            <Empty>Nobody is waiting for a reply.</Empty>
          ) : (
            <ul className="m-0 list-none p-0">
              {needs.data.items.map((n) => (
                <NeedsRow key={n.messageId} n={n} now={now} />
              ))}
            </ul>
          ))}

        {tab === "approvals" &&
          (!approvals.data ? (
            <Empty>Loading…</Empty>
          ) : approvals.data.items.length === 0 && approvals.data.offers.length === 0 ? (
            <Empty>Nothing needs approving.</Empty>
          ) : (
            <ul className="m-0 list-none p-0">
              {approvals.data.offers.map((o) => (
                <li key={`o${o.id}`} className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[15px] font-semibold">{o.name}</span>
                      <span className="chip plum">Discount offer · {o.discountPct}% off</span>
                    </div>
                    <div className="mt-1 text-[14px] text-muted">
                      {o.typeLabel} · budget {o.budget ? `$${nf(o.budget)}` : "none set"} · needs manager approval before it can be scheduled
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <a className="btn no-underline" href={href(`/offers/${o.id}`)}>Review</a>
                    <button className="btn primary" onClick={async () => { const r = await post<{ ok: boolean; error?: string }>(`/api/offers/${o.id}/approve`); toast(r.ok ? "Offer approved and scheduled" : (r.error ?? "Could not approve"), { tone: r.ok ? "info" : "error" }); }}>Approve</button>
                  </div>
                </li>
              ))}
              {approvals.data.items.map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <a className="text-[15px] font-semibold text-link" href={href(`/customers/${m.customerId}`)}>
                        {m.customerName}
                      </a>
                      <span className="chip plum">{m.reasonChip ?? "Waiting for approval"}</span>
                    </div>
                    <div className="mt-1 text-[15px]">“{m.body}”</div>
                    {m.why?.blockedBy && m.why.blockedBy.length > 0 && <div className="mt-1 text-[13px] text-muted">Needs your OK because: {m.why.blockedBy.map((code) => checkSentence(code as TraceCode, false)).join("; ")}.</div>}
                    {m.whySentence && (
                      <details className="mt-1 text-[13px] text-muted">
                        <summary className="cursor-pointer select-none text-link">Why this move</summary>
                        <div className="mt-1">{m.whySentence}</div>
                      </details>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button className="btn" title="Don't send: keep the current delivery" onClick={async () => { const r = await post<{ ok: boolean; error?: string }>(`/api/messages/${m.id}/hold`); toast(r.ok ? "Held: nothing was sent" : (r.error ?? "Could not hold"), { tone: r.ok ? "info" : "error" }); }}>Hold</button>
                    <button className="btn primary" onClick={async () => { const r = await post<{ ok: boolean; error?: string }>(`/api/messages/${m.id}/approve`); toast(r.ok ? "Approved" : (r.error ?? "Could not approve"), { tone: r.ok ? "info" : "error" }); }}>Approve</button>
                  </div>
                </li>
              ))}
            </ul>
          ))}

        {tab === "all" && (
          <>
            <div className="border-b border-line p-3">
              <input aria-label="Search messages" placeholder="Search every text by customer or words" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} className="w-[360px]" />
            </div>
            {!all.data ? (
              <Empty>Loading…</Empty>
            ) : all.data.items.length === 0 ? (
              <Empty>No messages match.</Empty>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Customer</th>
                    <th></th>
                    <th>Text</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {all.data.items.map((m) => (
                    <tr key={m.id} className="row">
                      <td className="tnum whitespace-nowrap text-[13px]">{fmtDateTime(m.at)}</td>
                      <td>
                        <a className="font-medium text-link" href={href(`/customers/${m.customerId}`)}>
                          {m.customerName}
                        </a>
                      </td>
                      <td className="text-[13px] text-muted">{m.direction === "in" ? "from customer" : "to customer"}</td>
                      <td className="max-w-[420px] truncate" title={m.body}>
                        {m.body}
                      </td>
                      <td title={m.whySentence ?? ""}>{m.reasonChip ? <span className="chip">{m.reasonChip}</span> : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {all.data && all.data.total > 50 && (
              <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[14px]">
                <span className="text-muted">{nf(all.data.total)} messages</span>
                <span className="flex gap-2">
                  <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Newer</button>
                  <button className="btn" disabled={page * 50 >= all.data.total} onClick={() => setPage(page + 1)}>Older →</button>
                </span>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
