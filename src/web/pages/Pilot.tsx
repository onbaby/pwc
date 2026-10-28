import { useApi } from "../api.tsx";
import { Meter } from "../components/analytics.tsx";
import { Card, Empty, PageTitle, SectionTitle } from "../components/ui.tsx";
import { fmtDay, nf, pct, usd } from "../format.ts";
import { href } from "../router.ts";

interface Arm {
  label: string;
  enrolled: number;
  active: number;
  cancelled: number;
  cancelRate: number | null;
  revenuePerSubscriber: number | null;
  bagsDelivered: number;
  complaints: number;
  complaintsPer100Bags: number | null;
  checkIns: number;
  replied: number;
  moves: number;
  bySource: Record<string, number>;
}
interface PilotDTO {
  start: number;
  week: number;
  totalWeeks: number;
  arms: { ai: Arm; fixed: Arm };
  outsideTest: number;
  stopRule: { atWeek: number; state: "too_early" | "below_control" | "not_below_control"; weeksLeft: number; cancelDiffPoints: number | null; cancelMarginPoints: number | null; text: string };
  replyBar: number;
  managedReply: { asked: number; replied: number };
  qr: { bags: number; scans: number; scansPerBag: number; signups: number; scanToSubscribe: number; accounts: number };
  sources: Array<{ key: string; label: string }>;
}

const STAGES = [
  { label: "Month 1", what: "Build on existing data and texting", from: 0, to: 0 },
  { label: "Months 2–4", what: "A/B pilot: half of new subscribers get AI timing", from: 1, to: 3 },
  { label: "Month 5", what: "QR codes on Athens grocery bags", from: 4, to: 4 },
  { label: "Month 6", what: "Scale or stop", from: 5, to: 5 },
];

export function PilotPage() {
  const { data: d } = useApi<PilotDTO>("/api/pilot", ["queue", "message", "clock", "projection"]);
  return (
    <div>
      <PageTitle sub="The test from the proposal: new subscribers are split at random, half get AI timing and half stay on a fixed schedule. Every number below is read from the sandbox's sample data.">Pilot</PageTitle>
      {!d ? (
        <Card>
          <Empty>Loading…</Empty>
        </Card>
      ) : (
        <PilotBody d={d} />
      )}
    </div>
  );
}

