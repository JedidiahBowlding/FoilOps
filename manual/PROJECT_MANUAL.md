# FoilOps Project Manual

Navigation: [Home](README.html) | [Project Manual](PROJECT_MANUAL.html) | [Security and Operations Audit](SECURITY_AND_OPERATIONS_AUDIT.html)

## 1. What This Project Is

FoilOps is a Solana wallet intelligence platform that combines:

- A TypeScript/Node.js Telegram bot and HTTP app for wallet tracking, scam intelligence, user subscription flows, and signal emission.
- A Rust trading engine service that receives signed signals and can execute buy/sell logic on Solana.
- PostgreSQL with Prisma as the persistence layer.

Primary repository entry points:

- TypeScript app: `src/main.ts`
- Rust bot entry: `Auto-solana-trading-bot/src/main.rs`
- Rust signal API: `Auto-solana-trading-bot/src/services/signal_receiver.rs`
- Prisma schema: `prisma/schema.prisma`

## 2. High-Level Architecture

## 2.1 Components

1. TypeScript Runtime (FoilOps app)

- Runs Express server and Telegram bot handlers.
- Monitors wallets through Solana RPC log subscriptions.
- Parses DeFi activity and sends user/admin notifications.
- Runs scam-intelligence pipelines (flagging, tracing, token investigation).
- Emits normalized trade signals to Rust service.

1. Rust Runtime (Auto Solana Trading Bot)

- Runs a signal receiver HTTP server (default `127.0.0.1:8787`).
- Validates request signature/timestamp/dedupe policies.
- Applies trade state gates and risk gates.
- Executes DEX trade logic (buy/sell) through Pump/Raydium engine paths.

1. Database Layer (PostgreSQL + Prisma)

- Stores users, subscriptions, promotions, groups, wallets, and scam event history.

1. Runtime Orchestration

- Combined local startup script: `start-both.sh`
- PM2 can be used for daemonized deployment of the two services.

## 2.2 Core Data Flow

1. Wallet activity is observed by FoilOps watcher.
2. Parsed transaction details are sent to users/admin logic.
3. Intelligence decisions produce a signal payload.
4. Signal payload is signed (HMAC) and posted to Rust `/signals`.
5. Rust validates and either:

- dry-run accepts (no execution), or
- live-mode executes through strategy paths.

## 3. TypeScript Service Capabilities

## 3.1 Runtime Boot and Routes

`src/main.ts`:

- Starts HTTP server on `PORT` (default fallback in code).
- Registers Telegram webhook endpoint:
  - `POST /webhook/telegram`
- Registers health/default endpoint:
  - `GET /`
- Registers scam-intelligence endpoints:
  - `GET /dashboard/scam-wallets`
  - `GET /api/scam-wallets`
  - `GET /api/token-investigation/:tokenMint`

## 3.2 Telegram Commands (User/Admin)

Command handlers are in `src/bot/commands`.

Common user commands include:

- `/start`
- `/add`
- `/delete`
- `/manage`
- `/upgrade`
- `/help_group`
- `/help_notify`
- `/groups` and related activation flow

Trading/admin related commands include:

- `/ban_wallet`
- `/scam_wallet` command family
- `/trading_status`
- `/trading_balance`
- `/trading_trades`
- `/trading_enable`
- `/trading_disable`
- `/trading_pause`
- `/trading_resume`

Note:

- Admin authorization is mediated by bot middleware checks.
- Trading commands in TS call Rust HTTP endpoints, not an internal Rust Telegram loop.

## 3.3 Wallet Tracking and Parsing

Core flow files:

- `src/lib/track-wallets.ts`
- `src/lib/watch-transactions.ts`
- `src/parsers/transaction-parser.ts`

Capabilities:

- Subscribes to per-wallet onLogs streams.
- Detects and parses Raydium/Jupiter/Pumpfun/Pump AMM behavior.
- Extracts token transfer details, direction, and descriptive summaries.
- Sends messages to tracked users with rate limiting controls.

## 3.4 Scam Intelligence Layer

Core files:

