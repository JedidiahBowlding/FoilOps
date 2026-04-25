# FoilOps Dashboard — Live Demo Voiceover Script

> **Recording notes:** All mutation buttons (Enable, Kill Switch, etc.) were
> intercepted at the network layer during recording — no actual state was
> changed on the live receiver. The UI responses you see are real.

---

## INTRO

"Welcome to FoilOps — a full-stack Solana wallet intelligence and trading
operations platform built for serious traders.

Over the next seven minutes I'm going to walk you through every major interface
and show you exactly what each control does, how they integrate, and the real
workflows that tie them together.

This platform is split into two core layers: the operations layer for live trading
control, and the intelligence layer for discovery and analysis. Everything you see
on screen fires real API calls to the Rust backend — mutations are gated through
the control API, while queries hit the intelligence pipeline. Let's dive in."

---

## PAGE 1 — TRADING OPS

_Navigate to `/dashboard/trading-ops`_

"This is the Trading Ops dashboard — the nerve centre of the entire platform.
It's where you manage live execution, configure your signal parameters,
and control your source wallet watchlist. The dashboard is split into five
major sections — you can jump between them using the tab navigation at the top."

"Think of Trading Ops as your mission control. Whether you want to check which
source wallets are currently active, see attribution scoring, visualize your
open exposure, or run a backtest before going live — it's all here."

---

### Section Navigation

**Controls tab**
"Controls is the primary control hub. This is where you manage the Rust receiver
state — you can bring it online, pause it, or kill it completely. You'll also
see your current trading settings and source wallet configuration all in one view."

**Profiles tab**
"Profiles shows you every watchlisted source wallet with a detailed performance
scorecard. You'll see their opportunity score — how often they hit winning trades —
their risk score, behavior classification, and a list of their most recent launches
so you can spot patterns in real time."

**Attribution tab**
"Attribution is critical if you're running multiple source wallets. It breaks down
execution quality by source — which wallets in your watchlist are actually generating
profitable signals, and which ones are contributing noise or false positives. This helps
you decide which wallets to cap, remove, or upgrade to shadow mode."

**Exposure tab**
"Exposure gives you a real-time snapshot of open positions, concentration risk,
and capital deployment. You can see exactly how much of your bankroll is deployed
per source wallet, which is essential for risk management when you're trading live."

**Simulation tab**
"Simulation lets you run paper-trade backtests against your current settings without
touching live capital. This is how you validate a strategy change — change your buy amount,
adjust your risk thresholds, and run a full backtest to see the projected P&L before
you flip the switch to live execution."

---

### Receiver Action Buttons

**Enable**
"The Enable button brings the Rust signal receiver online. Once enabled it starts
listening for incoming Telegram signals from your watchlist, evaluates each one
against your risk thresholds and scoring criteria, and routes qualifying trades
directly to your connected wallet. It fires a control signal to the receiver that
says: start accepting trades."

**Disable**
"Disable is the clean shutdown. It stops accepting new signals immediately and lets
any transactions that are already in flight settle gracefully before going completely
quiet. Use this when you want to end your trading session properly without force-killing
the process."

**Pause**
"Pause is gentler than Disable. The receiver stays running and keeps its connection
to Telegram active, but it won't execute any new trades. This is useful when you're
monitoring something volatile and want a short break without fully restarting the system."

**Resume**
"Resume brings the receiver back from paused state — same session, same configuration,
picks up exactly where it left off."

**Tighten Risk**
"Tighten Risk is a one-click safety measure for volatile moments. It immediately lowers
your max risk threshold and buy amount to conservative defaults — useful when you're
watching a market spike and want to reduce exposure without having to open the full
settings form and reconfigure everything manually."

**Retry Dead Letters**
"Retry Dead Letters is for network resilience. It replays any signals that failed on
their first execution attempt — maybe there was an RPC timeout, or the network was
temporarily congested. This button re-queues those failed trades so you don't miss
profitable opportunities because of transient infrastructure issues."

**Kill Switch**
"And finally, Kill Switch — this is your emergency stop button. It kills the receiver
process immediately, cancels any open orders, and shuts everything down hard. The browser
will ask you to confirm because this action can't be undone without manually restarting
the receiver process."

---

### Settings Form

**Apply Settings**
"Below the action buttons is the full settings configuration form. Here you can tune
the execution mode — paper for testing or live for real trades. You choose your trading
profile which determines position sizing and risk tolerance. You set the buy amount in SOL,
the max risk score you'll accept, slippage tolerance for your swaps, and minimum alert
quality thresholds.

When you've adjusted all the values to your liking, hit Apply Settings and the entire
configuration POSTs to the receiver's control API in one shot. The receiver picks up the
new settings immediately — no restart needed."

---

### Preset Buttons

