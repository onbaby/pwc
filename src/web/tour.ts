/** A guided route through the console (sandbox drawer, and Ctrl+Alt+1 to 7). Each stop is a page a judge can see in under a minute. */
export interface TourStop {
  to: string;
  label: string;
  /** one line to say about it */
  say: string;
}

export const TOUR: TourStop[] = [
  { to: "/today", label: "Today", say: "The morning worklist: who is running out, who needs a person, what is waiting for approval." },
  { to: "/customers/maya-thompson", label: "Maya: reply, move, fresher cup", say: "One text reply tightens her range; the move passes six checks; the bag opens fresher." },
  { to: "/customers/dev-patel", label: "Dev: when not to act", say: "New subscriber, no reply yet: the system holds off and changes nothing." },
  { to: "/inbox?tab=approvals", label: "Inbox: a person stays in charge", say: "Anything risky waits here with a plain-English reason." },
  { to: "/customers", label: "Customers: worklists for reps", say: "Saved views (needs attention, running out, new), a CSV export, one click into any account." },
  { to: "/qr", label: "Bag QR: grocery to subscriber", say: "Scans, sign-ups and how long bags sit on the shelf, by store." },
  { to: "/offers/new", label: "Offers: targeted and measured", say: "Who is eligible and why others are excluded, break-even, and a control group." },
  { to: "/outlook", label: "Roast outlook: for the roaster", say: "Six weeks of pounds with a likely range, exportable." },
];
