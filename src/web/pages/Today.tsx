import { useState } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import type { CustomerListItem } from "../../shared/types.ts";
import { post, useApi } from "../api.tsx";
import { Card, Delta, Empty, HowSure, Status, Tabs } from "../components/ui.tsx";
import { fmtDay, fmtMonthDay, fmtTime, nf, pct, range, relativeTime } from "../format.ts";
import { href } from "../router.ts";

interface TodayDTO {
  now: number;
  today: number;
  kpis: {
    active: { value: number; prev: number };
    deliveriesThisWeek: { value: number; prev: number; sparkline: number[] };
    checkInsToday: { value: number; prev: number };
    waitingForPerson: { value: number; prev: number };
    freshness: { total: number; counts: { best: number; peak: number; past_peak: number; late: number }; atPeakShare: number; peakEndDays: number };
  };
  runningOutSoon: { items: CustomerListItem[]; total: number };
  goingOut: { items: Array<{ messageId: number; customerId: string; name: string; at: number; kind: string; reasonChip: string; body: string }>; total: number };
  needsPerson: { items: Array<{ messageId: number; customerId: string; name: string; text: string; at: number; reason: string }>; total: number };
  approvals: { items: Array<{ id: number; customerId: string; customerName: string; kind: string; body: string; reasonChip: string | null; whySentence: string | null }>; total: number };
}