- `src/lib/scam-wallet-monitor.ts`
- `src/lib/scam-dashboard.ts`
- `src/lib/fund-flow-tracer.ts`
- `src/lib/token-investigator.ts`
- `src/lib/scam-risk.ts`
- `src/repositories/prisma/scam-wallet.ts`

Capabilities:

- Track curated and manually flagged wallets.
- Compute risk scores and risk-level classifications.
- Persist suspicious event history per wallet.
- Trace downstream fund flows over multiple hops.
- Map wallet hops to known platform categories.
- Investigate token mint to likely developer wallet.
- Render dashboard and expose JSON for dashboard data.

## 3.5 Trade Signal Emission

Core files:

- `src/lib/trade-signal-emitter.ts`
- `src/types/trade-signal.ts`

Signal features:

- Creates schema `1.0` signal payloads.
- Adds risk score and risk level metadata.
- Performs idempotency suppression in TS before sending.
- HMAC-signs payload with timestamp header when configured.
- Emits signals to Rust `/signals`.

Signal types currently supported in TS type system:

- `TOKEN_INVESTIGATION`
- `SUSPICIOUS_TOKEN_LAUNCH`
- `COPY_TRADE`

Action hints currently supported in TS type system:

- `WATCH_ONLY`
- `BUY`
- `SELL`

New integration call site now present:

- `src/lib/watch-transactions.ts` emits `COPY_TRADE` automatically on detected tracked-wallet swaps via `emitCopyTradeSignal(...)`.

## 4. Rust Service Capabilities

## 4.1 Rust Main Runtime

`Auto-solana-trading-bot/src/main.rs`:

- Loads env configuration.
- Creates execution engine.
- Spawns signal receiver server.
- Runs additional websocket monitoring logic.

## 4.2 Signal Receiver API

`Auto-solana-trading-bot/src/services/signal_receiver.rs` exposes:

- `GET /health`
- `POST /signals`
- `GET /trading/status`
- `GET /trading/balance`
- `GET /trading/trades`
- `GET /trading/stats`
- `GET /trading/config`
- `POST /trading/enable`
- `POST /trading/disable`
- `POST /trading/pause`
- `POST /trading/resume`
- `GET|POST /trading/slippage`
- `GET|POST /trading/target`
- `GET|POST /trading/mev`

Receiver controls include:

- HMAC signature verification (`SIGNAL_REQUIRE_AUTH`, `SIGNAL_AUTH_SECRET`)
- timestamp skew validation
- idempotency key duplicate suppression
- dry-run vs live mode toggle

## 4.3 Execution Engine and Risk Gates

`Auto-solana-trading-bot/src/services/signal_execution.rs`:

- Maintains runtime trading state (`enabled`, `paused`, slippage, target wallet, stats).
- Applies risk gates before execution.
- Supports action mapping from incoming signal types.
- Supports configurable max risk gate via env-backed `max_risk_score`.

Current mappings include:

- `TOKEN_INVESTIGATION` -> buy flow
- `SUSPICIOUS_TOKEN_LAUNCH` -> sell flow
- `COPY_TRADE` -> buy/sell execution based on metadata/action hint

Copy trade direction resolution currently checks:

- `metadata.direction`
- `metadata.action`
- `metadata.side`
- fallback to `action_hint`

Normalization currently supports:

- buy aliases: `buy`, `long`
- sell aliases: `sell`, `short`

## 4.4 DEX Execution Paths

`Auto-solana-trading-bot/src/engine/swap.rs`:

- `pump_swap(...)`
- `raydium_swap(...)`

`signal_execution.rs` determines DEX path and routes buy/sell through these methods.

## 5. Data Model (Prisma)

`prisma/schema.prisma` entities and enums include:

Enums:

