import { useApi } from "../api.tsx";
import { Card, Empty, PageTitle, SectionTitle } from "../components/ui.tsx";
import { fmtDay } from "../format.ts";
import { href } from "../router.ts";

interface SettingsDTO {
  deliveryDay: string;
  quietHours: { from: number; to: number };
  caps: { routine: number; other: number };
  freeze: { from: number; to: number };
  cautiousness: string;
  consentTexts: { delivery: string };
  engineVersion: string;
  holidays: Array<{ name: string; from: number; to: number }>;
  freshness: { bestByDays: number; peakEndDays: number; roastToDoorDays: number };
  environment: string;
}

const hour = (h: number): string => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}`;

export function Settings() {
  const { data: s } = useApi<SettingsDTO>("/api/settings", []);
  return (
    <div>
      <PageTitle sub="Delivery timing and messaging rules. Read only.">Settings</PageTitle>
      {!s ? (
        <Empty>Loading…</Empty>
      ) : (
        <div className="grid max-w-[980px] grid-cols-1 lg:grid-cols-2 gap-5">
          <Card>
            <SectionTitle>Delivery and texting</SectionTitle>
            <dl className="m-0 grid grid-cols-1 gap-x-4 sm:grid-cols-[minmax(120px,160px)_minmax(0,1fr)] gap-y-2 text-[14px]">
              <dt className="text-muted">Delivery day</dt>
              <dd className="m-0">{s.deliveryDay}</dd>
              <dt className="text-muted">Quiet hours</dt>
              <dd className="m-0">{hour(s.quietHours.from)} to {hour(s.quietHours.to)} Eastern: texts wait until morning</dd>
              <dt className="text-muted">Texts per delivery</dt>
              <dd className="m-0">{s.caps.routine} routine and {s.caps.other} other. Replies to a customer and legal texts are exempt.</dd>
              <dt className="text-muted">Holiday freeze</dt>
              <dd className="m-0">{fmtDay(s.freeze.from)} to {fmtDay(s.freeze.to)}: no automatic moves</dd>
              <dt className="text-muted">Cautiousness</dt>
              <dd className="m-0">{s.cautiousness}</dd>
            </dl>
          </Card>
          <Card>
            <SectionTitle>Freshness and holidays</SectionTitle>
            <dl className="m-0 grid grid-cols-1 gap-x-4 sm:grid-cols-[minmax(120px,160px)_minmax(0,1fr)] gap-y-2 text-[14px]">
              <dt className="text-muted">Freshness window</dt>
              <dd className="m-0">At its best within {s.freshness.bestByDays} days of roasting; past peak after {s.freshness.peakEndDays}. Subscription bags are roasted to order and reach the door {s.freshness.roastToDoorDays} days later.</dd>
              <dt className="text-muted">Holiday travel weeks</dt>
              <dd className="m-0">
                A check-in for a delivery landing in one of these also asks “Away? Reply AWAY” (no extra text). AWAY holds it until the Wednesday after.
                <ul className="mb-0 mt-1 list-none p-0">
                  {s.holidays.map((h) => (
                    <li key={`${h.name}-${h.from}`} className="tnum">
                      {h.name === "the holidays" ? "Winter holidays" : h.name}: {fmtDay(h.from)} to {fmtDay(h.to)}
                    </li>
                  ))}
                </ul>
              </dd>
            </dl>
          </Card>
          <Card>
            <SectionTitle>Pilot control group</SectionTitle>
            <p className="m-0 text-[14px]">
              New subscribers are split at random when they join: half get AI timing, half stay on a fixed schedule with no check-ins and no moves. The split is fixed by the customer's ID, so it never changes. The <a href={href("/pilot")}>Pilot page</a> compares the two.
            </p>
            <p className="mb-0 mt-4 text-[13px] text-muted">
              {s.environment} · engine {s.engineVersion}
            </p>
          </Card>
          <Card className="lg:col-span-2">
            <SectionTitle>Consent texts (sent word for word)</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[14px]">
              <div>
                <div className="mb-1 text-[13px] font-semibold text-muted">Delivery texts</div>
                <div className="rounded-lg bg-cream p-3">{s.consentTexts.delivery}</div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
