import { useState } from "react";
import { WEDNESDAY, dayFromISO, isoFromDay, weekday } from "../../shared/dates.ts";
import { FRESHNESS, SOURCE_LABEL, WORLD } from "../../shared/constants.ts";
import type { CustomerProfile as Profile } from "../../shared/types.ts";
import { HOW_SURE_KEY } from "../../engine/explain.ts";
import { FRESHNESS_LABEL, type Freshness } from "../../engine/freshness.ts";
import { post, toast, useApi } from "../api.tsx";
import { MessageThread } from "../components/MessageThread.tsx";
import { PantryChart } from "../components/PantryChart.tsx";
import { Card, ConsentChip, HowSure, Modal } from "../components/ui.tsx";
import { fmtDay, fmtMonthDay, fmtTime, nf, relativeTime, usd } from "../format.ts";
import { href } from "../router.ts";

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

function FreshTile({ title, f, tone }: { title: string; f: Freshness; tone: "muted" | "main" }) {
  const cls = f.status === "best" || f.status === "peak" ? "ok" : f.status === "late" ? "bad" : "warn";
  return (
    <div className={`rounded-lg border p-3 ${tone === "main" ? "border-strong" : "border-line"}`}>
      <div className="text-[13px] text-muted">{title}</div>
      <div className="text-[16px] font-semibold">{fmtDay(f.arrival)}</div>
      {f.status === "late" ? (
        <div className="tnum mt-1 text-[14px]">Out of coffee about {f.daysWithout} days before it arrives</div>
      ) : (
        <div className="tnum mt-1 text-[14px]">
          Opened about <b>{f.openedAtAge} days</b> after roasting; last cup at about {f.lastCupAge} days
        </div>
      )}
      <span className={`chip ${cls} mt-2`}>{FRESHNESS_LABEL[f.status]}</span>
    </div>
  );
}

function FreshnessCard({ p }: { p: Profile }) {
  const f = p.freshness;
  if (!f.next) return null;
  const before = f.original;
  const after = f.proposed;
  const first = p.customer.name.split(" ")[0]!;
  const sentence = before
    ? `Moving it means ${first}'s next bag is opened about ${before.openedAtAge - f.next.openedAtAge} days fresher.`
    : after
      ? `The proposed date would open it about ${f.next.openedAtAge - after.openedAtAge} days fresher.`
      : f.next.status === "past_peak"
        ? `On this date the bag waits behind about ${f.next.onHandAtArrival} days of coffee: a reply would let us move it.`
        : `On this date the bag is opened inside the 2–4 week peak.`;
  return (
    <Card>
      <h2 className="m-0 mb-1 text-[20px] font-medium tracking-tight text-strong">Freshness at the cup</h2>
      <div className="mb-3 text-[13px] text-muted">Roasted to order, at the door {WORLD.roastToDoorDays} days later, opened when the coffee ahead of it runs out. Best within {FRESHNESS.bestByDays} days of roasting; past peak after {FRESHNESS.peakEndDays}.</div>
      <div className={`grid gap-3 ${before || after ? "grid-cols-2" : "grid-cols-1"}`}>
        {before && <FreshTile title="Original date" f={before} tone="muted" />}
        <FreshTile title={before ? "Now" : "Next delivery"} f={f.next} tone="main" />
        {after && <FreshTile title="Proposed" f={after} tone="muted" />}
      </div>
      <div className="mt-3 text-[14px]">{sentence}</div>
      <div className="mt-1 text-[12px] text-muted">The model's median estimate; one bag lasts {first} about {p.projection ? Math.round(p.projection.daysPerBag) : "–"} days.</div>
    </Card>
  );
}