- `SubscriptionPlan`: `FREE`, `HOBBY`, `PRO`, `WHALE`
- `WalletStatus`: `ACTIVE`, `USER_PAUSED`, `SPAM_PAUSED`, `BANNED`
- `HandiCatStatus`: `ACTIVE`, `PAUSED`
- `PromotionType`: `UPGRADE_TO_50_WALLETS`
- `ScamSource`: `CURATED_DB`, `MANUAL`, `DETECTED`
- `ScamEventType`: `SUSPICIOUS_TOKEN_LAUNCH`, `MANUAL_FLAG`, `MANUAL_UNFLAG`, `FLOW_TRACE`, `PLATFORM_INTERACTION`, `FLOW_TO_NEW_LAUNCH`, `TOKEN_INVESTIGATION`

Models:

- `User`
- `Wallet`
- `UserWallet`
- `UserSubscription`
- `Promotion`
- `UserPromotion`
- `Group`
- `ScamWallet`
- `ScamWalletEvent`

Practical capability outcome:

- User plan management
- Tracked wallet relations
- Scam wallet state and history
- Promotion purchases
- Group linkage

## 6. Environment Variables

## 6.1 TypeScript/FoilOps side (root `.env`)

Core:

- `BOT_TOKEN`
- `ADMIN_CHAT_ID`
- `DATABASE_URL`
- `RPC_ENDPOINTS`
- `HELIUS_API_KEY`
- `PORT`
- `ENVIRONMENT`
- `APP_URL`

Signal emitter:

- `TRADE_SIGNAL_ENDPOINT`
- `TRADE_SIGNAL_TIMEOUT_MS`
- `TRADE_SIGNAL_REQUIRE_AUTH`
- `TRADE_SIGNAL_AUTH_SECRET`
- `COPY_TRADE_RISK_SCORE`

Receiver controls if running in same env context:

- `SIGNAL_RECEIVER_BIND`
- `SIGNAL_RECEIVER_DRY_RUN`
- `SIGNAL_REQUIRE_AUTH`
- `SIGNAL_AUTH_SECRET`
- `SIGNAL_MAX_RISK_SCORE`
- `SIGNAL_DEDUP_WINDOW_SECONDS`
- `SIGNAL_MAX_TIMESTAMP_SKEW_SECONDS`

Backup/security toggles:

- `ALLOW_PRIVATE_KEY_EXPORT`
- `INCLUDE_PRIVATE_KEYS_IN_BACKUP`
- `ENCRYPT_BACKUP`
- `BACKUP_ENCRYPTION_KEY`
- `BACKUP_FILE`

## 6.2 Rust side (`Auto-solana-trading-bot/.env`)

Core:

- `SOL_PUBKEY`
- `RPC_ENDPOINT`
- `RPC_WEBSOCKET_ENDPOINT`
- `TARGET_PUBKEY`
- `JUP_PUBKEY`

Optional integrations:

- `NOZOMI_URL`
- `NOZOMI_TIP_VALUE`
- `ZERO_SLOT_URL`
- `ZERO_SLOT_TIP_VALUE`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Signal receiver controls:

- `SIGNAL_RECEIVER_BIND`
- `SIGNAL_RECEIVER_DRY_RUN`
- `SIGNAL_REQUIRE_AUTH`
- `SIGNAL_AUTH_SECRET`
- `SIGNAL_MAX_RISK_SCORE`
- `SIGNAL_DEDUP_WINDOW_SECONDS`
- `SIGNAL_MAX_TIMESTAMP_SKEW_SECONDS`

## 7. Scripts and Operational Commands

From `package.json`:

Runtime:

- `pnpm start`
- `pnpm start-both`
- `pnpm start-both:health`

Database:

- `pnpm db:setup`
- `pnpm db:migrate`
- `pnpm db:push`
- `pnpm db:generate`
- `pnpm db:studio`

Backup/restore:

- `pnpm db:backup`
- `pnpm db:backup:enc`
- `pnpm db:seed`
- `pnpm db:seed:enc`

Signals:

- `pnpm signals:self-test`
- `pnpm signals:ci:test`

Maintenance:

- `pnpm wallets:cleanup`
- `pnpm send:alert`

Formatting:

- `pnpm format`
- `pnpm format:check`
- `pnpm format:write`

## 8. Deployment Modes

