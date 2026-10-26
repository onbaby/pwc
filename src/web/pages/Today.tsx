import { ChatLines, DeliveryTruck, Group, Leaf, SendDiagonal, StatsUpSquare } from "iconoir-react";
import { useState } from "react";
import type { CustomerListItem } from "../../shared/types.ts";
import { post, useApi } from "../api.tsx";
import { ACCENT, BarTrend, DeltaBadge, Eyebrow, HalfGauge, INK, Meter, StatTile, TRACK } from "../components/analytics.tsx";
import { Card, Empty, HowSure, Status, Tabs } from "../components/ui.tsx";
import { fmtDay, fmtMonthDay, fmtTime, nf, pct, range, relativeTime } from "../format.ts";
import { go, href } from "../router.ts";

interface TodayDTO {
  now: number;
  today: number;
  kpis: {
    active: { value: number; prev: number };
    deliveriesThisWeek: { value: number; prev: number; sparkline: number[]; weeks: number[] };
    checkInsToday: { value: number; prev: number };
    waitingForPerson: { value: number; prev: number };
    freshness: { total: number; counts: { best: number; peak: number; past_peak: number; late: number }; atPeakShare: number; peakEndDays: number };
  };
  runningOutSoon: { items: CustomerListItem[]; total: number };
  goingOut: { items: Array<{ messageId: number; customerId: string; name: string; at: number; kind: string; reasonChip: string; body: string }>; total: number };
  needsPerson: { items: Array<{ messageId: number; customerId: string; name: string; text: string; at: number; reason: string }>; total: number };
  approvals: { items: Array<{ id: number; customerId: string; customerName: string; kind: string; body: string; reasonChip: string | null; whySentence: string | null }>; total: number };
}

