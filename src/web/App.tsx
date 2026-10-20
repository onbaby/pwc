import { useState } from "react";
import { Shell } from "./components/Shell.tsx";
import { BagQrPage } from "./pages/BagQr.tsx";
import { QrLanding } from "./pages/QrLanding.tsx";
import { CustomerProfile } from "./pages/CustomerProfile.tsx";
import { Customers } from "./pages/Customers.tsx";
import { ImpactPage } from "./pages/Impact.tsx";
import { Inbox } from "./pages/Inbox.tsx";
import { OfferPage, OffersList } from "./pages/Offers.tsx";
import { OutlookPage } from "./pages/Outlook.tsx";
import { Settings } from "./pages/Settings.tsx";
import { Today } from "./pages/Today.tsx";
import { useRoute } from "./router.ts";

type InboxTab = "needs" | "approvals" | "all";

export function App() {
  const route = useRoute();
  const [section, id] = [route.path[0] ?? "today", route.path[1]];
  const q = route.query.get("tab");
  const tab: InboxTab = q === "approvals" || q === "all" ? q : "needs";
  const [, setTab] = useState<InboxTab>(tab);
  // the public page a grocery buyer opens from a bag's QR code: customer-facing, so no console shell
  if (section === "q" && id) return <QrLanding key={id} code={id} />;
  let page;
  switch (section) {
    case "customers":
      page = id ? <CustomerProfile key={id} id={id} /> : <Customers />;
      break;
    case "inbox":
      page = <Inbox tab={tab} setTab={setTab} />;
      break;
    case "offers":
      page = id ? <OfferPage key={id} id={id} /> : <OffersList />;
      break;
    case "qr":
      page = <BagQrPage />;
      break;
    case "outlook":
      page = <OutlookPage />;
      break;
    case "impact":
      page = <ImpactPage />;
      break;
    case "settings":
      page = <Settings />;
      break;
    default:
      page = <Today />;
  }
  return <Shell route={route}>{page}</Shell>;
}
