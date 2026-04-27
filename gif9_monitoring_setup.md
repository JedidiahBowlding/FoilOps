# Gif9 Monitoring Setup - FoilOps Configuration

**Date Setup:** 2026-04-27T19:45:00Z  
**Target Wallet:** `Gif9xQeWnLRsYAFYfrVDP2GSUyPafULEnArxgUNKG8Ce`  
**Trigger Event:** LP withdrawal of 653.4M EUX (sig 5SZpjQn2...)  
**Monitoring Period:** 24-72 hours (expect next move within this window)

---

## FoilOps Configuration Applied

### 1. Source Wallet Monitoring (Active)

- **Status:** ✅ ENABLED
- **Wallet:** `Gif9xQeWnLRsYAFYfrVDP2GSUyPafULEnArxgUNKG8Ce`
- **Action:** `add`
- **Scope:** Tracks all outgoing transfers, swaps, and fund movements
- **Purpose:** Capture first-hop recipients and route analysis
- **Updated Via:** Trading Ops → Source Wallet Controls

### 2. Tracked Wallets List (Active)

- **Status:** ✅ ENABLED
- **Wallet:** `Gif9xQeWnLRsYAFYfrVDP2GSUyPafULEnArxgUNKG8Ce`
- **Label:** `EUX-LP-SINK-MONITOR`
- **Scope:** General watchlist with alerting and profile drift detection
- **Purpose:** Broad alert coverage for any suspicious activity
- **Updated Via:** Trading Ops → Tracked Wallets

---

## Expected Monitoring Events

### High-Priority Alerts (Immediate Investigation)

| Event Type              | Trigger                                       | Expected Timeframe | Action                                                  |
| :---------------------- | :-------------------------------------------- | :----------------- | :------------------------------------------------------ |
| **Large EUX Transfer**  | >100K units sent from Gif9                    | 6-36hr             | Alert → Graph retrace → Trace downstream recipient      |
| **DEX Swap Signature**  | Raydium/Orca instruction with EUX-SOL         | 12-36hr            | Capture swap price/slippage → estimate exit price point |
| **CEX Deposit Pattern** | Transfer to known exchange cold wallet + memo | 18-48hr            | Identify exchange → user KYC linkage attempt            |
| **Bridge Activity**     | Wormhole/Portal EUX bridge tx                 | 18-48hr            | Alert upstream; track wrapped tokens on receiving chain |
| **Circular Routing**    | Gif9 → intermediate → Gif9                    | Any time           | Obfuscation indicator; fan-out to H2hnTfe likely        |
| **Batch Distribution**  | Multiple recipients in quick succession       | 24-48hr            | Potential mixer-routing or fan-out phase                |

---

## Real-Time Monitoring Checklist

### Pre-Movement Indicators (Monitor Now)

- [ ] Gif9 balance queries spike (RPC activity)
- [ ] Gif9 prepares intermediate token accounts (ATA creation)
- [ ] Small test transfers (5K-10K EUX) to new wallets ← **Already detected 2 tests**
- [ ] SOL balance increase (likely funding swap gas)

### Movement Phase (12-48hr Window)

- [ ] Large single DEX swap (650M EUX → SOL) ← **MOST LIKELY NEXT MOVE**
- [ ] Staggered swaps (break 650M into 3-5 x 100-150M segments)
- [ ] Bridge wrap/unwrap signatures
- [ ] CEX-pattern memo fields in transfers

### Post-Exit Phase (48-72hr)

- [ ] Gif9 balance collapse (most tokens transferred out)
- [ ] Terminal sink wallets go dormant
- [ ] H2hnTfe or secondary sinks show EUX inflow
- [ ] No further Gif9 activity (clean exit achieved)

---

## Alert Configuration Recommendations

### Dashboard Auto-Refreshes

- Set Trading Ops dashboard to **refresh every 60 seconds** during monitoring window
- Check "Execution Journal" tab for any signal detections
- Monitor "Alert Pressure" metric for drift warnings

### Specific Watch Parameters

**Scam Intel Dashboard:**

- Flag Gif9 with **CRITICAL risk** tag if not already done
- Note LP-removal precedent in wallet history
- Link to token investigation for EUX and related mints

**Graph Dashboard:**

- Run Deep Retrace on Gif9 every 4-6 hours
- Watch for any outgoing edges (currently 0)
- If edges appear, immediately trace second-hops to identify final destination

**Trading Ops Attribution:**

