import { useEffect, useState } from "react";
import { api, post } from "../api.tsx";
import { fmtDay } from "../format.ts";

/**
 * The page a grocery buyer opens by scanning a bag (one page on the existing website: no app, no login). It shows how
 * fresh that bag is, then offers the same coffee roasted to order and timed to when they run out. Customer-facing, so
 * it is outside the console shell.
 */
interface LotDTO {
  code: string;
  roast: string;
  roastDate: number;
  store: string;
  ageDays: number;
  band: "best" | "peak" | "past_peak";
  bestByDays: number;
  peakEndDays: number;
  roastToDoorDays: number;
  price: number;
  firstDelivery: number;
  rhythmMenu: number[];
  rhythms: Record<string, number>;
  consentTexts: { delivery: string; offers: string };
  error?: string;
}

// one scan per page load (React's development double-mount must not count twice)
const scans = new Map<string, Promise<{ ok: boolean; scanId?: number }>>();
const scanOnce = (code: string) => {
  if (!scans.has(code)) scans.set(code, post<{ ok: boolean; scanId?: number }>("/api/qr/scan", { code }));
  return scans.get(code)!;
};

const HEADLINE: Record<LotDTO["band"], string> = {
  best: "This bag is at its best.",
  peak: "This bag is still in its peak window.",
  past_peak: "This bag is past its peak.",
};

function FreshnessMeter({ age, best, peak }: { age: number; best: number; peak: number }) {
  const max = Math.max(peak * 2, age + 7);
  const at = (d: number) => `${(Math.min(d, max) / max) * 100}%`;
  return (
    <div aria-label={`Roasted ${age} days ago`} role="img">
      <div className="relative h-3 overflow-hidden rounded-full bg-[#F3E6DC]">
        <div className="absolute inset-y-0 left-0 bg-success" style={{ width: at(best) }} />
        <div className="absolute inset-y-0 bg-[#7FB89C]" style={{ left: at(best), width: `calc(${at(peak)} - ${at(best)})` }} />
      </div>
      <div className="relative h-6">
        <div className="absolute -top-[18px] h-6 w-[3px] -translate-x-1/2 rounded bg-ink" style={{ left: at(age) }} />
      </div>
      <div className="relative -mt-3 h-4 text-[12px] text-muted">
        <span className="absolute left-0">Roasted</span>
        <span className="absolute -translate-x-1/2" style={{ left: at(best) }}>2 weeks</span>
        <span className="absolute -translate-x-1/2" style={{ left: at(peak) }}>4 weeks</span>
      </div>
    </div>
  );
}

