# Right on Time: staff console for Classic Cup's coffee subscriptions

A working prototype for the UGA AI Society × PwC case competition (spec: [PROTOTYPE_SPEC.md](PROTOTYPE_SPEC.md), v4.1). It is a console for the subscription team that times each customer's next coffee delivery to when they will actually run out, by asking one question by text ("about how many weeks of coffee do you have left?"), estimating the customer's pantry from the answers, and proposing a date. It also runs targeted retention offers with a built-in holdout, and shows what the whole program is worth.

**Everything on screen runs on sample customers we generated to match Classic Cup's case numbers; the model's projections are computed live.** There is no client data in this repository.

## Run it

Needs Node 24 (`.nvmrc`) and pnpm. No API keys are required for anything below.

```bash
pnpm install
pnpm demo        # builds the web app, resets the sample data (about 11 s), serves everything on http://localhost:8787
```

```bash
pnpm dev         # server on :8787 (watch) + Vite on :5173 with /api proxied; open http://localhost:5173
pnpm test        # 100+ tests: engine, flows, offers, every HTTP route, simulator, real-data check, web source rules
pnpm typecheck
```

Other commands: `pnpm seed` (write the deterministic sample database to a file; never run it while the server has the file open), `pnpm impact` (re-run the simulator and rewrite `artifacts/impact.json`), `pnpm backtest` (re-run the real-data check; see below).

### The demo

The sandbox clock starts at Sunday Oct 18, 2026, 9:00 am (America/New_York). Press **Ctrl+Alt+→** (matched on the physical key; ignored while you type in a text box) to advance to the next scripted event: the morning check-ins go out, Maya replies "6" and her delivery moves from Wed Oct 28 to Wed Nov 11 (all six automatic-send checks pass, and "Why we sent this" shows them), Priya texts that she is travelling and it lands in the Inbox. **Ctrl+Alt+D**, or the "Sandbox · sample data" badge, opens the sandbox drawer: advance, inject a reply as any customer, switch channel, reset. The script is `scenarios/demo.json`; the walkthrough is §6 of the spec.

## What you may need to provide (all optional)

| What | Used for | If absent |
|---|---|---|
| `SPECTRUM_PROJECT_ID`, `SPECTRUM_PROJECT_SECRET` (Photon dashboard → project settings) and `PHONE_MAYA`, `PHONE_DEV` (opted-in team phones, E.164) in `.env` | `CHANNEL=photon`: send the demo's texts as real iMessages to two team phones | Nothing changes: the default `replay` channel runs the whole demo offline; `console` lets you type replies in the drawer |
| Counsel review of both consent texts and quiet hours | Before any real customer is texted | Not needed for the sandbox |
| Mentor answers: orders per subscriber, delivery days, cancel-reason shares, whether offer consent exists today | Replace the labelled assumptions on the Impact page | Assumptions are used and listed |

Copy `.env.example` to `.env` to set anything. `KEEP_DATA=1` keeps the database between boots (the default resets it so every dry run starts identical).

## What is where

```
src/shared/   types, constants (every assumption lives in LEDGER), counter-based randomness, dates
src/engine/   pantry particle filter, Layer A prior, decision rule and guardrails, explanations, roast outlook
src/sim/      synthetic world, policies, churn calibration, Impact simulator, seed generator, backtest/ (real-data check)
src/server/   Hono API, node:sqlite store, flows (send, schedule, inbound, actions), offers/, channels/ (replay, console, photon)
src/web/      React 19 + Tailwind 4 + Recharts 3 console
artifacts/    impact.json, backtest.json (committed outputs of the two scripts)
data/derived/ online_retail_gaps.csv (derived reorder gaps, committed with attribution)
```

## How the model works (short)

