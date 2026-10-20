import { useState } from "react";
import { WEDNESDAY, dayFromISO, isoFromDay, weekday } from "../../shared/dates.ts";
import { SOURCE_LABEL } from "../../shared/constants.ts";
import type { CustomerProfile as Profile } from "../../shared/types.ts";
import { HOW_SURE_KEY } from "../../engine/explain.ts";
import { post, toast, useApi } from "../api.tsx";
import { MessageThread } from "../components/MessageThread.tsx";
import { PantryChart } from "../components/PantryChart.tsx";
import { Card, ConsentChip, HowSure, Modal } from "../components/ui.tsx";
import { fmtDay, fmtMonthDay, fmtTime, nf, relativeTime, usd } from "../format.ts";

type ActionKind = "move" | "hold" | "pause" | "note" | null;

function ActionModal({ id, kind, profile, onClose }: { id: string; kind: Exclude<ActionKind, null>; profile: Profile; onClose: () => void }) {
  const today = profile.pantry.today;
  const next = profile.customer.nextDelivery ?? today + 10;
  const wednesdays: number[] = [];
  for (let d = today + 3; wednesdays.length < 10; d++) if (weekday(d) === WEDNESDAY) wednesdays.push(d);
  const [to, setTo] = useState<number>(wednesdays.find((w) => w > next) ?? wednesdays[0]!);
  const [until, setUntil] = useState(isoFromDay(next + 6));
  const [days, setDays] = useState(28);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const payload = kind === "move" ? { action: "move", to } : kind === "hold" ? { action: "hold", until: dayFromISO(until) } : kind === "pause" ? { action: "pause", days } : { action: "add_note", body };
    const r = await post<{ ok: boolean; error?: string }>(`/api/customers/${id}/actions`, payload);
    setBusy(false);
    if (r.ok) {
      toast(kind === "note" ? "Note added" : "Done: the customer has been told", { tone: "info" });
      onClose();
    } else toast(r.error ?? "That didn't work", { tone: "error" });
  };
  return (
    <Modal title={kind === "move" ? "Move delivery" : kind === "hold" ? "Hold until…" : kind === "pause" ? "Pause" : "Add note"} onClose={onClose}>
      <div className="space-y-3 text-[14px]">
        {kind === "move" && (
          <label className="block">
            <span className="mb-1 block text-muted">New delivery date (Wednesdays)</span>
            <select className="w-full" value={to} onChange={(e) => setTo(Number(e.target.value))}>
              {wednesdays.map((w) => (
                <option key={w} value={w}>
                  {fmtDay(w)}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "hold" && (
          <label className="block">
            <span className="mb-1 block text-muted">Hold the delivery until (it ships the next Wednesday)</span>
            <input type="date" className="w-full" value={until} onChange={(e) => setUntil(e.target.value)} />
          </label>
        )}
        {kind === "pause" && (
          <label className="block">
            <span className="mb-1 block text-muted">Pause for</span>
            <select className="w-full" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[14, 28, 42, 56].map((d) => (
                <option key={d} value={d}>
                  {d / 7} weeks
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "note" && <textarea className="w-full" rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What should the next person know?" aria-label="Note" />}
        {kind !== "note" && <div className="text-[13px] text-muted">The customer gets a text, and can undo it by replying OLD.</div>}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || (kind === "note" && !body.trim())} onClick={submit}>
            {kind === "note" ? "Save note" : "Confirm"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function CustomerProfile({ id }: { id: string }) {
  const { data: p } = useApi<Profile & { error?: string }>(`/api/customers/${id}`);
  const [modal, setModal] = useState<ActionKind>(null);
  const [showAll, setShowAll] = useState(false);
  if (!p) return <div className="text-muted">Loading…</div>;
  if (p.error) return <div className="text-danger">No customer “{id}”.</div>;
  const c = p.customer;
  const pr = p.projection;
  const first = c.name.split(" ")[0]!;
  const activity = showAll ? p.activity : p.activity.slice(0, 5);
  const suggested = c.suggestedRhythmDays;
  return (
    <div>
      <div className="sticky -top-6 z-20 -mx-6 mb-4 border-b border-line bg-cream/95 px-6 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="m-0 text-[28px] font-semibold leading-tight text-espresso">{c.name}</h1>
              <ConsentChip label="Delivery texts" yes={c.consentDelivery} />
              <ConsentChip label="Offers" yes={c.consentOffers} />
              {c.state === "OPTED_OUT" && <span className="chip bad">Texts stopped</span>}
              {c.state === "CANCELLED" && <span className="chip bad">Cancelled</span>}
              {c.state === "HELD" && <span className="chip warn">Held until {c.heldUntil ? fmtMonthDay(c.heldUntil) : ""}</span>}
            </div>
            <div className="mt-1 text-[14px] text-muted">
              Member since {fmtMonthDay(c.memberSince)} · {SOURCE_LABEL[c.source]} sign-up · {c.plan} · {c.city} · Next delivery <b className="text-ink">{c.nextDelivery ? fmtDay(c.nextDelivery) : "none scheduled"}</b>
              {suggested !== null && (
                <>
                  {" "}
                  · Suggested at sign-up: every {Math.round(suggested / 7)} weeks · chose: every {Math.round(c.rhythmDays / 7)} weeks
                </>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn primary" onClick={async () => { const r = await post<{ ok: boolean; error?: string }>(`/api/customers/${id}/actions`, { action: "send_checkin_now" }); toast(r.ok ? "Check-in sent" : (r.error ?? "Could not send"), { tone: r.ok ? "info" : "error" }); }}>
              Send check-in now
            </button>
            <button className="btn" onClick={() => setModal("move")}>Move delivery…</button>
            <button className="btn" onClick={() => setModal("hold")}>Hold until…</button>
            <button className="btn" onClick={() => setModal("pause")}>Pause…</button>
            <button className="btn" onClick={() => setModal("note")}>Add note</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-8 space-y-5">
          <Card>
            <h2 className="m-0 mb-1 text-[20px] font-semibold text-espresso">{p.pantry.title}</h2>
            <div className="mb-2 text-[13px] text-muted">Days of coffee on hand · {p.pantry.empty ?? "labelled directly on the chart"}</div>
            <PantryChart pantry={p.pantry} />
          </Card>
          <Card>
            <h2 className="m-0 mb-3 text-[20px] font-semibold text-espresso">Messages</h2>
            <MessageThread messages={p.messages} />
          </Card>
          <Card pad={false}>
            <h2 className="m-0 px-4 pb-2 pt-4 text-[20px] font-semibold text-espresso">Order history</h2>
            {p.deliveries.length === 0 ? (
              <div className="px-4 pb-4 text-[14px] text-muted">No orders yet.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Items</th>
                    <th>Size</th>
                    <th>Price</th>
                    <th>Status</th>
                    <th title="The model's estimate of coffee left just before it arrived">Est. days on hand at arrival</th>
                  </tr>
                </thead>
                <tbody>
                  {p.deliveries.map((d) => (
                    <tr key={d.id} className="row">
                      <td className="tnum">{fmtDay(d.deliveredDate ?? d.scheduledDate)}</td>
                      <td>{d.items}</td>
                      <td>{d.size}</td>
                      <td className="tnum">{usd(d.price)}</td>
                      <td>
                        <span className={`chip ${d.status === "delivered" ? "ok" : d.status === "scheduled" ? "" : "warn"}`}>{d.status[0]!.toUpperCase() + d.status.slice(1)}</span>
                      </td>
                      <td className="tnum">{d.daysOnHandAtArrival !== null ? `${nf(d.daysOnHandAtArrival)} days` : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <aside className="col-span-4">
          <div className="sticky top-[100px] space-y-5">
            <Card>
              <h2 className="m-0 mb-3 text-[20px] font-semibold text-espresso">Why this date</h2>
              {pr ? (
                <div className="space-y-3 text-[14px]">
                  <div>
                    <div className="text-[13px] font-semibold text-muted">Starting point</div>
                    <div>{pr.explanation.startingPoint}</div>
                    <span className="chip mt-1 !whitespace-normal !rounded-lg text-left" title="Layer A is fit on synthetic data in the sandbox">{pr.explanation.startingPointTag}</span>
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-muted">{first}'s evidence</div>
                    <div>{pr.explanation.evidence}</div>
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-muted">What would change it</div>
                    <div>{pr.explanation.whatWouldChange || "Any reply is checked against the same rules."}</div>
                  </div>
                  <div>
                    <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-muted">How sure we are <HowSure value={pr.confidence} /></div>
                    <div className="text-[13px] text-muted">{HOW_SURE_KEY[pr.confidence]}</div>
                    {pr.holdingOff && <div className="mt-1 text-[13px]"><b>Holding off:</b> no answer, no change.</div>}
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-muted">Checks that applied</div>
                    {pr.explanation.checks.length === 0 ? (
                      <div className="text-[13px] text-muted">None yet: a move needs a reply, and the customer needs 2+ completed deliveries.</div>
                    ) : (
                      <ul className="m-0 list-none p-0 text-[13px]">
                        {pr.explanation.checks.map((k, i) => (
                          <li key={i} className={k.ok ? "text-success" : "text-danger"}>
                            {k.ok ? "✓" : "✗"} {k.text}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="text-[12px] text-muted" title="Estimated from 500 what-if pantries">Estimated from 500 what-if versions of this pantry, updated {relativeTime(pr.computedAt, p.now)}.</div>
                </div>
              ) : (
                <div className="text-[14px] text-muted">No projection yet.</div>
              )}
            </Card>
            <Card>
              <h2 className="m-0 mb-2 text-[16px] font-semibold text-espresso">Activity log</h2>
              {activity.length === 0 ? (
                <div className="text-[13px] text-muted">Nothing yet.</div>
              ) : (
                <ul className="m-0 list-none space-y-1.5 p-0 text-[13px]">
                  {activity.map((a, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span>{a.text}</span>
                      <span className="tnum shrink-0 text-muted">{relativeTime(a.at, p.now)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {p.activity.length > 5 && (
                <button className="mt-2 border-0 bg-transparent p-0 text-[13px] text-orange-ink underline" onClick={() => setShowAll((s) => !s)}>
                  {showAll ? "Show less" : `Show all ${p.activity.length}`}
                </button>
              )}
              {p.notes.length > 0 && (
                <div className="mt-3 border-t border-line pt-2">
                  <div className="text-[13px] font-semibold text-muted">Notes</div>
                  {p.notes.map((n) => (
                    <div key={n.id} className="mt-1 text-[13px]">
                      {n.body} <span className="text-muted">· {n.author.split(" ·")[0]}, {fmtTime(n.at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </aside>
      </div>
      {modal && <ActionModal id={id} kind={modal} profile={p} onClose={() => setModal(null)} />}
    </div>
  );
}