## 8.1 Local Combined Start

`start-both.sh`:

- resolves app port from env
- frees ports (`8787` and app port)
- starts Rust bot (`cargo run --bin trading-bot`)
- starts TS bot (`pnpm start`)
- traps `SIGINT/SIGTERM` and cleans child processes

## 8.2 PM2 Deployment Pattern

Operationally, common pattern is two separate PM2 apps:

- one for FoilOps TypeScript service
- one for Rust trading bot

Recommended:

- avoid running local and server polling instances for the same Telegram bot token simultaneously
- save PM2 process list after clean restart

## 9. Signal Contract and Security

## 9.1 TradeSignalV1 Shape (Camel Case)

Important fields:

- `schemaVersion`
- `signalId`
- `emittedAt`
- `sourceSystem`
- `signalType`
- `dryRun`
- `riskScore`
- `riskLevel`
- `trackedWallet`
- `developerWallet`
- `tokenMint`
- `traceAlerts`
- `actionHint`
- `metadata`

## 9.2 Authentication

When auth is required:

- include timestamp header
- include HMAC SHA256 signature over `timestamp.payload`
- receiver verifies signature and freshness

## 9.3 Dedupe

- TS emitter tracks recent idempotency keys locally.
- Rust receiver rejects duplicate keys/signals within configured dedupe window.

## 10. Feature-by-Feature Capability Matrix

1. Real-time wallet tracking: Yes
2. DeFi swap parsing: Yes
3. SOL transfer parsing: Yes
4. Telegram user notifications: Yes
5. Scam wallet curation + monitoring: Yes
6. Token investigation to developer wallet: Yes
7. Fund flow tracing with platform labels: Yes
8. HTML + JSON dashboard for scam intelligence: Yes
9. Signed signal relay TS -> Rust: Yes
10. Dry-run signal processing: Yes
11. Live execution mode: Yes (controlled by dry-run/live toggles and trading enable state)
12. Trading control via Telegram admin commands: Yes (through TS -> Rust API)
13. Copy trade via signal path: Yes (native `COPY_TRADE` in TS + Rust handler execution)
14. Auto-emit copy trade signal from detected wallet swaps: Yes
15. Backup/restore support: Yes (encrypted and plaintext modes)

## 11. Troubleshooting Reference

1. Telegram 409 conflict errors

- Cause: multiple polling instances using same bot token.
- Fix: run only one active polling instance per token.

1. Empty reply from Rust trading endpoints

- Cause historically seen when async handlers used blocking state lock patterns.
- Fix now in repo: async-safe accessors and async lock usage in HTTP handlers.

1. `invalid_signature` from `/signals`

- Usually mismatched auth secret or bad signed payload/timestamp composition.
- Confirm `TRADE_SIGNAL_AUTH_SECRET` and `SIGNAL_AUTH_SECRET` match.

1. `TRADING_DISABLED` response

- Service accepted signal but trading enable flag is off.
- Call `/trading/enable` after validating live safety.

1. `mode: live` unexpectedly

- Check `SIGNAL_RECEIVER_DRY_RUN` in runtime env used by Rust process.

## 12. Safe Rollout Checklist

Before live trading:

1. Ensure fresh, uncompromised private keys and bot tokens.
2. Keep receiver in dry-run while validating signal acceptance paths.
3. Verify signed signal flow and dedupe behavior with self-tests.
4. Confirm risk gates (`SIGNAL_MAX_RISK_SCORE`, slippage, position size strategy).
5. Confirm `/trading/status` reflects intended enabled/paused/mode settings.
6. Move to live only after monitoring dry-run logs and expected decision traces.

## 13. Known Limitations and Notes

1. Some upstream docs may lag behind code changes.
2. Copy-trade execution relies on available token context and existing buy/sell pathways.
3. Any command exposing private key material should be considered high risk in production.
4. Secrets should be treated as compromised once exposed in chat/logs and rotated promptly.

## 14. Recommended Next Documentation Extensions