/** What a rep should do next for this account, in one place: the first thing that needs a person, else the status. */
function NextAction({ p }: { p: Profile }) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const c = p.customer;
  const first = c.name.split(" ")[0]!;
  const pending = [...p.messages].reverse().find((m) => m.direction === "out" && m.status === "pending_approval");
  const asked = [...p.messages].reverse().find((m) => m.direction === "in" && m.status === "needs_person");
  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    toast(r.ok ? done : (r.error ?? "That didn't work"), { tone: r.ok ? "info" : "error" });
    if (r.ok) setReply("");
  };
  const checkin = [...p.messages].reverse().find((m) => m.direction === "out" && m.kind === "checkin" && (m.status === "sent" || m.status === "delivered" || m.status === "queued"));
  let tone = "ok";
  let title = "";
  let body: React.ReactNode = null;
  let actions: React.ReactNode = null;
  if (pending) {
    tone = "plum";
    title = "Waiting for your approval";
    body = (
      <>
        <b>{pending.reasonChip ?? "A proposed message"}</b>: “{pending.body}”
        {pending.whySentence && <div className="mt-0.5 text-[13px] text-muted">{pending.whySentence}</div>}
      </>
    );
    actions = (
      <>
        <button className="btn primary" disabled={busy} onClick={() => act(() => post(`/api/messages/${pending.id}/approve`), "Approved")}>Approve</button>
        <button className="btn" disabled={busy} onClick={() => act(() => post(`/api/messages/${pending.id}/hold`), "Held")}>Hold</button>
      </>
    );
  } else if (asked) {
    tone = "plum";
    title = `${first} wrote and needs a person`;
    body = (
      <>
        “{asked.body}”
        <div className="mt-2 flex gap-2">
          <input aria-label={`Reply to ${first}`} className="min-w-0 flex-1" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Type a reply (sent as Classic Cup)" />
          <button className="btn primary" disabled={busy || !reply.trim()} onClick={() => act(() => post(`/api/customers/${c.id}/actions`, { action: "reply", body: reply, messageId: asked.id }), "Reply sent")}>Send</button>
        </div>
      </>
    );
    actions = <button className="btn" disabled={busy} onClick={() => act(() => post(`/api/customers/${c.id}/actions`, { action: "resolve", messageId: asked.id }), "Marked resolved")}>Mark resolved</button>;
  } else if (c.state === "CANCELLED" || c.state === "OPTED_OUT") {
    tone = "bad";
    title = c.state === "CANCELLED" ? "Cancelled: nothing to do" : "Texts are off: nothing will be sent";
    body = c.state === "OPTED_OUT" ? "They replied STOP. Only they can turn texts back on (by replying START)." : "No further deliveries are scheduled.";
  } else if (c.holiday && c.nextDelivery) {
    tone = "warn";
    title = `Delivery lands over ${c.holiday}`;
    body = "The check-in asks if they're away; if they reply AWAY the delivery is held until the Wednesday after they're back.";
  } else if (p.projection && !p.projection.freshReply) {
    tone = "warn";
    title = checkin ? "Waiting for a reply to the check-in" : "No check-in yet this cycle";
    body = checkin ? `The check-in went out ${relativeTime(checkin.at, p.now)}. Until ${first} replies the system holds off and changes nothing.` : "Without a reply the system holds off and changes nothing. You can ask now.";
    if (!checkin) actions = <button className="btn primary" disabled={busy} onClick={() => act(() => post(`/api/customers/${c.id}/actions`, { action: "send_checkin_now" }), "Check-in sent")}>Send check-in now</button>;
  } else {
    title = "On track: nothing needed";
    body = c.nextDelivery ? `Next delivery ${fmtDay(c.nextDelivery)}. The reminder goes out three days before.` : "No delivery is scheduled.";
  }
  const border = tone === "plum" ? "border-plum bg-plum-tint" : tone === "warn" ? "border-line bg-cream" : tone === "bad" ? "border-danger" : "border-line bg-surface";
  return (
    <section aria-label="Next action" className={`mb-5 flex items-start justify-between gap-4 rounded-xl border p-4 ${border}`}>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Next action</div>
        <div className="text-[18px] font-medium text-strong">{title}</div>
        <div className="mt-0.5 text-[14px]">{body}</div>
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </section>
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
      <div className="sticky -top-4 z-20 -mx-6 mb-4 border-b border-line bg-cream px-6 py-3">
        <a href={href("/customers")} className="mb-1 inline-block text-[13px] text-muted no-underline hover:text-strong">
          ← Customers
        </a>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="m-0 text-[32px] font-normal leading-tight tracking-tight text-strong">{c.name}</h1>
              <ConsentChip label="Delivery texts" yes={c.consentDelivery} />
              <ConsentChip label="Offers" yes={c.consentOffers} />
              {c.state === "OPTED_OUT" && <span className="chip bad">Texts stopped</span>}
              {c.state === "CANCELLED" && <span className="chip bad">Cancelled</span>}
              {c.state === "HELD" && <span className="chip warn">Held until {c.heldUntil ? fmtMonthDay(c.heldUntil) : ""}</span>}
              {c.acquisition && (
                <span className="chip plum" title={`Scanned lot ${c.acquisition.lot} (${c.acquisition.roast}) at ${c.acquisition.store}; the bag was ${c.acquisition.ageAtScan} days from roasting`}>
                  Via bag QR · {c.acquisition.store}
                </span>
              )}
              {c.holiday && <span className="chip warn" title="The check-in asks if they're away; AWAY holds the delivery until they're back">Next delivery lands over {c.holiday}</span>}
            </div>
            <div className="mt-1 text-[14px] text-muted">
              Next delivery <b className="text-ink">{c.nextDelivery ? fmtDay(c.nextDelivery) : "none scheduled"}</b> · {c.plan}
              {suggested !== null && Math.round(suggested / 7) !== Math.round(c.rhythmDays / 7) && <> (we suggested every {Math.round(suggested / 7)} weeks)</>} · {c.city} · {SOURCE_LABEL[c.source]} sign-up · member since {fmtMonthDay(c.memberSince)}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn primary" title="Text them now to ask how much coffee is left" onClick={async () => { const r = await post<{ ok: boolean; error?: string }>(`/api/customers/${id}/actions`, { action: "send_checkin_now" }); toast(r.ok ? "Check-in sent" : (r.error ?? "Could not send"), { tone: r.ok ? "info" : "error" }); }}>
              Send check-in now
            </button>
            <button className="btn" title="Pick a new date for the next delivery" onClick={() => setModal("move")}>Move delivery…</button>
            <button className="btn" title="Don't deliver before a date, for example while they travel" onClick={() => setModal("hold")}>Hold until…</button>
            <button className="btn" title="Stop deliveries for a few weeks" onClick={() => setModal("pause")}>Pause…</button>
            <button className="btn" onClick={() => setModal("note")}>Add note</button>
          </div>
        </div>
      </div>

      <NextAction p={p} />
      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-8 space-y-5">
          <Card>
            <h2 className="m-0 mb-1 text-[20px] font-medium tracking-tight text-strong">{p.pantry.title}</h2>
            <div className="mb-2 text-[13px] text-muted">Days of coffee on hand · {p.pantry.empty ?? "labelled directly on the chart"}</div>
            <PantryChart pantry={p.pantry} />
          </Card>
          <FreshnessCard p={p} />
          <Card>
            <h2 className="m-0 mb-3 text-[20px] font-medium tracking-tight text-strong">Messages</h2>
            <MessageThread messages={p.messages} />
          </Card>
          <Card pad={false}>
            <h2 className="m-0 px-4 pb-2 pt-4 text-[20px] font-medium tracking-tight text-strong">Order history</h2>
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
                    <th title="Roast to door plus the coffee ahead of it: about how old the bag was when opened">Opened after roasting</th>
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
                      <td className="tnum">{d.openedAtAge !== null ? <span className={d.openedAtAge > FRESHNESS.peakEndDays ? "text-link" : ""}>~{d.openedAtAge} days</span> : "–"}</td>
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
              <h2 className="m-0 mb-3 text-[20px] font-medium tracking-tight text-strong">Why this date</h2>
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
              <h2 className="m-0 mb-2 text-[16px] font-medium tracking-tight text-strong">Activity log</h2>
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
                <button className="mt-2 border-0 bg-transparent p-0 text-[13px] text-link underline" onClick={() => setShowAll((s) => !s)}>
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
