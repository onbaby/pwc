# PROTOTYPE_SPEC — "Right on Time" team console (spec v4.1)

> **For the build session. Start a new project from scratch.** This spec replaces v3 (in git history: `git show 57a7588:PROTOTYPE_SPEC.md`; the v3 build is commit `b09ece6`). New repo structure, new server, database and UI. *Option:* the team may copy v3's proven model, simulator, backtest and Photon modules from `b09ece6` with their tests (saves ≈ 7–8 person-days, §15); the spec does not depend on it.
> Audience: an AI-literate judging panel (UGA AI Society × PwC case competition; prelim week of Nov 2, final Nov 13, 2026, PwC Atlanta). Talk 15–20 min, hard cutoff. **Demo under 7 minutes: 5:40 of narration + ~0:30 navigation ≈ 6:10.**
> Validated by a simulated judge panel (consulting director + roaster COO; ML engineer + responsible-AI lead; product designer + builder). §17 records what they found and what changed.

---

## 0. Summary

**Right on Time** is the web console Classic Cup's subscription team (the DTC manager and customer care) opens every morning. It does three things:

1. **Paces deliveries.** A model running on Classic Cup's own server estimates when each subscriber will run out of coffee, sends a short check-in text ("about how many weeks of coffee do you have left?"), and proposes moving the next delivery, with a plain-English reason staff can read and an approval step where the rules require one.
2. **Sends the right offer at the right moment, and proves whether it worked.** Staff build targeted offers (a rotating Athens roast for people who signed up "only sampling", a smaller bag or a pause for people with too much coffee, gift-to-own for gift recipients) that ride on a text the customer was getting anyway, with consent, caps and a holdout group.
3. **Shows the whole picture.** Every message, the reason it was sent, the customer's past orders, a list of customers about to run out, and a small roast outlook for the roaster.

### What changed from v3 (and why)
| Change | Why |
|---|---|
| A **staff console** instead of a three-screen presentation | A business-facing tool Classic Cup could adopt; the demo walks real workflows |
| **Offers module**: targeted by cancel reason, consent-gated, never adds a text, measured against holdouts | Your second feature, designed so it can't quietly pay people who would have stayed or drown out the check-in replies the model depends on (§8) |
| **Sign-up rhythm suggestion** (extra feature) | Covers the first two deliveries, where pacing is not allowed to act yet (§9.1) |
| **Roast outlook** kept small (a tile and one page) | Cheap reuse of the projections; honest that DTC is a small share of roaster volume (§9.2) |
| **Production look**: no demo chrome; an honest "Sandbox · sample data" badge; demo controls hidden in a drawer | Looks shippable without misleading anyone (§4) |
| **Smaller stack**: one package; **SQLite built into Node**; no zod, no date-parsing library, no Playwright, no router library | Fewer moving parts; the database *adds* ability (offers, approvals, audit) at no dependency cost (§12) |
| Economics on an **Impact** page, ending on a concrete pilot ask | The honest "does it pay?" answer, framed as what to approve on Monday (§10) |
| Free-text replies go to a person (**Inbox**) instead of a parser | Human-in-the-loop, and one dependency fewer (§11) |
| **Jittery Joe's-inspired palette** (colors only) | Your request; contrast-checked (§5) |

### Five design decisions (do not change without reading §17)
1. **The text is the sensor.** One numeric reply ("weeks left"); a 3-way PLENTY/LOW/OUT reply could not tell a 3-week stockpile from a 3-month one.
2. **The model tracks the pantry** (days of coffee on hand), runs on the server, **makes no network calls** (texts go out through a messaging provider; the model itself uses no API, LLM or GPU), and is explainable in one sentence: "we keep 500 what-if versions of each customer's pantry and keep the ones that agree with what the customer told us."
3. **No dollar win is claimed.** The v3 build found pacing alone does not pay at the placeholder assumption (≈ −$12K/yr; break-even only if ≈ 95 of every 100 cafe/website cancellations are stockpile-driven; perfect knowledge needs ≈ 54). The Impact page says so and ends on a pilot ask. Offers are measured, never assumed.
4. **Offers protect the sensor.** Reply rate was the single biggest lever in the stress test. Offers never add a text, are capped, can be refused with **NO OFFERS** without losing delivery texts, and pause automatically if they raise opt-outs.
5. **Production look, honest data.** One environment badge and one spoken sentence make clear the customers are synthetic.

---