- **Pantry filter.** 500 particles per customer, each a consumption rate and a pile of coffee. Each reply is a noisy, rounded reading of the true weeks left (σ = 0.35, 10% garbage); skips and staff holds are soft evidence. A projection is a pure function of the customer's event log and a deterministic seed, so it replays identically.
- **Decision rule.** Aim to arrive when the 10th-percentile run-out plus three days' grace; land on the latest Wednesday on or before that; never move more than 14 days at once; keep the gap between 21 and 84 days. How sure: High if the 90th/10th ratio is ≤ 1.6, Medium ≤ 3.0, and both need a fresh reply.
- **Automatic sends** only for *later* moves that pass all six checks (fresh reply, Medium or better, ≥ 7 days' notice with a reminder scheduled, delivered receipt, pay-as-you-go with ≥ 2 deliveries, outside the Nov 15–Jan 5 freeze). Sooner moves always need staff approval **and** the customer's YES. Free text always goes to a person; there is no LLM fallback.
- **Offers** never add a text (they ride on a reminder that was going out anyway), are capped at one per customer per 30 days, are measured against a standing 10% holdout, and pause themselves if opt-outs exceed 2% of sends. Cancellation effects are only read at the pre-set sample size (about 1,060 per group).

## Honest limits

- **Layer A (the starting guess) is fit on our own synthetic data**, so it is circular by construction; the console says so on every customer. Layers B (the replies) are what the pilot tests.
- **The Impact page is a simulation.** Its parameters are in the assumptions table on that page. With our numbers, pacing alone never breaks even at any setting of "cancellations caused by too much coffee"; perfect pantry knowledge breaks even at 52 of every 100; reply rate is the biggest lever. The spec's illustrative ≈ 95 / ≈ 54 are not what this build computes; the page always shows the computed values.
- **Real-data check.** UCI *Online Retail II* (Chen 2012, doi:10.24432/C5CG6D, CC BY 4.0): real repeat-purchase gaps, but wholesale buyers and no text replies. The method beat a calibrated last-gap baseline at the first two reorders and its 80% ranges held within 5 points at the first four. The protocol (`src/sim/backtest/PROTOCOL.md`) was committed before the first run, and the CLI refuses to run unless it is committed and clean. It does not test the reply model, the pantry estimate or the churn effect.
- **Photon live path is untested** without credentials (it imports lazily and falls back to replay after 5 s). The Photon M1 test with a real phone is an open item.

## Deviations from the spec, and open items

1. **Dev Patel's run-out range** (Appendix A: ≈ 13/22/27/47 days at day 18) comes out as 8/15/19/35 in this build, outside the ±25% tolerance, because Layer A is fit on our simulator rather than the spec author's prior. The behaviour is as specified: "Not yet sure → holding off, no change".
2. **Break-even** in the offer preview is 1000 × acceptance × cost per acceptance ÷ gross profit per saved customer, with value from 7–9.2 deliveries a year × the source's order value × 61% margin, summed over 12 months at 8% monthly attrition. Labelled in the ledger.
3. **Impact chart** draws a fourth, lighter dashed line (the bar perfect knowledge must clear), because that bar differs from pacing's (it removes more deliveries). The spec's three lines are all there.
4. **Simulator ledger notes:** the holiday freeze is not modelled in the simulator; staff approvals are assumed always given; expedited deliveries are not credited.
5. **Stale approvals** (a proposal whose date has passed) expire automatically with a reason; the spec does not describe this.
6. The offer editor lives in `pages/Offers.tsx` with the list rather than a separate `OfferEditor.tsx`.
7. Not in the repo: counsel's review, team sign-off that the Jittery Joe's-inspired colors (not marks) are fine for the presentation, and mentor data.

## Licenses

Everything is pinned to exact versions.

| Package | Version | License |
|---|---|---|
| hono | 4.13.13 | MIT |
| @hono/node-server | 2.1.5 | MIT |
| spectrum-ts | 12.11.0 | MIT |
| react, react-dom, react-is | 19.3.1 | MIT |
| recharts | 3.10.1 | MIT |
| typescript | 7.0.2 | Apache-2.0 |
| @types/node | 24.19.2 | MIT |
| @types/react, @types/react-dom | 19.3.0 | MIT |
| vite | 8.3.4 | MIT |
| @vitejs/plugin-react | 6.1.2 | MIT |
| tailwindcss, @tailwindcss/vite | 4.3.3 | MIT |
| tsx | 4.23.15 | MIT |
| vitest | 5.0.5 | MIT |
| Inter (`public/fonts`) | variable | SIL OFL 1.1 (`public/fonts/OFL.txt`) |
| Online Retail II (derived gap table) | n/a | CC BY 4.0, Chen, D. (2012) |

Colors are inspired by a public coffee brand's site and logo (colors only; no names, marks or artwork). "Classic Cup" is the case's fictional client; sample customers are synthetic.
