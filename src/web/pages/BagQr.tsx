import { useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { useApi } from "../api.tsx";
import { BagLabel, downloadSvg } from "../components/BagLabel.tsx";
import { Card, Empty, PageTitle, SectionTitle } from "../components/ui.tsx";
import { fmtDay, fmtMonthDay, nf, pct, relativeTime } from "../format.ts";
import { href } from "../router.ts";

interface QrDTO {
  now: number;
  pilot: { from: number; weeks: number; accounts: number };
  totals: { bags: number; scans: number; signups: number; scanRate: number; signupRate: number; stillSubscribed: number; medianShelfAge: number | null };
  freshnessAtScan: { best: number; peak: number; past_peak: number };
  weeks: Array<{ weekOf: number; scans: number; signups: number }>;
  accounts: Array<{ id: string; name: string; city: string; kind: string; bags: number; scans: number; signups: number; medianShelfAge: number | null; pastPeakShare: number | null }>;
  latestLots: Array<{ code: string; roast: string; roastDate: number; account: string; bags: number }>;
  recentSignups: Array<{ customerId: string; name: string; at: number; lot: string; ageAtScan: number; status: string }>;
}

const INK = "#643A2B";
const ACCENT = "#F16A21";
const TICK = { fontSize: 12, fill: "#6B5A50" };

export const bagUrl = (code: string): string => `${window.location.origin}/#/q/${code}`;

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card h-[96px] px-4 py-2.5">
      <div className="text-[13px] font-medium text-muted">{label}</div>
      <div className="tnum text-[36px] font-semibold leading-[1.05] text-strong">{value}</div>
      <div className="text-[13px] text-muted">{sub}</div>
    </div>
  );
}

