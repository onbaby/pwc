# Right on Time: the team handbook

**What this is.** A working prototype of a staff console for Classic Cup Coffee's online subscription team (UGA AI Society × PwC case competition). It times each subscriber's next bag to when they will actually run out of coffee, so every bag is opened fresh: **not too early** (sitting a month behind a stockpile) and **not too late** (after the canister is empty). It learns each customer's pantry from one text question, keeps a person in charge of anything risky, proves itself against a fixed-schedule control group, and turns grocery-shelf buyers into subscribers with a QR code on the bag.

**Read this if** you are on the team and a judge might ask you how something works, how to use it, or how it would fit the business. Section 9 has answers to likely questions. The pitch script is in [docs/SAMPLE_PITCH.md](docs/SAMPLE_PITCH.md); the full spec, the panel review and the enhancement plan are in [PROTOTYPE_SPEC.md](PROTOTYPE_SPEC.md) (v4.3).

> **Everything on screen runs on sample customers we generated to match Classic Cup's case numbers; the model's projections are computed live.** There is no client data in this repository. Say this once, out loud, in the demo.

## Contents

1. [The story in one minute](#1-the-story-in-one-minute)
2. [Run it](#2-run-it)
3. [The product, page by page](#3-the-product-page-by-page)
4. [A rep's day, and who uses what](#4-a-reps-day-and-who-uses-what)
5. [How the model works](#5-how-the-model-works)
6. [How it is built](#6-how-it-is-built)
7. [Fitting it into Classic Cup's business](#7-fitting-it-into-classic-cups-business)
8. [Running the demo](#8-running-the-demo)
9. [Questions judges may ask](#9-questions-judges-may-ask)
10. [Honest limits, deviations and open items](#10-honest-limits-deviations-and-open-items)
11. [Glossary, licenses and credits](#11-glossary-licenses-and-credits)

---

## 1. The story in one minute

- **The case.** Classic Cup's direct-to-consumer (DTC) subscriptions are 5% of revenue but have the best margin (61%) and the fastest growth (+14%, which is 2× wholesale cafes and 3.5× the company). They are also a leaky bucket: **6,622 of the 8,670 new subscribers a year are gone within twelve months** (54% still here at 90 days, 23.6% at a year).
- **The clue (Exhibit C).** For the two biggest sign-up sources, in-cafe (2,140 a year) and website (1,860), the top cancel reason is **"too much coffee arriving."** Classic Cup controls the delivery schedule completely, yet cannot see anyone's pantry.
- **The idea.** Treat the customer's pantry as something to *estimate*. Once per delivery, send one text: "about how many weeks of coffee do you have left?" About 45% reply (an assumption the pilot would measure). Combine the replies with delivery history to estimate when each customer runs out, then propose a better delivery date, with a plain-English reason and a human check where the rules require one.
- **The second half.** A QR code on retail bags shows the bag's roast date and offers a subscription roasted to order, timed to when the buyer runs out. It also tells Classic Cup something grocery never could: how long bags sit on the shelf.
- **The ask (the deck's pilot).** Month 1 build; months 2–4 an **A/B test**: new subscribers are split at random, half get AI timing and half stay on a fixed schedule. We track cancellation rate, revenue per subscriber and freshness complaints, plus scans per bag and scan-to-subscribe for the QR. Month 5 puts the QR on Athens grocery bags; month 6 scale or stop. **Stop rule:** if AI-timed churn isn't below the control group by the end of month 3, turn it off. The console's **Pilot** page runs this test live.
- **What we do *not* claim.** Our simulation says timing deliveries *alone* does not pay for itself unless stockpiles drive almost all cancellations. We say so, and the pilot decides.

### At a glance

| Item | Value |
|---|---|
| Stack | One TypeScript package: Node 24, Hono (API), `node:sqlite` (database), React 19, Tailwind 4, Recharts 3, Vite |
| Model | Our own statistical model (a particle filter, 500 what-if pantries per customer). **No LLM, no outside calls, no GPU.** |
| Sample data | 8,272 customers (4,059 active), 9 months of orders and texts, 12 grocery stores, deterministic, resets in about 11 s |
| Pages | Today · Customers (+ profile) · Inbox · Bag QR (+ public bag page) · Roast outlook · Pilot · Settings |
| Tests | Automated tests (engine, flows, the A/B pilot, every API route, simulator, real-data check, web source rules) |
| Real-data check | UCI *Online Retail II*, 1,067,371 orders; the 80% ranges held 78.8% of the time |

---

## 2. Run it

Needs **Node 24** (`.nvmrc`) and **pnpm**. **No API keys are required for anything.**

```bash
pnpm install
pnpm demo        # builds the web app, resets the sample data (about 11 s), serves everything at http://localhost:8787
```

| Command | What it does |
|---|---|
| `pnpm demo` | Build, reset the sandbox, serve on one port (the presentation mode) |
| `pnpm dev` | Server on :8787 (auto-restart) and Vite on :5173; open http://localhost:5173 while editing code |
| `pnpm test` | All tests (about 20 s) |
| `pnpm typecheck` | TypeScript check |
| `pnpm seed` | Write the deterministic sample database to a file (never while the server has it open) |
| `pnpm impact` | Re-run the simulator and rewrite `artifacts/impact.json` (no page shows it any more; the numbers go on slides) |
| `pnpm backtest` | Re-run the real-data check (refuses to run unless its protocol file is committed and clean) |

**Environment (all optional; copy `.env.example` to `.env`):**

| Variable | Meaning |
|---|---|
| `PORT` | Default 8787 |
| `CHANNEL` | `replay` (default: scripted replies, fully offline), `console` (type replies in the drawer), `photon` (real iMessage to team phones) |
| `SANDBOX` | `1` enables the demo drawer and sample clock |
| `KEEP_DATA=1` | Keep the database between boots (default: reset on every boot so each dry run starts identical) |
| `SPECTRUM_PROJECT_ID`, `SPECTRUM_PROJECT_SECRET` | Photon credentials, only for `CHANNEL=photon` |
| `PHONE_MAYA`, `PHONE_DEV` | Opted-in team phones (E.164), only for `CHANNEL=photon` |

**What you might need to provide (all optional):** Photon credentials and two team phones (to send the demo as real iMessages; otherwise replay does it offline), counsel's review of the consent wording, mentor answers on the numbers marked "assumption", and team sign-off on the color palette.

---

## 3. The product, page by page

The sandbox clock starts at **Sunday Oct 18, 2026, 9:00 am (America/New_York)**. Deliveries land on **Wednesdays**. The top-right badge always says **"Sandbox · sample data."**

**Shortcuts.** `Ctrl+K` find a customer or page · `Ctrl+Alt+→` advance the demo story · `Ctrl+Alt+D` open the sandbox drawer · `Ctrl+Alt+1…8` jump to a tour stop.

### 3.1 Today (the morning worklist)
*Who uses it:* the subscriptions manager and customer care, first thing.
- **Pills:** counts waiting for a person, waiting for approval, and running out soon. Each links to its list.
- **Four tiles:** Active subscribers, Deliveries this week, **Reply rate** (live, against the pilot's 40% bar; hover for how many were asked and the opt-outs this week), Needs reply.
- **Worklist** with two tabs: *Running out soon* (customers likely to run out within 14 days, customers with a usable estimate first) and *Going out today* (every queued text with its reason chip).
- **Bag freshness gauge:** of the bags arriving in the next four weeks, what share will be opened at peak freshness (within 28 days of roasting), past peak, or arrive after the customer runs out.
- **Needs a person / Waiting for approval** side cards with the top items and links to the Inbox.

### 3.2 Customers (worklists and export)
*Who uses it:* reps managing accounts.
- **Saved views with live counts:** Everyone · Needs attention (a reply a person must answer, or a move waiting for approval) · Running out soon · Waiting for approval · New (first 60 days, when pacing is not allowed to act yet).
- Search by name, city or ID; filters for status, sign-up source and consent.
- **Export CSV:** every row that matches the current view and filters (id, name, plan, next delivery, early/likely/late run-out dates, how sure, last reply, status, consents). Cells that start with `=`, `+`, `-` or `@` are neutralised so a spreadsheet won't execute them.
- Click any row to open the profile.

### 3.3 Customer profile (the centerpiece)
- **Header:** name, consent chip (Delivery texts), badges (Pilot group, Via bag QR, Held, Texts stopped, holiday week), next delivery, plan, and actions: **Send check-in now · Move delivery · Hold until · Pause · Add note** (no check-in button for a control-group customer). Every action texts the customer where relevant and is written to the audit log.
- **Next action banner:** the one thing to do for this account. In order of priority:
  1. *Waiting for your approval* with **Approve / Hold**;
  2. *The customer wrote and needs a person* with an inline reply box and **Mark resolved**;
  3. *Cancelled / texts off*: nothing to do;
  4. ***Moved* (automatically, by staff, or after approval):** "Wed Oct 28 → Wed Nov 11. The next bag now opens about 21 days after roasting instead of 35 (14 days fresher). Maya was told and can undo it by replying OLD." with an **Undo move** button (puts the delivery back and texts the customer);
  5. a holiday-week notice;
  6. *Waiting for a reply to the check-in* (or **Send check-in now**);
  7. *On track: nothing needed.*
- **Pantry chart:** estimated days of coffee on hand over time. Dots are deliveries; hollow dots are replies ("6 wks"); the orange band is the likely run-out range; the hollow marker is the scheduled delivery and the solid marker the proposed one. The title is generated from the model: "Most likely runs out around Nov 27 (likely between Nov 11 and Dec 15)."
- **Freshness at the cup:** original date vs now vs proposed, each with "opened about N days after roasting" and a band (at its best / within the peak window / past its peak / arrives after they run out).
- **Messages:** the full thread, in the coffee palette. Each automated text has a reason chip and **Why we sent this** (plain-English reasons and the checks that passed), with *Technical details* underneath (quantiles, rule codes).
- **Order history** with the model's estimate of days on hand at arrival and how old the bag was when opened.
- **Why this date (right column):** the starting point ("people like Maya usually take about 5 weeks per delivery", tagged "assumed prior, fit on synthetic data"), the customer's evidence, a **"what would change it"** table (what we would propose for every possible reply from 0 to 8 weeks), how sure we are, the checks that applied, and **"Are these ranges honest?"**, a one-click summary of the real-data check.
- **Activity log** and **notes** for hand-offs.

### 3.4 Inbox
Three tabs. **Needs a person:** free-text replies the system won't interpret (Reply, Resolve, and a *More* menu with Hold until, Pause for 4 weeks, Move delivery). **Approvals:** proposed moves waiting for a yes, with the plain-English reason they need one ("not pay-as-you-go, or fewer than 2 deliveries"), **Why this move**, **Hold** and **Approve**. **All messages:** a searchable log of every text, in and out, with its reason.

### 3.5 Pilot (the test from the deck)
*Who uses it:* the subscriptions manager, and the team in the pitch ("this is how we will know").
- **Where we are:** "Week 5 of 13", a progress bar, and the four stages from the deck (month 1 build, months 2–4 A/B pilot, month 5 QR in Athens grocery, month 6 scale or stop) with the current one marked.
- **AI timing against the control group:** enrolled subscribers, **cancellation rate**, **revenue per subscriber**, **freshness complaints per 100 bags** (a customer texting STALE), check-ins answered and deliveries moved (the control group gets none, by design). Every number is read from the database.
- **The stop rule:** the deck's rule in words and today's reading. Before week 13 it says *too early*, gives the gap so far, and adds the margin chance alone can produce at this sample size (a 95% band for two proportions), so a gap in either direction is not over-read. From week 13 it reads "below control: keep going" or "not below control: turn it off".
- **Is the check-in working?** The reply rate against the 40% go bar. New subscribers are first asked after their first delivery, so early on the AI group has too few answers and the card shows the rate across everyone being texted (the same count as Today's tile).
- **How the split works** and a balance table by sign-up source; **the bag QR** measures (scans per bag, scan-to-subscribe) with a link to Bag QR.
- **Sample data builds in no difference between the groups**, so they read alike; the page says so. In a real pilot those rows decide it. 3,466 customers who joined before the pilot are outside the test.

### 3.6 Bag QR (grocery buyer to subscriber)
- **Console page:** bags shipped with a QR code, scans (and scan rate), subscriptions started (and how many are still subscribed), median bag age at scan, a weekly chart, and a **By store** table ranked by the share of scanned bags that were already past 4 weeks old. Stores at **50% or more** are tagged **"Visit first"** and have a **Copy note** button that writes a short note for the rep who covers the store. Below: the **bag label** (SVG with the QR code, downloadable) for any lot, and recent subscriptions from a bag.
- **Public page** (`#/q/<lot>`, what a phone opens after scanning): this bag's roast date and age against the 2–4 week window, then a short sign-up (cups a day, people at home, a suggested rhythm the buyer can change, name, mobile number). Texts begin **only after the customer replies YES** (double opt-in). No app, no account.
- The sign-up is attributed to the lot and store, so Classic Cup sees sell-through and freshness at the shelf for the first time.

### 3.7 Roast outlook
Six weeks of DTC deliveries and pounds (deliveries × 0.75 lb for one 12-oz bag) with a likely range (P10–P90), a table by week including a two-bag sensitivity, and **Export CSV** for the head roaster. Caption: a planning view; DTC is under 2% of wholesale pounds, so this is a convenience, not the reason to do this.

### 3.8 Settings (read-only)
Delivery day, quiet hours (9 pm–8 am ET), text caps, the holiday freeze (Nov 15–Jan 5), cautiousness (Balanced), freshness windows, the next two holiday travel weeks, the pilot control-group rule, and the consent text word for word.

### 3.9 Sandbox drawer and Tour (hidden from judges' view)
`Ctrl+Alt+D` or the badge menu. **Tour:** eight one-click stops (Today, Maya, Dev, Approvals, Customers, Bag QR, Roast outlook, Pilot), each with the line to say. Plus: advance to the next scripted event, inject a reply as any customer, switch channel, open the newest bag's QR page, move the clock, **reset**. The scripted story is `scenarios/demo.json`: 10:00 check-ins go out → 10:02 Maya replies "6" → 10:20 Priya writes free text.

---

## 4. A rep's day, and who uses what

| Person | Typical day | Where they live |
|---|---|---|
| **Subscriptions manager** (1) | Scan Today (reply rate, freshness gauge); decide approvals; read the pilot | Today, Inbox › Approvals, Pilot |
| **Customer care** (1–2) | Work the worklist; answer free-text; hold or pause on request | Customers › Needs attention, Inbox, profile banner |
| **Sales / wholesale rep** | Visit the stores whose bags are sitting; show the QR | Bag QR › Visit first, Copy note |
| **Head roaster** (read-only) | Check next six weeks of pounds; export | Roast outlook |

**A 10-minute morning routine:**
1. **Today:** glance at the reply rate and the pills.
2. **Inbox › Needs a person:** reply or resolve (usually under five).
3. **Inbox › Approvals:** read the reason chip; approve or hold.
4. **Customers › Running out soon:** open anyone whose Next action banner isn't "On track."
5. **Customers › Export CSV** if you need the list elsewhere.
6. (Weekly) **Bag QR › Visit first** for the sales rep; **Roast outlook** for the roaster.

---

## 5. How the model works

Plain-English summary: *we keep 500 what-if versions of each customer's pantry and keep the ones that agree with what the customer told us.* The rest of this section is the detail, for when a judge asks "how, exactly?"

### 5.1 The problem as mathematics
For each customer we want a probability distribution over **R**, the days of coffee currently on hand (equivalently, days until the canister is empty), which we cannot observe. We see: delivery dates, replies ("weeks left"), skips, and staff holds. This is a **hidden-state estimation** problem, solved with a **Bayesian filter** implemented as a **particle filter**.

### 5.2 Layer A: the starting guess (the prior)
A linear regression (ordinary least squares) predicts ln(days one delivery lasts) from sign-up answers: sign-up source (five dummies), cups a day (−2), people at home (−2) and the chosen rhythm (ln, centered). The residual spread τ says how much real people vary. **It is fit on our own synthetic customers, so it is circular by construction; the console labels it "assumed prior, fit on synthetic data."** With real data it would be refit.

### 5.3 Layer B: the pantry filter (`src/engine/pantryFilter.ts`)
Each customer gets **M = 500 particles**. Each particle is a hypothesis **(θ, R)**:
- **θ** = ln(days one delivery lasts at this customer's usual pace), drawn from the Layer A prior: θ ~ N(μ, τ²).
- **R** = days of coffee on hand now.

The cycle, replayed in date order over the customer's event log:
1. **Predict.** Each elapsed day removes about one day from R, with noise (ν = 0.1 per √(30 days)). A **delivery** adds exp(θ + 0.15·z) days. A **staff hold** pauses consumption and widens the noise by 1.5×.
2. **Weight on a reply.** Each particle's weight is multiplied by the likelihood of the reply given its R (below).
3. **Soft evidence from a skip.** A skipped delivery while holding 21+ days is plausible (weight 0.95) and while holding less is not (0.05).
4. **Normalise** with a small floor, w ← 0.99·w + 0.01/M, so no hypothesis is ever completely killed.
5. **Resample** when the effective sample size ESS = 1/Σw² falls below M/2 (systematic resampling, jitter 0.01 on θ and 0.5 day on R).
6. **Read out** weighted quantiles of R: q05, q10, q33, q50, q90. Those are the "likely runs out" range.

**The reply likelihood.** The customer's reading of their own pantry is noisy and rounded: perceived = true × e^z, z ~ N(0, σ²), σ = 0.35, then rounded to whole weeks. So P(reply = w | R) is the probability that ln(R) + z falls inside the rounding interval:

`P(w | R) = (1 − ε) · [ Φ((ln(7(w + ½)) − ln R) / σ) − Φ((ln(7(w − ½)) − ln R) / σ) ] + ε / 13`

with ε = 0.10 (a mis-tap or nonsense reply, uniform over 0–12). "0" has only the upper term; "12" is right-censored (12 or more). Φ is the standard normal CDF.

*Worked example.* Maya says "6" (42 days). Particles with R = 10, 20, 30, 42, 55, 70 get likelihoods ≈ 0.008, 0.027, 0.116, 0.178, 0.134, 0.067, i.e. normalised weights ≈ 1.5%, 5%, 22%, 34%, 25%, 13%. The cloud moves toward 42 but keeps its width.

Why θ is also learned: each particle's R came from its own θ (bigger bags mean a bigger pile), so weighting by R favours the θ values that produced a matching pile.

**Why a particle filter and not a formula?** It handles rounded, censored, garbage-contaminated replies and skips with no special cases, and it outputs a *range*, not a point.

### 5.4 Determinism
There is no `Math.random`. All randomness is a counter-based hash of (global seed, customer id, purpose, index). A projection is therefore a **pure function of the customer's event log**, tested to be identical when replayed, and cached in the `projections` table with a hash of the log, the engine version and the day.

### 5.5 The decision rule (`src/engine/decision.ts`)
1. **Trigger:** only a fresh reply, a staff action or the customer's own request starts an evaluation. **No answer, no change.** Customers with fewer than **2 completed deliveries** never get a proposal.
2. **Target arrival** = today + q10 of the run-out range + **3 days' grace**. We aim at the *early* end because running out is worse than a bit of leftover. (Cautiousness: Cautious uses q05, Balanced q10, Aggressive q20.)
3. **Snap** to the latest Wednesday on or before the target.
4. **Clamp:** at most **±14 days** from the original date; the gap between deliveries stays within **[21, 84] days**; a sooner move needs at least 3 days to ship.
5. **How sure:** ratio = (q90 + 7) / (q10 + 7). **High** if ≤ 1.6, **Medium** if ≤ 3.0, otherwise **Not yet sure**. High and Medium also need a fresh reply this cycle.

### 5.6 Guardrails (who may act)
A **later** move is sent automatically only if all six hold: (a) a fresh reply triggered it; (b) How sure is Medium or better; (c) the text goes at least 7 days before the original date and a reminder is scheduled 3 days before the new date; (d) earlier texts were delivered (from the third proposal on, also a reply in the previous two cycles); (e) the plan is pay-as-you-go with at least 2 completed deliveries; (f) neither the send date nor the new date falls in the holiday freeze (Nov 15–Jan 5). Anything else goes to **Inbox › Approvals** with the failed check named.
A **sooner** move *always* needs staff approval **and** the customer's YES, because it charges them earlier. Free text is never interpreted: it goes to a person. Quiet hours (9 pm–8 am ET) and caps (3 routine texts per delivery plus 1 other) apply to everything except direct replies and legal texts.

### 5.7 Freshness (`src/engine/freshness.ts`) and holidays
A subscription bag is roasted to order and reaches the door **5 days** later. It is opened when the coffee ahead of it runs out, so **age when opened = 5 + days still on hand when it arrives.** Bands: at its best ≤ 14 days, peak ≤ 28 (the case's 2–4 week window), past peak > 28, and "late" if the customer is empty 3+ days before it arrives. Freshness is read-only: it explains a date and never changes the rule.
**Holiday travel:** the check-in for a delivery landing in Thanksgiving week or Dec 21–Jan 2 adds "Away? Reply AWAY" (no extra text). AWAY holds it until the Wednesday after (a customer's own request, so the freeze doesn't block it); OLD undoes it; a hold that would pass 12 weeks goes to a person.

### 5.8 Roast outlook (`src/engine/outlook.ts`)
200 Monte Carlo draws. Each draw first perturbs the cancel hazard (±20%) and the sign-up rate (±15%), then simulates every customer's skips and cancellations (Exhibit C hazards by tenure) and the new sign-ups' first deliveries (Poisson at 8,670 a year × the Exhibit D monthly index). The P10–P90 band therefore includes uncertainty about the rates, not just luck. Pending moves shift their delivery date with the probability they will be approved.

### 5.9 The A/B pilot and its control group (`src/shared/pilot.ts`, `src/server/pilot.ts`)
- **Assignment.** A new subscriber (from the website, a bag QR, anywhere) gets an arm when they join: `hash(customer id) mod 2`. It is random-looking, about 50/50, **reproducible and sticky** (the same customer always gets the same arm) and cannot be changed by staff.
- **What "fixed schedule" means in code.** A control customer is never sent a check-in (`queueCheckIn` returns early), so there is nothing to move; if they text a number anyway it is recorded but `handleWeeks` stops before any proposal; staff cannot send them a check-in. They still get delivery reminders, can hold or pause on request, and are counted in every measure. They are kept off the Today and "Running out soon" worklists.
- **Scope.** The test covers customers who joined after the pilot began (the sandbox puts it at week 5 of 13). Earlier subscribers (`arm` empty) are outside it; the console works them as a daily tool so judges can see the product on accounts with history. In the real plan existing subscribers stay on their current schedule during the test.
- **The measures** (from the deck): cancellation rate, revenue per subscriber, freshness complaints (a STALE text, per 100 bags), plus the QR's scans per bag and scan-to-subscribe, and the check-in reply rate against the 40% go bar.
- **The stop rule** compares the two cancellation rates at week 13. Because a point estimate can mislead at small sample sizes, the page shows the 95% chance margin next to the gap. The sample data has the same churn in both arms by construction, so it reads "too early" and "within chance".
- **Why not run offers too?** An earlier build had an Offers page (rotation, smaller bag, swap, gift-to-own) with holdouts. The team removed it to keep the pitch to one idea; the texting rules that remain (STOP, caps, quiet hours, consent) are unchanged.

### 5.10 The simulator (`src/sim/`)
A synthetic world of customers whose true consumption, rhythm choice, life events, reply behaviour and cancellation we control, with four scheduling policies: **Fixed** (today), **RuleText** (a simple rule on the reply alone), **Paced** (our model) and **Ceiling** (perfect pantry knowledge). Cancellation hazards are calibrated by bisection to match Exhibit C's retention by source *exactly*, then a "share of cancellations caused by stockpiles" φ (unknown, so a slider) tilts them. Differences use a **paired bootstrap** (same customers under both policies) and a **model-free break-even bar**: the retention gain a change must add to pay for its program cost ($2 per active subscriber-year, a placeholder) and the deliveries it removes.

**Findings (sample assumptions; at φ = 40 of every 100):** Paced keeps about 0.9 percentage points more subscribers but needs about 2.7 to break even (profit −$1.44 per cafe/website sign-up, about −$5,760 a year across 4,000). **Pacing alone never breaks even at any φ**; perfect knowledge breaks even at 52 of every 100; reply rate is the biggest lever (at 70% replies, pacing breaks even at 92). Average coffee age in the cup: about 60 days fixed, 58 paced, 54 perfect: timing helps the worst bags, not the average. Numbers live in `artifacts/impact.json`.

### 5.11 The real-data check (`src/sim/backtest/`)
Public UCI *Online Retail II* (Chen 2012; 1,067,371 rows, 2009–2011; CC BY 4.0): predict the next reorder gap from earlier gaps. **Protocol committed before the first run** (`PROTOCOL.md`); the CLI refuses to run if it is not committed and clean. 180-day administrative cut; split by time and by customer; conformal calibration of the ranges; a calibrated "same as last gap" baseline; pinball loss at 10/50/90%; coverage of the 80% range by reorder count. **Result:** better than the baseline after the first two reorders (mean pinball 9.9 vs 14.1 after one order), and the 80% ranges held 77%, 77%, 80%, 83% over the first four reorders (pooled 78.8%). **Limits:** wholesale buyers, no consumption signal, no text replies. It tests the math, not the whole idea.

### 5.12 Constants cheat-sheet

| Constant | Value | Where |
|---|---|---|
| Particles | 500 | `ENGINE.particles` |
| Reply error σ / garbage ε | 0.35 / 10% | `ENGINE.sigmaObs`, `garbage` |
| Between-delivery variation σ_b | 0.15 | `ENGINE.sigmaB` |
| Consumption noise ν | 0.1 | `ENGINE.nu` |
| Skip threshold / weights | 21 days; 0.95 vs 0.05 | `ENGINE` |
| How sure | ratio ≤ 1.6 High; ≤ 3.0 Medium | `ENGINE.ratioHigh/Medium` |
| Grace; max step; gap | 3 days; ±14; 21–84 | `ENGINE` |
| Notice; reminder; check-in | 7 days; 3 days before; 10 days before | `ENGINE` |
| Quiet hours; caps | 9 pm–8 am; 3 routine + 1 other | `RULES` |
| Freeze | Nov 15 – Jan 5 | `RULES` |
| Pilot | 13 weeks (months 2–4); reply rate ≥ 40%; split 50/50 by customer ID | `RULES`, `PILOT` |
| QR first bag | 20% off | `QR.firstBagDiscount` |
| Roast to door; pounds per delivery | 5 days; 0.75 lb | `WORLD` |

Every assumption is also listed with its range and source in `LEDGER` (`src/shared/constants.ts`).

---

## 6. How it is built

### 6.1 Architecture

```
 Browser (React 19, Tailwind 4, Recharts)               Node 24 process (one port, :8787)
 ┌───────────────────────────────┐   JSON over HTTP    ┌─────────────────────────────────────────┐
 │ pages · hash router           │ ──────────────────▶ │ Hono API  (src/server/app.ts)           │
 │ useApi() fetch + refetch      │ ◀────────────────── │   flows/   send · schedule · inbound ·  │
 │ SSE listener (coalesced)      │   Server-Sent       │            actions (staff + approvals)  │
 └───────────────────────────────┘   Events stream     │   pilot.ts the A/B scoreboard           │
                                       (/api/stream)   │   qr.ts    bag QR                       │
                                                       │ engine/ (the model: pure functions)     │
                                                       │ node:sqlite  (data/console.db, WAL)     │
                                                       │ channels/  replay · console · photon    │
                                                       └─────────────────────────────────────────┘
```

**The model runs on the server, in the same Node process as the API.** The browser never runs the model; it only displays what the API returns.

### 6.2 Stack choices (and why)
- **One TypeScript package** (TypeScript 7, Node 24, pnpm): shared types between server and web; no monorepo overhead.
- **Hono + `@hono/node-server`:** a small, standards-based web framework; serves the API and the built web app on one port.
- **`node:sqlite` (`DatabaseSync`, WAL):** the database is built into Node: no extra dependency, real persistence (approvals, pilot arms, audit log). The seed and every reset run in one transaction. Every "today" query takes the sandbox clock as a parameter, never SQL `date('now')`.
- **React 19 + Tailwind 4 + Recharts 3 + Vite 8:** standard, fast to build; hash-based router (about 40 lines, no library); `qrcode-generator` for the bag QR.
- **Why no LLM:** the job is estimating a number with a range and explaining it; free-text replies go to a person. That removes a vendor, a cost, a privacy question and a source of unpredictable text.
- All dependencies are **pinned to exact versions**; licenses are in section 11.

### 6.3 Folder map

```
src/shared/   types, constants (every assumption in LEDGER), counter-based RNG, dates, holidays, opportunity sizing
src/engine/   prior · pantryFilter · decision · explain · project (one customer's projection) · freshness · outlook
src/sim/      world · policies · churn · impact · prior · seed (sample data) · backtest/ (real-data check + PROTOCOL.md)
src/server/   app (routes) · db (schema) · store (clock, projections, audit) · queries · profile · seedDb · sandbox · sse
              flows/ (send, schedule, inbound, actions) · pilot · channels/ · qr · copy
src/web/      main · App · router · api (fetch + SSE hooks) · pages/ · components/ · tour · styles.css
scenarios/    demo.json (the scripted events)         artifacts/  impact.json, backtest.json (committed outputs)
data/derived/ online_retail_gaps.csv (derived gap table, committed with attribution)
test/         11 test files                          docs/       SAMPLE_PITCH.md · PITCH_TIMELINE.md
```

### 6.4 What happens when a customer replies "6" (end to end)
1. The channel (Photon iMessage, the drawer, or the replay script) delivers the text to `handleInbound`.
2. The reply is stored as a **message** (`reason_code = WEEKS_LEFT`) and an **event** in SQLite. Free text, STOP, HELP and keywords are handled by a small rule-based parser; anything else becomes "needs a person".
3. `projectionOf` replays the customer's events through the **particle filter** and writes the new quantiles to `projections` (cached by a hash of the log).
4. `decide()` turns the quantiles into a target date, confidence and the six checks.
5. **If a later move passes all six checks:** the delivery is moved, the "we've moved your delivery" text is sent (respecting caps and quiet hours), the reminder is re-queued and a **"why" snapshot** (checks, quantiles, rule codes) is stored with the message. **Otherwise** the message is created as `pending_approval` and appears in Approvals with the failed check named.
6. The server publishes an **SSE event** (`message`, `projection`, `queue`, `clock`).
7. Open pages receive it, coalesce the burst (one clock advance can emit hundreds of events) into one refresh per type after 350 ms, and **refetch** their JSON (`useApi`). The chart, banner and counts update without a reload.

### 6.5 Data model (SQLite)
`customers` · `deliveries` · `events` (replies, moves, holds, skips) · `messages` (every text, with kind, reason code, status, and a JSON "why" snapshot) · `projections` (cached model output) · `notes` · `audit_log` (every staff and system action) · `settings` (the clock, cautiousness) · `retail_accounts` · `retail_lots` · `qr_scans` · `qr_signups`.

### 6.6 API (all JSON; `SANDBOX=1` adds the sandbox routes)

| Route | Purpose |
|---|---|
| `GET /api/today` | Tiles, worklists, reply rate, freshness |
| `GET /api/customers` (`?view=&q=&status=&source=&consent=&page=`, `&format=csv`) · `GET /api/customers/views` · `GET /api/customers/:id` | List, saved-view counts, profile |
| `POST /api/customers/:id/actions` | `send_checkin_now`, `move`, `hold`, `pause`, `add_note`, `reply`, `resolve`, `undo_move` |
| `GET /api/inbox?tab=` · `GET /api/inbox/counts` · `POST /api/messages/:id/approve` or `/hold` | Queues and approvals |
| `GET /api/pilot` | The A/B scoreboard: arms, three measures, stop rule, QR measures |
| `GET /api/outlook` (`?format=csv`) | Roast outlook |
| `GET /api/qr` · `GET /api/qr/lots/:code` · `POST /api/qr/scan` `/signup` | Bag QR console and public page |
| `GET /api/evidence` | Real-data check summary (from `artifacts/backtest.json`) |
| `GET /api/settings` · `GET /api/stream` (SSE) | Static settings; live updates |
| `POST /api/sandbox/advance` `/reset` `/inject` `/clock` `/channel` | Demo controls (`SANDBOX=1` only) |

### 6.7 Messaging
A `Channel` interface with three implementations: **replay** (default; scripted and fully offline), **console** (type replies in the drawer) and **photon** (real iMessage through Photon's Spectrum SDK; lazily imported; falls back to replay after 5 seconds if it can't connect). All texts go through `sendText`, which enforces consent, quiet hours (a text waits for morning) and caps. Copy is a single deck (`src/server/copy.ts`), signed "Classic Cup (Athens)".

### 6.8 Design system
Palette inspired by a public coffee brand's site and logo (**colors only; no names, marks or artwork**): orange `#F16A21` (fills, bars, the active-page marker; never body text, and only on white surfaces), orange-ink `#B34A12` (links, focus), espresso `#643A2B` (headings, primary buttons, sent bubbles), plum `#7F2754` on its tint (needs a person, pilot group), cream `#FBF6F1` page background, warm-grey lines `#E9DFD6`, ink `#1C1C1C`, success `#2E7D5B`, danger `#B42318`. Type scale 12/13/14/16/20/28; tabular numerals for numbers; cards with 16 px corners; focus rings; color is never the only signal. Charts use direct labels and a single y-axis.

### 6.9 Testing
Automated tests (`pnpm test`): engine (likelihood vs numerical integration, monotone median, idempotent replay, guardrail properties); flows (every keyword, consent, caps, quiet hours, approvals, AWAY/OLD, Undo); the A/B pilot (sticky split, control arm never texted or moved, scoreboard, stop rule, old-database rebuild); **every HTTP route** through the app without a network; the simulator and backtest artifacts; and **source rules** that fail the build if the web code hard-codes a calendar date, uses `Math.random`, shows demo wording other than the badge, or types the real-data figures instead of reading them from the artifact.

---

## 7. Fitting it into Classic Cup's business

### 7.1 Where it sits
**In production the model and rules sit behind Classic Cup's existing subscription and SMS platform through its API; the console is the review-and-approve layer for 2–4 staff, not a replacement system.** There is no new customer app or portal (a case rule). The bag QR is one page on the existing website.

| Integration point | What flows | Notes |
|---|---|---|
| **Subscription platform** | Customers, plan, next delivery date, order history in; "move delivery to X" out | Today the console writes its own SQLite; production swaps these for API calls. The model only needs delivery dates, replies, skips and holds |
| **Text-message provider** | Outbound texts; inbound replies and STOP/START | Photon (iMessage) in the prototype; any provider with webhooks works behind the `Channel` interface |
| **Roaster / production planning** | Weekly pounds with a range | CSV today; a scheduled export is trivial |
| **Grocery accounts** | A lot-coded QR printed on retail bags | Needs the packaging printer to add a code per lot; EDI chains and "text a rep" independents both covered |
| **Single sign-on, audit** | Staff identity; the `audit_log` | The prototype has no login (one persona) |

### 7.2 Rollout in four steps
1. **Shadow mode (2 weeks).** Run the model on real history; make no changes. Check that the sample's assumptions (reply rate, consumption) are in the right range; replace the prior with real data.
2. **A/B pilot (months 2–4, about 13 weeks).** New subscribers are split at random by customer ID: half get AI timing, half stay on a fixed schedule. Freeze moves Nov 15–Jan 5. The Pilot page is the readout.
3. **Month 5:** put the QR on Athens grocery bags (below).
4. **Month 6: scale or stop.** The stop rule is read at the end of month 3; scale means rolling AI timing to everyone and extending the QR to more accounts.

**Pilot readouts.** Cancellation rate, revenue per subscriber and freshness complaints, AI against control; for the QR, scans per bag and scan-to-subscribe. **Go-ahead gate:** the check-in reply rate is at least 40%. **Stop rule:** if AI-timed churn isn't below the control group by the end of month 3, turn it off. We judge on net revenue, because slower pacing can mean fewer bags per person.

### 7.3 People and process
2–4 existing staff; a morning routine of about 10 minutes (Today → Inbox → done) that absorbs the subscription inbox the team already answers (**assumption: confirm with mentors**). Humans approve anything risky; free text always goes to a person. Every automatic action is in the audit log and visible to the customer ("reply OLD to undo").

### 7.4 The money case (arithmetic, not a forecast)
- DTC gross profit ≈ **$793K** a year ($1.3M × 61%).
- **Keep 10% more subscribers** ≈ +$79K a year (10% of DTC gross profit, treating each extra subscriber as average).
- **Convert 5% of grocery buyers** ≈ +$197K a year: grocery volume from Exhibit B (6 regional chains × 3,900 lb + 84 independents × 210 lb a month ≈ 656,640 twelve-ounce bags a year) at an assumed **12 bags per buyer a year** gives about 54,720 buyers; 5% is about 2,736 new subscribers worth about $72 each in the first year after the grocery margin they would have earned.
- **Total ≈ $276K a year, with no new stores, no new headcount and no price increase.** The 12 bags per buyer is the soft spot: the pitch's ≈ $140K needs about 40 bags per buyer. Both inputs are what the pilots measure.
- **Honest counterweight:** timing alone does not pay in our simulation (5.10), so the retention lift is a pilot question, and the pilot's control group is what answers it.
- **Program cost** is a placeholder of $2 per active subscriber-year (texts and care time), unverified.

### 7.5 Data we would ask the client for
Orders per subscriber, delivery days, cancel-reason shares, bags per grocery buyer per year, whether retail bags can carry a printed lot code and QR, and whether the team already uses an inbox or spreadsheet routine.

### 7.6 Compliance and ethics, concretely
One **opt-in** for delivery texts (double opt-in on the QR sign-up); **STOP** stops everything. No marketing texts at all. No texts 9 pm–8 am. At most 3 routine texts per delivery. **A sooner delivery needs an explicit YES.** Every text can show why it was sent. The one price promise is the QR page's 20% off a first bag, shown on the page before sign-up. Counsel should review the consent text (open item).

---

## 8. Running the demo

Full script, timings and recovery steps are in [docs/SAMPLE_PITCH.md](docs/SAMPLE_PITCH.md). The short version:

1. `CHANNEL=replay pnpm demo`; wait for "Right on Time: http://localhost:8787". Full-screen the browser at 1280×720 or larger; turn off notifications.
2. `Ctrl+Alt+D` → check the clock reads Sun Oct 18, 9:00 am, scripted events 0 of 3, channel Replay → **Reset sandbox** → close the drawer. Start on **Today** and don't scroll.
3. **Today** → say the one disclosure sentence → point at the reply-rate tile and the freshness gauge.
4. **Maya** (`Ctrl+Alt+2`): chart and "No replies yet" → `Ctrl+Alt+→` (check-ins go out) → `Ctrl+Alt+→` (she replies "6"): range tightens, **move summary**, freshness 35 → 21 days, **Why we sent this**, **Are these ranges honest?**, **Undo move** (show it exists; don't press it).
5. **Dev** (`Ctrl+Alt+3`): "not yet sure, so it does nothing."
6. **Customers** (`Ctrl+Alt+5`): Needs attention → open one → banner → Export CSV. **Approvals** (`Ctrl+Alt+4`).
7. **Bag QR** (`Ctrl+Alt+6`): By store, Visit first, Copy note; drawer → *Open the newest bag's QR page* (20% off a first bag).
8. **Roast outlook** (`Ctrl+Alt+7`) then **Pilot** (`Ctrl+Alt+8`): "this is the test we are asking for"; if time is short, cut Roast outlook first.
9. Back to the slide for the ask.

**If something breaks:** refresh; or `Ctrl+Alt+D` → Reset sandbox and repeat from Maya; or play the backup recording. Don't debug live.

---

## 9. Questions judges may ask

### The idea and the case
**Why DTC when it's 5% of revenue?** It is the best margin (61% vs 34% for grocery), the fastest growth (+14%), and the only channel where Classic Cup sees every customer and controls the schedule. It is also testable in a quarter. The same "text as a sensor" idea could later extend to the 744 wholesale accounts.

**What is the actual problem?** Growth is first-time subscribers who don't stay: 6,622 of 8,670 a year are gone within twelve months, and the top reason for cafe and website sign-ups is "too much coffee arriving." The schedule is fixed; the pantry is invisible.

**Why not just cut the price, or let people pick any delivery date?** Price is the top reason for only one cohort (gift, 940 a year), and margin is the channel's strength; discounting everyone pays people who would have stayed. Letting people choose is the current problem: they choose once, at sign-up, before they know their pace (they guess to about ±15%).

**What does Classic Cup actually do differently on Monday?** Someone opens Today, answers a few free-text replies, approves a few moves, and the system handles the rest: one question a delivery, a better date, and a reason for every text.

**How is this different from a CRM or an SMS tool?** Those send what you schedule. What's new is a per-customer pantry estimate, the rules for when a move is safe to automate, and a control group built into the pilot. In production it sits behind their existing platform's API.

### The model
**What does the AI actually do?** It estimates when each customer runs out, as a range, from delivery dates and one text reply, then proposes a delivery date with a plain-English reason.

**Is it ChatGPT / an LLM?** No. It's our own statistical model (a particle filter) running on Classic Cup's server with no outside calls. Free-text replies go to a person.

**What is a particle filter, simply?** We keep 500 what-if versions of the customer's pantry (some drink slowly, some fast). When they say "six weeks," we keep the versions that agree and drop the ones that don't. What's left is a range.

**Why a range instead of one number?** A wrong confident date makes someone run out of coffee. A wide range makes the system hold off, which is the safe default.

**What if the customer is wrong or lies?** Replies are modeled as noisy (σ = 0.35 on the log scale, about ±35%) with a 10% chance of being nonsense, so one odd reply can't swing the estimate far. Sooner moves still need the customer's YES.

**What if they don't reply?** No answer, no change: the system holds off. Around 55% won't reply (our assumption: 45% do), and the schedule just stays as the customer chose it.

**What about new customers?** Fewer than 2 completed deliveries means no proposal. That is why we add a sign-up rhythm *suggestion* (a nudge the customer can ignore) for the first two deliveries.

**How do you know the model is any good?** Two ways, neither perfect. (1) On 1.07M real orders it beat a calibrated baseline at the first two reorders, and its "80% range" held 78.8% of the time; the plan was committed before the run. (2) In a simulator it reproduces the case's retention exactly and shows where it pays. Neither proves the coffee effect; the pilot does.

**The starting guess is fitted on your own sample data. Isn't that circular?** Yes, and the console says so on every profile. In the pilot it is refit on real history; the replies, not the prior, carry the estimate for anyone who answers.

**Why does Dev Patel's range differ from the spec's example?** The spec's expected numbers came from a different fitted prior. Our behavior is as specified ("not yet sure, so no change"); the numbers move with the prior.

**Could the model run out of data or drift?** Every projection is recomputed from the event log when the engine version changes; the pilot's reply-rate and late-delivery readouts are the drift alarms.

**Why q10 and not the median?** Asymmetric cost: arriving a week early costs a little freshness; arriving after the canister is empty costs a customer. Cautiousness (q05 / q10 / q20) is a setting.

### Money and evidence
**Does it pay?** Timing alone does not: in our simulation it never breaks even at any share of stockpile-driven cancellations from 0 to 100 of every 100 (perfect pantry knowledge would, at 52). Reply rate is the biggest lever. That is why the recommendation is a pilot, not a rollout, and why the QR matters: it brings in new subscribers who join the same test.

**Where does $276K come from?** Arithmetic on Exhibits A–C: 10% of $793K DTC gross profit (+$79K) plus converting 5% of grocery buyers (+$197K, at an assumed 12 bags per buyer a year, net of the grocery margin they replace). It's the size of the prize, not a forecast.

**Why is that number positive when your sim says pacing loses money?** The $276K is what the program must deliver; the sim says one piece of it (timing alone) doesn't get there. The pilot measures whether timing keeps enough subscribers, against a control group, to pay for itself.

**Did you prove the coffee is fresher?** Not on average: about 60 days at the cup on a fixed schedule, 58 paced, 54 with perfect knowledge. Timing fixes the *bag that waits a month behind a stockpile*; the profile shows that per customer (35 → 21 days for Maya). Bag size is the other lever, and a future option.

**What does it cost?** No per-call fees (the model is ours); the placeholder program cost is $2 per active subscriber-year for texts and care time, flagged as unverified.

**Is 45% reply realistic?** It is an assumption and the first number the pilot measures. Below 40% we stop. Our sim says reply rate is the biggest lever, which is why we ask only one routine question per delivery.

### Risk, ethics and law
**A wrong date makes someone run out.** We aim at the early end plus a 3-day cushion; every reminder says "Running low? Reply SEND NOW"; sooner moves need a YES; the customer can reply OLD at any time and staff can press Undo move.

**Consent and texting law?** One opt-in for delivery texts and no marketing texts at all, STOP always works, quiet hours, a recorded consent text word for word in Settings, double opt-in on the QR sign-up. Counsel should review before any real customer is texted; it's on our open-items list.

**Won't more texts annoy people?** One routine question per delivery, at most 3 routine texts, none at night, STOP always works, and the check-in reply rate and opt-outs are on the Today and Pilot pages. Below a 40% reply rate we stop.

**Who is accountable for an automatic move?** The rules are written down, each move stores the checks that passed, the customer is told and can undo it, and a person approves anything outside the rules.

**What stops this discounting people who'd have stayed?** Only gift-to-own discounts, capped at 10%, manager approval, a control group, and a budget cap; the break-even is shown in the editor.

**Bias or fairness?** Discount audiences may use only sign-up source, gift status and tenure, never city, ZIP or name-derived fields.

**Privacy?** The model runs on Classic Cup's server with no outside calls; texts go through the provider you choose. The sample contains no real people.

### Adoption and operations
**Isn't this another tool nobody uses?** It's internal, 2–4 staff, a 10-minute routine that replaces the subscription inbox they already answer (to confirm with mentors). The Next action banner tells a rep what to do for each account.

**What integrations are needed?** The subscription platform's API (read customers and dates; write a new delivery date), a text provider with webhooks, and optionally a CSV drop for the roaster. See 7.1.

**What does the head roaster get?** A six-week DTC pounds range with a likely band and a CSV. We say plainly that DTC is under 2% of wholesale pounds, so it's a planning convenience, not the reason to do this.

**What about December?** It runs at 141% of an average month, so moves are frozen from Nov 15 to Jan 5, and the check-in for a holiday-week delivery offers "Away? Reply AWAY."

### The QR and the pilot
**Isn't the QR page a customer portal?** No: one page on the existing website, no login, ending in the same subscription. The case rules out a new customer app; this isn't one.

**Why would a grocery shopper scan?** The page tells them how fresh the bag is and offers a roasted-to-order subscription timed to when they run out. Our scan rate (3% of bags) and sign-up rate (8% of scans) are labelled assumptions until a pilot measures them.

**What's in it for the grocery store?** Sell-through and freshness data by store, and no loss of their sale if the shopper keeps buying on the shelf; we count the grocery margin a conversion would replace.

**Why does the QR page offer 20% off a first bag?** It is the deck's hook for a grocery shopper, shown on the page before sign-up and applied to the first delivery only. It is the one price promise in the product; there are no discount texts.

**How is the A/B test set up?** Each new subscriber is assigned at sign-up by a hash of their customer ID: half get AI timing, half stay on a fixed schedule. A control customer is never sent a check-in, so nothing can move. The Pilot page compares cancellation rate, revenue per subscriber and freshness complaints, plus the QR's scans per bag and scan-to-subscribe.

**What is the stop rule?** If AI-timed subscribers are not cancelling less than the control group by the end of month 3, we turn it off. The page also shows how much a gap could move by chance at this sample size, so we don't over-read an early gap in either direction.

**Why does the sample data show no difference between the groups?** Because we did not build one in. We will not show judges a made-up win; the page shows how the real result will be read.

**Why only new subscribers?** Randomising at sign-up is clean and cheap, and new subscribers are where "too much coffee arriving" drives early cancellations. Existing subscribers are untouched during the test.

**What if churn falls but revenue per subscriber falls too?** That is the pacing risk the deck names: slower pacing can mean fewer bags per person. We judge on net revenue, not churn alone.

### Gotchas to know cold
- The sandbox is **synthetic**: say so once, out loud.
- **Pacing alone doesn't pay** in our simulation; don't let a judge find that first.
- The prior is **circular**; the profile says so.
- The $276K depends on **12 bags per buyer**; it's an assumption.
- **Photon live iMessage is untested** without credentials; the demo runs on replay.

---

## 10. Honest limits, deviations and open items

- **Layer A (the starting guess) is fit on our synthetic data.** Circular by construction; refit on real history in step 1 of the rollout.
- **The simulator is a model, not evidence.** Its parameters are assumptions in `LEDGER`. It is no longer shown in the console; its numbers belong on slides.
- **Real-data check:** wholesale buyers, no consumption signal, no replies. It tests the method's math only.
- **Photon live path** is untested without credentials and a real phone (M1 test). It imports lazily and falls back to replay after 5 s.
- **Dev Patel's range** (Appendix A: ≈ 13/22/27/47 days at day 18) comes out as 8/15/19/35: outside the spec's ±25%, because Layer A is ours. Behavior is as specified.
- **Bag QR rates** (3% scan, 8% sign-up) and **12 bags per buyer** are labelled assumptions; the seeded QR sign-ups are existing synthetic website sign-ups re-attributed to a bag.
- **Reply rate on Today** is counted from sample messages (about 42% for customers with a delivery behind them, because the seed assumes 45%); it will be a real number only in the pilot.
- **Simulator ledger notes:** the holiday freeze is not modeled; staff approvals are assumed always given; expedited deliveries are not credited.
- **Open items:** counsel review of both consent texts and STOP scoping; mentor data (section 7.5); team sign-off on the palette (colors only); a recorded backup of a passing demo; the enhancement plan items E5–E8 in the spec (§18.3).
- Stale approvals (a proposal whose date has passed) expire automatically with a reason.

---

## 11. Glossary, licenses and credits

**Glossary.** *Prior:* belief before seeing a customer's own data. *Posterior:* belief after combining prior and data. *Likelihood:* how probable the observed reply is under a hypothesis. *Latent variable:* something real that can't be measured directly (the pile). *Particle filter:* a Bayesian filter that represents belief as weighted sample hypotheses. *ESS:* effective sample size, how many particles are doing real work. *Quantile (q10, q50, q90):* the value below which 10%, 50%, 90% of the probability lies. *Censored:* we only know "at least this much" (a reply of "12+"). *Monte Carlo:* estimating by simulating many random draws. *Calibration / coverage:* when we say 80%, it should be right about 80% of the time. *Pinball loss:* an error measure for quantile forecasts. *Conformal:* a way to widen ranges so they hit their stated coverage. *Holdout:* a random group that doesn't get a treatment, so you can measure the effect. *Paired bootstrap:* resampling the same customers under two policies to get a confidence interval. *SSE:* Server-Sent Events, a one-way live stream from server to browser. *Stockpile:* 14+ days of coffee still on hand when a delivery arrives. *Late:* the customer is empty 3+ days before the delivery arrives.

**Dependencies (all pinned):** hono 4.13.13 (MIT) · @hono/node-server 2.1.5 (MIT) · spectrum-ts 12.11.0 (MIT) · qrcode-generator 2.0.4 (MIT) · react, react-dom, react-is 19.3.1 (MIT) · recharts 3.10.1 (MIT) · iconoir-react (MIT) · typescript 7.0.2 (Apache-2.0) · vite 8.3.4, @vitejs/plugin-react 6.1.2, tailwindcss and @tailwindcss/vite 4.3.3, tsx 4.23.15, vitest 5.0.5 (MIT) · fonts: Inter (SIL OFL 1.1, `public/fonts/OFL.txt`) and Lufga (as supplied by the team; check its license before any public release).

**Data:** UCI *Online Retail II*, Chen, D. (2012), doi:10.24432/C5CG6D, CC BY 4.0 (derived gap table committed in `data/derived/`). Case numbers come from the competition's kick-off deck (Exhibits A–D). Sample customers are synthetic.

**Brand:** colors inspired by a public coffee brand's site and logo (colors only; no names, marks or artwork). "Classic Cup" is the case's fictional client.