1. Add sequence diagrams for TS watcher -> signal -> Rust execution path.
2. Add complete per-command Telegram UX examples (request + response samples).
3. Add production SLOs and alert thresholds (latency, rejection rate, error budgets).
4. Add disaster recovery drill procedures with backup restore validation records.

## 15. Appendix A: Telegram Command Examples

This appendix lists each currently registered slash command in the codebase and shows:

1. Example input from a user/admin.
2. Expected bot response pattern.

Notes:

1. Many responses include HTML formatting and inline keyboards.
2. Some commands are multi-step and require a follow-up user message.
3. Admin-only commands return access denied for non-admin users.

## 15.1 User Commands

1. `/start`

- Example input: `/start`
- Expected response: welcome/start menu message; in group chats, group-specific start guidance.

1. `/add`

- Example input: `/add`
- Expected response (step 1): prompt asking for wallet address input.
- Example follow-up input: `4kAfac1KbyoT5SZhMDRUeGRfJs3Gb1gqZrGneQwxF5pd main_wallet`
- Expected response (step 2):
  - success: `Wallet ... has been added.`
  - duplicate: `You already follow the wallet ...`
  - invalid wallet: `Address provided is not a valid Solana wallet`
  - plan limit reached: wallet limit/upgrade prompt.

1. `/delete`

- Example input: `/delete`
- Expected response (step 1): prompt asking for wallet address(es) to delete.
- Example follow-up input: `4kAfac1KbyoT5SZhMDRUeGRfJs3Gb1gqZrGneQwxF5pd`
- Expected response (step 2):
  - success: confirms number of wallet(s) deleted.
  - not tracked: `You're not tracking the wallet: ...`
  - invalid wallet: `Address ... is not a valid Solana wallet`.

1. `/manage`

- Example input: `/manage`
- Expected response: wallet management summary (tracked wallets + plan wallet limit) and manage submenu.

1. `/upgrade`

- Example input: `/upgrade`
- Expected response: upgrade/subscription message with upgrade plan submenu.

1. `/help_group`

- Example input: `/help_group`
- Expected response: groups help/instructions message.

1. `/help_notify`

- Example input: `/help_notify`
- Expected response: notifications help/instructions message.

1. `/activate` (group command)

- Example input (inside group): `/activate`
- Expected response:
  - success: `Group ... has been activated!`
  - already active: `This group has been already activated`
  - user not pro: pro-plan-required message
  - user not initialized with `/start`: group not started message.

## 15.2 Admin and Scam-Intelligence Commands

1. `/ban_wallet`

- Example input: `/ban_wallet`
- Expected response (step 1): prompt to enter wallet public key to ban.
- Example follow-up input: `9xQeWvG816bUx9EPf8N7Kj2fM9pV8oW1sY3X4Z5a6b7c`
- Expected response (step 2):
  - success: `wallet with address ... has been banned!`
  - wallet not found: `Wallet with address ... is not in the Database!`
  - invalid wallet: `Address ... is not a valid Solana wallet`.

1. `/flag_wallet <wallet> [reason]`

- Example input: `/flag_wallet 4kAfac1KbyoT5SZhMDRUeGRfJs3Gb1gqZrGneQwxF5pd suspicious_launch_pattern`
- Expected response:
  - success summary: wallet flagged, reason, base risk score, flow hops traced
  - optional second message with trace alerts
  - invalid format response if wallet missing.

1. `/unflag_wallet <wallet> [reason]`

- Example input: `/unflag_wallet 4kAfac1KbyoT5SZhMDRUeGRfJs3Gb1gqZrGneQwxF5pd false_positive`
- Expected response:
  - success: wallet unflagged + reason
  - not found: `Wallet was not found in scam intelligence records.`
  - usage message if wallet argument omitted.

1. `/scam_feed [limit]`

- Example input: `/scam_feed 5`
- Expected response:
  - if data exists: suspicious launch alert feed entries (wallet, token, risk, tx, type, time)
  - if none: `No suspicious token launch alerts yet.`

1. `/flow_map <wallet>`