## 1. Context for the builder
- Client: Classic Cup Coffee (constructed case, modelled on Jittery Joe's, Athens GA): ~20 cafes, ~744 wholesale accounts, DTC online subscriptions. Exhibits A–D: `../UGA AI Society Case Competition Kick-off.pptx` (text in `../research_sources/` notes and `../01_DTC_Strategy_Review_100_Avenues_Top3_Paths.md`).
- DTC: $1.3m revenue, 61% gross margin (≈ $793K gross profit), +14%; 8,670 new subscribers/yr; 90-day retention 54%, 12-month 23.6%.
- **Exhibit C cancel reasons by source:** in-cafe (2,140/yr) and website (1,860) "too much coffee arriving"; social/paid (3,420; 11% kept at 12 months) "was only sampling"; gift (940) "price"; wholesale referral (310) "moved or changed job". Different reasons need different interventions: this is why offers are targeted.
- **Discounts are a narrow tool** because only one cohort (gift, 940/yr) cancels over price and margin is the channel's strength (61%). Separately, the case rules out price *increases* as the primary lever.
- Case rules: no new customer app/portal (this console is internal), no headcount cuts, "be concrete and ethical about the AI", at least one AI element.
- Rubric: Problem framing 25, Recommendation 25, Analytical rigor 20, Risk & adoption 15, Communication 15.
- **Volume check (corrects an earlier talk figure):** DTC ≈ 36.6K deliveries/yr ($1.3m ÷ $35.5); at 0.75 lb per delivery ≈ 27K lb/yr ≈ 520 lb/week. Wholesale alone (Exhibit B) ≈ 124K lb/month ≈ 1.49M lb/yr. **DTC is under 2% of wholesale pounds**, not "≈ 5% of roaster load" (that figure compared DTC with grocery wholesale only). Use "a small share of roaster volume (under 2% of wholesale pounds)".

---

## 2. Who uses it
| Person | Daily job | What the console gives them |
|---|---|---|
| **DTC / subscriptions manager** (1) | Keep subscribers; decide promotions | Today; offers with holdouts and break-even; Impact; approvals |
| **Customer care** (1–2) | Answer customers | **Inbox** (Needs a person, Approvals); each customer's orders, messages and "why we sent this"; one-click actions |
| **Head roaster** (read-only) | Roast the right amount | Roast outlook page and CSV |

**Adoption (answers "another tool nobody uses?" and "isn't this just a CRM?"):** internal, 2–4 staff, a morning routine under 10 minutes (Today → Inbox → done), absorbing the subscription inbox the team already answers (assumption; confirm with mentors). Subscription platforms and SMS tools send what you tell them on a schedule; what is new here is the pantry estimate per customer, the rules for when a move is safe to automate, and a holdout on every offer. **In production the model and rules would sit behind Classic Cup's existing subscription and SMS platform through its API; the console is the review-and-approve layer, not a replacement system.**

---

## 3. Information architecture
**Sidebar (espresso):** **Today · Customers · Inbox · Offers · Roast outlook · Impact**; **Settings** as a gear in the sidebar footer. Top bar: Classic Cup wordmark (our own text logo), global customer search, environment badge **"Sandbox · sample data"**, user menu ("Jordan · Subscriptions"). No login in the prototype (production: company single sign-on). Hash-based routes.

### 3.1 Today
Layout (fits 1280×720 above the fold):
- **Row 1, four KPI tiles (96 px):** Active subscribers · Deliveries this week (with a **6-week roast-outlook sparkline** in the tile) · Check-ins going out today · Waiting for a person. Each tile has a delta vs last week (the seed must produce plausible weekly variation) and links to its list.
- **Row 2, 12-column grid.** Left 8 columns: one card with tabs **Running out soon (n)** | **Going out today (n)**. Right 4 columns: **Needs a person** (plum count badge; max 5 rows + "View all in Inbox") stacked over **Waiting for approval** (max 3 rows + link).
- *Running out soon*: customers whose likely run-out starts within 14 days. Columns: customer · next delivery · **"around Dec 2"** (primary) with the range "Nov 16 – Dec 24" beneath in muted 13 px · how sure · status chip (*Check-in sent · Reply received · Move proposed · Holding off · On schedule*).
- *Going out today*: each queued text with a **reason chip** (*Check-in: likely runs out in 10–14 days* · *Delivery moved: replied 6 weeks* · *Reminder* · *Offer: Athens roast rotation*).

### 3.2 Customers
- **List:** search; filters (status, sign-up source, consent; more after the prelim); columns: name, plan, next delivery, likely run-out, last reply, status; 50 per page.
- **Customer profile** (centerpiece). Sticky header: name, member since, sign-up source, plan, **consent chips** ("Delivery texts: yes · Offers: yes"), next delivery, quick actions (Send check-in now · Move delivery… · Hold until… · Pause… · Add note). Below, two columns:
  - **Left 8 columns:** **Pantry chart**, labelled directly on the chart (no legend): past deliveries (espresso markers), replies (dots labelled "6 wks"), estimated days on hand (espresso line at 60%), likely run-out range (orange band at 20%), scheduled next delivery (hollow espresso marker) and proposed delivery (solid orange marker) joined by a dashed arrow, "today" line in muted. Title generated from the model: "Most likely runs out around Dec 2 (likely between Nov 16 and Dec 24)". Empty state: "No replies yet: projection based on similar customers". Then the **Message thread**: each automated text has a reason line and an expandable **"Why we sent this"** ("Runs out around Dec 2 (likely Nov 16 – Dec 24) · How sure: Medium · Checks passed: replied this cycle ✓, 10 days' notice ✓, not in holiday freeze ✓ · Sun Oct 18, 10:02 am") with a **Technical details** disclosure holding the raw quantiles and rule codes. Then **Order history** (date, items, size, price, status, estimated days on hand at arrival).
  - **Right 4 columns (sticky):** **Why this date** card (starting point, her evidence, what would change it; how sure; checks that applied), then **Activity log** (last 5, expandable).

### 3.3 Inbox
Tabs: **Needs a person** (default; free-text replies and unclear cases, oldest first; actions Reply · Hold until… · Pause · Move… · Resolve) · **Approvals** (sooner moves, discount offers, anything a rule sends for review; Approve / Hold) · **All messages** (searchable audit log of every text, with reason chips and "why we sent this"). Each queue has exactly one home; Today shows the top items and links here.

### 3.4 Offers (§8)
- **List:** name, type, status (Draft · Scheduled · Running · Paused · Ended), audience size, holdout, sends, status line, e.g. "Collecting data · 212 of 1,060 per group · first read est. Mar 2027".
- **Create/edit** (one page, four sections, pre-filled templates): 1) type + message preview; 2) audience (rule chips); 3) timing (rides with the next reminder; never a new text); 4) safety (holdout mode, caps, approval, budget). **Live preview panel:** eligible count, excluded counts by reason (incl. "no offer consent", "stockpiled", "in pacing pilot", "no message to ride on", "had an offer in last 30 days", "in another experiment"), a sample message for a real customer, and the **break-even range**.
- **Results:** per-offer acceptance, opt-outs within 7 days, next check-in reply rate (readable in weeks); cancellation effects read only at the pre-computed sample size (§8.5).

### 3.5 Roast outlook (§9.2)
Weekly DTC deliveries and pounds for 6 weeks with a P10–P90 band; table by week; **Export CSV**. Caption: "Planning view · DTC only · a small share of roaster volume."

### 3.6 Impact (§10)
Cards: *Is pacing paying for itself?* · *Pilot plan* · *Model check on real data* · *Offer experiments*.

### 3.7 Settings (static, read-only in the prototype; values from the `settings` table)
Delivery day (Wednesday), quiet hours (9 pm–8 am), caps, freeze dates (Nov 15–Jan 5), cautiousness (Balanced), consent texts, standing global holdout.

---

## 4. Production look, honest data
- No mode pills, presenter strips or "SIMULATED" stamps on screens. One environment badge: **"Sandbox · sample data"**. Only the Impact page's simulator chart carries "Projection from simulation".
- The presenter says once: **"Everything here runs on sample customers we generated to match Classic Cup's case numbers; the model's projections are computed live."**
- **Sandbox drawer** (hidden; `Ctrl+Alt+D` or the badge menu): *Advance to next scripted event*, *Inject reply*, *Channel: Replay / Console / Live*, *Reset sandbox*. During the demo the presenter uses one shortcut, **`Ctrl+Alt+→` (advance)**, matched on `event.code`, ignored while a text input is focused.
- Sample data: ~4,000 active subscribers, synthetic names from common first/last-name lists (no real people), Georgia cities, 9 months of orders and messages, ~60% with offer consent.
- `pnpm demo` **resets the sandbox on boot** (unless `KEEP_DATA=1`), so every dry run starts identical.

---

## 5. Visual design system
**Palette** inspired by Jittery Joe's public site and logo as observed Oct 19, 2026 (logo orange `#F16A21`/`#FE6A00`, logo espresso `#643A2B`, site accent plum `#7F2754`, site ink `#1C1C1C`). **Colors only: no Jittery Joe's name, logo, artwork or wordmark;** the product is branded Classic Cup (fictional). WCAG 2.x contrast computed:

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `--brand-orange` | `#F16A21` | chart primary series, proposed-delivery marker, active-nav bar, large numbers | 3.08 on white; **2.87 on cream (fails)** ⇒ **only on white surfaces, never directly on `--cream`; never body text** |
| `--orange-ink` | `#B34A12` | links and secondary emphasis; focus ring | 5.4 on white, 5.0 on cream |
| `--espresso` | `#643A2B` | primary buttons (white text), headings, sidebar | 9.6 with white |
| `--plum` | `#7F2754` | "needs a person" and offer chips as **text on a `#F5E9EF` tint**; comparison chart series (**dashed**) | 9.1 on white; differs from espresso by only 1.06:1 in lightness ⇒ always pair with tint or dash |
| `--ink` | `#1C1C1C` | body text | 15.9 on cream |
| `--muted` | `#6B5A50` | secondary text | 6.1 on cream |
| `--cream` | `#FBF6F1` | page background | — |
| `--surface` | `#FFFFFF` | cards, tables, chart areas | — |
| `--line` | `#E9DFD6` | borders, grid lines | — |
| `--success` | `#2E7D5B` | on schedule, positive deltas | 5.0 with white |
| `--danger` | `#B42318` | failures, stop states | 6.6 with white |

