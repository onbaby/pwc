import { useState } from "react";
import { SOURCES, SOURCE_LABEL } from "../../shared/constants.ts";
import type { CustomerListItem } from "../../shared/types.ts";
import { useApi } from "../api.tsx";
import { Card, Empty, HowSure, PageTitle, Status } from "../components/ui.tsx";
import { fmtDay, fmtMonthDay, nf } from "../format.ts";
import { go, href } from "../router.ts";

interface ListDTO {
  items: CustomerListItem[];
  total: number;
  page: number;
  pageSize: number;
}

const VIEWS: Array<{ id: string; label: string; hint: string }> = [
  { id: "", label: "Everyone", hint: "All active and held subscribers" },
  { id: "attention", label: "Needs attention", hint: "A reply that needs a person, or a move waiting for approval" },
  { id: "running", label: "Running out soon", hint: "Likely to run out within 14 days, with a usable estimate" },
  { id: "approval", label: "Waiting for approval", hint: "A proposed move or offer that needs a yes from staff" },
  { id: "new", label: "New (first 60 days)", hint: "The first deliveries, where pacing is not allowed to act yet" },
];

export function Customers() {
  const [view, setView] = useState("");
  const counts = useApi<Record<string, number>>("/api/customers/views", ["projection", "message", "queue"]).data;
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [consent, setConsent] = useState("");
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page) });
  if (q.trim()) qs.set("q", q.trim());
  if (status) qs.set("status", status);
  if (source) qs.set("source", source);
  if (consent) qs.set("consent", consent);
  if (view) qs.set("view", view);
  const csvHref = `/api/customers?${(() => { const c = new URLSearchParams(qs); c.delete("page"); c.set("format", "csv"); return c.toString(); })()}`;
  const { data } = useApi<ListDTO>(`/api/customers?${qs.toString()}`, ["projection"]);
  const reset = (fn: () => void) => () => {
    fn();
    setPage(1);
  };
  return (
    <div>
      <PageTitle
        sub={data ? `${nf(data.total)} customers · select a row to open their profile` : undefined}
        right={
          <a className="btn no-underline" href={csvHref} download="customers.csv" title="Everything that matches the current view and filters, for a spreadsheet">
            Export CSV
          </a>
        }
      >
        Customers
      </PageTitle>
      <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Saved views">
        {VIEWS.map((v) => (
          <button key={v.id} role="tab" aria-selected={view === v.id} title={v.hint} className={`chip h-9 px-3.5 text-[14px] ${view === v.id ? "ok" : ""}`} onClick={() => (setView(v.id), setPage(1))}>
            {v.label}
            {counts && <span className="tnum ml-1.5 font-semibold">{nf(counts[v.id || "all"] ?? 0)}</span>}
          </button>
        ))}
      </div>
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <input aria-label="Search" placeholder="Search name, city or ID" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} className="w-[280px]" />
          <select aria-label="Status" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
            <option value="">Active and held</option>
            <option value="active">Active (texts on)</option>
            <option value="held">Held or paused</option>
            <option value="texts-off">Texts off (STOP)</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select aria-label="Sign-up source" value={source} onChange={(e) => (setSource(e.target.value), setPage(1))}>
            <option value="">All sources</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
          <select aria-label="Consent" value={consent} onChange={(e) => (setConsent(e.target.value), setPage(1))}>
            <option value="">Any consent</option>
            <option value="offers">Offer consent: yes</option>
            <option value="no-offers">Offer consent: no</option>
            <option value="no-delivery">No delivery-text consent</option>
          </select>
          {(q || status || source || consent || view) && (
            <button className="btn" onClick={reset(() => (setQ(""), setStatus(""), setSource(""), setConsent(""), setView("")))}>
              Clear filters
            </button>
          )}
        </div>
        {!data ? (
          <Empty>Loading…</Empty>
        ) : data.items.length === 0 ? (
          <Empty>No customers match these filters.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Plan</th>
                <th>Next delivery</th>
                <th>Likely runs out</th>
                <th>How sure</th>
                <th>Last reply</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id} className="row cursor-pointer" onClick={(e) => !(e.target as HTMLElement).closest("a,button") && go(`/customers/${c.id}`)}>
                  <td>
                    <a className="font-medium text-link" href={href(`/customers/${c.id}`)}>
                      {c.name}
                    </a>
                    <div className="text-[13px] text-muted">
                      {SOURCE_LABEL[c.source]} · {c.city}
                    </div>
                  </td>
                  <td className="text-[13px]">{c.plan}</td>
                  <td className="tnum">{c.nextDelivery ? fmtDay(c.nextDelivery) : "–"}</td>
                  <td className="tnum">{c.runOut ? `around ${fmtMonthDay(c.runOut.mid)}` : "–"}</td>
                  <td>
                    <HowSure value={c.confidence} />
                  </td>
                  <td className="tnum text-[13px]">{c.lastReply ? `${c.lastReply.weeks} wks · ${fmtMonthDay(c.lastReply.day)}` : "–"}</td>
                  <td>
                    <Status value={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && data.total > data.pageSize && (
          <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[14px]">
            <span className="text-muted">
              {nf((data.page - 1) * data.pageSize + 1)}–{nf(Math.min(data.page * data.pageSize, data.total))} of {nf(data.total)}
            </span>
            <span className="flex gap-2">
              <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                ← Previous
              </button>
              <button className="btn" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>
                Next →
              </button>
            </span>
          </div>
        )}
      </Card>
    </div>
  );
}
