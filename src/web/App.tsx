import { useState } from "react";
import { Shell } from "./components/Shell.tsx";
import { type InboxTab, PageFor } from "./PageFor.tsx";
import { Follow } from "./pages/Follow.tsx";
import { Join } from "./pages/Join.tsx";
import { QrLanding } from "./pages/QrLanding.tsx";
import { useRoute } from "./router.ts";

export function App() {
  const route = useRoute();
  const [section, id] = [route.path[0] ?? "today", route.path[1]];
  const [, setTab] = useState<InboxTab>("needs");
  // the public page a grocery buyer opens from a bag's QR code: customer-facing, so no console shell
  if (section === "q" && id) return <QrLanding key={id} code={id} />;
  // guests following along on a phone, and the full-screen join code for the room: no console shell either
  if (section === "follow") return <Follow />;
  if (section === "join") return <Join />;
  return (
    <Shell route={route}>
      <PageFor path={route.path} query={route.query} setTab={setTab} />
    </Shell>
  );
}
