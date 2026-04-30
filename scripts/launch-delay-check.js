#!/usr/bin/env node
/**
 * launch-delay-check.js
 *
 * Compares three timestamps for any token mint:
 *   1. Mint creation time (first on-chain signature for the mint address)
 *   2. Source-wallet first buy time (first tx of the source wallet involving that mint)
 *   3. Bot-wallet first buy time (first tx of the bot wallet involving that mint)
 *
 * Usage:
 *   node scripts/launch-delay-check.js <tokenMint> [sourceWallet] [botWallet]
 *
 * Environment:
 *   QUICKNODE_RPC_URL or RPC_ENDPOINT — Solana RPC HTTP endpoint (required)
 *   BOT_WALLET — fallback bot wallet if not provided as arg
 *
 * Options (set as env vars or edit defaults below):
 *   LAUNCH_CHECK_LIMIT=200   Max signatures per wallet scan (default 200)
 */

'use strict'

const RPC = process.env.QUICKNODE_RPC_URL
  || process.env.RPC_ENDPOINT
  || 'https://api.mainnet-beta.solana.com'

const DEFAULT_BOT_WALLET = process.env.BOT_WALLET
  || process.env.FOILOPS_WALLET_ADDRESS
  || ''

const SCAN_LIMIT = Number(process.env.LAUNCH_CHECK_LIMIT) || 200

const [, , tokenMint, sourceWalletArg, botWalletArg] = process.argv
const sourceWallet = (sourceWalletArg || '').trim() || null
const botWallet = (botWalletArg || '').trim() || DEFAULT_BOT_WALLET || null

if (!tokenMint) {
  console.error('Usage: node scripts/launch-delay-check.js <tokenMint> [sourceWallet] [botWallet]')
  process.exit(1)
}