- Example input: `/flow_map 4kAfac1KbyoT5SZhMDRUeGRfJs3Gb1gqZrGneQwxF5pd`
- Expected response:
  - flow map with hop-by-hop lines if available
  - fallback when no flow exists: prompts to flag wallet first
  - usage message if wallet argument omitted.

1. `/trace_token <token_contract_address>`

- Example input: `/trace_token So11111111111111111111111111111111111111112`
- Expected response:
  - multi-message investigation report including token identity, risk/market data, developer wallet context, and trace findings
  - if unresolved: `Unable to resolve the developer wallet for that token.`
  - invalid key: `Invalid token contract address.`
  - usage message if argument omitted.

## 15.3 Trading Commands (Admin Only)

1. `/trading_status`

- Example input: `/trading_status`
- Expected response: formatted trading bot status block (enabled, paused, mode, target wallet, MEV service, slippage).

1. `/trading_balance`

- Example input: `/trading_balance`
- Expected response: wallet balance block (SOL, USDC, token count, total USD value).

1. `/trading_trades`

- Example input: `/trading_trades`
- Expected response:
  - recent trade list if available
  - or `No recent trades found`.

1. `/trading_enable`

- Example input: `/trading_enable`
- Expected response: `Trading bot enabled` on success.

1. `/trading_disable`

- Example input: `/trading_disable`
- Expected response: `Trading bot disabled` on success.

1. `/trading_pause`

- Example input: `/trading_pause`
- Expected response: `Trading paused` on success.

1. `/trading_resume`

- Example input: `/trading_resume`
- Expected response: `Trading resumed` on success.

1. `/trading_slippage [percent]`

- Example input (get): `/trading_slippage`
- Expected response: `Current slippage: X%`.
- Example input (set): `/trading_slippage 2.5`
- Expected response: `Slippage set to 2.5%`.

1. `/trading_target [wallet]`

- Example input (get): `/trading_target`
- Expected response: `Target wallet: ...` or `Not set`.
- Example input (set): `/trading_target 4kAfac1KbyoT5SZhMDRUeGRfJs3Gb1gqZrGneQwxF5pd`
- Expected response: `Target wallet set to ...`.

## 15.4 Common Error Patterns Across Commands

1. Non-admin execution on admin command:

- Expected response: `Access denied. Admin only command.`

1. Missing required arguments:

- Expected response: usage format hint for that command.

1. Upstream Rust trading API unavailable:

- Expected response: failure message such as `Failed to get trading status` or `Failed to manage ...`.

1. User sends another slash command during a multi-step prompt (`/add`, `/delete`, `/ban_wallet`):

- Expected behavior: pending listener state is reset/canceled for that prompt flow.

## 16. Appendix B: Real Transcript Style Operator Training

The transcripts below are realistic training examples showing exact command flow style, including multi-step command prompts and common failure cases.

Conventions:

1. `Operator>` means the human in Telegram.
2. `Bot>` means FoilOps response text.
3. Samples are representative; exact wording can vary by context/data.

## 16.1 Onboarding and Wallet Add Success

```text
Operator> /start
Bot> Welcome message + main menu buttons

Operator> /add
Bot> Send me the wallet address you want to track.

Operator> 4kAfac1KbyoT5SZhMDRUeGRfJs3Gb1gqZrGneQwxF5pd alpha_wallet
Bot> Wallet 4kAfac1KbyoT5SZhMDRUeGRfJs3Gb1gqZrGneQwxF5pd has been added.
```

## 16.2 Add Command Invalid Wallet Then Retry

```text
Operator> /add
Bot> Send me the wallet address you want to track.

Operator> not_a_wallet
Bot> Address provided is not a valid Solana wallet

Operator> 9xQeWvG816bUx9EPf8N7Kj2fM9pV8oW1sY3X4Z5a6b7c
Bot> Wallet 9xQeWvG816bUx9EPf8N7Kj2fM9pV8oW1sY3X4Z5a6b7c has been added.
```

## 16.3 Delete Command for Untracked Wallet

