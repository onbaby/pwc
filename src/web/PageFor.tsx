import { BagQrPage } from "./pages/BagQr.tsx";
import { CustomerProfile } from "./pages/CustomerProfile.tsx";
import { Customers } from "./pages/Customers.tsx";
import { Inbox } from "./pages/Inbox.tsx";
import { OutlookPage } from "./pages/Outlook.tsx";
import { PilotPage } from "./pages/Pilot.tsx";
import { Settings } from "./pages/Settings.tsx";
import { Today } from "./pages/Today.tsx";

export type InboxTab = "needs" | "approvals" | "all";

/** The page for a route. Shared by the console and by the guest view that mirrors it. */
export function PageFor({ path, query, setTab }: { path: string[]; query: URLSearchParams; setTab?: (t: InboxTab) => void }) {
  const [section, id] = [path[0] ?? "today", path[1]];
  const q = query.get("tab");
  const tab: InboxTab = q === "approvals" || q === "all" ? q : "needs";
  switch (section) {
    case "customers":
      return id ? <CustomerProfile key={id} id={id} /> : <Customers />;
    case "inbox":
      return <Inbox tab={tab} setTab={setTab ?? (() => undefined)} />;
    case "qr":
      return <BagQrPage />;
    case "outlook":
      return <OutlookPage />;
    case "pilot":
      return <PilotPage />;
    case "settings":
      return <Settings />;
    default:
      return <Today />;
  }
}