async function rpc(method, params) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}: ${await res.text()}`)
  const data = await res.json()
  if (data.error) throw new Error(`RPC error [${method}]: ${JSON.stringify(data.error)}`)
  return data.result
}

/** Get signatures for an address, newest first, paginated, up to maxCount. */
async function getSignatures(address, maxCount) {
  const sigs = []
  let before = undefined
  while (sigs.length < maxCount) {
    const batch = await rpc('getSignaturesForAddress', [
      address,
      { limit: Math.min(1000, maxCount - sigs.length), ...(before ? { before } : {}) },
    ])
    if (!batch || batch.length === 0) break
    sigs.push(...batch)
    before = batch[batch.length - 1].signature
    if (batch.length < 1000) break
  }
  return sigs
}

/** Get the earliest (oldest) signature and timestamp for an address. */
async function getEarliestSig(address, maxSigs = 5000) {
  const all = []
  let before = undefined
  while (all.length < maxSigs) {
    const batch = await rpc('getSignaturesForAddress', [
      address,
      { limit: 1000, ...(before ? { before } : {}) },
    ])
    if (!batch || batch.length === 0) break
    all.push(...batch)
    before = batch[batch.length - 1].signature
    if (batch.length < 1000) break
  }
  if (all.length === 0) return null
  const oldest = all[all.length - 1]
  return {
    signature: oldest.signature,
    blockTime: oldest.blockTime,
    timestamp: oldest.blockTime ? new Date(oldest.blockTime * 1000).toISOString() : null,
    totalFound: all.length,
  }
}

/** Scan wallet signatures to find the first tx mentioning the mint. */
async function findFirstMintTxForWallet(walletAddress, mint, scanLimit) {
  const sigs = await getSignatures(walletAddress, scanLimit)
  if (sigs.length === 0) return null

  // Walk oldest-first to find earliest involvement
  const sorted = [...sigs].reverse()

  for (const sig of sorted) {
    let tx
    try {
      tx = await rpc('getTransaction', [sig.signature, {
        encoding: 'jsonParsed',
        maxSupportedTransactionVersion: 0,
      }])
    } catch {
      continue
    }
    if (!tx) continue

    const meta = tx.meta || {}
    const allBalances = [
      ...(meta.preTokenBalances || []),
      ...(meta.postTokenBalances || []),
    ]
    if (allBalances.some(b => b.mint === mint)) {
      return {
        signature: sig.signature,
        blockTime: sig.blockTime,
        timestamp: sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : null,
      }
    }

    // Also check inner instructions for the mint string
    const txJson = JSON.stringify(tx.transaction || {})
    if (txJson.includes(mint)) {
      return {
        signature: sig.signature,
        blockTime: sig.blockTime,
        timestamp: sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : null,
      }
    }
  }
  return null
}

function formatDelay(seconds) {
  if (seconds === null || seconds === undefined) return 'N/A'
  const abs = Math.abs(seconds)
  const mins = Math.floor(abs / 60)
  const secs = abs % 60
  const prefix = seconds < 0 ? '-' : '+'
  return `${prefix}${mins}m ${secs}s`
}

;(async () => {
  console.log('═══════════════════════════════════════════════════')
  console.log('  Launch Delay Diagnostics')
  console.log('═══════════════════════════════════════════════════')
  console.log(`  Mint        : ${tokenMint}`)
  console.log(`  Source      : ${sourceWallet || '(not provided)'}`)
  console.log(`  Bot wallet  : ${botWallet || '(not provided)'}`)
  console.log(`  RPC         : ${RPC.replace(/https?:\/\//, '').substring(0, 50)}...`)
  console.log(`  Scan limit  : ${SCAN_LIMIT} sigs per wallet`)
  console.log('───────────────────────────────────────────────────')

  // 1. Mint creation time
  process.stdout.write('[1/3] Finding mint creation time ... ')
  let mintCreation = null
  try {
    mintCreation = await getEarliestSig(tokenMint)
    console.log(mintCreation ? mintCreation.timestamp : 'not found')
  } catch (e) {
    console.log(`ERROR: ${e.message}`)
  }

  // 2. Source wallet first buy
  let sourceBuy = null
  if (sourceWallet) {
    process.stdout.write('[2/3] Finding source-wallet first buy ... ')
    try {
      sourceBuy = await findFirstMintTxForWallet(sourceWallet, tokenMint, SCAN_LIMIT)
      console.log(sourceBuy ? sourceBuy.timestamp : 'not found in scan window')
    } catch (e) {
      console.log(`ERROR: ${e.message}`)
    }
  } else {
    console.log('[2/3] Source wallet — skipped (not provided)')
  }

  // 3. Bot wallet first buy
  let botBuy = null
  if (botWallet) {
    process.stdout.write('[3/3] Finding bot-wallet first buy ... ')
    try {
      botBuy = await findFirstMintTxForWallet(botWallet, tokenMint, SCAN_LIMIT)
      console.log(botBuy ? botBuy.timestamp : 'not found in scan window')
    } catch (e) {
      console.log(`ERROR: ${e.message}`)
    }
  } else {
    console.log('[3/3] Bot wallet — skipped (not provided)')
  }

  console.log('═══════════════════════════════════════════════════')
  console.log('  RESULTS')
  console.log('───────────────────────────────────────────────────')

  const rows = [
    { label: 'Mint created',        data: mintCreation },
    { label: 'Source wallet bought', data: sourceBuy },
    { label: 'Bot wallet bought',    data: botBuy },
  ]

  rows.forEach(({ label, data }) => {
    const ts = data?.timestamp || 'N/A'
    const sig = data?.signature ? data.signature.slice(0, 20) + '...' : 'N/A'
    console.log(`  ${label.padEnd(22)}: ${ts}  (${sig})`)
  })

  console.log('───────────────────────────────────────────────────')
  console.log('  DELAYS')
  console.log('───────────────────────────────────────────────────')

  const mintT = mintCreation?.blockTime ?? null
  const sourceT = sourceBuy?.blockTime ?? null
  const botT = botBuy?.blockTime ?? null

  if (mintT && sourceT) {
    const delay = sourceT - mintT
    console.log(`  Source vs launch : ${formatDelay(delay)}  (${delay}s)`)
  } else {
    console.log('  Source vs launch : N/A')
  }

  if (mintT && botT) {
    const delay = botT - mintT
    console.log(`  Bot vs launch    : ${formatDelay(delay)}  (${delay}s)`)
  } else {
    console.log('  Bot vs launch    : N/A')
  }

  if (sourceT && botT) {
    const delay = botT - sourceT
    console.log(`  Bot vs source    : ${formatDelay(delay)}  (${delay}s)`)
    if (delay > 0) {
      console.log(`  ⚠  Bot bought ${formatDelay(delay)} AFTER source wallet`)
    } else if (delay === 0) {
      console.log('  ✓  Bot bought at same time as source wallet')
    } else {
      console.log(`  ✓  Bot bought ${formatDelay(-delay)} BEFORE source wallet`)
    }
  } else {
    console.log('  Bot vs source    : N/A')
  }

  console.log('═══════════════════════════════════════════════════')
})()
