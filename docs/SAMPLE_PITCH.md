# Sample pitch: "Right on Time" (18 minutes + Q&A)

**Audience:** consultants and business people who know basic tech terms; at least one technologist; few have worked with AI. **Rule for every sentence:** say what it does for the business first; name the technique only if someone asks.

**Rubric to hit:** Problem framing 25 · Recommendation 25 · Analytical rigor 20 · Risk and adoption 15 · Communication 15.

> The numbers below come from the case exhibits and from this prototype (sample data). Where a number is an assumption, the script says so out loud. Re-check every figure against the app on the morning of the pitch.

---

## Run sheet

| Time | Section | On screen | Who | Rubric |
|---|---|---|---|---|
| 0:00–2:30 | 1. The problem | Slide: Exhibit C | Speaker 1 | Framing |
| 2:30–4:30 | 2. Why DTC, and what is at stake | Slide (or Impact → top two cards) | Speaker 1 | Framing |
| 4:30–6:30 | 3. The idea in plain English | Slide: the pantry diagram | Speaker 2 | Recommendation |
| 6:30–12:30 | 4. **Live demo** | The console | Speaker 2 drives, Speaker 1 narrates | Recommendation, Communication |
| 12:30–14:30 | 5. Does it pay? What we know and don't | Impact page | Speaker 1 | Rigor |
| 14:30–16:30 | 6. The ask: a 12-week pilot; risks; ethics | Slide | Speaker 2 | Risk and adoption |
| 16:30–17:30 | 7. Close | Slide | Speaker 1 | Communication |
| 17:30–18:00 | Buffer | | | |

---

## 1. The problem (2:30)

**Say:**

> Classic Cup's online subscription business is the best part of the company: **61% gross margin, growing 14% a year**, against 3% for the company's own cafes. But look at who it is growing with. **8,670 people sign up every year, and 6,622 of them are gone within twelve months.** Only 54% are still here at 90 days. That is a leaky bucket, and the leak is not random.
>
> Exhibit C tells us why. For the two biggest sign-up sources, **cafe and website, almost half of all new subscribers, the number one reason for cancelling is "too much coffee arriving."**
>
> Think about what that means. Classic Cup controls the schedule *completely*. It decides every ship date. And yet it has no idea how much coffee is sitting in anyone's kitchen. Somebody drinks one cup a day, somebody else three. Everyone gets a bag every four weeks. For one person the pile grows until they cancel. Another runs out and goes to the grocery store. **The company is steering by a fixed calendar when what matters is the pantry.**

**Show:** Exhibit C table (source, new subs, kept at 90 days, top cancel reason). Point at the first two rows.

**Land the point:** "Different customers cancel for different reasons. One fix will not work for all of them." (This sets up the second lever, targeted offers, and the QR code.)

---

## 2. Why DTC, and what is at stake (2:00)

**Say:**

> Why back a channel that is 5% of revenue? Because it is **visible** (Classic Cup sees every transaction and every customer), **controllable** (it owns the schedule), and **testable in a quarter**. And it has a freshness story the grocery shelf cannot match: a bag roasted to order lands at the door five days later. The case itself puts peak flavor at two to four weeks.
>
> So there are two halves to the fix. **Keep the first-timers**: time each delivery so coffee is never piling up and never running out. And **bring more of them in**: a QR code on every grocery bag turns a shelf purchase into a subscription.
>
> If we keep 10% more subscribers and convert 5% of grocery buyers, that is about **$276,000 a year in gross profit** (about $79,000 from retention and $197,000 from grocery), with no new stores, no extra sales staff and no price increase. I want to be direct about what that number is: it is **arithmetic on the case exhibits plus one assumption we flag** (twelve grocery bags per buyer per year). It is not a forecast. What we ask you to approve is the experiment that finds out whether those two inputs are real.

**Show:** Impact page, "Why direct to consumer?" and "What it could be worth" cards (or one slide with the same content).

**If you only keep one sentence:** "It is arithmetic, not a forecast; the pilot measures the two inputs."

---

## 3. The idea in plain English (2:00)

Use one slide with a picture of a coffee canister and a question mark.

**Say:**