export function Today() {
  const { data } = useApi<TodayDTO>("/api/today");
  const [tab, setTab] = useState<"soon" | "out">("soon");
  if (!data) return <div className="text-muted">Loading…</div>;
  const { kpis } = data;
  const fresh = kpis.freshness;
  const active = Math.max(1, kpis.active.value);
  const weeks = kpis.deliveriesThisWeek.sparkline.map((v, i) => ({ label: kpis.deliveriesThisWeek.weeks[i] !== undefined ? fmtMonthDay(kpis.deliveriesThisWeek.weeks[i]!) : `Wk ${i + 1}`, value: Math.round(v) }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-8 flex flex-col">
          <h1 className="m-0 text-[44px] font-normal leading-[1.1] tracking-tight text-strong">Today's subscriptions</h1>
          <p className="mb-5 mt-2 text-[15px] text-muted">
            {pct(fresh.atPeakShare)} of the next bags will be <span className="font-medium text-strong">opened at peak freshness</span>
          </p>
          <div className="mb-6 flex flex-wrap gap-2">
            <a className="pill" href={href("/inbox")}>
              <span className="dot bg-accent" />
              {nf(kpis.waitingForPerson.value)} waiting for a person
            </a>
            <a className="pill" href={href("/inbox?tab=approvals")}>
              <span className="dot bg-strong" />
              {nf(data.approvals.total)} waiting for approval
            </a>
            <a className="pill" href={href("/customers")}>
              <span className="dot bg-[#B9AA9D]" />
              {nf(data.runningOutSoon.total)} running out soon
            </a>
          </div>
          <div className="mt-auto grid grid-cols-4 gap-3">
            <StatTile icon={Group} label="Active" value={nf(kpis.active.value)} delta={<DeltaBadge now={kpis.active.value} prev={kpis.active.prev} />} href={href("/customers")} title="Active subscribers" meter={<Meter value={kpis.active.prev ? Math.min(1, kpis.active.prev / active) : 1} tone="ink" label={`${nf(kpis.active.prev)} last week`} />} />
            <StatTile icon={DeliveryTruck} label="Deliveries" value={nf(kpis.deliveriesThisWeek.value)} delta={<DeltaBadge now={kpis.deliveriesThisWeek.value} prev={kpis.deliveriesThisWeek.prev} />} href={href("/outlook")} title="Deliveries this week" meter={<Meter value={kpis.deliveriesThisWeek.value / active} label={`${pct(kpis.deliveriesThisWeek.value / active)} of subscribers`} />} />
            <StatTile icon={SendDiagonal} label="Check-ins" value={nf(kpis.checkInsToday.value)} delta={<DeltaBadge now={kpis.checkInsToday.value} prev={kpis.checkInsToday.prev} />} title="Check-ins going out today" meter={<Meter value={kpis.checkInsToday.value / active} tone="ink" label={`${pct(kpis.checkInsToday.value / active, 1)} of subscribers`} />} />
            <StatTile icon={ChatLines} label="Needs reply" value={nf(kpis.waitingForPerson.value)} delta={<DeltaBadge now={kpis.waitingForPerson.value} prev={kpis.waitingForPerson.prev} good="down" />} href={href("/inbox")} title="Replies waiting for a person" meter={<Meter value={kpis.waitingForPerson.prev ? Math.min(1, kpis.waitingForPerson.value / Math.max(kpis.waitingForPerson.value, kpis.waitingForPerson.prev)) : 1} tone="ink" label={`${nf(kpis.waitingForPerson.prev)} a week ago`} />} />
          </div>
        </div>
        <Card className="col-span-4 flex flex-col">
          <Eyebrow icon={Leaf}>Bag freshness</Eyebrow>
          <div className="mb-3 mt-1 text-[13px] text-muted">Bags arriving in the next 4 weeks, when the customer opens them</div>
          <div className="mt-auto">
            <HalfGauge
              segments={[
                { label: "Past peak", value: fresh.counts.past_peak, color: INK },
                { label: "Late", value: fresh.counts.late, color: TRACK },
                { label: "At peak", value: fresh.counts.best + fresh.counts.peak, color: ACCENT },
              ]}
              center={pct(fresh.atPeakShare)}
              caption={`within ${fresh.peakEndDays} days of roasting`}
            />
          </div>
        </Card>
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
                      <tr key={c.id} className="row cursor-pointer" onClick={(e) => !(e.target as HTMLElement).closest("a,button") && go(`/customers/${c.id}`)}>
                        <td>
                          <a className="font-medium text-link" href={href(`/customers/${c.id}`)}>
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
                    <tr key={m.messageId} className="row cursor-pointer" onClick={(e) => !(e.target as HTMLElement).closest("a,button") && go(`/customers/${m.customerId}`)}>
                      <td className="tnum whitespace-nowrap">{fmtTime(m.at)}</td>
                      <td>
                        <a className="font-medium text-link" href={href(`/customers/${m.customerId}`)}>
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
              <a href={href("/customers")} className="text-link">
                All customers
              </a>
            </div>
          )}
        </Card>

        <div className="col-span-4 space-y-4">
          <Card>
            <Eyebrow
              icon={StatsUpSquare}
              right={
                <a href={href("/outlook")} className="text-[13px] text-link">
                  Roast outlook
                </a>
              }
            >
              Deliveries ahead
            </Eyebrow>
            <div className="mt-2 text-[13px] text-muted">Expected bags per week (model median)</div>
            <BarTrend data={weeks} highlight={0} height={150} unit=" bags" />
          </Card>
          <Card pad={false}>
            <div className="flex items-center justify-between px-4 pb-1 pt-3">
              <h2 className="eyebrow">Needs a person</h2>
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
                      <a className="text-[14px] font-medium text-link" href={href(`/customers/${n.customerId}`)}>
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
              <a href={href("/inbox")} className="text-link">
                View all in Inbox
              </a>
            </div>
          </Card>

          <Card pad={false}>
            <div className="flex items-center justify-between px-4 pb-1 pt-3">
              <h2 className="eyebrow">Waiting for approval</h2>
              <span className="chip tnum">{data.approvals.total}</span>
            </div>
            {data.approvals.items.length === 0 ? (
              <Empty>Nothing needs approving.</Empty>
            ) : (
              <ul className="m-0 list-none p-0">
                {data.approvals.items.map((a) => (
                  <li key={a.id} className="border-t border-line px-4 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <a className="text-[14px] font-medium text-link" href={href(`/customers/${a.customerId}`)}>
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
              <a href={href("/inbox?tab=approvals")} className="text-link">
                View all approvals
              </a>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
