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

"Everything we have talked about so far improves the subscription that Classic Cup already has, but this slide is about how we win new subscribers. Today, four-point-six million dollars of Classic Cup coffee sits on grocery shelves, and the company can't see any of it."

"Our idea is to put a QR code on every wholesale bag and cafe cup that invites the shopper to scan it and check how fresh the bag is. The page tells them when the bag was roasted and how long it stays at its peak, and it offers them twenty percent off a first fresh bag."

"If the shopper decides to subscribe, they get the same coffee with the details already filled in, and they never have to download an app. Their first bag ships when the one they own runs out, and our timing keeps every later bag fresh, so they have less reason to cancel. The stores benefit as well, because they earn referral credit and get scan data that tells them which bags to pull. Wholesale referrals are already our best group of customers, and fifty-one percent of them are still subscribed after a year."

**Bridge:** "That is the idea on a slide, so let me show you what the Classic Cup team would actually see when they use it." *(Say aloud: "switching to the live product.")* [Switch to the browser window. Today is already open.]

---

## Part B: Live demo (1:30 to 6:30). Demo clock starts at 0:00

### 1. Today (0:00 to 0:40)
[You are already on **Today**. Don't scroll or click. Just point with the mouse.]

"This is what a subscriptions rep sees when they open the app in the morning. Everything on this screen uses sample customers that we generated to match Classic Cup's numbers, although the model's predictions are being computed live."

[Point at the **Reply rate** tile (about 42%, with a marker at 40%): shows what share of customers answered the last check-in.]
"If you remember only one number on this page, make it this one, because our whole approach depends on customers answering a one-question text. We set the bar at forty percent, and the sample data is currently above it."

[Point at the three counts at the top (waiting for a person, waiting for approval, running out soon): the rep's to-do list.]
"These three counts tell the rep where to spend their morning, because the software handles everything else on its own."

**Bridge:** "Let me show you what it means for the software to handle things, by following one customer." [Press `Ctrl+Alt+2`: opens Maya Thompson's profile.]

### 2. Maya: ask, answer, move (0:40 to 2:20)
[On Maya's profile. Point at the chart: shows her coffee on hand over time, with the orange band as the range when she likely runs out.]
"Maya signed up in the cafe and receives a bag every four weeks. Each delivery lands on top of coffee she hasn't finished, so her pile keeps growing. At the moment the system only has a guess based on similar customers, and the page says so, which is why the orange band showing when she might run out is so wide."

[Press `Ctrl+Alt+→` once: simulates 10 am, when the morning's check-in texts go out. A new text appears in her thread on the right.]
"So the system simply asks her. Once per delivery it sends a single text asking roughly how many weeks of coffee she has left, and that text is our entire data collection. It needs no app and no portal, because people already know how to reply to a text message."

[Press `Ctrl+Alt+→` again: simulates Maya replying "6". The chart's band narrows, and a banner appears at the top of her profile.]
"Maya replies that she has about six weeks left, and you can see the orange band tighten around a much narrower window. The banner at the top also shows that the system moved her delivery two weeks later on its own and let her know. It only makes a later move automatically after the change passes a set of safety checks, such as having a fresh reply and giving her a week's notice."

[Point at the freshness comparison in the banner: shows how old the bag will be when she opens it, before and after the move.]
"This is the payoff of the whole system. On the old date, Maya would have opened that bag thirty-five days after it was roasted, which is past its peak. On the new date she opens it twenty-one days after roasting, which is inside the two-to-four-week window, so she gets the same coffee in a fresher cup."

[Click **Why we sent this** under the move text in her thread: expands a plain-English reason the system acted.]
"None of this is a black box, because every text can explain itself to the rep. The rep can also undo any move with one click, and Maya can undo it herself by replying OLD." *(Optional, if time: click **Are these ranges honest?** under "Why this date". It shows the real-data test. Say: "We also tested the model on a million real retail orders, and its eighty-percent ranges held about seventy-nine percent of the time.")*

**Bridge:** "The system acts when it is confident, but the harder question is when it should not act at all." [Press `Ctrl+Alt+3`: opens Dev Patel's profile.]

### 3. Dev: when not to act (2:20 to 2:40)
[On Dev's profile. Point at the banner at the top: says the system is waiting for a reply and holding off.]
"Dev is brand new, with only one delivery and no reply yet, and the banner shows that the system isn't sure about him, so it changes nothing. Knowing when not to act matters just as much as knowing when to act."

**Bridge:** "For the cases that fall in between, a person always stays in charge." [Press `Ctrl+Alt+4`: opens the Inbox on the Approvals tab.]

### 4. Approvals: a person stays in charge (2:40 to 3:05)
[On the Approvals tab. Point at the reason line under the first item: says in plain English why this move needs a person's yes.]
"Anything the system isn't sure about waits here with the reason spelled out in plain English, such as a customer whose history is still short. Any move to a sooner date also needs the customer's explicit yes, because it charges them earlier than they expected."

[Click **Approve** on the first item: sends the proposed text to the customer and clears it from the list.]
"With one click the customer receives the text, so the rep makes the decision while the software does the legwork."

**Bridge:** "That covers the subscription side, so now let's go back to the grocery shelf from slide seven." [Press `Ctrl+Alt+6`: opens the Bag QR page.]

### 5. Bag QR: grocery stops being a blind spot (3:05 to 4:05)
[On Bag QR. Point at the **By store** table: ranks each grocery store by the share of its scanned bags that were already more than four weeks old.]
"This table shows something that grocery has never told Classic Cup, which is how long its bags sit on the shelf before someone buys them. Stores where half or more of the scanned bags were already stale are tagged Visit first, so a sales rep knows exactly where to go."

[Click **Copy note** on a Visit-first store: copies a short pre-written note about that store to the clipboard.]
"That one click gives the rep a ready-made note to take along on their route."

[Press `Ctrl+Alt+D`, click **Open the newest bag's QR page**: opens, in a new tab, the page a shopper sees after scanning a bag.]
"This is the shopper's side of the same system. After scanning, they see how fresh that exact bag is, they see the twenty percent off a first fresh bag, and they can finish a short sign-up. We only start texting them after they reply YES to our confirmation message." *(Don't fill in the form.)*
[Close the tab with `Cmd+W`, then close the drawer: returns you to the console.]

**Bridge:** "The same forecast gives us one more benefit for free, and this one is for the roaster." [Press `Ctrl+Alt+7`: opens Roast outlook.]

### 6. Roast outlook (4:05 to 4:25)
[On Roast outlook. Point at the chart: shows the next six weeks of pounds to roast, with a likely range.]
"The same predictions turn into a weekly roasting plan with a likely range, and one click exports it to a spreadsheet. Subscriptions are a small share of total roasting, but this plan comes at no extra cost."

**Bridge:** "All of this raises the question of how we would prove that it works." [Press `Ctrl+Alt+8`: opens the Pilot page.]

### 7. Pilot: the test we're asking for (4:25 to 5:00)
[On Pilot. Point at the **Week 5 of 13** bar and the four stage boxes: shows where the pilot is on the deck's timeline.]
"This page is slide eight in action. We split new subscribers at random, so that half of them get AI timing and the other half stay on a fixed schedule."

[Point at the comparison table: shows cancellations, revenue per subscriber and freshness complaints for each group. The control group gets no check-ins by design.]
"These rows are the measures we will read to decide whether the AI timing works."

[Point at **The stop rule** card: shows the month-three rule and today's reading.]
"This card holds our commitment to the judges, which is that we will turn the AI timing off if its subscribers aren't cancelling less than the control group by the end of month three."

"One honest note is that this is sample data with no difference built in, so the two groups look alike. We are not going to show you a made-up win, and this page simply shows how the real result will be read."

**Handoff:** "That is the product, and [P5] will now explain how we prove it works." *(Say aloud: "back to the slides.")* [Switch to the slides window.]

---

## If you run long (cut in this order)
1. The optional "Are these ranges honest?" and "Why we sent this" lines · 2. Dev · 3. Roast outlook (say its one sentence, don't open it) · 4. Copy note. **Never cut:** Maya's reply, the move and the freshness line; the Pilot page.

## If you run short (add before the Pilot page)
[Press `Ctrl+Alt+5`: opens Customers. Click **Needs attention**: filters to people with a reply to answer or a move to approve. Open one account and click **Export CSV**: downloads the current list.]
"This is how a rep works through a day, because the saved lists show live counts, each account is one click away, and the list can be exported to a spreadsheet."

## If something breaks
1. Refresh the page. 2. `Ctrl+Alt+D`, click **Reset sandbox**, and restart from stop 2. 3. Switch to the backup recording and narrate over it. Never debug live.

## Questions you may get right after the demo
- **"Is this real data?"** Sample customers matched to the case's numbers; the model's projections are live; the real-data check used a public retail data set (1,067,371 orders).
- **"What if the customer doesn't reply?"** The system holds off and changes nothing (Dev).
- **"Can it send the wrong date?"** Later moves auto-send only after the safety checks; sooner moves always need the customer's YES and staff approval; every move has Undo, and the customer can reply OLD.
- **"Why is there no difference on the Pilot page?"** We didn't build one in; it shows how the pilot will be read.