> Our system is like a **weather forecast for each customer's coffee canister.** We cannot see inside the canister. But we know three things: when each bag was delivered, how a household like theirs usually drinks, and, if we ask, **what they tell us.**
>
> So once per delivery we send **one text**: "About how many weeks of coffee do you have left?" About 45% reply, and replies are fuzzy. People say "six" when it is really five or seven.
>
> The system handles that fuzziness the way a forecaster does: it does not guess *one* answer, it keeps **500 what-if versions of that customer's pantry**, some where they drink slowly, some fast. When the customer says "six weeks," it **keeps the versions that agree and drops the ones that don't.** What is left is a *range*: "most likely runs out around November 27, probably between November 11 and December 15."
>
> Then a few simple rules turn the range into a delivery date, and **a person approves anything risky.** The software never lets a delivery come sooner without the customer saying YES, never moves a date more than two weeks at a time, and never texts at night. Nothing here is a chatbot; there is no ChatGPT in the loop. It is a statistical model that runs on Classic Cup's own server, and every text it sends can show *why*.

**Show:** a simple diagram: *deliveries + one reply → 500 what-if pantries → a range → a date → a human check.*

**If a judge asks "is that AI?":** "It is the kind of AI that is closest to forecasting: statistics that update as evidence arrives. We chose it because it can say how unsure it is, and a wrong date makes someone run out of coffee."

---

## 4. Live demo (6:00): procedure

### Before you go on stage

| When | Do |
|---|---|
| Night before | `pnpm install`, `pnpm test` (all pass), `pnpm build`. Record a **backup screen recording** of the full demo path. |
| T−30 min | In `pwc/`: `CHANNEL=replay pnpm demo`. Wait for the line *"Right on Time: http://localhost:8787"* (about 15 seconds; it resets the sample data on boot, so every run starts identical). |
| T−20 min | Open http://localhost:8787 in the browser, full screen, zoom so the room can read 14 px text. Turn off notifications. Wi-Fi can be off: **everything runs offline.** |
| T−10 min | Press **Ctrl+Alt+D**, confirm the drawer shows *Clock: Sun Oct 18, 9:00 am*, *Scripted events 0 of 3*, *Channel: Replay*. Press **Reset sandbox** once, then close the drawer. |
| T−2 min | Land on **Today**. Do not scroll. |

**Stage rule:** the presenter touches only two keys: **Ctrl+Alt+→** (advance the scripted story) and the mouse. Do not type in the drawer on stage.

### The script

| Min | Beat | You do | You say |
|---|---|---|---|
| 0:00 | **Today** | Stay on the page. | "This is the screen the subscription team opens each morning. Four numbers, then a worklist. *Next bags opened at peak* is our freshness measure. *Needs a person* are texts the software won't touch. *Waiting for approval* are moves a human must sign off." (The only demo wording on screen is the *Sandbox · sample data* badge. Say once: "Everything here runs on sample customers we generated to match Classic Cup's numbers; the model's projections are computed live.") |
| 0:40 | **Maya: the problem** | Search "Maya Thompson", open her profile. | "Maya signed up in the cafe and gets a bag every four weeks. Watch the chart: each delivery **stacks on top of what's left.** Her pile on arrival has grown from nothing to 9 days to 17 days, and it keeps growing. Right now the system only has a guess from similar customers, and the chart says so." |
| 1:30 | **Ask** | Press **Ctrl+Alt+→** once. | "It's 10 a.m. Sunday. The morning check-ins go out." Point at Maya's thread: the one question. |
| 1:50 | **Reply and move** | Press **Ctrl+Alt+→** again. | "Maya replies **6**. Look at what changes. The range tightens: *likely runs out around November 27.* The system proposes moving her bag from **October 28 to November 11**, and since it is a *later* move, with notice, a reply, and a delivered receipt, **it passes six safety checks and goes out automatically.**" |
| 2:30 | **Freshness** | Point at the Freshness card (original vs new). | "Here's why the move matters: on October 28 the bag would have been opened about **35 days after roasting, past its peak**; on November 11 it's opened at **21 days, inside the two-to-four-week window.** Same customer, same coffee, fresher cup." |
| 3:00 | **Trust** | Click **Why we sent this** on the proposal. | "Every text explains itself in plain English: what the customer said, how sure we are, which checks passed. A person can always see why." |
| 3:30 | **Dev: when not to act** | Search "Dev Patel", open. | "Dev is new. One delivery, no reply yet. The system says **'not yet sure', so it does nothing.** Knowing when *not* to act is as important as acting." |
| 4:00 | **Bag QR** | Press **Ctrl+Alt+D** → *Open the newest bag's QR page*. (New tab.) | "This is the second half: the grocery shelf. Every retail bag has a QR code with a lot number. A shopper scans it, sees **how many days ago this bag was roasted**, and can start a subscription roasted to order, with a rhythm suggested from two questions. No app, no account; texts start only after they reply YES. And the console now sees how long bags sit on shelves, something grocery has never told Classic Cup." Close the tab. |
| 5:00 | **Money** | Click **Impact**; scroll to *What it could be worth*; move the sliders. | "Move the sliders and the dollars update. Everything is from the exhibits, and the one assumption is labelled." |
| 5:30 | **Back to the slide** | Stop. | Hand off to section 5. |