function Kpi({ label, value, now, prev, good = "up", href: to, children }: { label: string; value: number; now: number; prev: number; good?: "up" | "down"; href: string; children?: React.ReactNode }) {
  return (
    <a href={to} className="card block h-[96px] overflow-hidden px-4 py-2.5 text-ink no-underline hover:border-espresso" aria-label={`${label}: ${nf(value)}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[13px] font-medium text-muted">{label}</div>
          <div className="tnum text-[36px] font-semibold leading-[1.05] text-espresso">{nf(value)}</div>
        </div>
        {children}
      </div>
      <Delta now={now} prev={prev} good={good} />
    </a>
  );
}

export function Today() {
  const { data } = useApi<TodayDTO>("/api/today");
  const [tab, setTab] = useState<"soon" | "out">("soon");
  if (!data) return <div className="text-muted">Loading…</div>;
  const { kpis } = data;
  const spark = kpis.deliveriesThisWeek.sparkline.map((v, i) => ({ i, v }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-5 gap-4">
        <Kpi label="Active subscribers" value={kpis.active.value} now={kpis.active.value} prev={kpis.active.prev} href={href("/customers")} />
        <Kpi label="Deliveries this week" value={kpis.deliveriesThisWeek.value} now={kpis.deliveriesThisWeek.value} prev={kpis.deliveriesThisWeek.prev} href={href("/outlook")}>
          <div className="h-[44px] w-[96px]" title="Next 6 weeks (roast outlook)">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={spark} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <Area type="monotone" dataKey="v" stroke="#F16A21" strokeWidth={2} fill="#F16A21" fillOpacity={0.15} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Kpi>
        <Kpi label="Check-ins going out today" value={kpis.checkInsToday.value} now={kpis.checkInsToday.value} prev={kpis.checkInsToday.prev} href={href("/today")} />
        <Kpi label="Waiting for a person" value={kpis.waitingForPerson.value} now={kpis.waitingForPerson.value} prev={kpis.waitingForPerson.prev} good="down" href={href("/inbox")} />
        <a
          href={href("/customers")}
          className="card block h-[96px] overflow-hidden px-4 py-2.5 text-ink no-underline hover:border-espresso"
          title={`Of ${nf(kpis.freshness.total)} bags arriving in the next 4 weeks: ${nf(kpis.freshness.counts.best + kpis.freshness.counts.peak)} opened within ${kpis.freshness.peakEndDays} days of roasting, ${nf(kpis.freshness.counts.past_peak)} past peak, ${nf(kpis.freshness.counts.late)} arriving after the customer runs out (model median)`}
        >
          <div className="text-[13px] font-medium text-muted">Next bags opened at peak</div>
          <div className="tnum text-[36px] font-semibold leading-[1.05] text-espresso">{pct(kpis.freshness.atPeakShare)}</div>
          <div className="truncate text-[13px] text-muted">
            {nf(kpis.freshness.counts.past_peak)} past peak · {nf(kpis.freshness.counts.late)} late
          </div>
        </a>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <Card pad={false} className="col-span-8 overflow-hidden">
          <div className="px-4 pt-2">
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { id: "soon", label: `Running out soon (${nf(data.runningOutSoon.total)})` },
                { id: "out", label: `Going out today (${nf(data.goingOut.total)})` },
              ]}
            />
          </div>
          <div className="max-h-[calc(100vh-340px)] min-h-[260px] overflow-y-auto">
            {tab === "soon" ? (
              data.runningOutSoon.items.length === 0 ? (
                <Empty>Nobody is likely to run out in the next 14 days.</Empty>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Next delivery</th>
                      <th>Likely runs out</th>
                      <th>How sure</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.runningOutSoon.items.map((c) => (
                      <tr key={c.id} className="row">
                        <td>
                          <a className="font-medium text-orange-ink" href={href(`/customers/${c.id}`)}>
                            {c.name}
                          </a>
                        </td>
                        <td className="tnum">{c.nextDelivery ? fmtDay(c.nextDelivery) : "–"}</td>
                        <td>
                          {c.runOut ? (
                            <>
                              <div className="tnum font-medium">around {fmtMonthDay(c.runOut.mid)}</div>
                              {c.runOut.lo !== c.runOut.hi && <div className="tnum text-[13px] text-muted">{range(c.runOut.lo, c.runOut.hi)}</div>}
                            </>
                          ) : (
                            "–"
                          )}
                        </td>
                        <td>
                          <HowSure value={c.confidence} />
                        </td>
                        <td>
                          <Status value={c.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            ) : data.goingOut.items.length === 0 ? (
              <Empty>Nothing is queued for the rest of today.</Empty>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Customer</th>
                    <th>Why it's going out</th>
                    <th>Text</th>
                  </tr>
                </thead>
                <tbody>
                  {data.goingOut.items.map((m) => (
                    <tr key={m.messageId} className="row">
                      <td className="tnum whitespace-nowrap">{fmtTime(m.at)}</td>
                      <td>
                        <a className="font-medium text-orange-ink" href={href(`/customers/${m.customerId}`)}>
                          {m.name}
                        </a>
                      </td>
                      <td>
                        <span className={`chip ${m.kind === "reminder" && m.reasonChip.includes("offer") ? "plum" : ""}`}>{m.reasonChip}</span>
                      </td>
                      <td className="max-w-[360px] truncate text-[13px] text-muted" title={m.body}>
                        {m.body}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {((tab === "soon" && data.runningOutSoon.total > data.runningOutSoon.items.length) || (tab === "out" && data.goingOut.total > data.goingOut.items.length)) && (
            <div className="border-t border-line px-4 py-2 text-[13px] text-muted">
              Showing the first {tab === "soon" ? data.runningOutSoon.items.length : data.goingOut.items.length} of {nf(tab === "soon" ? data.runningOutSoon.total : data.goingOut.total)}.{" "}
              <a href={href("/customers")} className="text-orange-ink">
                All customers
              </a>
            </div>
          )}
        </Card>

        <div className="col-span-4 space-y-4">
          <Card pad={false}>
            <div className="flex items-center justify-between px-4 pb-1 pt-3">
              <h2 className="m-0 text-[16px] font-semibold text-espresso">Needs a person</h2>
              <span className="chip plum tnum" aria-label={`${data.needsPerson.total} waiting`}>
                {data.needsPerson.total}
              </span>
            </div>
            {data.needsPerson.items.length === 0 ? (
              <Empty>Nobody is waiting for a reply.</Empty>
            ) : (
              <ul className="m-0 list-none p-0">
                {data.needsPerson.items.map((n) => (
                  <li key={n.messageId} className="border-t border-line px-4 py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <a className="text-[14px] font-medium text-orange-ink" href={href(`/customers/${n.customerId}`)}>
                        {n.name}
                      </a>
                      <span className="text-[12px] text-muted">{relativeTime(n.at, data.now)}</span>
                    </div>
                    <div className="line-clamp-2 text-[13px] text-ink">“{n.text}”</div>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-line px-4 py-2 text-[13px]">
              <a href={href("/inbox")} className="text-orange-ink">
                View all in Inbox
              </a>
            </div>
          </Card>

          <Card pad={false}>
            <div className="flex items-center justify-between px-4 pb-1 pt-3">
              <h2 className="m-0 text-[16px] font-semibold text-espresso">Waiting for approval</h2>
              <span className="chip tnum">{data.approvals.total}</span>
            </div>
            {data.approvals.items.length === 0 ? (
              <Empty>Nothing needs approving.</Empty>
            ) : (
              <ul className="m-0 list-none p-0">
                {data.approvals.items.map((a) => (
                  <li key={a.id} className="border-t border-line px-4 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <a className="text-[14px] font-medium text-orange-ink" href={href(`/customers/${a.customerId}`)}>
                        {a.customerName}
                      </a>
                      <button className="btn" onClick={() => post(`/api/messages/${a.id}/approve`)}>
                        Approve
                      </button>
                    </div>
                    <div className="text-[13px] text-muted">{a.reasonChip ?? (a.kind === "sooner" ? "Sooner delivery" : "Move proposed")}</div>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-line px-4 py-2 text-[13px]">
              <a href={href("/inbox?tab=approvals")} className="text-orange-ink">
                View all approvals
              </a>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
