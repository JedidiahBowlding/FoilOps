# FailOps System Capabilities Guide

## 1. Purpose

FailOps is a Solana wallet intelligence and monitoring platform delivered through a Telegram bot plus HTTP dashboard/API endpoints.

It supports:

- Real-time wallet transaction monitoring.
- Scam/rug-risk detection and risk scoring.
- Fund-flow tracing across wallet hops.
- Token contract investigations to identify likely developer wallets.
- Ongoing monitoring and alerting for future suspicious activity.
- Secure backup/restore workflows with optional encryption.

---

## 2. Core System Components

### 2.1 Runtime Entrypoint

`src/main.ts` bootstraps:

- Express server routes.
- Telegram command handlers.
- Background cron jobs.
- Wallet tracking initialization.
- Scam wallet monitor initialization.

### 2.2 Telegram Bot Layer

Main command logic is in `src/bot/commands/**`.

Notable command modules:

- Wallet tracking and management commands (`/add`, `/delete`, `/manage`, etc.).
- Admin security/moderation commands.
- Scam intelligence commands (`/flag_wallet`, `/trace_token`, `/flow_map`, etc.).

### 2.3 Data Layer (Prisma + PostgreSQL)

Schema in `prisma/schema.prisma`.

Key scam-intelligence tables:

- `ScamWallet`
- `ScamWalletEvent`

Key repository APIs:

- `src/repositories/prisma/scam-wallet.ts`

### 2.4 Monitoring and Analysis Services

Main services:

- `src/lib/watch-transactions.ts` for live transaction streams.
- `src/lib/scam-wallet-monitor.ts` for flagged wallet launch monitoring.
- `src/lib/fund-flow-tracer.ts` for hop-by-hop movement tracing.
- `src/lib/token-investigator.ts` for token-to-developer investigations.

### 2.5 Dashboard and API Surface

- HTML dashboard renderer: `src/lib/scam-dashboard.ts`
- Routes exposed in `src/main.ts`:
  - `/dashboard/scam-wallets`
  - `/api/scam-wallets`
  - `/api/token-investigation/:tokenMint`

---

## 3. What the System Can Do

## 3.1 Real-Time Solana Wallet Tracking

The bot subscribes to wallet logs and parses activity across major Solana DeFi/token activity patterns.

Detected patterns include:

- Pump.fun and Pump AMM related activity.
- Raydium and Jupiter transactions.
- Relevant SOL transfers.

Parsed output can include:

- Transaction signature.
- Swap direction (buy/sell).
- Token in/out symbols and amounts.
- Market context (price and market cap when available).

## 3.2 Scam Wallet Flagging and Risk Lifecycle

You can mark wallets as suspicious manually or through detection logic.

The system stores:

- Source of flag (`CURATED_DB`, `MANUAL`, `DETECTED`).
- Reason and base risk score.
- Prior known token associations.
- Time-stamped event history.

Risk scoring is calculated and updated over time by combining:

- Base risk score.
- Prior token history count.
- Activity/event volume.
- Flag status.

## 3.3 Curated and Extensible Threat Intelligence

Built-in lists:

- Known scam wallets (`src/constants/known-scam-wallets.ts`).
- Known platform intelligence (`src/constants/trace-platforms.ts`).

Repo-managed JSON intelligence files:

- `src/constants/bridge-wallets.json`
- `src/constants/custody-wallets.json`
- `src/constants/exchange-wallets.json`
- `src/constants/mixer-wallets.json`

Each JSON entry maps address -> `{ label, category }`.

Supported categories:

- `MIXER`
- `EXCHANGE`
- `DEFI`
- `SCAM`
- `BRIDGE`
- `CUSTODY`
- `UNKNOWN`

Optional runtime override:

- `TRACE_PLATFORM_WALLETS_JSON`

## 3.4 Flow Tracing Across Wallet Hops

When a wallet is flagged or when suspicious launch behavior is detected, the tracer can:

- Traverse outgoing transactions across multiple hops.
- Build a step-by-step flow map with source, destination, amount, asset, and signature.
- Classify each step by known platform intelligence.
- Detect launch-linked patterns in traced steps.
- Store trace artifacts in scam events for later retrieval.

Trace output includes:

- `steps` list with hop index and classification.
- `alerts` list for suspicious platform interactions or launch patterns.

## 3.5 Token Contract Investigation Workflow

Given a token mint/contract address, the investigator can:

1. Resolve likely developer wallet using mint authority, freeze authority, or first signer fallback.
2. Pull related token history for that developer wallet.
3. Run flow tracing for developer wallet movement analysis.
4. Flag and persist developer risk context.
5. Enable future monitoring for suspicious launches by that developer wallet.

This is available through:

- Telegram command: `/trace_token <token_contract_address>`
- HTTP endpoint: `/api/token-investigation/:tokenMint`

## 3.6 Alerting and Feed

Alerts can be generated for:

- Suspicious token launch patterns.
- Platform interactions in flow traces.
- Flow steps linked to new launch patterns.

Feed retrieval is available via:

- Telegram command: `/scam_feed [limit]`

## 3.7 Dashboard Visibility

The scam dashboard includes:

- Flagged wallet summary cards.
- Risk score and risk level.
- Prior token links.
- Recent suspicious launches.
- Latest flow map snippets.
- Dedicated token investigation section for token-input investigations.

