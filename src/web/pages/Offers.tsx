import { useEffect, useState } from "react";
import { SOURCES, SOURCE_LABEL, type Source } from "../../shared/constants.ts";
import { api, post, toast, useApi } from "../api.tsx";
import { Card, Empty, PageTitle } from "../components/ui.tsx";
import { nf, usd } from "../format.ts";
import { go, href } from "../router.ts";

type OfferType = "rotation" | "smaller" | "seasonal_swap" | "gift_to_own";
interface Audience {
  sources?: Source[];
  memberDaysMin?: number;
  memberDaysMax?: number;
  runOutMinDays?: number;
  runOutMaxDays?: number;
  onHand?: "lt7" | "lt14" | "ge14";
  lastReplyMaxWeeks?: number;
  skipped2of4?: boolean;
  giftEndingWithinDays?: number;
  notStockpiled?: boolean;
}
interface Results {
  sends: number;
  accepted: number;
  acceptRate: number | null;
  optOuts7d: number;
  optOutShare: number | null;
  holdoutAssigned: number;
  treatmentAssigned: number;
  nextCheckIn: { treatment: { reached: number; replied: number; rate: number | null }; holdout: { reached: number; replied: number; rate: number | null } };
  perGroup: number;
  perGroupNeeded: number;
  statusLine: string;
  readReady: boolean;
  sandboxNote: string;
}
interface OfferDTO {
  id: number;
  name: string;
  type: OfferType;
  typeLabel: string;
  reason: string;
  status: string;
  audience: Audience;
  holdoutMode: "global" | "experiment" | "none";
  holdoutPct: number;
  discountPct: number;
  budget: number;
  approvalRequired: boolean;
  pausedReason: string | null;
  audienceSize: number;
  holdout: string;
  sends: number;
  statusLine: string;
  results: Results;
}
interface Types {
  [k: string]: { label: string; discount: boolean; reason: string; template: string };
}
interface Preview {
  matching: number;
  eligible: number;
  excluded: Record<string, number>;
  treatment: number;
  holdout: number;
  sample: { name: string; body: string } | null;
  breakEven: { acceptRate: number; costPerAccept: number; costPerRecipient: number; valuePerSave: [number, number]; keepPer1000: [number, number]; aov: number; discount: boolean };
  sampleSizePerGroup: number;
  firstRead: { perGroupNeeded: number; perGroupNow: number; estimate: string; months: number };
  sensorNote: string;
  errors: string[];
}

const statusChip = (s: string) => (s === "Running" ? "ok" : s === "Paused" ? "bad" : s === "Pending approval" ? "plum" : s === "Scheduled" ? "warn" : "");