- **Buttons:** primary = espresso; secondary = white with espresso border; orange-ink is for links only (never a button next to a danger button).
- **Sidebar:** espresso, cream labels (8.96:1), 4 px orange bar on the active item (non-text, 3.1:1 on espresso).
- **Typography:** Inter (SIL OFL 1.1; ship `InterVariable.woff2` + `OFL.txt` in `public/fonts`; system stack fallback). Sizes 12 (axis ticks) · 13 (chips, captions, reason lines) · 14 (tables) · 16 (body) · 20 (section) · 28 (page title) · 36 (KPI). Weights 400 / 500 / 600. Tabular numerals in tables, KPIs and chart ticks.
- **Layout:** 8-px grid; cards 12-px radius, 1-px `--line`, no heavy shadows; tables 48-px rows; content max 1440 px; works at 1280×720.
- **Charts (Recharts):** one y-axis, ≤ 5 ticks; direct end-of-line labels for ≤ 3 series (no legend); bands as `<Area>` with `[low, high]` at 20% opacity; series differ by **pattern and color**: current/this customer = orange solid; history = espresso 60%; comparison = plum dashed; Impact chart: Required = espresso dashed, Paced = orange solid, Ceiling = plum dotted. Titles state the finding.
- **States:** empty states for every list and chart; a 2-px top progress bar after 300 ms (no skeleton loaders; local responses are fast); error toasts with retry.
- **Accessibility:** keyboard navigation; focus ring 2 px `--orange-ink` with 2 px offset; color never the only signal.
- **Microcopy:** plain English (§11.6); dates "Wed Nov 11"; relative times.

---

## 6. The demo (≤ 7 minutes)
Data from `scenarios/demo.json` (Appendix A). Sandbox clock **Sun Oct 18, 2026, 9:00 am** (`America/New_York`), one clock for everyone. Deliveries land on Wednesdays.

| # | Beat | Page | What happens | Budget |
|---|---|---|---|---|
| 0 | Problem first | — | "Exhibit C: almost half of new subscribers come from the cafe and website, and their number-one reason for cancelling is 'too much coffee arriving'. Classic Cup controls the schedule completely but can't see anyone's pantry. This is the console that gives the subscription team that view. Sample customers matched to the case; the model computes live." | 0:20 |
| 1 | Morning view | Today | Tiles; Running out soon; Going out today with reason chips; Needs a person and Waiting for approval | 0:50 |
| 2 | Maya | Profile | Pantry chart: her stockpile on arrival has grown 0 → 10 → 20 days and would be 30 at the scheduled Oct 28 delivery. Advance: the 10:00 check-in goes out; Maya replies **6**; the band updates; the proposed move **Wed Oct 28 → Wed Nov 11** appears with "Why this date" and the checks that let it go automatically; open "Why we sent this" (audit trail) | 1:40 |
| 3 | Dev | Profile | New subscriber, one delivery; this morning's check-in went out, no reply yet: "How sure: Not yet sure → holding off". At sign-up he said "1 cup a day, just me": the console had suggested every 6 weeks; he chose 4 (sign-up suggestion, §9.1) | 0:30 |
| 4 | Impact | Impact | "Is pacing paying for itself? Only if stockpiles drive nearly all of these cancellations, and nobody knows that share today. With perfect knowledge of pantries it pays far sooner, and reply rate is the biggest lever, so we protect it. Pacing fixes one cancel reason; that's why there's a second lever." Show the real-data model check card | 0:50 |
| 5 | Offers | Offers → New (pre-filled) | "Athens roast rotation" for social sign-ups ("was only sampling", 3,420/yr, 11% kept at a year): audience *source = social/paid* + *member 30–90 days* + *not stockpiled* + *offer consent*; rides with the reminder; experiment mode (50% holdout). Preview: eligible and excluded-by-reason counts, sample message, break-even range, "≈ 1,060 per group: first read months away; until then we watch acceptance and opt-outs". Schedule | 1:15 |
| 6 | The ask | — | "Our recommendation: a 12-week pilot on pay-as-you-go cafe and website subscribers, three randomized arms, run by the existing subscription team. Go if late deliveries and stockpiles fall with reply rate at or above 40%; stop if a guardrail breaks two weeks running. Every decision is explained; every offer is measured against a holdout." | 0:15 |
| (opt) | Priya | Inbox | Free text "heading to Denver till Nov 2" → Hold until Wed Nov 4 → confirmation text | (0:20, cut first) |
| | **Total** | | 5:40 narration (6:00 with Priya) + ~0:30 navigation | **≈ 6:10** |

Time rule: on Impact by 3:20; on Offers by 4:10. Cut order: Priya → the "Why we sent this" drill-down → the sign-up line in beat 3. The 8-field data request and the "why DTC" answer go on the slide before the demo.

---

## 7. The model (server-side, no network calls)
Code `src/engine/`: pure TypeScript, deterministic, unit-tested. Runs on the server against SQLite data; a customer's projection is recomputed when their event log changes.

### 7.1 Two layers
- **Layer A: starting estimate (empirical Bayes).** Each customer's typical "days one delivery lasts" (log scale, θ) starts from a small linear model on sign-up source, sign-up answers and the chosen rhythm, with partial pooling (OLS coefficients; τ from residuals; σ_b as pooled within-customer variation). **In the sandbox the coefficients are fit on synthetic data (labelled "assumed prior; circular by construction").** In production the label comes from replies (each "weeks left" reply implies a days-per-delivery estimate), and the prior is refit once ≈ 300 replies exist. The real-data check (§7.6) tests the *method*, not Classic Cup's coefficients.
- **Layer B: pantry tracker (particle filter / sequential Monte Carlo).** M = 500 weighted hypotheses per customer, each (θ, R) with R = days of coffee on hand. Deliveries add coffee; days remove it; replies reweight. Output: a run-out range whose coverage is **checked against the simulator's known truth** (80% range coverage by deliveries completed and reply state, with a deliberately misspecified reply channel; reported, not tuned). In the pilot a sub-sample gets one follow-up ("What day did you open your next bag?") so coverage can be audited on real customers.

### 7.2 Dynamics and observations
- Delivery: `R += exp(θ + σ_b·z)`; the first delivery starts consumption. Between events of Δ days: `R = max(R − Δ·exp(ν·√(Δ/30)·z), 0)`, ν = 0.10.
- **Weeks-left reply w ∈ {0..12}:** `w = round(R·e^z/7)`, z ~ N(0, σ_obs²) plus garbage. Likelihood `P(w|R) = (1−ε)[Φ((ln 7(w+½) − ln R′)/σ_obs) − Φ((ln 7(w−½) − ln R′)/σ_obs)] + ε/13`, `R′ = max(R, 0.5)`; w = 0 uses only the upper term; w = 12 is right-censored. Engine constants fixed: **σ_obs = 0.35, ε = 0.10** (the simulator draws its own accuracy).
- Skip with ≥ 21 days on hand: soft constraint R > 21 (0.95/0.05). Staff "Hold until…": consumption paused between dates; ν × 1.5 for that stretch.
- Systematic resampling when effective sample size < M/2; jitter θ 0.01 and R 0.5 day; floor `w ← 0.99w + 0.01/M` per observation; log-space weights.
- **Counter-based randomness** (`hash32(seed, customerId, stream, index)`): a projection is a pure function of the event log.
- **Performance:** ≈ 4,000 × 500 × 15 ≈ 3·10⁷ particle updates (a v3 benchmark ran this in ≈ 3.7 s on a laptop). Projections are written by the seed and stored; the server recomputes at startup only if the stored `ENGINE_VERSION` differs, otherwise per customer when their event-log hash changes (< 10 ms each).

