import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { Day } from "../../shared/dates.ts";
import { useApi } from "../api.tsx";
import { Card, Empty, PageTitle, SectionTitle } from "../components/ui.tsx";
import { fmtMonthDay, nf } from "../format.ts";

interface Band {
  p10: number;
  p50: number;
  p90: number;
}
interface Outlook {
  weeks: Array<{ wednesday: Day; deliveries: Band; pounds: Band; poundsTwoBag: Band }>;
  draws: number;
  poundsPerDelivery: number;
  note: string;
}

export function OutlookPage() {
  const { data } = useApi<Outlook>("/api/outlook", ["queue", "clock", "projection"]);
  const rows = data?.weeks.map((w) => ({ day: w.wednesday, label: fmtMonthDay(w.wednesday), band: [w.pounds.p10, w.pounds.p90] as [number, number], mid: w.pounds.p50 })) ?? [];
  const top = data ? Math.max(...data.weeks.map((w) => w.pounds.p90)) : 0;
  const total = data ? data.weeks.reduce((a, w) => a + w.pounds.p50, 0) : 0;
  return (
    <div>
      <PageTitle
        sub="How much subscription coffee to roast in the coming weeks. Online subscriptions only, a small share of total roasting."
        right={
          <a className="btn no-underline" href="/api/outlook?format=csv" download="roast-outlook.csv">
            Export CSV
          </a>
        }
      >
        Roast outlook
      </PageTitle>
      <Card>
        {!data ? (
          <Empty>Loading…</Empty>
        ) : data.weeks.length === 0 ? (
          <Empty>No scheduled deliveries to project yet.</Empty>
        ) : (
          <>
            <SectionTitle>{`About ${nf(total)} lb of subscription coffee over the next ${data.weeks.length} weeks, between ${nf(Math.min(...data.weeks.map((w) => w.pounds.p10)))} and ${nf(top)} lb in any one week`}</SectionTitle>
            <div className="h-[300px] w-full" role="img" aria-label="Weekly pounds, P10 to P90 band with median line">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} margin={{ top: 16, right: 56, bottom: 6, left: 0 }}>
                  <CartesianGrid stroke="#ECEAE7" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#6E6E6A" }} axisLine={{ stroke: "#ECEAE7" }} tickLine={false} />
                  <YAxis domain={[0, Math.ceil((top * 1.1) / 100) * 100]} tickCount={5} tick={{ fontSize: 12, fill: "#6E6E6A" }} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => nf(v)} />
                  <Area dataKey="band" stroke="none" fill="#F16A21" fillOpacity={0.2} isAnimationActive={false} />
                  <Line dataKey="mid" stroke="#141414" strokeWidth={2} dot={{ r: 4, fill: "#F16A21", stroke: "#fff", strokeWidth: 1.5 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-1 text-[13px] text-muted">Black line: middle estimate. Shaded band: P10 to P90 of {data.draws} simulated outcomes, including uncertainty in cancel and sign-up rates.</div>
          </>
        )}
      </Card>

      {data && data.weeks.length > 0 && (
        <Card pad={false} className="mt-5">
          <table>
            <thead>
              <tr>
                <th>Week of (Wed)</th>
                <th className="text-right">Deliveries (P10–P90)</th>
                <th className="text-right">Middle</th>
                <th className="text-right">Pounds (P10–P90)</th>
                <th className="text-right">Middle</th>
                <th className="text-right">If two bags a delivery</th>
              </tr>
            </thead>
            <tbody>
              {data.weeks.map((w) => (
                <tr key={w.wednesday} className="row">
                  <td className="tnum">{fmtMonthDay(w.wednesday)}</td>
                  <td className="tnum text-right">
                    {nf(w.deliveries.p10)}–{nf(w.deliveries.p90)}
                  </td>
                  <td className="tnum text-right">{nf(w.deliveries.p50)}</td>
                  <td className="tnum text-right">
                    {nf(w.pounds.p10)}–{nf(w.pounds.p90)}
                  </td>
                  <td className="tnum text-right font-medium">{nf(w.pounds.p50)}</td>
                  <td className="tnum text-right text-muted">
                    {nf(w.poundsTwoBag.p10)}–{nf(w.poundsTwoBag.p90)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {data && (
        <div className="mt-4 max-w-[860px] text-[14px] text-muted">
          It turns the subscription projections into a weekly DTC pounds range the roaster can drop into the batch plan. DTC is a small share of roaster volume (under 2% of wholesale pounds), so this is a planning convenience, not the reason to do this. Pounds are deliveries × {data.poundsPerDelivery} lb (one 12-oz bag); the last column shows the two-bag sensitivity. Counts include new sign-ups' first deliveries.
        </div>
      )}
    </div>
  );
}
