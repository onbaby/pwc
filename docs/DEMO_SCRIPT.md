# Demo script for P4 (slide 7 + live demo, 6:30)

Your block starts when P3 says "[P4] will show the grocery side and then the real thing." You hold the laptop. Times are a running clock from the moment slide 7 is on screen. Spoken lines are written to be said; cut anything in *italics*.

**Keys you need (nothing else):** `Ctrl+Alt+→` advance the story · `Ctrl+Alt+1…8` jump to a stop · `Ctrl+Alt+D` sandbox drawer · `Ctrl+K` search. The stops: **1** Today · **2** Maya · **3** Dev · **4** Approvals · **5** Customers · **6** Bag QR · **7** Roast outlook · **8** Pilot.

## Before you go on (T-30 to T-2)
1. `cd pwc && CHANNEL=replay pnpm demo`. Wait for "Right on Time: http://localhost:8787". Wi-Fi can be off.
2. Open the app full screen, zoom (Cmd +) until the table text is readable from the back. Notifications off.
3. `Ctrl+Alt+D`: the drawer must say **clock Sun Oct 18, 9:00 am**, **scripted events 0 of 3**, **channel Replay**. Press **Reset sandbox**, close the drawer.
4. Land on **Today** (`Ctrl+Alt+1`). Do not scroll. Keep the slides in a second window; put the backup recording in a third tab.
5. Know the one disclosure line: *"Everything on screen is sample customers we generated to match Classic Cup's numbers; the model's projections are computed live."* Say it once, in beat 1.

---

## Part A: Slide 7, the grocery funnel (0:00 to 1:30)

*Screen: slide 7. Click the clicker only.*

| Clock | Say |
|---|---|
| 0:00 | "Everything so far fixes the subscription we already have. This is how we get more subscribers, from the \$4.6 million that sits on grocery shelves where Classic Cup can't see a thing." |
| 0:15 | "**Step one: scan the bag.** Every wholesale bag and cafe cup carries a QR code: *How fresh is this bag? Scan to check.*" |
| 0:30 | "**Step two: see the date.** The page shows when it was roasted and its peak window, and offers twenty percent off a first fresh bag." |
| 0:45 | "**Step three: subscribe.** The same coffee, pre-filled, no app. The first bag ships when their current one runs out." |
| 1:00 | "**Step four: the AI keeps them.** Timing keeps every bag fresh, so new subscribers don't churn. Stores win too: referral credit, and scan data that flags stale bags to pull. Wholesale referrals are already our best cohort, fifty-one percent still subscribed after a year." |
| 1:20 | "Let me show you what Classic Cup's team would actually see. *(Say aloud: "switching to the live product.")*" |

**Click:** switch to the browser window (Today is already open).

---

## Part B: Live demo (1:30 to 6:30)

Demo clock below starts at 0:00 when you reach Today.

### 1. Today (0:00 to 0:40): "a rep opens this each morning"
**Click:** you are on **Today**. Don't scroll. Point with the mouse, don't click.
- **Say:** "Everything on screen is sample customers we generated to match Classic Cup's numbers; the model's projections are computed live. This is the screen a subscriptions rep opens each morning."
- **Point at the Reply rate tile** (about 42%, marker at 40%): "This is the first number our pilot lives or dies on: do people answer a one-question text? The bar is forty percent. We are above it."
- **Point at the pills at the top** (waiting for a person, waiting for approval, running out soon): "Then a worklist. Who needs a human, what's waiting for approval, who is about to run out."
- **Point at the bag freshness gauge:** "And the number we're here to move: how many bags get opened at peak freshness."