export function QrLanding({ code }: { code: string }) {
  const [lot, setLot] = useState<LotDTO>();
  const [scanId, setScanId] = useState<number>();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [cups, setCups] = useState(2);
  const [people, setPeople] = useState(2);
  const [rhythm, setRhythm] = useState<number | null>(null);
  const [consentDelivery, setConsentDelivery] = useState(false);
  const [consentOffers, setConsentOffers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<{ firstDelivery: number; rhythmDays: number } | null>(null);

  useEffect(() => {
    api<LotDTO>(`/api/qr/lots/${encodeURIComponent(code)}`).then(setLot).catch(() => setLot({ error: "not found" } as LotDTO));
    scanOnce(code).then((r) => r.scanId !== undefined && setScanId(r.scanId)).catch(() => undefined);
  }, [code]);

  if (!lot) return <Page><div className="text-muted">Loading…</div></Page>;
  if (lot.error) return <Page><h1 className="text-[24px] font-semibold text-espresso">We couldn't find that bag.</h1><p className="text-muted">Check the code under the QR, or visit classiccup.example.</p></Page>;

  const suggested = lot.rhythms[`${cups}-${Math.min(people, 4)}`] ?? 42;
  const chosen = rhythm ?? suggested;
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    const r = await post<{ ok: boolean; error?: string; firstDelivery?: number; rhythmDays?: number }>("/api/qr/signup", { scanId, code, name, phone, cups, people, rhythmDays: chosen, consentDelivery, consentOffers });
    setBusy(false);
    if (r.ok && r.firstDelivery !== undefined) setDone({ firstDelivery: r.firstDelivery, rhythmDays: r.rhythmDays ?? chosen });
    else setError(r.error ?? "Something went wrong. Please try again.");
  };

  return (
    <Page>
      <div className="text-[13px] font-medium uppercase tracking-wide text-muted">{lot.roast} · bought in {lot.store}</div>
      <h1 className="m-0 mt-1 text-[28px] font-semibold leading-tight text-espresso">{HEADLINE[lot.band]}</h1>
      <p className="mb-4 mt-2 text-[16px]">
        It was roasted in Athens on <b>{fmtDay(lot.roastDate)}</b>, <b>{lot.ageDays} day{lot.ageDays === 1 ? "" : "s"} ago</b>. Coffee is at its best within two to four weeks of roasting, then the flavor fades.
      </p>
      <FreshnessMeter age={lot.ageDays} best={lot.bestByDays} peak={lot.peakEndDays} />

      <div className="card mt-6 p-4">
        {done ? (
          <div>
            <h2 className="m-0 text-[20px] font-semibold text-espresso">You're in.</h2>
            <p className="mb-0 mt-2 text-[15px]">
              Your first bag is roasted to order and arrives <b>{fmtDay(done.firstDelivery)}</b>, then about every {Math.round(done.rhythmDays / 7)} weeks.
              {consentDelivery ? " We just texted you to confirm delivery texts: reply YES and we'll time each bag to when you're running low." : " You can turn on delivery-timing texts any time."}
            </p>
          </div>
        ) : (
          <div className="space-y-3 text-[14px]">
            <h2 className="m-0 text-[20px] font-semibold text-espresso">Get it roasted to order instead</h2>
            <p className="m-0 text-muted">
              At your door {lot.roastToDoorDays} days after roasting, and timed to when you actually run out: we check in by text and move a delivery if you're not ready. ${lot.price} a bag, skip or cancel anytime.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-muted">Cups a day at home</span>
                <select className="w-full" value={cups} onChange={(e) => (setCups(Number(e.target.value)), setRhythm(null))}>
                  {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n === 4 ? "4 or more" : n}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-muted">People drinking it</span>
                <select className="w-full" value={people} onChange={(e) => (setPeople(Number(e.target.value)), setRhythm(null))}>
                  {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n === 4 ? "4 or more" : n}</option>)}
                </select>
              </label>
            </div>
            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-1 text-muted">How often? Most homes like yours choose every {Math.round(suggested / 7)} weeks.</legend>
              <div className="flex flex-wrap gap-2">
                {lot.rhythmMenu.map((d) => (
                  <button key={d} type="button" className={`btn ${chosen === d ? "primary" : ""}`} aria-pressed={chosen === d} onClick={() => setRhythm(d)}>
                    Every {d / 7} weeks{d === suggested ? " · suggested" : ""}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="block">
              <span className="mb-1 block text-muted">Name</span>
              <input className="w-full" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </label>
            <label className="block">
              <span className="mb-1 block text-muted">Mobile number</span>
              <input className="w-full" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="(706) 555-0100" />
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={consentDelivery} onChange={(e) => setConsentDelivery(e.target.checked)} />
              <span className="text-[13px]">Text me to time my deliveries. We'll send this to confirm: “{lot.consentTexts.delivery}”</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={consentOffers} onChange={(e) => setConsentOffers(e.target.checked)} />
              <span className="text-[13px]">Also send occasional offers (optional, not required to buy): “{lot.consentTexts.offers}”</span>
            </label>
            {error && <div className="text-[14px] text-danger" role="alert">{error}</div>}
            <button className="btn primary w-full justify-center py-2.5 text-[16px]" disabled={busy || scanId === undefined} onClick={submit}>
              Start my subscription · first bag {fmtDay(lot.firstDelivery)}
            </button>
          </div>
        )}
      </div>
      <p className="mt-4 text-[12px] text-muted">Lot {lot.code} · Classic Cup Coffee, Athens GA · Sandbox · sample data</p>
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="brand min-h-full">
      <header className="bg-espresso px-5 py-3 text-[#FBF6F1]">
        <div className="mx-auto max-w-[520px] text-[18px] font-semibold">Classic Cup</div>
      </header>
      <main className="mx-auto max-w-[520px] px-5 py-6">{children}</main>
    </div>
  );
}