**Cut order if you run long:** Dev → "Why we sent this" → the money sliders (say it from the slide instead). **Never cut:** Maya's reply, move and freshness.

**If something fails:** (1) refresh the page; (2) press **Ctrl+Alt+D → Reset sandbox** and repeat from Maya; (3) play the backup recording and narrate over it. Never debug live.

**Optional (30 seconds, only if time): Offers.** *Offers → New.* "Different cancel reasons need different offers. For people who signed up 'only sampling,' this one rotates a new roast each delivery. It never adds a text, it's capped at one a month, and it always has a control group, so we measure whether it worked. The tool computes who is eligible and why others are excluded."

---

## 5. Does it pay? What we know, and don't (2:00)

**Say, with the Impact page's pacing card:**

> We also built a simulator of a few thousand synthetic customers, calibrated to the case's retention numbers, to ask: does timing deliveries pay for itself? **Our honest answer: timing alone does not, unless stockpiles drive almost all of these cancellations, and nobody knows that share today.** With *perfect* knowledge of every pantry, it pays once about half of cancellations are stockpile-driven. And the biggest lever by far is **how many customers reply to the text.** That is why we protect that text.
>
> We would rather tell you that than overclaim. It is also why our recommendation is a **pilot**, not a rollout.
>
> Two more checks: first, we tested the method on **real purchase data**: over a million orders from a public retailer. It predicted repeat-purchase timing better than a simple "same gap as last time" rule, and its "80% range" really did contain the truth about 80% of the time. That is real data, but wholesalers, not coffee drinkers, and no text replies, so it tests the math, not the whole idea. Second, the plan for that test was committed to the repository *before* we ran it, so we could not choose the favorable result.

**Show:** the slider and the *What would make it better* table; then the *Model check on real data* card.

**Avoid:** "AI will save $X." **Say instead:** "Here is the bar it has to clear, here is how likely it is to clear it, here is the experiment."

---

## 6. The ask, risks and ethics (2:00)

**The ask (say it plainly):**

> Approve a **12-week pilot** on pay-as-you-go cafe and website subscribers. **Three random groups:** (1) today's fixed schedule, (2) check-in texts only, (3) check-in plus paced delivery. Run by the existing subscription team, about ten minutes of their morning.
>
> **Go** if late deliveries and stockpiles fall *and* at least 40% of customers reply. **Stop** if opt-outs, complaints or late deliveries cross a guardrail two weeks running. We freeze moves from November 15 to January 5, because December is 41% above the average month. A second small pilot puts QR codes on the bags at a handful of grocery accounts.

**Adoption (rubric: risk and adoption):**
- Internal tool for 2–4 people; no new customer app or portal (a case rule).
- Replaces nothing; it sits on top of Classic Cup's existing subscription and text platform through its API.
- Humans approve anything risky; free-text replies always go to a person.