**Paper Test**
"Paper Test is a one-click shortcut for testing. It sets execution mode to paper mode,
profile to conservative, and buy amount to just 0.005 SOL. This is perfect when you're
evaluating a new signal source — you can validate the quality of their trades without
any real money on the line."

**Cautious Live**
"Cautious Live is the recommended starting point when you're ready to go live for the
first time. It flips execution to real mode but keeps the conservative profile and sets
buy amount to 0.01 SOL. This lets you get real trading experience while keeping position
sizes small enough that even if your source wallet is noisy, the damage is limited."

**Aggressive Live**
"Aggressive Live is for when you've validated that a source wallet's signal quality is
genuinely excellent. This preset switches to live execution with the aggressive profile
and a 0.02 SOL buy amount — significantly larger positions. Only use this after you've
run data and confirmed that the source wallet's win rate and average trade profitability
justify the larger risk."

---

### Source Wallet Controls

**Update Source Wallet**
"The Source Wallet Controls form lets you manage the Rust receiver's signal watchlist
directly from the browser — no CLI commands needed. You choose an action from the dropdown:
add a new source wallet, remove one you don't want, cap the position size for a specific
wallet, uncap it again, or apply a behavioral profile.

You paste in the Base58 wallet address — the source wallet you want to track. Optionally
you can set a position size cap if you want this particular wallet to never deploy more
than a certain amount of capital, and you can choose a behavior preset like shadow mode
for conservative tracking, scalp for quick flips, swing for longer holds, or defensive
for ultra-conservative entry criteria.

Hitting Update Source Wallet sends this configuration straight to the receiver's control API.
It takes effect immediately."

---

### Tracked Wallets

**Update Tracked Wallets**
"Below the source wallet form is Tracked Wallets. This controls which wallets appear in
your website alerts, your graph views, and your dashboard tables. Add or remove a wallet
here and it'll immediately start appearing in — or disappear from — your alerts pool, the
graph analysis, and the Launch Intelligence table. This is separate from source wallets;
tracked wallets are for monitoring and analysis, while source wallets are for signal
generation."

---

## PAGE 2 — WALLET GRAPH

_Navigate to `/graph/<address>`_

"The Wallet Graph is your on-chain relationship explorer. It renders a force-directed
network canvas that visualizes transaction relationships between wallets.

Think of it as an intelligence view — you point it at a wallet and it shows you:
who has that wallet been transacting with, what's the velocity of transactions,
and what's the historical pattern. This is essential context when you're deciding
whether to trust a source wallet."

---

### Wallet Chip Buttons

"Along the top of the graph you'll see your tracked wallet shortcuts — these are
quick-access chips for wallets you're monitoring regularly. Click any chip and it
instantly loads that wallet's graph. The canvas redraws, the relationship data loads,
and the AI analysis summary below updates automatically.

This is the fastest way to flip between your core watchlist without typing wallet
addresses."

---

### Load Graph

"You can also paste any Solana wallet address directly into the Load Graph input box.
Hit Load Graph and it builds the network from scratch for that address — fetches all
transaction partners within the relationship depth, computes the force-directed layout,
and renders the canvas with all the nodes and edges."

---

### Node Popup — Wallet Details

**Graph node click**
"When you click any wallet node on the canvas a detailed popup opens. You get the full
wallet address, an AI intelligence summary including scam likelihood scoring, bot
probability, and developer wallet probability, plus a complete list of SPL token
holdings in that wallet. This gives you instant context about what you're looking at."

**Analyze Wallet**
"The Analyze Wallet button inside the popup runs a fresh on-demand AI analysis for
that specific wallet address. It reruns the behavior classification pipeline, updates
the intelligence scoring, and shows you the most current results right in the popup.
This is useful if a wallet is new or if you want to force a refresh."

**Open in Solscan**
"Open in Solscan is a direct bridge to on-chain transparency. It takes the wallet
address from context and opens that account page on Solscan in a new tab so you can
inspect the full transaction history, SPL token holdings, and native SOL balance
directly from the blockchain."

**Copy Address**
"Copy Address copies the wallet's Base58 address directly to your clipboard with one
click. No need to select text or worry about whitespace — it's ready to paste anywhere."

**Close**
"Close dismisses the popup and resets the wallet context. The next time you click a
node it'll load fresh context."

---

## PAGE 3 — SCAM INTELLIGENCE

_Navigate to `/dashboard/scam-wallets`_

"The Scam Intelligence dashboard is your persistent case-history view. It's where you
build a library of flagged wallets, suspicious launch patterns, and fund-flow traces.

Unlike the graph which shows relationships, Scam Intelligence shows you research —
where did this token come from, who deployed it, is there a pattern of scams or rug pulls
from this wallet. You're building an evidence chain."

---

### Investigate Token (empty)

"The Investigate Token input at the top is your primary entry point. If you try to submit
without filling in a token mint address the form gives you an inline validation message —
it won't let you run a blank investigation because there's nothing to trace."

