# Demo script for P4 (slide 7 + live demo, 6:30)

Your block starts when P3 says "[P4] will show the grocery side and then the real thing." You hold the laptop. Times are a running clock.

**How to read this script**
- **[Brackets]** are actions: what to click or press, and what it does on screen. Don't say them.
- **"Quoted lines"** are what you say. They explain what the screen *means* for a rep; you do not need to read out every number or label. Pick one or two things to point at per screen.
- **Bridge:** the last line of each section hands you into the next one. Say it as you press the key.

**Keys you need (nothing else):** `Ctrl+Alt+→` advance the story · `Ctrl+Alt+1…8` jump to a stop · `Ctrl+Alt+D` sandbox drawer. Stops: **1** Today · **2** Maya · **3** Dev · **4** Approvals · **5** Customers · **6** Bag QR · **7** Roast outlook · **8** Pilot.

## Before you go on (T-30 to T-2)
1. `cd pwc && CHANNEL=replay pnpm demo`. Wait for "Right on Time: http://localhost:8787". Wi-Fi can be off.
2. Open the app full screen and zoom (Cmd +) until it reads from the back. Notifications off.
3. `Ctrl+Alt+D`: the drawer must say **clock Sun Oct 18, 9:00 am**, **scripted events 0 of 3**, **channel Replay**. Click **Reset sandbox**, close the drawer.
4. Land on **Today** (`Ctrl+Alt+1`). Don't scroll. Slides in a second window; backup recording in a third tab.

---

## Part A: Slide 7, the grocery funnel (0:00 to 1:30)

[Slide 7 on screen. Use the clicker only.]

"Everything so far fixes the subscription Classic Cup already has. This is how we get *more* subscribers, from the four-point-six million dollars sitting on grocery shelves, where Classic Cup can't see a thing."

"It starts with a QR code on every wholesale bag and cafe cup: *how fresh is this bag? Scan to check.* The shopper sees when it was roasted and its peak window, and gets twenty percent off a first fresh bag."

"If they subscribe, it's the same coffee, pre-filled, no app. The first bag ships when their current one runs out, and our timing keeps every bag fresh so they don't churn. Stores win too: referral credit, and scan data that flags stale bags to pull. Wholesale referrals are already our best cohort, fifty-one percent still subscribed after a year."

**Bridge:** "That's the idea on a slide. Let me show you what the Classic Cup team would actually see." *(Say aloud: "switching to the live product.")* [Switch to the browser window. Today is already open.]

---

## Part B: Live demo (1:30 to 6:30). Demo clock starts at 0:00