export function BagQrPage() {
  const { data: d } = useApi<QrDTO>("/api/qr", ["queue", "clock"]);
  const [lot, setLot] = useState<string | null>(null);
  const label = useRef<SVGSVGElement>(null);
  if (!d) return <Empty>Loading…</Empty>;
  const t = d.totals;
  const shown = d.latestLots.find((l) => l.code === lot) ?? d.latestLots[0];
  const scanned = d.freshnessAtScan.best + d.freshnessAtScan.peak + d.freshnessAtScan.past_peak;
  const weeks = d.weeks.map((w) => ({ week: fmtMonthDay(w.weekOf), scans: w.scans, signups: w.signups }));
  return (
    <div>
      <PageTitle sub={`Pilot since ${fmtDay(d.pilot.from)} on bags shipped to ${d.pilot.accounts} grocery accounts. A QR code on every retail bag opens that bag's roast date and a subscription roasted to order.`}>Bag QR: grocery buyers to subscribers</PageTitle>
      <div className="mb-4 grid grid-cols-4 gap-4">
        <Stat label="Bags shipped with a QR code" value={nf(t.bags)} sub={`over ${d.pilot.weeks} weeks`} />
        <Stat label="Scans" value={nf(t.scans)} sub={`${pct(t.scanRate, 1)} of bags`} />
        <Stat label="Subscriptions started" value={nf(t.signups)} sub={`${pct(t.signupRate, 1)} of scans · ${nf(t.stillSubscribed)} still subscribed`} />
        <Stat label="Median bag age at scan" value={t.medianShelfAge === null ? "–" : `${nf(t.medianShelfAge)} days`} sub="from roasting to a shopper's scan" />
      </div>

      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-8 space-y-5">
          <Card>
            <SectionTitle>Scans and new subscriptions by week</SectionTitle>
            {weeks.length === 0 ? (
              <Empty>No bags have shipped with a QR code yet.</Empty>
            ) : (
              <div className="h-[220px]" role="img" aria-label="Weekly QR scans and subscriptions started">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeks} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="#E9DFD6" vertical={false} />
                    <XAxis dataKey="week" tick={TICK} axisLine={{ stroke: "#E9DFD6" }} tickLine={false} />
                    <YAxis tick={TICK} axisLine={false} tickLine={false} width={40} tickCount={5} />
                    <Bar dataKey="scans" name="Scans" fill={INK} fillOpacity={0.6} isAnimationActive={false} />
                    <Bar dataKey="signups" name="Subscriptions started" fill={ACCENT} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="mt-1 flex gap-4 text-[13px] text-muted">
              <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-strong/60 align-middle" />Scans</span>
              <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-accent align-middle" />Subscriptions started</span>
            </div>
          </Card>

          <Card pad={false}>
            <div className="px-4 pb-2 pt-4">
              <SectionTitle>By store</SectionTitle>
              <p className="m-0 -mt-2 text-[13px] text-muted">Every scan says how long the bag sat before someone bought it: the sell-through and freshness signal wholesale never had. Bags past 4 weeks are the ones that hurt the brand.</p>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="text-right">Bags</th>
                  <th className="text-right">Scans</th>
                  <th className="text-right">Subscriptions</th>
                  <th className="text-right">Median age at scan</th>
                  <th className="text-right">Scanned past 4 weeks</th>
                </tr>
              </thead>
              <tbody>
                {d.accounts.map((a) => (
                  <tr key={a.id} className="row">
                    <td>
                      <div className="font-medium">{a.name}</div>
                      <div className="text-[13px] text-muted">{a.city} · {a.kind === "chain" ? "regional chain (EDI)" : "independent (texts a rep)"}</div>
                    </td>
                    <td className="tnum text-right">{nf(a.bags)}</td>
                    <td className="tnum text-right">{nf(a.scans)}</td>
                    <td className="tnum text-right">{nf(a.signups)}</td>
                    <td className="tnum text-right">{a.medianShelfAge === null ? "–" : `${nf(a.medianShelfAge)} days`}</td>
                    <td className="tnum text-right">{a.pastPeakShare === null ? "–" : <span className={a.pastPeakShare > 0.25 ? "font-semibold text-danger" : ""}>{pct(a.pastPeakShare)}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3 text-[13px] text-muted">
              Of {nf(scanned)} scans, {pct(scanned ? d.freshnessAtScan.best / scanned : 0)} were within 2 weeks of roasting, {pct(scanned ? d.freshnessAtScan.peak / scanned : 0)} in weeks 3–4 and {pct(scanned ? d.freshnessAtScan.past_peak / scanned : 0)} past 4 weeks. Sample data: scan and sign-up rates are labelled assumptions until the pilot measures them.
            </div>
          </Card>
        </div>

        <aside className="col-span-4 space-y-5">
          <Card>
            <SectionTitle right={<button className="btn" onClick={() => shown && downloadSvg(label.current, `bag-label-${shown.code}.svg`)}>Download SVG</button>}>Bag label</SectionTitle>
            {!shown ? (
              <Empty>No lots yet.</Empty>
            ) : (
              <>
                <label className="mb-3 block text-[13px]">
                  <span className="mb-1 block text-muted">Lot</span>
                  <select className="w-full" value={shown.code} onChange={(e) => setLot(e.target.value)}>
                    {d.latestLots.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.code} · {l.account} · {l.roast}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex justify-center">
                  <BagLabel ref={label} url={bagUrl(shown.code)} lot={shown.code} roast={shown.roast} roastDate={shown.roastDate} />
                </div>
                <div className="mt-3 text-[13px] text-muted">
                  The code links to this bag's own page:{" "}
                  <a className="break-all text-link" href={href(`/q/${shown.code}`)} target="_blank" rel="noreferrer">
                    {bagUrl(shown.code)}
                  </a>
                  . One page on the existing website: no app, no login.
                </div>
              </>
            )}
          </Card>
          <Card pad={false}>
            <h2 className="m-0 px-4 pb-1 pt-3 text-[16px] font-medium tracking-tight text-strong">Recent subscriptions from a bag</h2>
            {d.recentSignups.length === 0 ? (
              <Empty>None yet.</Empty>
            ) : (
              <ul className="m-0 list-none p-0">
                {d.recentSignups.map((s) => (
                  <li key={s.customerId} className="flex items-baseline justify-between gap-2 border-t border-line px-4 py-2 text-[14px]">
                    <span>
                      <a className="font-medium text-link" href={href(`/customers/${s.customerId}`)}>{s.name}</a>
                      <span className="text-[13px] text-muted"> · bag was {s.ageAtScan} days old{s.status === "CANCELLED" ? " · cancelled" : ""}</span>
                    </span>
                    <span className="shrink-0 text-[12px] text-muted">{relativeTime(s.at, d.now)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