---

### Investigate Token (with mint)

"Paste in a valid SPL token mint address and hit Investigate Token. Here's what happens
behind the scenes:

One, it traces the developer wallet by following the mint authority on-chain.
Two, it cross-references that wallet against the scam database looking for known malicious
patterns or previous rug pulls.
Three, it pulls every other token that wallet has launched — you're building a complete
picture of their launch history.
Four, it renders the full result below, showing you: the developer wallet address that
deployed it, the resolution source explaining how the wallet was identified, the count of
related tokens from that same developer, and the trace step depth — how many transaction
hops deep the analysis went."

---

### Open Wallet Graph link

"Once the investigation completes, the result card includes an Open Wallet Graph link.
Click it and you jump directly to the graph view for the identified developer wallet.
Now you can visualize their full on-chain network — see who else they've been transacting
with, what clusters they're part of, and whether they're connected to known bad actors."

---

## PAGE 4 — LAUNCH INTELLIGENCE

_Navigate to `/dashboard/foilops`_

"Launch Intelligence is the discovery and opportunity surface. It scores source wallets
by their historical performance — opportunity score, risk score, behavior classification,
entry timing, and recent launch history.

Think of this as your deal flow engine. New wallets appear as you and the community
submit launches, they get scored based on the source wallet's track record, and you
can filter for the high-opportunity, low-risk wallets that match your trading style."

---

### Apply Filters

"Apply Filters at the top of the table lets you narrow down the view. You can filter by
minimum opportunity score — only show me wallets with an 80+ track record. Maximum risk
score — I don't want anything above 30. Behavior class — show me only conservative or
scalp wallets depending on what I trade. And time window — only show launches from the
last 24 hours versus the last week.

Hit Apply Filters and the table reloads with only the wallets that match your criteria.
This is essential when your watchlist grows large and you want to focus on your specific
risk and return profile."

---

### Run Lite

"Run Lite triggers a lightweight intelligence refresh. It rescores all the wallets in the
current table view using cached on-chain data — this is fast, low API cost, and useful
for a quick sanity check during an active trading session. If you haven't entered a token
mint it shows a validation message."

---

### Run Full

"Run Full does a complete deep-dive rescore. It fetches fresh on-chain data for every wallet,
reruns the full behavior classification pipeline with current market data, and rebuilds the
cluster graph with updated relationship data. Takes longer than Lite — maybe a few seconds
depending on table size — but gives you the most current picture. Same validation applies."

---

### Detail (wallet row)

"Every row in the intelligence table has a Detail button. Clicking it opens a full-screen
modal showing the wallet's complete scorecard.

You get the opportunity and risk scores broken down into eight individual dimensions so you
can see exactly what's driving the overall score — things like historical win rate, average
trade profitability, volatility, and entry timing quality.

You see behavior tags — is this wallet classified as a scalper, a swing trader, conservative,
aggressive, or something else. You get cluster links with confidence scores showing you what
token clusters this wallet typically participates in. And you get a paginated table of their
recent launches — for each one you see the token name, the platform it launched on, the entry
and exit timing in minutes, and the date.

This is your deep research view — when you're considering adding a wallet to your signal
watchlist, you come here to validate the decision."

---

### Close modal

"The X button in the top-right of the modal closes it and returns you to the table view.
All your filters stay applied, so you can jump between detail views without losing context."

---

## OUTRO

"That's the complete tour of FoilOps — four integrated dashboards that tie together
intelligence, discovery, research, and live trading control.

Here's how they work together in a real workflow:

You start on Launch Intelligence — you find a high-opportunity wallet with a clean
risk profile. You click Detail, validate their recent trade history in the modal,
and decide they're worth monitoring. You add them to your tracked wallets.

Next, you go to Wallet Graph and load their network. You can see who they're
connected to, whether they're part of clusters, and get AI insights about their
behavior. If everything checks out, you go back to Trading Ops and add them to your
source wallet watchlist with a specific profile — maybe shadow mode to start.

Then you jump to Scam Intelligence and run an investigation on one of their recent
launches — you want to make sure they're not connected to any known malicious actors.
The investigation comes back clean, so you bump them up from shadow to live execution.

You hit the Cautious Live preset to start with conservative position sizing, monitor
their performance on the Trading Ops Profiles tab to see their attribution score, and
after a few winning trades you upgrade to Aggressive Live.

Every piece of context flows through the system — from discovery to research to
execution to monitoring. And every action is a single click with instant feedback.

The mutation buttons all go through the Rust receiver's control API for clean separation
between the web interface and the execution layer. The intelligence surfaces hit the
analysis pipeline for scoring and relationship analysis. Everything is built for speed
and decision confidence.

If you have questions or want a deeper dive into any specific section or workflow,
I'm happy to show you more."

---

_End of script — Estimated runtime: 7 minutes — Total controls covered: 40+_