- Once Gif9 shows activity, check "Wallet Attribution" section
- If any copy-trade signals trigger from Gif9's moves, inspect before execution

---

## Escalation Protocol

### If Large Outflow Detected

1. **Immediate (0-5min):**

   - Take screenshot of FoilOps graph
   - Note signature, recipient, amount
   - Check Solscan for tx details

2. **Short-term (5-30min):**

   - Run Graph retrace on recipient wallet(s)
   - Identify if recipient is known sink/exchange/mixer
   - Prepare summary for escalation

3. **Medium-term (30-2hr):**
   - Map full branch tree if outflow is distributed
   - Correlate with H2hnTfe activity
   - Document obfuscation techniques used

### If Bridge/CEX Deposit Detected

1. **Chain correlation:**

   - Identify destination chain and wrapped token
   - Check liquidity/exit paths on receiving chain
   - Flag for cross-chain monitoring

2. **KYC linkage:**
   - If memo field present, attempt exchange memo → user correlation
   - Check public exchange addresses for known patterns
   - Report to exchange security team if applicable

---

## Fallback Monitoring (if RPC limited)

If FoilOps platform monitoring is rate-limited or unavailable:

1. **Switch to direct Solscan API:**

   - Query Gif9 token account balance changes
   - Monitor signature stream for recent activity
   - Use Helius webhook for real-time updates

2. **Manual blockchain inspection:**

   - Run custom Node.js script (see `/trace_*.js` templates)
   - Poll RPC every 30-60 seconds for Gif9 signatures
   - Maintain local ledger of all tx seen

3. **Alert Integration:**
   - Set up Telegram bot alert on pre-defined events
   - Use SMS fallback for CRITICAL alerts
   - Maintain email summary for audit trail

---

## Success Metrics

**Monitoring is successful if:**

- ✅ All outgoing Gif9 transfers are logged
- ✅ Recipients are identified within 5 min of first move
- ✅ Downstream 2-hop+ routing is traced to terminal sink
- ✅ Total EUX balance is accounted for (no missing units)
- ✅ Exit route (DEX/CEX/Bridge) is identified
- ✅ Timeline matches operational rug-exit pattern (18-48hr)

**Failure modes to watch:**

- ❌ Gif9 address changes/multisig rotation (unlikely but possible)
- ❌ Wrapped tokens/re-minting (bridge route)
- ❌ Atomic swaps or OTC off-chain deals (no on-chain trace)
- ❌ Stolen private key / wallet compromise (lost control)

---

## Status Tracker

| Phase                | Status | Timestamp            | Notes                            |
| :------------------- | :----- | :------------------- | :------------------------------- |
| Setup Complete       | ✅     | 2026-04-27T19:45:00Z | Gif9 added to FoilOps monitoring |
| Source Wallet Added  | ✅     | 2026-04-27T19:45:15Z | Ready for outgoing trace         |
| Tracked Wallet Added | ✅     | 2026-04-27T19:45:30Z | Ready for alerting               |
| First Alert Event    | ⏳     | TBD                  | Awaiting Gif9 movement           |
| Downstream Trace     | ⏳     | TBD                  | Will execute on alert trigger    |
| Final Route ID       | ⏳     | TBD                  | Terminal sink identification     |
| Report Closure       | ⏳     | TBD                  | Case closed once exit confirmed  |

---

## Quick Reference: Key Wallets in Rug Chain

| Wallet      | Role            | Status       | Notes                                        |
| :---------- | :-------------- | :----------- | :------------------------------------------- |
| E7iMadA9... | Developer       | 🔴 Flagged   | LP operator; SOL distribution hub            |
| Gif9xQe...  | LP Sink         | 🟡 Monitored | Currently holding 653M EUX; **WATCHING NOW** |
| 5V5uWyg...  | SOL Route (68%) | 🔴 Flagged   | Routes to H2hnTfe sink cluster               |
| H2hnTfe...  | Obfuscator      | 🔴 Flagged   | Active mixer; final primary sink             |
| 3Z9vJXp...  | Micro-recipient | 🟡 Flagged   | Received 5K EUX test transfer                |
| 8X1hYTb...  | Micro-recipient | 🟡 Flagged   | Received 1.2K EUX test transfer              |

---

**Configuration Status:** LIVE  
**Last Updated:** 2026-04-27T19:45:30Z  
**Next Review:** 2026-04-28T00:00:00Z (or on alert trigger)