---

## 4. Admin Commands and Operational Usage

## 4.1 Core Security/Scam Commands

- `/flag_wallet <wallet> [reason]`

  - Flags wallet and starts/refreshes monitoring.
  - Can trigger immediate flow tracing.

- `/unflag_wallet <wallet> [reason]`

  - Removes wallet from active scam monitoring.

- `/flow_map <wallet>`

  - Returns latest stored flow trace for that wallet.

- `/scam_feed [limit]`

  - Returns latest suspicious launch and trace-derived alerts.

- `/trace_token <token_contract_address>`
  - Runs full token investigation workflow.

## 4.2 Existing Wallet Tracking Commands

The bot still supports baseline command set (`/start`, `/add`, `/delete`, `/help_*`, etc.) for non-scam operations.

---

## 5. API Endpoints

- `GET /dashboard/scam-wallets`

  - HTML dashboard for scam intelligence.

- `GET /api/scam-wallets`

  - JSON data for flagged wallets, launches, risk context, and flow snippets.

- `GET /api/token-investigation/:tokenMint`
  - Runs token investigation and returns investigation result JSON.

---

## 6. Security Controls and Hardening Implemented

## 6.1 Logging Safety

- Token-bearing logs are redacted.
- Secret-redaction helper added to avoid accidental credential leakage in logs.

## 6.2 Private Key Exposure Guard

- Private key export is disabled by default.
- Requires explicit opt-in:
  - `ALLOW_PRIVATE_KEY_EXPORT=true`

## 6.3 Backup Safety Defaults

- Private keys are excluded from backups by default.
- Attempting to include private keys without encryption is blocked.

## 6.4 Optional Encrypted Backup Mode

Supports AES-256-GCM encrypted backup payloads.

Environment flags:

- `ENCRYPT_BACKUP=true`
- `INCLUDE_PRIVATE_KEYS_IN_BACKUP=true`
- `BACKUP_ENCRYPTION_KEY=<64-char hex OR 32-byte base64>`

Output files:

- Encrypted: `database_backup.enc.json`
- Plaintext (no private keys): `database_backup.json`

Restore behavior:

- Auto-detects encrypted backup first.
- Optional override with `BACKUP_FILE`.

---

## 7. Data Model Notes (Scam Intelligence)

`ScamWallet` stores wallet-level risk context.

`ScamWalletEvent` stores event timeline and trace metadata.

Important event types include:

- `SUSPICIOUS_TOKEN_LAUNCH`
- `MANUAL_FLAG`
- `MANUAL_UNFLAG`
- `FLOW_TRACE`
- `PLATFORM_INTERACTION`
- `FLOW_TO_NEW_LAUNCH`
- `TOKEN_INVESTIGATION`

This event-first model allows:

- Full history reconstruction.
- Timeline analytics.
- Dashboard and feed aggregation.

---

## 8. Configuration Summary

## 8.1 Core Runtime

- `BOT_TOKEN`
- `TEST_BOT_TOKEN`
- `ENVIRONMENT`
- `APP_URL`
- `RPC_ENDPOINTS`
- `HELIUS_API_KEY`
- `DATABASE_URL`
- `ADMIN_CHAT_ID`

## 8.2 Security Toggles

- `ALLOW_PRIVATE_KEY_EXPORT=false`
- `INCLUDE_PRIVATE_KEYS_IN_BACKUP=false`
- `ENCRYPT_BACKUP=false`
- `BACKUP_ENCRYPTION_KEY=`
- `BACKUP_FILE=`

## 8.3 Threat Intelligence Inputs

- Repo JSON intelligence files under `src/constants/*.json`
- Optional env override: `TRACE_PLATFORM_WALLETS_JSON`

---

## 9. Practical Runbooks

## 9.1 Investigate a New Token Quickly

1. Run `/trace_token <token_mint>` in admin chat.
2. Review returned developer wallet and investigation summary.
3. Review `/flow_map <developer_wallet>` for transfer chain.
4. Monitor `/scam_feed` for follow-up suspicious launches.

## 9.2 Add New Intelligence Data

1. Add labeled addresses to the appropriate JSON file:
   - exchange, mixer, custody, or bridge.
2. Restart service if needed to reload constants.
3. Re-run investigation/flow trace for improved classification.

## 9.3 Create Secure Backup Including Private Keys

1. Set:
   - `ENCRYPT_BACKUP=true`
   - `INCLUDE_PRIVATE_KEYS_IN_BACKUP=true`
   - `BACKUP_ENCRYPTION_KEY=<valid key>`
2. Run `pnpm db:backup:enc`.
3. Store encrypted backup and key in separate secure locations.

---

## 10. Current Limitations and Notes

- Platform wallet intelligence quality depends on the accuracy/completeness of labeled JSON files.
- Some developer-wallet inference relies on on-chain heuristics and may produce uncertain attributions for complex deployments.
- Flow tracing depth and breadth are bounded by configured hop/signature limits to keep runtime practical.

---

## 11. Recommended Next Enhancements

- Add confidence scores to developer-wallet attribution.
- Add scheduled re-tracing for high-risk wallets.
- Add deduplicated alert suppression windows.
- Add richer dashboard filters by category, risk range, and timeframe.
- Add signed intelligence source metadata for auditability.