```text
Operator> /delete
Bot> Send the wallet address(es) to delete.

Operator> 11111111111111111111111111111111
Bot> You're not tracking the wallet: 11111111111111111111111111111111
```

## 16.4 Admin Ban Flow

```text
Operator> /ban_wallet
Bot> Enter the wallet Public Key you want to Ban

Operator> 4kAfac1KbyoT5SZhMDRUeGRfJs3Gb1gqZrGneQwxF5pd
Bot> wallet with address 4kAfac1KbyoT5SZhMDRUeGRfJs3Gb1gqZrGneQwxF5pd has been banned!
```

## 16.5 Scam Flag and Feed Verification

```text
Operator> /flag_wallet 4kAfac1KbyoT5SZhMDRUeGRfJs3Gb1gqZrGneQwxF5pd launch_pattern
Bot> Wallet flagged as suspicious.
Bot> Wallet: 4kAfac1KbyoT5SZhMDRUeGRfJs3Gb1gqZrGneQwxF5pd
Bot> Reason: launch_pattern
Bot> Base risk score: 50
Bot> Flow hops traced: 3

Operator> /scam_feed 3
Bot> Suspicious Launch Alert Feed
Bot> Wallet: ... Token: ... Risk: ... Tx: ... Type: ... Time: ...
```

## 16.6 Token Investigation Flow

```text
Operator> /trace_token So11111111111111111111111111111111111111112
Bot> Rug Pull Investigation Report (message 1: token identity + links)
Bot> Risk & Market Data (message 2: score, liquidity, holder concentration)
Bot> Developer Wallet Analysis (message 3: resolved dev wallet + related tokens)
Bot> Flow/Alert Summary (message 4: hops + notable flags)
```

## 16.7 Trading Status and Controls

```text
Operator> /trading_status
Bot> Trading Bot Status
Bot> Status: Disabled
Bot> Paused: No
Bot> Mode: signal_based
Bot> Target Wallet: Not set
Bot> MEV Service: jito
Bot> Slippage: 3%

Operator> /trading_enable
Bot> Trading bot enabled

Operator> /trading_pause
Bot> Trading paused

Operator> /trading_resume
Bot> Trading resumed

Operator> /trading_disable
Bot> Trading bot disabled
```

## 16.8 Trading Config Commands

```text
Operator> /trading_slippage
Bot> Current slippage: 3%

Operator> /trading_slippage 2.5
Bot> Slippage set to 2.5%

Operator> /trading_target
Bot> Target wallet: Not set

Operator> /trading_target 4kAfac1KbyoT5SZhMDRUeGRfJs3Gb1gqZrGneQwxF5pd
Bot> Target wallet set to 4kAfac1...
```

## 16.9 Access Denied Training Case

```text
Operator> /trading_status
Bot> Access denied. Admin only command.

Operator> /ban_wallet
Bot> (no action or admin-denied behavior based on middleware path)
```

## 16.10 Multi-Step Prompt Cancellation Behavior

```text
Operator> /add
Bot> Send me the wallet address you want to track.

Operator> /manage
Bot> Wallet management summary...

Training Note: entering a new slash command cancels the pending add-input flow.
```

## 16.11 Group Activation Training

```text
Operator (in group)> /activate
Bot> Group Alpha has been activated! Remember only you can update this bot settings
```

Failure variants:

1. Group user has not run `/start` previously -> group-not-started guidance.
2. User is not PRO tier -> upgrade-required guidance.
3. Group already activated -> already-activated message.

## 16.12 Operator Drill Checklist for Transcript Practice

Use these drills in order:

1. `/start` then `/add` success case.
2. `/add` invalid wallet then successful retry.
3. `/delete` for tracked and untracked wallet.
4. `/flag_wallet` then `/scam_feed`.
5. `/trace_token` and verify multi-message report.
6. `/trading_status`, `/trading_enable`, `/trading_slippage 2.5`, `/trading_disable`.
7. Non-admin denial test on `/trading_status`.

---

Previous: [Home](README.html) | Next: [Security and Operations Audit](SECURITY_AND_OPERATIONS_AUDIT.html)