function PilotBody({ d }: { d: PilotDTO }) {
  const { ai, fixed } = d.arms;
  // a new subscriber is first asked after their first delivery, so early in the pilot the AI arm has few answers to count:
  // then show the rate across everyone the console is texting (the same count as Today's tile)
  const armRate = ai.checkIns >= 30 ? ai.replied / ai.checkIns : null;
  const allRate = d.managedReply.asked ? d.managedReply.replied / d.managedReply.asked : null;
  const replyRate = armRate ?? allRate;
  const rows: Array<{ label: string; hint: string; ai: string; fixed: string }> = [
    { label: "New subscribers enrolled", hint: "Joined since the pilot began; the split is fixed by each customer's ID", ai: nf(ai.enrolled), fixed: nf(fixed.enrolled) },
    { label: "Cancellation rate", hint: "Cancelled since enrolling, as a share of those enrolled", ai: ai.cancelRate === null ? "–" : pct(ai.cancelRate, 1), fixed: fixed.cancelRate === null ? "–" : pct(fixed.cancelRate, 1) },
    { label: "Revenue per subscriber", hint: "Delivered orders so far divided by subscribers enrolled", ai: ai.revenuePerSubscriber === null ? "–" : usd(ai.revenuePerSubscriber, 2), fixed: fixed.revenuePerSubscriber === null ? "–" : usd(fixed.revenuePerSubscriber, 2) },
    { label: "Freshness complaints per 100 bags", hint: "A customer texting STALE; counted per bag delivered", ai: ai.complaintsPer100Bags === null ? "–" : nf(ai.complaintsPer100Bags, 1), fixed: fixed.complaintsPer100Bags === null ? "–" : nf(fixed.complaintsPer100Bags, 1) },
    { label: "Check-ins answered", hint: "Subscribers with a delivery to describe; the control group is never asked, by design", ai: ai.checkIns ? `${nf(ai.replied)} of ${nf(ai.checkIns)}` : "none asked yet", fixed: "none (by design)" },
    { label: "Deliveries moved", hint: "Automatic moves plus approved ones", ai: nf(ai.moves), fixed: "none (by design)" },
  ];
  const s = d.stopRule;
  const diff = s.cancelDiffPoints;
  return (
    <div className="space-y-5">
      <Card>
        <div className="mb-3 flex items-end justify-between gap-4">
          <SectionTitle>{`Week ${d.week} of ${d.totalWeeks}`}</SectionTitle>
          <div className="mb-3 text-[13px] text-muted">Pilot began {fmtDay(d.start)}</div>
        </div>
        <Meter value={d.week / d.totalWeeks} tone="ink" label={`${s.weeksLeft} weeks until the month-3 stop rule is read`} />
        <ol className="m-0 mt-4 grid list-none grid-cols-4 gap-3 p-0">
          {STAGES.map((st) => {
            const month = Math.ceil(d.week / 4.33);
            const now = month - 1 >= st.from && month - 1 <= st.to;
            return (
              <li key={st.label} className={`rounded-xl border p-3 ${now ? "border-plum bg-plum-tint" : "border-line bg-cream"}`}>
                <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">{st.label}{now ? " · you are here" : ""}</div>
                <div className="mt-0.5 text-[14px]">{st.what}</div>
              </li>
            );
          })}
        </ol>
      </Card>

      <Card pad={false}>
        <div className="px-4 pt-4">
          <SectionTitle>AI timing against the control group</SectionTitle>
        </div>
        <table>
          <thead>
            <tr>
              <th>What we measure</th>
              <th className="text-right">AI timing</th>
              <th className="text-right">Fixed schedule (control)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td title={r.hint}>
                  {r.label}
                  <div className="text-[13px] text-muted">{r.hint}</div>
                </td>
                <td className="tnum text-right text-[16px] font-medium">{r.ai}</td>
                <td className="tnum text-right text-[16px] font-medium">{r.fixed}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-line px-4 py-3 text-[13px] text-muted">
          Sample data: no difference between the two groups is built in, so they should read alike. In the real pilot these rows are what decide it. {nf(d.outsideTest)} customers who joined before the pilot are outside the test.
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-5">
        <Card>
          <SectionTitle>The stop rule</SectionTitle>
          <p className="m-0 text-[14px]">{s.text}</p>
          <div className={`mt-3 rounded-xl border p-3 ${s.state === "not_below_control" ? "border-danger" : "border-line bg-cream"}`}>
            <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Today</div>
            {s.state === "too_early" ? (
              <div className="text-[15px]">
                Too early to read: {s.weeksLeft} weeks to go.
                {diff !== null && <> So far AI-timed subscribers have cancelled {Math.abs(diff) < 0.05 ? "at the same rate as" : `${nf(Math.abs(diff), 1)} points ${diff < 0 ? "less than" : "more than"}`} the control group{s.cancelMarginPoints !== null && <>, but with this many people a gap of ±{nf(s.cancelMarginPoints, 1)} points can happen by chance alone</>}.</>}
              </div>
            ) : s.state === "below_control" ? (
              <div className="text-[15px]">AI-timed subscribers are cancelling less than the control group: keep going.</div>
            ) : (
              <div className="text-[15px]">AI-timed subscribers are not cancelling less than the control group: the rule says turn it off.</div>
            )}
          </div>
          <p className="mb-0 mt-3 text-[13px] text-muted">We would also judge on net revenue, because slower pacing can mean fewer bags per person.</p>
        </Card>
        <Card>
          <SectionTitle>Is the check-in working?</SectionTitle>
          <div className="text-[34px] font-normal leading-none tracking-tight text-strong">{replyRate === null ? "–" : pct(replyRate)}</div>
          <div className="mb-2 mt-1 text-[14px] text-muted">
            {armRate !== null ? "of AI-timed subscribers answered a check-in within 5 days." : "of customers answered a check-in within 5 days, across everyone being texted. New subscribers are first asked after their first delivery, so the AI group alone has too few answers yet."} The pilot goes ahead only if at least {pct(d.replyBar)} do.
          </div>
          {replyRate !== null && <Meter value={replyRate} mark={d.replyBar} label={replyRate >= d.replyBar ? "above the bar" : "below the bar"} />}
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-5">
        <Card>
          <SectionTitle>How the split works</SectionTitle>
          <p className="m-0 text-[14px]">
            Each new subscriber is assigned when they join, by a fixed function of their customer ID: about half land in each group, it cannot be changed by staff, and the same customer always gets the same group. Their profile says which one.
          </p>
          <table className="mt-3">
            <thead>
              <tr>
                <th>Sign-up source</th>
                <th className="text-right">AI timing</th>
                <th className="text-right">Control</th>
              </tr>
            </thead>
            <tbody>
              {d.sources.map((src) => (
                <tr key={src.key}>
                  <td>{src.label}</td>
                  <td className="tnum text-right">{nf(ai.bySource[src.key] ?? 0)}</td>
                  <td className="tnum text-right">{nf(fixed.bySource[src.key] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mb-0 mt-3 text-[13px]">
            <a className="text-link" href={href("/customers")}>Open Customers</a> and use the pilot-group filter to see who is in each group.
          </p>
        </Card>
        <Card>
          <SectionTitle>The bag QR code</SectionTitle>
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-y-2 text-[14px]">
            <dt className="text-muted">Grocery accounts with QR bags</dt>
            <dd className="tnum m-0 text-right">{nf(d.qr.accounts)}</dd>
            <dt className="text-muted">Scans per bag</dt>
            <dd className="tnum m-0 text-right">{pct(d.qr.scansPerBag, 1)} ({nf(d.qr.scans)} of {nf(d.qr.bags)})</dd>
            <dt className="text-muted">Scan-to-subscribe rate</dt>
            <dd className="tnum m-0 text-right">{pct(d.qr.scanToSubscribe, 1)} ({nf(d.qr.signups)} sign-ups)</dd>
          </dl>
          <p className="mb-0 mt-3 text-[13px] text-muted">
            In the plan this starts in month 5; the sandbox shows it early so you can see the page. Sign-ups from a bag join the same random split. <a className="text-link" href={href("/qr")}>Open Bag QR</a>
          </p>
        </Card>
      </div>
    </div>
  );
}