**Ethics and law (rubric: "be concrete and ethical about the AI"):**
- Two separate opt-ins: delivery texts and offers. "NO OFFERS" stops offers only; "STOP" stops everything.
- No texts 9 pm–8 am; at most three routine texts per delivery.
- Sooner deliveries cost the customer money earlier, so they need **an explicit YES**.
- Offers that discount are limited to gift recipients, need manager approval, and use only source, gift status and tenure (never city, ZIP or name).
- Counsel should review the consent wording before any real texting. We flag this as open.

**Honest limits, to say yourself before a judge does:**
1. The starting estimate for a new customer is fitted on sample data, so it is circular. The pilot replaces it with real data.
2. Every dollar figure is a simulation or arithmetic on labelled assumptions.
3. Photon (the iMessage provider) is demonstrated through a replay; a live-phone test is still to do.

---

## 7. Close (1:00)

> Classic Cup already controls the one thing that decides whether a subscriber stays: **when the next bag arrives.** Today it sets that date by calendar. We propose to set it by the customer's pantry, ask one simple question to learn it, keep a human in charge, and measure everything against a control group. **Twelve weeks. One team. A clear go or stop.** Thank you; we'd love your questions.

---

## Q&A cheat sheet

| Question | Short answer |
|---|---|
| **What does the AI actually do?** | Estimates when each customer runs out, from deliveries and one text reply, and proposes a date with a plain-English reason. |
| **Is it just ChatGPT?** | No. No language model. A statistical model on Classic Cup's own server, no outside calls. Free-text replies go to a person. |
| **How do you know it works?** | Two ways: real purchase data (beats a calibrated baseline at the first two reorders, ranges hold near 80%), and a simulator. Neither proves the coffee effect; the pilot does. |
| **Why is timing alone not profitable in your sim?** | Fewer deliveries means less revenue, and the stockpile share of cancellations is unknown. We show the bar it has to clear (about 2.7 points of retention at our placeholder). Reply rate is the lever. |
| **Where does $276K come from?** | Exhibit A (DTC gross profit $793K × 10%) plus grocery volume from Exhibit B at 12 bags per buyer × a 5% conversion × first-year value of a subscriber, minus the grocery margin given up. The 12 bags and the percentages are assumptions; the page lets you change them. |
| **Freshness: did you prove fresher coffee?** | Not on average: our sim shows about 60 days on a fixed schedule vs 58 paced (age at the cup). What timing fixes is the bag that waits a month behind a stockpile. The profile shows that per customer. Bag size is the other lever. |
| **Won't customers hate texts?** | One routine question per delivery, at most three routine texts, none at night, STOP and NO OFFERS always work, and offers pause automatically if opt-outs pass 2%. |
| **A wrong date makes someone run out.** | We aim at the *early* end of the range plus a 3-day cushion; every reminder says "Running low? Reply SOONER"; sooner moves need a YES. |
| **Why discounts only for gifts?** | Only the gift cohort cancels over price; margin is the channel's strength; discounting everyone pays people who would have stayed. Every offer has a holdout to prove it. |
| **Is the data real?** | The console runs on synthetic customers matched to the case's numbers (badge on screen, said aloud). The real-data check uses public retail data. |
| **Is the QR page a customer portal?** | One page on the existing website, no login, ending in the same subscription. |
| **Why not wholesale or the cafes?** | DTC is visible, controllable and testable in a quarter. The same "text as a sensor" idea can extend to the 744 wholesale accounts later. |
| **How much does this cost to run?** | Server-side software with no per-call fees; the placeholder program cost is $2 per active subscriber-year (texts and care time), flagged as unverified; first question to the client. |
| **What would you need from Classic Cup?** | Orders per subscriber, delivery days, cancel-reason shares, whether offer consent exists today, bags per grocery buyer, and whether retail bags can carry a printed code. |

---

## Words to avoid on stage → say this instead

| Avoid | Say |
|---|---|
| Particle filter, Bayesian | "500 what-if versions of the pantry; keep the ones that agree with the customer" |
| Posterior, quantile, P10–P90 | "the likely range" |
| Latent variable | "what we can't see: the pile" |
| Holdout, A/B test | "a control group that doesn't get the change" |
| Calibration | "when we say 80%, it should be right about 80% of the time" |
| Synthetic data | "sample customers we generated to match the case" |