### 7.3 Decision rule and guardrails
- Target arrival = today + Q₀.₁₀(run-out) + 3-day grace (Balanced; Cautious 0.05, Aggressive 0.20); new arrival = **latest Wednesday on or before** target; step ±14 days max; gap within [21, 84] days.
- **No answer, no change:** a move needs a fresh reply this cycle, a staff action, or the customer's own request.
- **How sure:** `ratio = (q90+7)/(q10+7)`; **High** = fresh reply and ratio ≤ 1.6; **Medium** = fresh reply and ratio ≤ 3.0; **Not yet sure** otherwise (constants in `ENGINE`; if v3 code is copied, its `+1 / 2.6` must be updated). On screen: "High ≈ range within ±25%; Medium ≈ within ±50%." The run-out band is the 80% range and is labelled "likely".
- **Later moves go automatically only if:** (a) a fresh reply triggered it, (b) Medium or High, (c) the text goes ≥ 7 days before the original date and a reminder 3 days before the new date, (d) the proposal shows delivered (from the third proposal on, also a reply in the previous two cycles), (e) pay-as-you-go with ≥ 2 completed deliveries, (f) neither the send date nor the new date falls in the freeze (Nov 15–Jan 5). Otherwise → **Inbox › Approvals**.
- **Sooner moves always need the customer's YES** (and go to Approvals first). Every reminder offers "Running low? Reply SOONER."
- **Caps:** 3 routine texts per delivery (check-in, proposal, reminder) + at most 1 other (a clarifying question); none 9 pm–8 am; once How sure is High, check-ins drop to every other delivery.

### 7.4 What the model writes (`projections`)
`{ computedAt, engineVersion, runOut: {q05,q10,q33,q50,q90}, confidence, holdingOff, proposal: {from, to, direction, step, autoSend, blockedBy[]}, explanation: {startingPoint, evidence, whatWouldChange}, ruleTrace[] }`. Each `ruleTrace` code maps to a plain-English sentence in `explain.ts`.

### 7.5 Simulator (sample data and the Impact page)
`src/sim/`: generates the sandbox and runs the policy comparison. Calibrated to Exhibit C retention by source (exactly identified: a code check, not validation). Assumptions in `LEDGER`: median days a delivery lasts 64/66/78/74/60 (in-cafe/website/social/gift/referral); τ 0.30; σ_b 0.15; customer rhythm from {28, 42, 56, 84} days with a mild over-ordering bias (range includes none and under-ordering); life events 8%/month (pace × 0.4 for 14–35 days); reply probability 45% (higher when low); reply accuracy ±35% with 10% garbage; churn hazard with a stockpile driver (share φ of the cafe/website hazard, the unknown the Impact page sweeps) and a run-out penalty. Policies: Fixed, Paced, Ceiling (perfect pantry knowledge, same rule), RuleText. Outputs per φ: required vs delivered retention gain, late and stockpile shares, profit per sign-up (shipped view, net of a $2/active-subscriber-year placeholder). Expected-survival calibration by scalar bisection; paired bootstrap intervals; "indistinguishable" when an interval includes zero. (Method detail: v3 §5.2.)

### 7.6 Real-data check (method only)
UCI *Online Retail II* (CC BY 4.0; Chen 2012, doi:10.24432/C5CG6D; 1,067,371 rows; Dec 2009–Dec 2011; many wholesale buyers). Predict the next reorder gap from earlier gaps; time + customer split; 180-day administrative cut; calibrated last-gap baseline; pinball at q = 0.10/0.50/0.90; coverage of the 80% range by reorder count; success rule committed before the first run. Impact card text: "Real data, not coffee, no text replies: checks that our ranges mean what they say." One-time `.xlsx` → CSV conversion (any tool); the derived gap table is committed with attribution.

---

## 8. Offers: the rules

### 8.1 Offer types (no generic discount)
| Type | Example | Discount | Exhibit C reason it targets |
|---|---|---|---|
| **Athens roast rotation** | "A different Athens roast each delivery, same price" | No | Social/paid: "was only sampling" |
| **Smaller bag / pause** | "Switch to a smaller bag?" / "Pause a month?" | No | In-cafe and website: "too much coffee arriving" |
| **Seasonal swap** | "This month's roast instead of your usual, same price" | No | Anyone not stockpiled (freshness, novelty) |
| **Gift-to-own** | "Keep it coming yourself? First delivery 10% off" | Small, manager approval, budget cap | Gift recipients near the end: "price" |

### 8.2 Audience chips
Likely run-out in N–M days · median days on hand (< 7, < 14, ≥ 14) · last reply 0–1 weeks · skipped 2+ of last 4 · sign-up source · gift ending within 30 days · member for N–M days · **offer consent = yes (always enforced)**. Discount audiences may use **only** sign-up source, gift status and tenure: never city, ZIP or name-derived fields.

### 8.3 Guardrails (enforced in code; shown as "excluded because…")
- **Never offer more coffee** (larger bag, add-ons) unless the model's **median** days on hand is < 7 **and** How sure is Medium or High; "Not yet sure" customers are excluded.
- **No new texts:** offers append to the next reminder (two reply options plus NO OFFERS); no scheduled message in the window → excluded.
- **Frequency:** at most 1 offer per customer per 30 days; never after STOP or NO OFFERS; never in quiet hours.
- **Consent:** offers are marketing and go only to customers with offer consent (prior express written consent for automated marketing texts, 47 CFR 64.1200); delivery-timing texts use the separate delivery consent. **NO OFFERS** clears offer consent only; STOP stops all texts.
- **Cancel requests are honoured immediately; no offer is attached to a cancel reply or sent afterwards.**
- **No interference with the pacing pilot:** customers in the pilot's 12-week window get no offers (they stay eligible for the global holdout afterwards).
- **Experiment hygiene:** randomization stratified by sign-up source and **sticky per offer family** (hash of customerId + family); a customer is in at most **one running experiment at a time** and its 60-day outcome window must close before another; analysis is intention-to-treat by assigned arm.
- **Sensor-protection rule (all offers, checked daily):** pause the offer if (a) STOP or NO OFFERS replies within 7 days of an offer text exceed **2% of sends** (minimum 100 sends); or (b) with ≥ 200 per arm, the one-sided 95% lower bound of (treatment − holdout) opt-out rate is above 0; or (c) with ≥ 200 per arm that reached their next check-in, the one-sided 95% upper bound of the reply-rate difference is below −5 points. Harm stops may be checked continuously; benefit is read only at the pre-set sample size.

