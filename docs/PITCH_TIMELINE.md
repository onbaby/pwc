# Pitch timeline: 5 presenters, 9 slides, live demo

Deck: `pwc case competition.pdf` (Group 1, "Fresh at the Cup"). Each slide has exactly one speaker. Total target: **18:00**. That length is an assumption; if the real slot differs, scale every block by the same ratio, and shorten the demo first.

## At a glance

| Clock | Slide | Topic | Speaker | Time |
|---|---|---|---|---|
| 0:00 | 1 | Title | **P1 Opener** | 0:30 |
| 0:30 | 2 | Our recommendation | **P1 Opener** | 1:30 |
| 2:00 | 3 | What we found (Exhibits A, B, C) | **P2 Analyst** | 2:00 |
| 4:00 | 4 | Why DTC, not wholesale | **P2 Analyst** | 1:00 |
| 5:00 | 5 | The numbers | **P3 Model lead** | 1:00 |
| 6:00 | 6 | 2026 AI engine (4 steps) | **P3 Model lead** | 2:30 |
| 8:30 | 7 | Shelf to subscriber (QR) | **P4 Demo lead** | 1:30 |
| 10:00 | Live demo | Right on Time console | **P4 Demo lead** | 5:00 |
| 15:00 | 8 | Pilot and risks | **P5 Closer** | 2:30 |
| 17:30 | 9 | Thank you, then Q&A | **P5 Closer** | 0:30 |

Speaker totals: P1 2:00, P2 3:00, P3 3:30, P4 6:30, P5 3:00. P4 carries the most because the demo is theirs. P5 also runs Q&A.

## Who says what

### P1 Opener (slides 1-2, 2:00)
- **Slide 1 (0:30).** Name the team and the case. One sentence: "Classic Cup's best channel has a coffee-timing problem, and timing is the one thing Classic Cup controls."
- **Slide 2 (1:30).** Read the recommendation as a chain, not a list: AI-timed subscriptions, arriving fresh, never piling up, fed by a QR code on every grocery bag. Say the pilot ask in one line (half of new subscribers, three months). Roadmap sentence: "Findings, numbers, how the AI works, a live demo, then the pilot."
- **Handoff:** "[P2] will show why we landed here."

### P2 Analyst (slides 3-4, 3:00)
- **Slide 3 (2:00).** Walk the four tiles left to right.
  - Exhibit A: DTC is 5% of revenue but grew 14%, the fastest channel.
  - Exhibit C: only 22% of website subscribers remain after a year; the top cancel reason is too much coffee arriving.
  - Grocery is a blind spot: $4.6M, no sell-through data, up to 9.4% of bags stale.
  - New apps don't stick: the portal and loyalty app both failed. So we use habits people already have: reply to a text, scan a code.
- **Slide 4 (1:00).** Four reasons, one sentence each: 61 cents kept per dollar (about 2x grocery), growing 3.5x faster than the company, fully in Classic Cup's control, a quick low-cost pilot on existing data.
- **Handoff:** "So what is the prize? [P3]."
- **Own in Q&A:** why not wholesale, where the 22% and 9.4% come from, why the apps failed.

### P3 Model lead (slides 5-6, 3:30)
- **Slide 5 (1:00).** Four big numbers: 5% share, +14% growth, 61% margin, $140K added profit a year. Say the $140K is an estimate built from the exhibits, then say what it depends on (subscribers kept, bags per buyer). Do not defend it past that on the slide; the handbook arithmetic is for Q&A.
- **Slide 6 (2:30).** Four steps, layman's terms.
  1. Data in: orders, skips, bag size, one-tap replies, plus the UGA calendar.
  2. Predict: "a guess of how fast each person drinks coffee, updated every time they reply" and pick the date the bag lands in its 2 to 4 week peak.
  3. Ask by text: nothing changes without the customer's yes; STOP anytime.
  4. Learn and plan: every reply retrains the model, and predictions feed the roaster's weekly plan.
  Land one line: "It gives a range, not a promise, and says when it is unsure."