export function OffersList() {
  const { data } = useApi<{ offers: OfferDTO[]; types: Types }>("/api/offers", ["offer", "queue"]);
  return (
    <div>
      <PageTitle sub="Small offers for customers likely to cancel. Only for people who said yes to offers, added to a text they were getting anyway, and compared against a group that gets nothing." right={<a className="btn primary no-underline" href={href("/offers/new")}>New offer</a>}>
        Offers
      </PageTitle>
      <Card pad={false}>
        {!data ? (
          <Empty>Loading…</Empty>
        ) : data.offers.length === 0 ? (
          <Empty>No offers yet. Create one from a template.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Status</th>
                <th>Audience</th>
                <th>Holdout</th>
                <th>Sends</th>
                <th>Where it stands</th>
              </tr>
            </thead>
            <tbody>
              {data.offers.map((o) => (
                <tr key={o.id} className="row cursor-pointer" onClick={(e) => !(e.target as HTMLElement).closest("a,button") && go(`/offers/${o.id}`)}>
                  <td>
                    <a className="font-medium text-link" href={href(`/offers/${o.id}`)}>
                      {o.name}
                    </a>
                  </td>
                  <td className="text-[13px]">{o.typeLabel}</td>
                  <td>
                    <span className={`chip ${statusChip(o.status)}`}>{o.status}</span>
                  </td>
                  <td className="tnum">{nf(o.audienceSize)}</td>
                  <td className="text-[13px]">{o.holdout}</td>
                  <td className="tnum">{nf(o.sends)}</td>
                  <td className="text-[13px] text-muted">{o.pausedReason ? `Paused: ${o.pausedReason}` : o.statusLine}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

const PRESET = { name: "Athens roast rotation", type: "rotation" as OfferType, audience: { sources: ["social"] as Source[], memberDaysMin: 30, memberDaysMax: 90, notStockpiled: true } as Audience, holdoutMode: "experiment" as "global" | "experiment" | "none", holdoutPct: 50, discountPct: 0, budget: 0, approvalRequired: false };

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="m-0 mb-3 flex items-center gap-3 text-[20px] font-medium tracking-tight text-strong">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-strong text-[14px] text-white">{n}</span>
        {title}
      </h2>
      {children}
    </Card>
  );
}

const numOrUndef = (v: string): number | undefined => (v === "" ? undefined : Number(v));

export function OfferPage({ id }: { id: string }) {
  const isNew = id === "new";
  const types = useApi<{ offers: OfferDTO[]; types: Types }>("/api/offers", ["offer"]);
  const existing = useApi<OfferDTO & { error?: string }>(isNew ? null : `/api/offers/${id}`, ["offer", "queue"]);
  const [d, setD] = useState({ ...PRESET });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(isNew);
  const o = existing.data;
  const locked = !!o && o.status !== "Draft" && o.status !== "Paused";

  useEffect(() => {
    if (o && !loaded && !o.error) {
      setD({ name: o.name, type: o.type, audience: o.audience, holdoutMode: o.holdoutMode, holdoutPct: o.holdoutPct, discountPct: o.discountPct, budget: o.budget, approvalRequired: o.approvalRequired } as typeof PRESET);
      setLoaded(true);
    }
  }, [o, loaded]);

  // live preview, debounced
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      api<{ ok: boolean; preview: Preview }>(`/api/offers/${id}/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(d) })
        .then((r) => r.ok && setPreview(r.preview))
        .catch(() => undefined);
    }, 350);
    return () => clearTimeout(t);
  }, [d, id, loaded]);

  if (!isNew && !o) return <div className="text-muted">Loading…</div>;
  if (o?.error) return <div className="text-danger">No offer {id}.</div>;
  const tdef = types.data?.types[d.type];
  const setA = (patch: Partial<Audience>) => setD((x) => ({ ...x, audience: { ...x.audience, ...patch } }));
  const setType = (t: OfferType) => setD((x) => ({ ...x, type: t, discountPct: t === "gift_to_own" ? 10 : 0, approvalRequired: t === "gift_to_own", audience: t === "gift_to_own" ? { sources: ["gift" as Source], giftEndingWithinDays: 30 } : t === "smaller" ? { sources: ["in_cafe", "website"] as Source[], onHand: "ge14" as const } : t === "seasonal_swap" ? { notStockpiled: true } : PRESET.audience, name: x.name === PRESET.name || !x.name ? types.data?.types[t]?.label ?? x.name : x.name, holdoutMode: t === "gift_to_own" ? "experiment" : x.holdoutMode }));

  const save = async (schedule: boolean) => {
    setSaving(true);
    let offerId = isNew ? 0 : Number(id);
    const r = isNew ? await post<{ ok: boolean; id?: number; error?: string }>("/api/offers", d) : await api<{ ok: boolean; id?: number; error?: string }>(`/api/offers/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(d) });
    if (!r.ok) {
      toast(r.error ?? "Could not save", { tone: "error" });
      setSaving(false);
      return;
    }
    if (isNew && r.id !== undefined) offerId = r.id;
    if (schedule) {
      const s = await post<{ ok: boolean; status?: string; assigned?: number; error?: string }>(`/api/offers/${offerId}/schedule`);
      if (!s.ok) toast(s.error ?? "Could not schedule", { tone: "error" });
      else toast(s.status === "Pending approval" ? "Sent to Approvals: a discount offer needs manager approval" : `Scheduled: ${nf(s.assigned ?? 0)} customers assigned`, { tone: "info" });
    } else toast("Draft saved", { tone: "info" });
    setSaving(false);
    go(`/offers/${offerId}`);
  };

  const R = o?.results;
  const be = preview?.breakEven;
  return (
    <div>
      <PageTitle sub={o ? `${o.typeLabel} · ${o.status}` : "New offer: pick a template, then adjust."} right={<a className="btn no-underline" href={href("/offers")}>← All offers</a>}>
        {isNew ? "New offer" : o!.name}
      </PageTitle>
      {o && o.status !== "Draft" && R && (
        <Card className="mb-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="m-0 text-[20px] font-medium tracking-tight text-strong">Results</h2>
            <span className={`chip ${statusChip(o.status)}`}>{o.status}</span>
          </div>
          {o.pausedReason && <div className="mb-3 rounded-lg bg-danger-tint p-3 text-[14px] text-danger">Paused: {o.pausedReason}</div>}
          <div className="mb-3 text-[16px] font-medium">{R.statusLine}</div>
          <div className="grid grid-cols-4 gap-4 text-[14px]">
            <div><div className="text-muted">Texts sent with the offer</div><div className="tnum text-[28px] font-medium tracking-tight text-strong">{nf(R.sends)}</div></div>
            <div><div className="text-muted">Accepted</div><div className="tnum text-[28px] font-medium tracking-tight text-strong">{nf(R.accepted)}</div><div className="text-[13px] text-muted">{R.acceptRate === null ? "no sends yet" : `${(R.acceptRate * 100).toFixed(1)}% of sends`}</div></div>
            <div><div className="text-muted">STOP or NO OFFERS within 7 days</div><div className="tnum text-[28px] font-medium tracking-tight text-strong">{nf(R.optOuts7d)}</div><div className="text-[13px] text-muted">{R.optOutShare === null ? "–" : `${(R.optOutShare * 100).toFixed(1)}% of sends (pauses above 2%)`}</div></div>
            <div><div className="text-muted">Next check-in reply rate</div><div className="tnum text-[28px] font-medium tracking-tight text-strong">{R.nextCheckIn.treatment.rate === null ? "–" : `${(R.nextCheckIn.treatment.rate * 100).toFixed(0)}%`}</div><div className="text-[13px] text-muted">{R.nextCheckIn.holdout.rate === null ? "holdout: not read yet" : `holdout ${(R.nextCheckIn.holdout.rate * 100).toFixed(0)}%`}</div></div>
          </div>
          <div className="mt-3 text-[13px] text-muted">Cancellation effects are read only at the pre-set sample size ({nf(R.perGroupNeeded)} per group for a 3-point drop from about 8% a month) and pooled against the standing holdout. {R.sandboxNote}</div>
          <div className="mt-3 flex gap-2">
            {(o.status === "Running" || o.status === "Scheduled") && <button className="btn danger" onClick={async () => { const r = await post<{ ok: boolean; error?: string }>(`/api/offers/${o.id}/pause`, { reason: "Paused by staff" }); toast(r.ok ? "Offer paused" : (r.error ?? "Could not pause"), { tone: r.ok ? "info" : "error" }); }}>Pause offer</button>}
            {o.status === "Pending approval" && <button className="btn primary" onClick={async () => { const r = await post<{ ok: boolean; error?: string }>(`/api/offers/${o.id}/approve`); toast(r.ok ? "Approved and scheduled" : (r.error ?? "Could not approve"), { tone: r.ok ? "info" : "error" }); }}>Approve (manager)</button>}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-7 space-y-5">
          <Section n={1} title="Offer type and message">
            <div className="grid grid-cols-2 gap-2">
              {types.data &&
                (Object.entries(types.data.types) as Array<[OfferType, Types[string]]>).map(([k, v]) => (
                  <label key={k} className={`cursor-pointer rounded-lg border p-3 text-[14px] ${d.type === k ? "border-strong bg-accent-tint" : "border-line"} ${locked ? "opacity-60" : ""}`}>
                    <input type="radio" name="otype" className="mr-2" checked={d.type === k} disabled={locked} onChange={() => setType(k)} />
                    <b>{v.label}</b>
                    <div className="mt-0.5 text-[13px] text-muted">{v.reason}</div>
                    {v.discount && <span className="chip plum mt-1">Discount: manager approval</span>}
                  </label>
                ))}
            </div>
            <label className="mt-3 block text-[14px]">
              <span className="mb-1 block text-muted">Name</span>
              <input className="w-full" value={d.name} disabled={locked} onChange={(e) => setD({ ...d, name: e.target.value })} />
            </label>
            {d.type === "gift_to_own" && (
              <label className="mt-3 block text-[14px]">
                <span className="mb-1 block text-muted">Discount on the first delivery (max 10%)</span>
                <input type="number" min={1} max={10} value={d.discountPct} disabled={locked} onChange={(e) => setD({ ...d, discountPct: Number(e.target.value) })} className="w-24" /> %
              </label>
            )}
            <div className="mt-3 rounded-lg bg-cream p-3 text-[14px]">
              <div className="mb-1 text-[13px] font-semibold text-muted">Message preview (added to the customer's reminder)</div>
              {preview?.sample ? <>“{preview.sample.body}” <span className="text-muted">· {preview.sample.name}</span></> : <span className="text-muted">{tdef?.template ?? "…"}</span>}
            </div>
          </Section>

          <Section n={2} title="Audience">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[14px]">
              <span className="chip ok">Offer consent = yes (always enforced)</span>
              {d.type === "gift_to_own" && <span className="text-[13px] text-muted">Discount audiences may use only sign-up source, gift status and tenure.</span>}
            </div>
            <div className="grid grid-cols-2 gap-x-5 gap-y-3 text-[14px]">
              <div className="col-span-2">
                <div className="mb-1 text-muted">Sign-up source</div>
                <div className="flex flex-wrap gap-2">
                  {SOURCES.map((s) => {
                    const on = d.audience.sources?.includes(s) ?? false;
                    return (
                      <button key={s} disabled={locked} className={`chip ${on ? "ok" : ""}`} aria-pressed={on} onClick={() => setA({ sources: on ? (d.audience.sources ?? []).filter((x) => x !== s) : [...(d.audience.sources ?? []), s] })}>
                        {on ? "✓ " : ""}
                        {SOURCE_LABEL[s]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label>Member for (days): from <input type="number" className="w-20" value={d.audience.memberDaysMin ?? ""} disabled={locked} onChange={(e) => setA({ memberDaysMin: numOrUndef(e.target.value) })} /> to <input type="number" className="w-20" value={d.audience.memberDaysMax ?? ""} disabled={locked} onChange={(e) => setA({ memberDaysMax: numOrUndef(e.target.value) })} /></label>
              <label>Gift ending within <input type="number" className="w-20" value={d.audience.giftEndingWithinDays ?? ""} disabled={locked} onChange={(e) => setA({ giftEndingWithinDays: numOrUndef(e.target.value) })} /> days</label>
              <label>Likely run-out in (days): <input type="number" className="w-20" value={d.audience.runOutMinDays ?? ""} disabled={locked} onChange={(e) => setA({ runOutMinDays: numOrUndef(e.target.value) })} /> to <input type="number" className="w-20" value={d.audience.runOutMaxDays ?? ""} disabled={locked} onChange={(e) => setA({ runOutMaxDays: numOrUndef(e.target.value) })} /></label>
              <label>Median days on hand <select value={d.audience.onHand ?? ""} disabled={locked} onChange={(e) => setA({ onHand: (e.target.value || undefined) as Audience["onHand"] })}><option value="">any</option><option value="lt7">under 7</option><option value="lt14">under 14</option><option value="ge14">14 or more</option></select></label>
              <label>Last reply: <input type="number" className="w-20" value={d.audience.lastReplyMaxWeeks ?? ""} disabled={locked} onChange={(e) => setA({ lastReplyMaxWeeks: numOrUndef(e.target.value) })} /> weeks or fewer</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={!!d.audience.skipped2of4} disabled={locked} onChange={(e) => setA({ skipped2of4: e.target.checked || undefined })} /> Skipped 2+ of the last 4</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={!!d.audience.notStockpiled} disabled={locked} onChange={(e) => setA({ notStockpiled: e.target.checked || undefined })} /> Not stockpiled (under 2 weeks on hand)</label>
            </div>
          </Section>

          <Section n={3} title="Timing">
            <div className="text-[14px]">It rides with the customer's next reminder text. <b>It never adds a text.</b> At most one offer per customer per 30 days; never in quiet hours (9 pm to 8 am); never after STOP or NO OFFERS; no offer is ever attached to a cancel reply. Customers with no reminder coming up are excluded.</div>
          </Section>

          <Section n={4} title="Safety">
            <div className="space-y-3 text-[14px]">
              <div>
                <div className="mb-1 text-muted">Holdout</div>
                {(
                  [
                    ["global", "Standing holdout only (10% of offer-consented customers get no offers for six months; benefit is read pooled)"],
                    ["experiment", "Experiment mode: a separate holdout for this offer (one experiment at a time per customer)"],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className="mb-1 flex items-start gap-2"><input type="radio" name="hold" checked={d.holdoutMode === k} disabled={locked} onChange={() => setD({ ...d, holdoutMode: k })} /> {label}</label>
                ))}
                {d.holdoutMode === "experiment" && <div className="ml-6">Holdout share <input type="number" className="w-20" min={10} max={90} value={d.holdoutPct} disabled={locked} onChange={(e) => setD({ ...d, holdoutPct: Number(e.target.value) })} /> %</div>}
              </div>
              <label className="flex items-center gap-2"><input type="checkbox" checked={d.approvalRequired || d.type === "gift_to_own"} disabled={locked || d.type === "gift_to_own"} onChange={(e) => setD({ ...d, approvalRequired: e.target.checked })} /> Needs manager approval {d.type === "gift_to_own" && <span className="text-muted">(always for discounts)</span>}</label>
              <label>Budget cap ($) <input type="number" className="w-28" value={d.budget} disabled={locked} onChange={(e) => setD({ ...d, budget: Number(e.target.value) })} /></label>
              <div className="text-[13px] text-muted">{preview?.sensorNote}</div>
            </div>
          </Section>

          {!locked && (
            <div className="flex gap-2">
              <button className="btn" disabled={saving || !d.name.trim()} onClick={() => save(false)}>Save draft</button>
              <button className="btn primary" disabled={saving || !d.name.trim() || (preview?.errors.length ?? 0) > 0} onClick={() => save(true)}>Schedule</button>
            </div>
          )}
        </div>

        <aside className="col-span-5">
          <div className="sticky top-2 space-y-4">
            <Card>
              <h2 className="m-0 mb-3 text-[20px] font-medium tracking-tight text-strong">Live preview</h2>
              {!preview ? (
                <div className="text-[14px] text-muted">Working it out…</div>
              ) : (
                <div className="space-y-3 text-[14px]">
                  {preview.errors.map((e) => (
                    <div key={e} className="rounded-lg bg-danger-tint p-2 text-danger">{e}</div>
                  ))}
                  <div>
                    <span className="tnum text-[36px] font-semibold leading-none text-strong">{nf(preview.eligible)}</span> <span className="text-muted">eligible of {nf(preview.matching)} who match</span>
                    {d.holdoutMode === "experiment" && <div className="text-[13px] text-muted">{nf(preview.treatment)} get the offer · {nf(preview.holdout)} held out</div>}
                  </div>
                  <div>
                    <div className="mb-1 text-[13px] font-semibold text-muted">Excluded, and why</div>
                    <ul className="m-0 list-none p-0">
                      {Object.entries(preview.excluded).map(([k, v]) => (
                        <li key={k} className="flex justify-between border-b border-line py-1 text-[13px]"><span>{k}</span><span className="tnum">{nf(v)}</span></li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-lg bg-cream p-3">
                    <div className="mb-1 text-[13px] font-semibold text-muted">Break-even</div>
                    {be?.discount ? (
                      <div>Pays if it keeps about <b className="tnum">{be.keepPer1000[0].toFixed(0)}–{be.keepPer1000[1].toFixed(0)}</b> of every 1,000 recipients. <span className="text-[13px] text-muted">Cost {usd(be.costPerAccept, 2)} per acceptance ({usd(be.costPerRecipient, 2)} per recipient at {(be.acceptRate * 100).toFixed(0)}% acceptance) against {usd(be.valuePerSave[0])}–{usd(be.valuePerSave[1])} of gross profit per customer kept, over 7–9.2 deliveries a year.</span></div>
                    ) : (
                      <div>No discount, so the money break-even is about $0. The real cost is annoyance, which the sensor-protection rule watches.</div>
                    )}
                  </div>
                  <div className="rounded-lg bg-cream p-3">
                    <div className="mb-1 text-[13px] font-semibold text-muted">When could we know?</div>
                    <div>About <b className="tnum">{nf(preview.sampleSizePerGroup)}</b> per group to see a 3-point drop in 30-day cancellation. Now: <span className="tnum">{nf(preview.firstRead.perGroupNow)}</span> per group, so the first read is {preview.firstRead.estimate.startsWith("more") ? preview.firstRead.estimate : `est. ${preview.firstRead.estimate}`}. Until then we watch acceptance and opt-outs.</div>
                  </div>
                </div>
              )}
            </Card>
          </div>
        </aside>
      </div>
    </div>
  );
}