### 2. Maya, before (0:40 to 1:00)
**Press:** `Ctrl+Alt+2` (Maya Thompson's profile).
- **Say:** "Maya signed up in the cafe and gets a bag every four weeks. The chart shows her coffee on hand: each delivery stacks on top of what's left. Right now the system only has a guess from similar customers, and the chart says so: *No replies yet*."
- **Point at the orange band:** "That band is the range when she likely runs out. Wide, because we haven't asked her yet."

### 3. The check-in goes out (1:00 to 1:25)
**Press:** `Ctrl+Alt+→` once (the 10:00 check-ins go out).
- **Point at the thread on the right:** "One text, once per delivery: about how many weeks of coffee do you have left? Reply a number."
- **Say:** "That is the whole data collection. No app, no portal. People already reply to texts."

### 4. She replies, the move, the fresher cup (1:25 to 2:20)
**Press:** `Ctrl+Alt+→` again (Maya replies "6").
- **Point at the chart:** "She says six weeks. The range tightens."
- **Point at the Next action banner at the top** (*Moved automatically: Wed Oct 28 → Wed Nov 11*): "And the system moved her delivery two weeks later, on its own, and told her. Later moves pass six safety checks: a fresh reply, enough confidence, a week's notice, a reminder, a delivered receipt, and not in the holiday freeze."
- **Point at the freshness line in the banner:** "Here's why it matters: on the old date the bag opens about thirty-five days after roasting, past its peak. On the new date it opens at twenty-one, inside the two-to-four-week window. Same customer, same coffee, fresher cup."
- **Click:** **Why we sent this** on the move text in the thread. **Say:** "Every text explains itself in plain English. A person can always see why."
- ***If time:** click **Are these ranges honest?** under Why this date: "We tested the model on a million real retail orders, with the plan committed before we ran it. Its eighty-percent ranges held about seventy-nine percent of the time."*
- **Point at Undo move, don't click:** "And a person can undo it in one click. So can the customer, by replying OLD."

### 5. Dev: when not to act (2:20 to 2:40)
**Press:** `Ctrl+Alt+3`.
- **Say:** "Dev is new. One delivery, no reply. The system says it's not yet sure, so it does nothing. Knowing when not to act matters as much as acting."
- **Point at the Next action banner** (waiting for a reply / holds off).

### 6. Approvals: a person stays in charge (2:40 to 3:05)
**Press:** `Ctrl+Alt+4` (Inbox, Approvals tab).
- **Say:** "Anything risky waits here, with the reason in plain English: a thin history, or not pay-as-you-go. And any move to a sooner date always needs the customer's yes, because it costs them money earlier."
- **Click:** **Approve** on the first item. Toast appears. **Say:** "One click, and the customer gets the text."

### 7. Bag QR: grocery stops being a blind spot (3:05 to 4:05)
**Press:** `Ctrl+Alt+6`.
- **Point at the By store table** (sorted by the share of bags already past four weeks old; some rows tagged **Visit first**): "This is what grocery has never told Classic Cup: how long bags sit on the shelf. Stores with half or more of their bags already stale are flagged *Visit first*."
- **Click:** **Copy note** on one Visit-first store. **Say:** "A rep can paste that into their route notes."
- **Press:** `Ctrl+Alt+D`, click **Open the newest bag's QR page** (opens a new tab).
- **Say (on the phone-style page):** "This is what a shopper sees after scanning: how fresh this exact bag is, **twenty percent off a first fresh bag**, and a sign-up with two questions. Texts start only after they reply YES." *(Do not fill the form.)*
- **Close the tab** (`Cmd+W`), close the drawer.

### 8. Roast outlook (4:05 to 4:25)
**Press:** `Ctrl+Alt+7`.
- **Say:** "And the roaster gets a plan: six weeks of pounds with a range, one click to a spreadsheet. A small share of total roasting, but it comes free with the forecast."

### 9. Pilot: the test we're asking for (4:25 to 5:00)
**Press:** `Ctrl+Alt+8`.
- **Point at "Week 5 of 13" and the four stages:** "This is slide 8, running. New subscribers are split at random: half get AI timing, half stay on a fixed schedule."
- **Point at the table:** "These rows are what we will read: cancellation rate, revenue per subscriber, freshness complaints. The control group is never texted by design."
- **Point at the stop rule card:** "And the rule: if AI-timed subscribers aren't cancelling less than the control group by the end of month three, we turn it off."
- **Say, plainly:** "The sample data has no difference built in, so the two groups read alike. We are not going to show you a made-up win. This page is how the real result will be read."
- **Handoff (say aloud):** "That's the product. [P5] covers how we prove it." Switch back to the slides.

---

## If you run long (cut in this order)
1. "Are these ranges honest?" and "Why we sent this" · 2. Dev · 3. Roast outlook (say one sentence, don't open) · 4. Copy note. **Never cut:** Maya's reply, the move, and the freshness line; the Pilot page.

## If you run short (add)
`Ctrl+Alt+5` Customers: click **Needs attention**, open one account, point at the Next action banner, click **Export CSV**: "this is how a rep works their day." Or open a control-group customer (Customers, **Pilot group** filter, *Fixed schedule*): "nothing to do, by design."

## If something breaks
1. Refresh the page. 2. `Ctrl+Alt+D` then **Reset sandbox**, and restart from stop 2. 3. Switch to the backup recording tab and narrate over it. Never debug live.

## Questions you may get right after the demo
- **"Is this real data?"** Sample customers matched to the case; the model's projections are live; the real-data check was on a public retail data set (1,067,371 orders).
- **"What if the customer doesn't reply?"** The system holds off and changes nothing (Dev).
- **"Can it send the wrong date?"** Later moves auto-send only after the checks; sooner moves always need the customer's YES and staff approval; every move has Undo and the customer can reply OLD.
- **"Why is there no difference on the Pilot page?"** We did not build one in; it shows how the pilot will be read.