### 8.4 Break-even (preview panel)
`breakEvenPer1000 = 1000 × acceptRate × costPerAccept / valuePerSave`, where `costPerAccept` is the discount value ($0 for swaps, rotation, size, pause; messages ride on existing texts) and `valuePerSave = (deliveriesPerYear × AOV_source × 0.61 / 12) × Σ_{k=0..11} 0.92^k` (gross profit over the next 12 months from keeping a subscriber who would otherwise cancel, counting that a saved customer still cancels at ≈ 8% a month: ≈ 7.9 expected months). Shown as a **range across deliveries per active year 7–9.2** (7 = labelled assumption; 9.2 = $1.3m ÷ ~4,000 actives ÷ $35.5): for gift-to-own at 10% off a $46 order (Exhibit C gift AOV) with 30% acceptance, cost ≈ $1.38 per recipient, value ≈ $129–170 → **pays if it keeps ≈ 8–11 of every 1,000 recipients** (computed in code from `LEDGER`; the UI must not hard-code it). For no-discount offers the money break-even is ≈ 0, so their real cost is annoyance: that is what the sensor-protection rule watches. For discount offers the decision metric is **90-day** cancellation (a delay is not a save).

### 8.5 Measurement (honest about scale)
- **Per offer, primary metrics readable in weeks:** acceptance, STOP/NO OFFERS within 7 days, next check-in reply rate.
- **Cancellation effects are read pooled** across offers against a **standing global holdout: 10% of offer-consented customers receive no offers for six months** (sticky, hash-assigned).
- **Experiment mode (50% holdout)** is used for one offer type at a time when its own cancellation effect must be measured. Sample size from a two-sided 5% test at 80% power: a 3-point drop from ≈ 8% per 30 days needs **≈ 1,060 per group**; smaller effects need far more (≈ 2,550 per group for a 2-point drop, and a break-even-sized effect of about 1 point is beyond Classic Cup's scale). At Classic Cup's scale that is **months per offer**: the results page says so ("Collecting data · n of N per group · first read est. {month}", from the current eligible rate).
- **Fixed read:** no benefit intervals are shown until N is reached (counts and guardrails only). Then: proportions with 95% Newcombe (Wilson) intervals; net gross profit per recipient as a difference in means with a 95% bootstrap interval over customers.
- In the sandbox, results always show the collecting-data state: **offer outcomes are never faked.**

### 8.6 The line for judges
"Offers are a second lever for the cancel reasons pacing can't fix: sampling for social sign-ups, price for gift recipients. They never add a text, never give more coffee to someone who's stockpiled, can be turned off with NO OFFERS, and every one is measured against a holdout. So Classic Cup learns which offers actually keep people, instead of paying people who would have stayed."

---

## 9. Extra features

### 9.1 Sign-up rhythm suggestion (recommended extra)
At sign-up (website form or a barista question in the cafe) the customer answers two questions (cups a day, people at home); the system **suggests** a rhythm ("Most one-cup-a-day households choose every 6 weeks") and the customer still chooses. It targets the first two deliveries, when pacing is not allowed to move anything and the stockpile starts to build, needs no new model (Layer A already uses these answers), and sends no extra texts. **Caveat for the talk:** in the stress test a schedule set from sign-up answers alone was *worse* than the customer's own choice (people know their pace to about ±15%), so this is a suggestion the customer can ignore, tested as a pilot arm, never an imposed schedule. In the console: the profile shows "Suggested at sign-up: every 6 weeks · chose: every 4 weeks".

### 9.2 Roast outlook (small)
- Weekly DTC deliveries and pounds for 6 weeks from (a) scheduled deliveries, (b) pending moves, (c) expected skips and cancellations (Exhibit C-calibrated hazards by tenure), (d) **new sign-ups' first deliveries** (Poisson at 8,670/yr × the Exhibit D monthly index, split by source). Monte Carlo: 200 draws; each draw first samples a hazard multiplier (±20%) and a sign-up-rate multiplier (±15%), then customer outcomes, so the P10–P90 band includes rate uncertainty.
- **Units:** pounds = deliveries × **0.75 lb** (one 12-oz bag; ≈ 27K lb/yr), with a 1.5 lb (two-bag) sensitivity in the CSV header and ledger.
- **Claim (exact):** "It turns the subscription projections into a weekly DTC pounds range the roaster can drop into the batch plan. DTC is a small share of roaster volume (under 2% of wholesale pounds), so this is a planning convenience, not the reason to do this."

---

## 10. Impact page
1. **"Is pacing paying for itself?"**: three lines over the slider "Of every 100 cancellations among cafe and website sign-ups, how many are caused by too much coffee?" (label shows the realised share): Required to break even (net of the $2 placeholder) · Paced · Ceiling (perfect pantry knowledge). One generated sentence ("Pacing alone breaks even at {N}; perfect knowledge at {M}; reply rate is the biggest lever"). Caption "Projection from simulation · sample data". A small "What would make it better" table (reply rate, accuracy).
2. **Pilot plan:** three arms (control / check-in only / check-in + paced delivery), randomized by customer, stratified by source; eligibility pay-as-you-go with ≥ 2 deliveries; 12-week leading indicators (late deliveries, stockpiles, skip rate, reply rate); 90-day retention after ~6 months; guardrails; **go** if late deliveries and stockpiles fall with reply rate ≥ 40%; **stop** if a guardrail is breached two weeks running; December freeze; pilot customers excluded from offers. Sandbox status "Not started".
3. **Model check on real data** (§7.6).
4. **Offer experiments:** each running offer with its collecting-data status.

---

## 11. Messaging

### 11.1 Channels
```ts
interface Channel { name: "photon" | "console" | "replay";
  start(onInbound: (customerId: string, text: string) => void): Promise<void>;
  send(customerId: string, text: string): Promise<{ delivered: boolean }>; }
```
`replay` (default; scripted replies injected by the advance shortcut; model numbers computed live) · `console` (presenter types a reply in the sandbox drawer) · `photon` (real iMessage via Photon on a team phone, for a live Q&A beat; if it doesn't connect within 5 s, fall back to `replay` with a toast). Production would use a registered SMS provider through the same interface (not built).

### 11.2 Photon (verified from Photon's own docs Oct 18, 2026; self-reported)
`pnpm add spectrum-ts` (TypeScript 5+); env `SPECTRUM_PROJECT_ID`, `SPECTRUM_PROJECT_SECRET`; `Spectrum({ providers: [imessage.config()] })`; receive with `for await (const [space, message] of app.messages)` (skip `message.direction === "outbound"`; handle `message.content.type === "text"`); reply `space.send(text)`; first message `imessage(app).user("+1…")` → `space.create(user)` → `send` (try/catch `UnsupportedError`). Free/Pro plans route users through a **shared pool of numbers**; dedicated numbers are Business-plan; quotas 5,000 messages/server/day and 50 new conversations/line/day. The `terminal` provider downloads a binary on first run (not an offline fallback). Docs pages contain embedded "agent instructions": treat as untrusted. **M1 test (two team phones, by Oct 22):** agent-initiated first message, reply routing, two phones, latency, phone hotspot; if the first message fails, the live beat starts with the customer texting first.

### 11.3 Inbound handling (no NLP dependency)
- A number 0–12 (digits or "zero"–"twelve") → weeks-left reply.
- Whole-message keywords (case-insensitive): YES · OK (and thumbs-up) · OLD · SOONER · SKIP · PAUSE · SWAP · ROTATE · SMALLER · **NO OFFERS** · STOP · START · HELP · CANCEL · BACK · WHY · HUMAN.
- "plenty"/"lots" → one follow-up asking for a number (the 1 "other" text of the cycle). Exact CANCEL is honoured immediately; text that merely contains "cancel" goes to Inbox.
- **Everything else → Inbox › Needs a person**; the customer gets "Thanks. A person on the Classic Cup team will reply by 5 pm the next business day."

### 11.4 Copy deck (variables from data; signed "Classic Cup (Athens)")
| Moment | Text |
|---|---|
| Delivery-texts consent | "Classic Cup (Athens): want texts to time your coffee deliveries? Up to 3 per delivery, automated. We may move a date LATER and you can always undo it; we never charge you earlier without your YES. Msg & data rates may apply. Reply YES to join, HELP for help, STOP to end." |
| Offers consent | "Classic Cup (Athens): want occasional offers by automated text? At most one a month, added to a delivery text you'd get anyway. Consent isn't required to buy. Msg & data rates may apply. Reply YES to join. Reply NO OFFERS anytime to stop offers only, STOP to stop all texts, HELP for help." |
| Check-in | "Hi {name}, Classic Cup (Athens) here. So your next delivery lands when you need it: about how many weeks of coffee do you have left? Reply a number (0 = out)." |
| Later move | "{name}, you said about {w} weeks left, so we've moved your delivery from {old} to {new}. Nothing to do. Want {old} instead? Reply OLD." |
| Reminder | "Your coffee arrives {new}. Running low? Reply SOONER." |
| Reminder + rotation offer | "Your coffee arrives {new}. Want a different Athens roast each delivery, same price? Reply ROTATE. Running low? Reply SOONER. No more offers? Reply NO OFFERS." |
| Reminder + smaller-bag offer | "Your coffee arrives {new}. Coffee piling up? Reply SMALLER for a smaller bag at a lower price. No more offers? Reply NO OFFERS." |
| Sooner (needs YES) | "You may run out before {old}. Get it on {sooner} (${amount} charged then)? Reply YES. No reply keeps {old}." |
| New subscriber | "Hi {name}, Classic Cup (Athens) here. How's your first coffee going? About how many weeks do you have left? We won't change your schedule until you tell us." |
| Staff hold | "Got it: we'll hold your {old} delivery and bring it {new} so it isn't sitting on your porch. Reply OLD to keep {old}." |
| WHY | "Your check-in on {date} said about {w} weeks left, and your deliveries have been landing with coffee still in the pantry." |
| Cancel | "Done. Your subscription is cancelled and you won't be charged again. Changed your mind? Reply BACK within 24 hours." |
| STOP | "You won't get any more texts from us. Your deliveries are not affected. Reply START to get texts again." |
| NO OFFERS | "Done: no more offers. You'll still get delivery texts." |

### 11.5 States
`OPT_IN_PENDING → ACTIVE ↔ AWAITING_CHECKIN | AWAITING_PROPOSAL`, plus `HELD`, `PAUSED`, `CANCELLED (24 h undo)`, `OPTED_OUT`. Timers use the sandbox clock (an instant, `America/New_York`), never `setTimeout`.

### 11.6 Vocabulary on screen
"How sure: High / Medium / Not yet sure" · "Holding off" · "Stockpile: 2+ weeks on hand" · "Runs out around" · "Needs a person" · "Profit per sign-up, after the cost of coffee" · no Greek letters, "particles" or quantile names on primary screens (the "Why this date" tooltip may say "estimated from 500 what-if pantries"; raw values sit under Technical details).

---

## 12. Architecture and tech stack (smaller)

### 12.1 What changed from v3
| v3 | v4.1 | Ability lost? |
|---|---|---|
| pnpm monorepo, 4 packages | **one package**, `src/{shared,engine,sim,server,web}` | No |
| In-memory state + JSON | **`node:sqlite`** (`DatabaseSync`, built into Node 24; release candidate since 24.15; no flag) | No: **gains** persistence (offers, approvals, notes, audit) |
| zod everywhere | shared TS types; hand-written guards at the two untrusted boundaries (Photon inbound, seed load) | Minimal |
| chrono-node | none: free text → a person; staff pick dates | No for the demo; better human-in-the-loop |
| Playwright | vitest + an HTTP smoke test of every route + a dry-run checklist | Some UI regression coverage |
| sms-stub, router library | dropped (described only); a ~40-line hash router | No |
| skeleton loaders | a 2-px progress bar after 300 ms | No |

### 12.2 Dependencies (pnpm; pin exact versions and record licenses in README)
- **Runtime:** `hono`, `@hono/node-server`, `spectrum-ts`, `react`, `react-dom`, `react-is` (same version as react; Recharts peer), `recharts`.
- **Dev:** `typescript`, `@types/node`, `@types/react`, `@types/react-dom`, `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`, `tsx`, `vitest`.
- Node **24 LTS** (`.nvmrc`, `engines`). Note: Node ≥ 25 renames the class `Database` and keeps `DatabaseSync` as a deprecated alias; keep `DatabaseSync` on Node 24.
- Verified (official pages): `@hono/node-server` with `serveStatic` from `@hono/node-server/serve-static`; Tailwind v4's `@tailwindcss/vite`; Inter under SIL OFL 1.1; Recharts peer range includes React 19 (confirm on the pinned version).

### 12.3 Repo layout
```
pwc/
  PROTOTYPE_SPEC.md  README.md  package.json  tsconfig.json  vite.config.ts  .nvmrc  .env.example  .gitignore
  scripts/   dev.mjs (spawns server + vite)   convert-online-retail (one-off)
  src/
    shared/  types.ts  constants.ts (WORLD, ENGINE, LEDGER)  rng.ts  dates.ts
    engine/  prior.ts  pantryFilter.ts  decision.ts  explain.ts  outlook.ts
    sim/     world.ts  policies.ts  churn.ts  impact.ts  seed.ts  backtest/
    server/  index.ts  db.ts  routes/*.ts  flows/  offers/  channels/{replay,console,photon}.ts  sse.ts  clock.ts
    web/     main.tsx  router.ts  pages/{Today,Customers,CustomerProfile,Inbox,Offers,OfferEditor,Outlook,Impact,Settings}.tsx  components/  styles.css
  public/fonts/  InterVariable.woff2  OFL.txt
  scenarios/demo.json
  data/  console.db (gitignored)  derived/online_retail_gaps.csv (committed)
  artifacts/  impact.json  backtest.json  (committed; regenerated by scripts)
```

### 12.4 Running it
- **Dev:** `pnpm dev` runs `scripts/dev.mjs`, which spawns `tsx watch src/server/index.ts` (Hono on :8787) and `vite` (:5173, `server.proxy['/api'] → http://localhost:8787`).
- **SSE:** Hono `streamSSE` (`hono/streaming`) with `Cache-Control: no-cache`, a 15-s heartbeat, no compression middleware; snapshot on connect.
- **Demo:** `pnpm demo` = `vite build` → `dist/`; Hono serves `/api/*` and `serveStatic({ root })` from `@hono/node-server/serve-static`, with `root` resolved from `import.meta.url` (Hono resolves relative roots against the process's working directory). The hash router needs no SPA fallback. One port (:8787). Boot resets the sandbox unless `KEEP_DATA=1`; `SANDBOX=1`; `CHANNEL=replay|console|photon` (default `replay`).

### 12.5 SQLite rules
- `new DatabaseSync(path, { timeout: 5000 })`; `PRAGMA journal_mode=WAL`; indexes on customer_id and dates.
- **Seed and sandbox reset run in-process inside one transaction** (`BEGIN`…`COMMIT`, prepared statements); never run the seed CLI while the server has the file open.
- Every "today" query takes the sandbox clock as a parameter; never SQL `date('now')`.
- Tables: `customers` (id, name, city, source, signup_date, plan_cadence_days, suggested_cadence_days, size, status, consent_delivery, consent_offers, signup_answers JSON) · `deliveries` (id, customer_id, scheduled_date, delivered_date, status, size, price) · `events` (customer_id, at, type, data JSON) · `messages` (id, customer_id, at, direction, body, kind, reason_code, status, offer_id, snapshot JSON) · `projections` (customer_id, computed_at, engine_version, events_hash, json) · `offers` · `offer_assignments` (offer_id, customer_id, family, arm, message_id, accepted_at) · `experiment_membership` · `global_holdout` · `notes` · `audit_log` · `settings`.

### 12.6 API
`GET /api/today` · `GET /api/customers` · `GET /api/customers/:id` · `POST /api/customers/:id/actions` · `GET /api/inbox?tab=` · `POST /api/messages/:id/approve|hold` · `GET|POST|PUT /api/offers` · `POST /api/offers/:id/preview|schedule|pause` · `GET /api/outlook` (+ `?format=csv`) · `GET /api/impact` · `GET /api/settings` · `GET /api/stream` (SSE: `message`, `projection`, `queue`, `offer`, `clock`) · sandbox only (`SANDBOX=1`): `POST /api/sandbox/advance|reset|inject|channel`.

### 12.7 Commands
`pnpm seed` (deterministic sample data) · `pnpm impact` · `pnpm backtest` · `pnpm test` · `pnpm dev` · `pnpm demo`.

---

## 13. Judge-attack matrix
| # | Attack | Answer | Where |
|---|---|---|---|
| 1 | "What does the AI actually do?" | Projects each customer's run-out from replies and deliveries; proposes moves; every text shows why | Profile, Inbox |
| 2 | "Is it just ChatGPT?" | No LLM; our own statistical model on the server, no network calls; free text goes to a person | Profile tooltip, Inbox |
| 3 | "Does it pay?" | Pacing alone doesn't unless stockpiles drive nearly all cancellations; reply rate is the lever; the pilot decides | Impact |
| 4 | "Discounts pay people who'd stay." | Only gift-to-own is discounted; holdouts; budget cap; break-even range | Offers |
| 5 | "More texts kill your sensor." | Offers never add a text; 1 per 30 days; NO OFFERS; auto-pause on opt-outs or reply-rate drops | Offers |
| 6 | "Consent and texting law." | Separate delivery and offer consent; NO OFFERS vs STOP; quiet hours; counsel review | Profile chips, Settings |
| 7 | "Another tool nobody uses." | Internal, 2–4 staff, 10-minute routine absorbing the subscription inbox (confirm with mentors) | Today |
| 8 | "Isn't this just a CRM / SMS app?" | Those send what you schedule; new here: per-customer pantry estimate, rules for safe automation, holdouts; in production it sits behind the existing platform's API as the review layer | Profile, Offers |
| 9 | "Cold start." | Dev: holding off; sign-up suggestion for the first deliveries | Profile |
| 10 | "A wrong date makes someone run out." | Service-level rule, 3-day grace, SOONER in every reminder, sooner moves need YES | Profile, copy |
| 11 | "Your offers contaminate your pilot." | Pilot customers get no offers; one experiment per customer; sticky assignment | Offers preview |
| 12 | "Which roast decision changes?" | A weekly DTC pounds range for the batch plan; small share of volume, said plainly | Roast outlook |
| 13 | "Is the data real?" | Sandbox badge; spoken disclosure; real-data model check | Top bar, Impact |
| 14 | "Why DTC when it's 5% of revenue?" | Slide before the demo: visible, controllable, testable in a quarter; the same text-as-sensor fits the 744 wholesale accounts later | Slide |

---

## 14. Testing and acceptance
- [ ] `pnpm demo` serves everything on one port with the network off (Photon excluded); boot reset makes runs identical.
- [ ] `pnpm seed` deterministic (identical sorted checksum); seed + reset each in one transaction.
- [ ] Engine: likelihood vs numerical integration (incl. w = 0, 12); monotone median in reported weeks (fixed seeds, 1-day tolerance); no NaN; idempotent; guardrail property tests (±14 days, [21, 84], never sooner without YES, never auto-move prepaid/gift/freeze); Maya → later, Dev → holding off.
- [ ] Offers: consent enforced; NO OFFERS clears offer consent only; never more coffee unless median < 7 days and Medium/High; no new texts; 30-day cap; pilot customers excluded; one experiment per customer; sticky assignment; break-even computed from `LEDGER`; sensor-protection rule triggers on synthetic opt-out spikes; results hidden until N.
- [ ] Flows: every state × STOP; CANCEL undo at 23 h 59 vs 24 h 01; "OK" never reverts; free text → Inbox; quiet hours; caps.
- [ ] HTTP smoke test of every route and the SSE stream.
- [ ] Simulator: calibration reproduces Exhibit C; mechanism tests (Paced stockpile < Fixed; Paced deliveries ≤ Fixed; Ceiling dominates Paced on late and stockpile, else the max is published); Layer B coverage reported.
- [ ] Backtest from the committed protocol; result shown as computed.
- [ ] Visual checklist at 1440×900 and 1280×720: palette tokens only; orange never on cream; focus rings orange-ink; empty states; no demo text except the badge.
- [ ] Three timed dry runs under 6:30; recorded screen video fallback.

---

## 15. Build plan (Oct 19 → Oct 27 feature freeze for the prelim; polish to Nov 13)
Roles: **A** engine + outlook · **B** server, database, flows, offers, Photon · **C** web and design system · **D** simulator, seed, impact, backtest, QA.

| Days | Dates | Goal |
|---|---|---|
| 1–2 | Oct 19–20 | Repo, types, constants/LEDGER, counter RNG, DB schema, seed v0, design tokens + app shell; Photon M1 spike starts |
| 3–5 | Oct 21–23 | Engine + tests; projections in DB; Today + Customers + Profile on real data; Inbox; replay channel; flows + guardrails |
| 6–8 | Oct 24–26 | Offers (editor, preview, guardrails, holdouts, schedule); Impact (simulation + backtest card); roast outlook; sandbox drawer; `demo.json`; rough video |
| 9 | Oct 27 | **Feature freeze** |
| 10–12 | Oct 28–30 | Visual polish, three dry runs, fixes, final video; Oct 31 buffer |
| after prelim | Nov 5–12 | Judges' feedback, polish, Photon live beat if M1 passed |

**Estimate (from scratch):** shell + design system 3 · DB + seed 3 · engine 5 · flows + guardrails + messaging 4 · Today 2 · Customers + Profile 4 · Inbox 1.5 · Offers 4.5 · roast outlook 1 · Impact + simulator 4 · backtest 3 · Photon 1.5 · sandbox + scenario 1.5 · QA + dry runs 4 · integration 2 = **≈ 44 person-days** (Settings is static from day 1). Capacity ≈ 25–30.
**Cut list (in order, before Oct 27):** 1) Photon live beat (1.5); 2) Inbox "All messages" tab → each profile's thread is the log (0.5); 3) Impact "What would make it better" table (0.5); 4) offer results page shows only collecting-data state (1); 5) Customers filters → search + status (0.5); 6) roast outlook median only, labelled (0.5); 7) Priya flow (0.5); 8) backtest card only, reusing v3's written protocol (1). After cuts ≈ 38.
**Option that closes the gap:** copying v3's engine, simulator, backtest and Photon modules from `b09ece6` (with tests; update the How-sure constants) cuts ≈ 7–8 more days (engine 5→2, impact + simulator 4→2, backtest 3→0.5, Photon 1.5→0.5) ⇒ ≈ 30, at capacity. Without it, build the core path (Today → Maya → Impact → Offers) end to end before any polish.
**Never cut:** Maya's flow with "Why we sent this", guardrails, the offers preview (consent, exclusions, holdout, break-even), the Impact chart and pilot ask, the sandbox badge, the palette and type system.

---

## 16. Open items
1. Photon M1 test and plan tier.
2. Inter license file shipped; package licenses recorded.
3. From mentors: orders per subscriber, delivery days, cancel-reason shares, whether offer consent exists today, whether the team already uses an inbox/spreadsheet routine.
4. Counsel: both consent texts, quiet hours, the consent record format, dual-purpose (delivery + offer) messages, and how a STOP sent in reply to an offer-bearing text is scoped under current FCC revocation rules.
5. Team sign-off that Jittery Joe's-inspired colors (not marks) are fine for the presentation.

---

## 17. Iteration log

**v3 → v4:** staff console; offers; roast outlook; production look; smaller stack; Impact page; human-in-the-loop for free text; JJ-inspired palette. Carried over: pantry particle filter, numeric sensor, guardrails, honest economics (v3 build: pacing alone ≈ −$12K/yr at the placeholder, break-even ≈ 95 of 100, perfect knowledge ≈ 54; real-data check passed with reorder-2 coverage exactly at the 75% edge), real-data protocol, counter-based randomness.

**Simulated judge panel on v4 → v4.1** (no blockers; majors fixed):

| Panel finding | Fix |
|---|---|
| Demo opened on the tool and ended on "doesn't pay" with no ask | Beat 0 starts with Exhibit C; Impact moved before Offers; closing pilot ask with go/stop criteria (§6) |
| No answer to "isn't this just a CRM?" | Adoption paragraph and attack row 8: the new parts are the pantry estimate, safe-automation rules and holdouts; production sits behind the existing platform's API (§2, §13) |
| Demoed offer didn't map to a cancel reason | "Athens roast rotation" for social/paid ("was only sampling"); offer types mapped to Exhibit C reasons; generic discount removed (§6, §8.1) |
| Offers would contaminate the pacing pilot; overlapping experiments; peeking | Pilot customers excluded; one experiment per customer; sticky, stratified assignment; fixed read (§8.3, §8.5) |
| Offer power impossible at Classic Cup's scale; 3-point effect implausible | Per-offer metrics readable in weeks; cancellation read pooled against a standing global holdout; experiment mode one type at a time; honest "months to first read" (§8.5) |
| Auto-pause fired on noise and covered only discounts | Sensor-protection rule for all offers with statistical thresholds and minimum sizes (§8.3) |
| STOP on an offer text killed delivery texts; thin marketing consent | NO OFFERS keyword; fuller offers consent copy; counsel items (§8.3, §11.4, §16) |
| "Calibrated"/"validated" over-claimed | v3's honesty labels restored for both layers; field audit question (§7.1) |
| Roast outlook overclaimed, omitted new sign-ups, units doubled DTC's share | Reframed as a planning convenience; new sign-ups and rate uncertainty added; 0.75 lb default; volume check corrects "≈ 5% of roaster load" to under 2% of wholesale pounds (§1, §9.2) |
| Better extra feature: sign-up rhythm suggestion | Added as a suggestion the customer can ignore, with the stress-test caveat (§9.1) |
| Dev's dates impossible on one clock | Dev's check-in is this morning; one clock (App. A) |
| Seven sidebar areas; approval queue in 2–3 places | Six areas + Settings gear; Inbox with one home per queue (§3) |
| Today didn't fit at 1280×720 | Prescribed grid; roast outlook as a tile sparkline (§3.1) |
| Orange failed contrast on cream; plum ≈ espresso in lightness | Orange only on white; orange-ink focus ring; plum tint chips and dashed series (§5) |
| Missing dev/demo wiring, SQLite rules, dependencies | §12.2, §12.4, §12.5 |
| Consent said "about 2 texts" but caps allowed 5 | "Up to 3 per delivery"; caps 3 + 1; fewer check-ins once High (§7.3, §11.4) |
| Break-even inputs inconsistent with case scale; 6-month value horizon | Explicit 12-month value formula with later churn counted, range across 7–9.2 deliveries/yr, computed from `LEDGER`; 90-day decision metric for discounts (§8.4) |
| Jargon on primary screens; "very likely" overstated the 80% band | "Why we sent this" in plain English with Technical details; band labelled "likely" (§3.2, §7.3) |
| "Start from scratch" vs v3 already built | New project from scratch, with an optional copy of v3 modules shown in the estimate (header, §15) |

---

## Appendix A: Demo scenario (`scenarios/demo.json`)
One sandbox clock: **Sun Oct 18, 2026, 9:00 am** (`America/New_York`). Calendar check (2026): Sep 30 Wed · Oct 14 Wed · Oct 18 Sun · Oct 28 Wed · Nov 4 Wed · Nov 11 Wed · Dec 9 Wed.

| Persona | Facts | Script | Expected model output (±25%) |
|---|---|---|---|
| **Maya Thompson** | in-cafe sign-up; 2 people, pour-over; every 4 weeks; delivered Wed Aug 5, Sep 2, Sep 30; next Wed Oct 28; true days per delivery ≈ 38; stockpile on arrival 0 → 10 → 20 days (30 at the scheduled Oct 28); consents: delivery yes (Oct 2), offers yes; seeded thread history | 10:00 check-in → reply "6" → projection updates → later move Oct 28 → Nov 11 auto-sent (checks a–f pass) → "Why we sent this" | run-out q10/q33/q50/q90 ≈ 29/39/45/67 days; ratio ≈ 2.0 ⇒ Medium; target ≈ +22 days ⇒ clamp +14 ⇒ Nov 11; she still arrives with ≈ 16 days on hand ("better, not fixed"); her next cycle (Dec 9) falls in the freeze |
| **Dev Patel** | in-cafe sign-up Sep 26; answered "1 cup a day, just me"; suggested every 6 weeks, chose every 4; first delivery Wed Sep 30; next Wed Oct 28; check-in queued for 9:30 today (10 days before) | check-in sent this morning; no reply yet | Not yet sure ⇒ holding off, no change (≈ 13/22/27/47 days at day 18; one completed delivery, so not movable) |
| **Priya Shah** (optional) | delivery due Wed Oct 28; delivery consent yes; offers no | free text "heading to Denver till Nov 2" → Inbox → staff "Hold until Wed Nov 4" | confirmation sent; gap within [21, 84] |
| **Offer audience** | ~4,000 actives | "Athens roast rotation": source social/paid + member 30–90 days + not stockpiled + offer consent; rides with reminder; experiment mode | preview counts computed from the DB (no hard-coded numbers) |

## Appendix B: Sources
Exhibits A–D. Jittery Joe's palette: jitteryjoes.com page styles and logo SVG (Oct 19, 2026). `node:sqlite`: nodejs.org Node 24 docs. Hono Node adapter, Tailwind v4 Vite plugin, Inter license, Recharts peer range: official pages (verified by the build reviewer, Oct 19, 2026). Photon: Spectrum docs (Oct 18, 2026). TCPA: 47 CFR 64.1200. UCI Online Retail II. Method references: `../research_sources/R4_methods.md`.