### 1. Today (0:00 to 0:40)
[You are already on **Today**. Don't scroll or click. Just point with the mouse.]

"This is what a subscriptions rep sees when they open the app in the morning. Everything on screen is sample customers we generated to match Classic Cup's numbers; the model's projections are computed live."

[Point at the **Reply rate** tile (about 42%, with a marker at 40%): shows what share of customers answered the last check-in.]
"If you remember one number on this page, it's this one. Our whole approach depends on people answering a one-question text. We set the bar at forty percent, and we're above it."

[Point at the three counts at the top (waiting for a person, waiting for approval, running out soon): the rep's to-do list.]
"And these tell the rep where to spend their morning. Everything else, the software handles."

**Bridge:** "Let me show you what 'the software handles' means, with one customer." [Press `Ctrl+Alt+2`: opens Maya Thompson's profile.]

### 2. Maya: ask, answer, move (0:40 to 2:20)
[On Maya's profile. Point at the chart: shows her coffee on hand over time, with the orange band as the range when she likely runs out.]
"Maya signed up in the cafe and gets a bag every four weeks. Each delivery stacks on top of what she hasn't finished, so her pile keeps growing. Right now the system only has a guess from similar customers, and the page says so. That wide orange band is its uncertainty."

[Press `Ctrl+Alt+→` once: simulates 10 am, when the morning's check-in texts go out. A new text appears in her thread on the right.]
"So it asks. One text, once per delivery: roughly how many weeks of coffee do you have left? That's the whole data collection. No app, no portal. People already reply to texts."

[Press `Ctrl+Alt+→` again: simulates Maya replying "6". The chart's band narrows, and a banner appears at the top of her profile.]
"Maya says six weeks. Watch the band tighten, and look at the banner: the system has moved her delivery two weeks later, on its own, and told her. A later move only goes out automatically after it passes a set of safety checks, such as a fresh reply and a week's notice."

[Point at the freshness comparison in the banner: shows how old the bag will be when she opens it, before and after the move.]
"This is the payoff. On the old date she'd open that bag thirty-five days after roasting, past its peak. On the new date it's twenty-one days, inside the two-to-four-week window. Same customer, same coffee, fresher cup."

[Click **Why we sent this** under the move text in her thread: expands a plain-English reason the system acted.]
"And nothing is a black box. Every text can explain itself to the rep. They can also undo it in one click, and so can she, by replying OLD." *(Optional, if time: click **Are these ranges honest?** under "Why this date". It shows the real-data test, a million retail orders, where the eighty-percent ranges held about seventy-nine percent of the time.)*

**Bridge:** "So the system acts when it's confident. The harder question is when it should *not* act." [Press `Ctrl+Alt+3`: opens Dev Patel's profile.]

### 3. Dev: when not to act (2:20 to 2:40)
[On Dev's profile. Point at the banner at the top: says the system is waiting for a reply and holding off.]
"Dev is brand new: one delivery, no reply. The system says it isn't sure yet, so it does nothing and changes nothing. Knowing when not to act matters as much as acting."

**Bridge:** "And for the cases in between, a person stays in charge." [Press `Ctrl+Alt+4`: opens the Inbox on the Approvals tab.]

### 4. Approvals: a person stays in charge (2:40 to 3:05)
[On the Approvals tab. Point at the reason line under the first item: says in plain English why this move needs a person's yes.]
"Anything the system isn't sure about waits here, with the reason spelled out, for example a short history. And moves to a sooner date always need the customer's yes, because they cost the customer money earlier."

[Click **Approve** on the first item: sends the proposed text to the customer and clears it from the list.]
"One click, and the customer gets the text. The rep decides; the software does the legwork."

**Bridge:** "That's the subscription side. Now back to the grocery shelf from slide seven." [Press `Ctrl+Alt+6`: opens the Bag QR page.]

### 5. Bag QR: grocery stops being a blind spot (3:05 to 4:05)
[On Bag QR. Point at the **By store** table: ranks each grocery store by the share of its scanned bags that were already more than four weeks old.]
"This is what grocery has never told Classic Cup: how long bags sit on the shelf. Stores where half or more of the bags are already stale are tagged *Visit first*, so a sales rep knows where to go."

[Click **Copy note** on a Visit-first store: copies a short pre-written note about that store to the clipboard.]
"One click gives the rep a note for their route."

[Press `Ctrl+Alt+D`, click **Open the newest bag's QR page**: opens, in a new tab, the page a shopper sees after scanning a bag.]
"And this is the shopper's side. They see how fresh this exact bag is, twenty percent off a first fresh bag, and a short sign-up. Texts only start after they reply YES." *(Don't fill in the form.)*
[Close the tab with `Cmd+W`, then close the drawer: returns you to the console.]

**Bridge:** "One more thing the forecast gives us for free, and it's for the roaster." [Press `Ctrl+Alt+7`: opens Roast outlook.]

### 6. Roast outlook (4:05 to 4:25)
[On Roast outlook. Point at the chart: shows the next six weeks of pounds to roast, with a likely range.]
"The same predictions become a weekly roasting plan, with a range, and one click exports it to a spreadsheet. It's a small share of total roasting, but it comes free."

**Bridge:** "Which brings us to how we'd prove all of this works." [Press `Ctrl+Alt+8`: opens the Pilot page.]

### 7. Pilot: the test we're asking for (4:25 to 5:00)
[On Pilot. Point at the **Week 5 of 13** bar and the four stage boxes: shows where the pilot is on the deck's timeline.]
"This is slide eight, running. New subscribers are split at random: half get AI timing, half stay on a fixed schedule."

[Point at the comparison table: shows cancellations, revenue per subscriber and freshness complaints for each group. The control group gets no check-ins by design.]
"These rows are what we'll read to decide if it works."

[Point at **The stop rule** card: shows the month-three rule and today's reading.]
"And here's our commitment: if AI-timed subscribers aren't cancelling less than the control group by the end of month three, we turn it off."

"One honest note: this is sample data with no difference built in, so the two groups read alike. We're not going to show you a made-up win. This page is how the real result will be read."

**Handoff:** "That's the product. [P5] will cover how we prove it." *(Say aloud: "back to the slides.")* [Switch to the slides window.]

---

## If you run long (cut in this order)
1. The optional "Are these ranges honest?" and "Why we sent this" lines · 2. Dev · 3. Roast outlook (say its one sentence, don't open it) · 4. Copy note. **Never cut:** Maya's reply, the move and the freshness line; the Pilot page.

## If you run short (add before the Pilot page)
[Press `Ctrl+Alt+5`: opens Customers. Click **Needs attention**: filters to people with a reply to answer or a move to approve. Open one account and click **Export CSV**: downloads the current list.]
"This is how a rep works their day: saved lists with live counts, one click into any account, and a spreadsheet export."

## If something breaks
1. Refresh the page. 2. `Ctrl+Alt+D`, click **Reset sandbox**, and restart from stop 2. 3. Switch to the backup recording and narrate over it. Never debug live.

## Questions you may get right after the demo
- **"Is this real data?"** Sample customers matched to the case's numbers; the model's projections are live; the real-data check used a public retail data set (1,067,371 orders).
- **"What if the customer doesn't reply?"** The system holds off and changes nothing (Dev).
- **"Can it send the wrong date?"** Later moves auto-send only after the safety checks; sooner moves always need the customer's YES and staff approval; every move has Undo, and the customer can reply OLD.
- **"Why is there no difference on the Pilot page?"** We didn't build one in; it shows how the pilot will be read.
