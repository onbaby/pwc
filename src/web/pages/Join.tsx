import { api } from "../api.tsx";
import { useEffect, useState } from "react";
import { QrPath } from "../components/BagLabel.tsx";

interface Info {
  base: string;
  followUrl: string;
  otherUrls: string[];
  onNetwork: boolean;
}

/** Full-screen code for the room: judges scan it to follow along on their own phones. Open it in its own window and show it on the projector. */
export function Join() {
  const [info, setInfo] = useState<Info>();
  useEffect(() => {
    api<Info>("/api/follow/info").then(setInfo).catch(() => undefined);
  }, []);
  return (
    <div className="brand flex min-h-full flex-col items-center justify-center bg-cream px-6 py-8 text-center">
      <div className="text-[18px] font-semibold text-espresso">Classic Cup · Right on Time</div>
      <h1 className="m-0 mt-2 text-[40px] font-normal leading-tight text-strong">Follow along on your phone</h1>
      <p className="mb-6 mt-2 max-w-[560px] text-[18px]">Scan the code to see the same screen we are showing, live. You can look but not change anything.</p>
      {info ? (
        <>
          <svg viewBox="0 0 300 300" width="min(60vh, 90vw)" height="min(60vh, 90vw)" role="img" aria-label={`QR code that opens ${info.followUrl}`}>
            <QrPath text={info.followUrl} x={0} y={0} size={300} />
          </svg>
          <div className="mt-4 break-all text-[20px] font-medium text-strong">{info.followUrl}</div>
          {info.otherUrls.length > 0 && <div className="mt-1 text-[13px] text-muted">Other addresses on this computer: {info.otherUrls.join(" · ")}</div>}
          <p className="mt-3 max-w-[560px] text-[14px] text-muted">
            {info.onNetwork ? "Your phone needs to be on the same Wi-Fi as this computer." : "No Wi-Fi address was found on this computer: connect to the room's Wi-Fi or a phone hotspot, then reload this page."}
          </p>
        </>
      ) : (
        <div className="text-muted">Loading…</div>
      )}
    </div>
  );
}