- **Handoff:** "That is the idea. [P4] will show the grocery side and then the real thing."
- **Own in Q&A:** all model questions (README section 5 and the judge Q&A), the $140K and $276K arithmetic.

### P4 Demo lead (slide 7 + demo, 6:30)
- **Slide 7 (1:30).** Funnel in four beats: scan the bag, see the roast date and peak window (20% off a first fresh bag), subscribe with no app, AI keeps the bag fresh. Add the store win (referral credit, stale-bag flags) and the 51% retention of wholesale referrals. Then: "Let me show you what Classic Cup's team would see."
- **Live demo (5:00).** Run order below.
- **Handoff:** "That is the product. [P5] covers how we prove it."
- **Own in Q&A:** how it is built, how it plugs into Shopify/SMS/ops, privacy, texting.

### P5 Closer (slides 8-9, 3:00 + Q&A)
- **Slide 8 (2:30).**
  - Timeline: month 1 build, months 2-4 A/B pilot, month 5 QR in Athens grocery, month 6 scale or stop.
  - Pilot: random half get AI timing, half stay fixed; measure cancellation, revenue per subscriber, freshness complaints, and QR scans and scan-to-subscribe.
  - Risks, said plainly: we may ship less coffee (so we judge on net revenue), and the forecast may be wrong (customers text SEND NOW; stop rule: if churn isn't below control by month 3, turn it off).
- **Slide 9 (0:30).** Thank the judges, name the ask, invite questions, then hand questions to the owner below.
- **Own in Q&A:** pilot design, risks, rollout, the stop rule, what we would need from Classic Cup.

## Demo run order (P4, 5:00)

Reset the sandbox first (`pnpm demo`, Ctrl+Alt+D). Use the tour shortcuts (→ for next stop, or keys 1-8). Stay on the spoken line; skip the rest.

| Time | Stop | Say | Show |
|---|---|---|---|
| 0:00-0:40 | Today | "A rep opens this each morning." | Reply-rate tile vs the 40% bar; who needs a person; running out soon |
| 0:40-1:55 | Maya | "Her bag is running out after the date we'd have picked." | Pantry chart and range; "Why this date"; the text thread; automatic later move with **Undo move** |
| 1:55-2:40 | Dev | "Sooner moves are never automatic." | A sooner proposal waiting for approval and the customer's YES |
| 2:40-3:20 | Approvals | "Humans stay in charge." | Approve one; the text goes out |
| 3:20-4:10 | QR / stores | "Grocery stops being a blind spot." | Scan landing; stores ranked by stale share; **Visit first**, Copy note |
| 4:10-4:50 | Outlook | "And the roaster gets a weekly plan." | Six-week band and CSV export |
| 4:50-5:00 | Close | "Everything you saw is the sample data; the pilot is how we find out for real." | Back to the slide |

Not in the main run (use in Q&A or if time is left): Customers saved views, Offers editor and holdout.

## Rehearsal rules
1. Each person rehearses their block alone against a timer, then the whole chain twice. The handoff sentences are fixed.
2. Slide changes: the speaker of the next slide says the cue word ("next"), not the previous speaker, so nobody reaches for the clicker twice. P4 should hold the laptop for slide 7 and the demo.
3. Q&A: the person whose name is on the topic answers first; others add only with a new fact. P1 moderates.
4. Keep a recorded demo as backup; open it in a second tab before you start.

## Fix before the pitch
- **Slide 8 has stray text:** the extracted text shows "bro" after the stop rule. Check the slide and delete it.
- **Slide 5 says $140K; the handbook computes about $276K** (10% more subscribers kept plus 5% of grocery buyers converted). The $140K is the safe, deck-consistent number. P3 should say $140K and keep $276K for questions.
- Slide 7 says "20% off a first fresh bag" while the console's offers cap discounts at 10% and need manager approval. Say 20% is the proposed launch promotion, or change the slide; do not let the demo contradict it unprepared.
- No slide covers the demo, so P4 should say out loud "we'll switch to the live product" and P5 should say "back to the slides".
