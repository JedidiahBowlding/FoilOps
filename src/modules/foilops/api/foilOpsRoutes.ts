// ─── FoilOps Intelligence API Routes ──────────────────────────────────────────
// Exposes the launch intelligence engine over HTTP.
// All routes are secured by the dashboard auth middleware.

import type { Express, Request, RequestHandler, Response } from 'express'
import { scoreWallet, WalletScoringInput } from '../services/walletScoringService'
import { scoreToken, TokenScoringInput } from '../services/tokenRiskService'
import { analyseWalletCluster, CandidateWalletData } from '../services/clusterAnalysisService'
import { buildWalletSummaryPayload, buildTokenSummaryPayload } from '../services/summaryPayloadService'
import { ClusterAnalysisResult } from '../types/cluster'
import { LaunchParticipationRecord } from '../types/wallet'
import { SuspiciousTokenEvent } from '../types/token'
import { tracingRules } from '../config/foilOpsConfig'
import { FoilOpsRepository } from '../repository/foilOpsRepository'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function safeAddress(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!/^[A-Za-z0-9:_-]{32,66}$/.test(trimmed)) return null
  return trimmed
}

// ─── Route registration ────────────────────────────────────────────────────────

export type FoilOpsRouteDeps = {
  requireApiAuth: RequestHandler
  requirePageAuth: RequestHandler
  repository: FoilOpsRepository
}

type MintScanMode = 'lite' | 'full'

type MintScanWallet = {
  address: string
  usdSpent: number
  txCount: number
  tokenAcquired: number
}

type MintDiscoveryResult = {
  tokenMint: string
  scanMode: MintScanMode
  signaturesFetched: number
  transactionsParsed: number
  walletsCount: number
  whaleThresholdUsd: number
  whales: MintScanWallet[]
  topWallets: MintScanWallet[]
  solUsd: number
  durationMs: number
}

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD8w2k7cD2qQxQq4Yk9B2w'

function parseRpcEndpoint(): string {
  const configured = process.env.RPC_ENDPOINTS?.split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (configured && configured.length > 0) {
    return configured[0]
  }

  const heliusKey = process.env.HELIUS_API_KEY?.trim()
  if (heliusKey) {
    return `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`
  }

  throw new Error('RPC_ENDPOINTS or HELIUS_API_KEY is required for mint discovery')
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.round(parsed)))
}

async function heliusRpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })

  if (!response.ok) {
    throw new Error(`RPC request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as { error?: unknown; result?: T }
  if (payload.error) {
    throw new Error(`RPC error: ${JSON.stringify(payload.error)}`)
  }

  return payload.result as T
}

function getTokenAmount(balance: any): number {
  const amount = Number(balance?.uiTokenAmount?.uiAmount)
  return Number.isFinite(amount) ? amount : 0
}

function getAccountKey(accountKey: any): string {
  if (!accountKey) {
    return ''
  }
  if (typeof accountKey === 'string') {
    return accountKey
  }
  if (typeof accountKey.pubkey === 'string') {
    return accountKey.pubkey
  }
  return ''
}

async function getSolUsdPrice(): Promise<number> {
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd')
    if (!response.ok) {
      return 150
    }
    const payload = (await response.json()) as { solana?: { usd?: number } }
    const usd = Number(payload?.solana?.usd)
    return Number.isFinite(usd) && usd > 0 ? usd : 150
  } catch {
    return 150
  }
}

async function discoverWalletsByMint(params: {
  tokenMint: string
  scanMode: MintScanMode
  maxSignatures: number
  top: number
  whaleThresholdUsd: number
}): Promise<MintDiscoveryResult> {
  const startedAt = Date.now()
  const rpcUrl = parseRpcEndpoint()
  const solUsd = await getSolUsdPrice()

  const signatures: string[] = []
  let before: string | undefined
  const pageSize = params.scanMode === 'lite' ? 250 : 1000

  while (signatures.length < params.maxSignatures) {
    const batch = await heliusRpc<any[]>(rpcUrl, 'getSignaturesForAddress', [
      params.tokenMint,
      { limit: pageSize, ...(before ? { before } : {}) },
    ])
    if (!Array.isArray(batch) || batch.length === 0) {
      break
    }

    for (const row of batch) {
      const signature = typeof row?.signature === 'string' ? row.signature : ''
      if (signature) {
        signatures.push(signature)
      }
      if (signatures.length >= params.maxSignatures) {
        break
      }
    }

    const lastSignature = batch[batch.length - 1]?.signature
    before = typeof lastSignature === 'string' ? lastSignature : undefined
    if (!before || batch.length < pageSize) {
      break
    }
  }

  const buyers: Record<string, MintScanWallet> = {}
  let transactionsParsed = 0
  const txBatchSize = params.scanMode === 'lite' ? 10 : 25

  for (let index = 0; index < signatures.length; index += txBatchSize) {
    const signatureChunk = signatures.slice(index, index + txBatchSize)

    const transactions = await Promise.all(
      signatureChunk.map(async (signature) => {
        try {
          return await heliusRpc<any | null>(rpcUrl, 'getTransaction', [
            signature,
            { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
          ])
        } catch {
          return null
        }
      }),
    )

    for (const tx of transactions) {
      if (!tx?.meta || !tx?.transaction?.message?.accountKeys) {
        continue
      }

      transactionsParsed += 1
      const preTokenBalances: any[] = Array.isArray(tx.meta.preTokenBalances) ? tx.meta.preTokenBalances : []
      const postTokenBalances: any[] = Array.isArray(tx.meta.postTokenBalances) ? tx.meta.postTokenBalances : []
      const preBalances: number[] = Array.isArray(tx.meta.preBalances) ? tx.meta.preBalances : []
      const postBalances: number[] = Array.isArray(tx.meta.postBalances) ? tx.meta.postBalances : []
      const accountKeys: any[] = Array.isArray(tx.transaction.message.accountKeys)
        ? tx.transaction.message.accountKeys
        : []

      const gains: Array<{ owner: string; accountIndex: number; tokenGained: number }> = []
      for (const postBalance of postTokenBalances) {
        if (postBalance?.mint !== params.tokenMint) {
          continue
        }

        const preBalance = preTokenBalances.find(
          (row) => row?.mint === params.tokenMint && row?.accountIndex === postBalance?.accountIndex,
        )

        const diff = getTokenAmount(postBalance) - getTokenAmount(preBalance)
        if (diff <= 0) {
          continue
        }

        const ownerFromPost = typeof postBalance?.owner === 'string' ? postBalance.owner : ''
        const ownerFromAccount = getAccountKey(accountKeys[postBalance.accountIndex])
        const owner = ownerFromPost || ownerFromAccount
        if (!owner) {
          continue
        }

        gains.push({ owner, accountIndex: Number(postBalance.accountIndex), tokenGained: diff })
      }

      if (gains.length === 0) {
        continue
      }

      for (const gain of gains) {
        if (!buyers[gain.owner]) {
          buyers[gain.owner] = {
            address: gain.owner,
            usdSpent: 0,
            txCount: 0,
            tokenAcquired: 0,
          }
        }

        let usdSpent = 0
        if (
          Number.isInteger(gain.accountIndex) &&
          gain.accountIndex >= 0 &&
          gain.accountIndex < preBalances.length &&
          gain.accountIndex < postBalances.length
        ) {
          const lamportsDelta = Number(preBalances[gain.accountIndex]) - Number(postBalances[gain.accountIndex])
          if (Number.isFinite(lamportsDelta) && lamportsDelta > 0) {
            usdSpent += (lamportsDelta / 1e9) * solUsd
          }
        }

        for (const stableMint of [USDC_MINT, USDT_MINT]) {
          const postRows = postTokenBalances.filter((row) => row?.mint === stableMint && row?.owner === gain.owner)
          for (const postRow of postRows) {
            const preRow = preTokenBalances.find(
              (row) =>
                row?.mint === stableMint && row?.owner === gain.owner && row?.accountIndex === postRow?.accountIndex,
            )
            const stableDelta = getTokenAmount(preRow) - getTokenAmount(postRow)
            if (stableDelta > 0) {
              usdSpent += stableDelta
            }
          }
        }

        buyers[gain.owner].usdSpent += usdSpent
        buyers[gain.owner].txCount += 1
        buyers[gain.owner].tokenAcquired += gain.tokenGained
      }
    }
  }

  const sortedWallets = Object.values(buyers).sort((left, right) => right.usdSpent - left.usdSpent)
  const whales = sortedWallets.filter((wallet) => wallet.usdSpent >= params.whaleThresholdUsd)

  return {
    tokenMint: params.tokenMint,
    scanMode: params.scanMode,
    signaturesFetched: signatures.length,
    transactionsParsed,
    walletsCount: sortedWallets.length,
    whaleThresholdUsd: params.whaleThresholdUsd,
    whales,
    topWallets: sortedWallets.slice(0, params.top),
    solUsd,
    durationMs: Date.now() - startedAt,
  }
}

export function registerFoilOpsRoutes(app: Express, deps: FoilOpsRouteDeps): void {
  const { requireApiAuth, requirePageAuth, repository } = deps

  // ─── GET /api/foilops/summary ─────────────────────────────────────────────
  app.get('/api/foilops/summary', requireApiAuth, async (_req: Request, res: Response) => {
    try {
      const summary = await repository.getDashboardSummary()
      res.status(200).json(summary)
    } catch (error) {
      console.error('[FoilOps] /api/foilops/summary error', error)
      res.status(500).json({ message: 'Failed to fetch summary' })
    }
  })

  // ─── GET /api/foilops/wallets/top ─────────────────────────────────────────
  app.get('/api/foilops/wallets/top', requireApiAuth, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || tracingRules.feedTopWalletCount))
      const classification = typeof req.query.classification === 'string' ? req.query.classification : undefined
      const maxRisk = req.query.maxRisk !== undefined ? Number(req.query.maxRisk) : undefined
      const minOpportunity = req.query.minOpportunity !== undefined ? Number(req.query.minOpportunity) : undefined

      const wallets = await repository.getTopWallets({
        limit,
        classification,
        maxRiskScore: maxRisk,
        minOpportunityScore: minOpportunity,
      })
      res.status(200).json({ wallets, count: wallets.length })
    } catch (error) {
      console.error('[FoilOps] /api/foilops/wallets/top error', error)
      res.status(500).json({ message: 'Failed to fetch top wallets' })
    }
  })

  // ─── GET /api/foilops/wallets/high-risk ──────────────────────────────────
  app.get('/api/foilops/wallets/high-risk', requireApiAuth, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50))
      const wallets = await repository.getHighRiskWallets(limit)
      res.status(200).json({ wallets, count: wallets.length })
    } catch (error) {
      console.error('[FoilOps] /api/foilops/wallets/high-risk error', error)
      res.status(500).json({ message: 'Failed to fetch high-risk wallets' })
    }
  })

  // ─── POST /api/foilops/wallets/discover-by-mint ─────────────────────────
  app.post('/api/foilops/wallets/discover-by-mint', requireApiAuth, async (req: Request, res: Response) => {
    try {
      const rawMint = typeof req.body?.tokenMint === 'string' ? req.body.tokenMint.trim() : ''
      const tokenMint = safeAddress(rawMint)
      if (!tokenMint) {
        res.status(400).json({ message: 'Valid tokenMint is required' })
        return
      }

      const requestedMode = req.body?.scanMode
      const scanMode: MintScanMode = requestedMode === 'full' ? 'full' : 'lite'
      const maxSignatures =
        scanMode === 'full'
          ? clampNumber(req.body?.maxSignatures, 100, 10000, 5000)
          : clampNumber(req.body?.maxSignatures, 25, 1500, 250)
      const top = clampNumber(req.body?.top, 5, 100, 50)
      const whaleThresholdUsd = clampNumber(req.body?.whaleThresholdUsd, 1000, 100000000, 1000000)

      const discovery = await discoverWalletsByMint({
        tokenMint,
        scanMode,
        maxSignatures,
        top,
        whaleThresholdUsd,
      })

      res.status(200).json(discovery)
    } catch (error) {
      console.error('[FoilOps] /api/foilops/wallets/discover-by-mint error', error)
      const message = error instanceof Error ? error.message : 'Failed to discover wallets by mint'
      res.status(500).json({ message })
    }
  })

  // ─── POST /api/foilops/wallets/score ─────────────────────────────────────
  app.post('/api/foilops/wallets/score', requireApiAuth, async (req: Request, res: Response) => {
    try {
      const body = req.body as Partial<WalletScoringInput>

      if (!body.wallet || typeof body.wallet !== 'string') {
        res.status(400).json({ message: 'wallet field is required' })
        return
      }

      const addr = safeAddress(body.wallet)
      if (!addr) {
        res.status(400).json({ message: 'Invalid wallet address format' })
        return
      }

      const input: WalletScoringInput = {
        wallet: addr,
        launches: Array.isArray(body.launches) ? (body.launches as LaunchParticipationRecord[]) : [],
        isFlagged: body.isFlagged === true,
        rugEventCount: Number(body.rugEventCount) || 0,
        fundingFlags: {
          fromKnownBadActor: body.fundingFlags?.fromKnownBadActor === true,
          fromMixer: body.fundingFlags?.fromMixer === true,
          fromExchangeWithdrawal: body.fundingFlags?.fromExchangeWithdrawal === true,
          fromNewWallet: body.fundingFlags?.fromNewWallet === true,
        },
        clusterResult: (body.clusterResult as ClusterAnalysisResult | null) ?? null,
        rapidDumpEventCount: Number(body.rapidDumpEventCount) || 0,
        largeSellEventCount: Number(body.largeSellEventCount) || 0,
      }

      const profile = scoreWallet(input)
      const summary = buildWalletSummaryPayload(profile, input.launches, input.clusterResult)

      // Persist the snapshot
      await repository.upsertWalletSnapshot(profile, input.launches)

      res.status(200).json({ profile, summary })
    } catch (error) {
      console.error('[FoilOps] /api/foilops/wallets/score error', error)
      res.status(500).json({ message: 'Failed to score wallet' })
    }
  })

  // ─── GET /api/foilops/wallets/:address ────────────────────────────────────
  app.get('/api/foilops/wallets/:address', requireApiAuth, async (req: Request, res: Response) => {
    try {
      const addr = safeAddress(req.params.address)
      if (!addr) {
        res.status(400).json({ message: 'Invalid wallet address format' })
        return
      }

      const [detail, clusterEdges] = await Promise.all([
        repository.getWalletDetail(addr),
        repository.getClusterEdges(addr),
      ])

      if (!detail) {
        res.status(404).json({ wallet: addr, message: 'No profile found. Submit via POST /api/foilops/wallets/score.' })
        return
      }

      res.status(200).json({ ...detail, clusterEdges })
    } catch (error) {
      console.error('[FoilOps] /api/foilops/wallets/:address error', error)
      res.status(500).json({ message: 'Failed to fetch wallet detail' })
    }
  })

  // ─── GET /api/foilops/tokens/high-risk ────────────────────────────────────
  app.get('/api/foilops/tokens/high-risk', requireApiAuth, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50))
      const tokens = await repository.getHighRiskTokens(limit)
      res.status(200).json({ tokens, count: tokens.length })
    } catch (error) {
      console.error('[FoilOps] /api/foilops/tokens/high-risk error', error)
      res.status(500).json({ message: 'Failed to fetch high-risk tokens' })
    }
  })

  // ─── POST /api/foilops/tokens/score ──────────────────────────────────────
  app.post('/api/foilops/tokens/score', requireApiAuth, async (req: Request, res: Response) => {
    try {
      const body = req.body as Partial<TokenScoringInput>

      if (!body.tokenAddress || typeof body.tokenAddress !== 'string') {
        res.status(400).json({ message: 'tokenAddress field is required' })
        return
      }

      const addr = safeAddress(body.tokenAddress)
      if (!addr) {
        res.status(400).json({ message: 'Invalid token address format' })
        return
      }

      const input: TokenScoringInput = {
        tokenAddress: addr,
        creatorHoldPercent: Number(body.creatorHoldPercent) || 0,
        top10HolderPercent: Number(body.top10HolderPercent) || 0,
        liquidityUsd: Number(body.liquidityUsd) || 0,
        liquidityRemovalPercent: Number(body.liquidityRemovalPercent) || 0,
        suspiciousWalletLinks: Number(body.suspiciousWalletLinks) || 0,
        largeSellEventCount: Number(body.largeSellEventCount) || 0,
        observedEvents: Array.isArray(body.observedEvents) ? (body.observedEvents as SuspiciousTokenEvent[]) : [],
      }

      const profile = scoreToken(input)
      const summary = buildTokenSummaryPayload(profile, input.observedEvents)

      // Persist
      await repository.upsertTokenSnapshot(profile, input.observedEvents)

      res.status(200).json({ profile, summary })
    } catch (error) {
      console.error('[FoilOps] /api/foilops/tokens/score error', error)
      res.status(500).json({ message: 'Failed to score token' })
    }
  })

  // ─── GET /api/foilops/tokens/:address ─────────────────────────────────────
  app.get('/api/foilops/tokens/:address', requireApiAuth, async (req: Request, res: Response) => {
    try {
      const addr = safeAddress(req.params.address)
      if (!addr) {
        res.status(400).json({ message: 'Invalid token address format' })
        return
      }

      const detail = await repository.getTokenDetail(addr)
      if (!detail) {
        res
          .status(404)
          .json({ tokenAddress: addr, message: 'No risk profile found. Submit via POST /api/foilops/tokens/score.' })
        return
      }

      res.status(200).json(detail)
    } catch (error) {
      console.error('[FoilOps] /api/foilops/tokens/:address error', error)
      res.status(500).json({ message: 'Failed to fetch token detail' })
    }
  })

  // ─── POST /api/foilops/cluster ────────────────────────────────────────────
  app.post('/api/foilops/cluster', requireApiAuth, async (req: Request, res: Response) => {
    try {
      const body = req.body as {
        targetWallet?: string
        targetData?: CandidateWalletData
        candidates?: CandidateWalletData[]
      }

      const addr = safeAddress(body.targetWallet ?? '')
      if (!addr) {
        res.status(400).json({ message: 'targetWallet field with a valid address is required' })
        return
      }

      if (!body.targetData || !Array.isArray(body.candidates)) {
        res.status(400).json({ message: 'targetData and candidates[] are required' })
        return
      }

      const result = analyseWalletCluster(addr, body.targetData, body.candidates)

      // Persist cluster edges
      if (result.links.length > 0) {
        await repository.upsertClusterEdges(result.links)
      }

      res.status(200).json(result)
    } catch (error) {
      console.error('[FoilOps] /api/foilops/cluster error', error)
      res.status(500).json({ message: 'Failed to run cluster analysis' })
    }
  })

  // ─── GET /api/foilops/cluster/:address ───────────────────────────────────
  app.get('/api/foilops/cluster/:address', requireApiAuth, async (req: Request, res: Response) => {
    try {
      const addr = safeAddress(req.params.address)
      if (!addr) {
        res.status(400).json({ message: 'Invalid wallet address format' })
        return
      }

      const edges = await repository.getClusterEdges(addr)
      const reachableWallets = [
        ...new Set(edges.flatMap((e) => [e.sourceWallet, e.targetWallet]).filter((w) => w !== addr)),
      ]
      const topSuspicion = edges.reduce((max, e) => Math.max(max, e.confidence * 100), 0)

      res.status(200).json({
        wallet: addr,
        links: edges,
        reachableWallets,
        clusterSuspicionScore: Math.round(topSuspicion),
        linkCount: edges.length,
      })
    } catch (error) {
      console.error('[FoilOps] /api/foilops/cluster/:address error', error)
      res.status(500).json({ message: 'Failed to fetch cluster graph' })
    }
  })

  // ─── GET /api/foilops/feed/launches ──────────────────────────────────────
  app.get('/api/foilops/feed/launches', requireApiAuth, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || tracingRules.feedLaunchCount))
      const launches = await repository.getRecentLaunchFeed(limit)
      res.status(200).json({ launches, count: launches.length })
    } catch (error) {
      console.error('[FoilOps] /api/foilops/feed/launches error', error)
      res.status(500).json({ message: 'Failed to fetch launch feed' })
    }
  })

  // ─── GET /dashboard/foilops ───────────────────────────────────────────────
  app.get('/dashboard/foilops', requirePageAuth, async (_req: Request, res: Response) => {
    try {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.status(200).send(renderFoilOpsDashboard())
    } catch (error) {
      console.error('[FoilOps] dashboard render error', error)
      res.status(500).send('Failed to render FoilOps dashboard')
    }
  })
}

// ─── Dashboard HTML ────────────────────────────────────────────────────────────

function renderFoilOpsDashboard(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FoilOps — Launch Intelligence</title>
  <style>
    :root {
      --bg: #080508;
      --panel: rgba(20,5,7,.85);
      --ink: #f8eded;
      --muted: #b89898;
      --accent: #ff2233;
      --accent2: #ff7744;
      --border: rgba(255,40,60,.18);
      --success: #00e676;
      --warning: #ffbc68;
      --risk: #ff7744;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--ink); font-family: "Space Grotesk", "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif; min-height: 100vh; }

    /* ── Top bar ── */
    .topbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: .75rem 2rem; background: var(--panel); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 100;
    }
    .topbar h1 { font-size: 1rem; font-weight: 800; letter-spacing: .06em; color: var(--accent); }
    .topbar nav a { color: var(--muted); text-decoration: none; margin-left: 1.4rem; font-size: .8rem; transition: color .12s; }
    .topbar nav a:hover, .topbar nav a.active { color: var(--ink); }

    /* ── Layout ── */
    .content { max-width: 1280px; margin: 0 auto; padding: 1.5rem 1.5rem 4rem; }

    /* ── Summary stats ── */
    .stats-bar { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
    .stat-card {
      background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
      padding: .9rem 1.2rem; min-width: 140px; flex: 1;
    }
    .stat-card .label { font-size: .68rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: .3rem; }
    .stat-card .value { font-size: 1.6rem; font-weight: 800; }
    .stat-card .value.green { color: var(--success); }
    .stat-card .value.red   { color: var(--accent); }
    .stat-card .value.orange { color: var(--risk); }
    .stat-card .value.blue  { color: var(--accent2); }

    /* ── Filter bar ── */
    .filter-bar {
      background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
      padding: 1rem 1.2rem; margin-bottom: 1.5rem;
      display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-end;
    }
    .filter-bar label { font-size: .72rem; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
    .filter-bar .field { display: flex; flex-direction: column; gap: .35rem; }
    .filter-bar input[type=range] { width: 140px; accent-color: var(--accent2); cursor: pointer; }
    .filter-bar select, .filter-bar input[type=number] {
      background: rgba(0,0,0,.3); border: 1px solid var(--border); border-radius: 6px;
      color: var(--ink); font-size: .8rem; padding: .35rem .6rem; outline: none; width: 140px;
    }
    .filter-bar select:focus, .filter-bar input[type=number]:focus { border-color: var(--accent2); }
    .filter-bar .apply-btn {
      background: var(--accent2); border: none; border-radius: 7px; color: #fff;
      font-weight: 700; font-size: .8rem; padding: .5rem 1.2rem; cursor: pointer; align-self: flex-end;
    }
    .filter-bar .apply-btn:hover { background: #e96230; }
    .range-val { font-size: .75rem; color: var(--ink); }

    /* ── Panels grid ── */
    .panels { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2rem; margin-bottom: 1.5rem; }
    @media (max-width: 900px) { .panels { grid-template-columns: 1fr; } }
    .panel {
      background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
      overflow: hidden;
    }
    .panel-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: .85rem 1.2rem; border-bottom: 1px solid var(--border);
    }
    .panel-header h2 { font-size: .88rem; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; }
    .panel-header .pill {
      font-size: .68rem; font-weight: 700; padding: .2rem .5rem; border-radius: 20px;
      background: rgba(255,119,68,.15); color: var(--accent2); border: 1px solid rgba(255,119,68,.3);
    }
    .panel-header .pill.danger { background: rgba(255,45,45,.1); color: var(--accent); border-color: rgba(255,45,45,.3); }
    .panel-header .pill.ok { background: rgba(0,230,118,.12); color: var(--success); border-color: rgba(0,230,118,.3); }

    .mint-discovery-controls {
      display: flex; flex-wrap: wrap; gap: .75rem; align-items: flex-end;
      padding: .9rem 1rem; border-bottom: 1px solid var(--border);
      background: rgba(0,0,0,.18);
    }
    .mint-discovery-controls .field { display: flex; flex-direction: column; gap: .35rem; min-width: 170px; }
    .mint-discovery-controls label { font-size: .7rem; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
    .mint-discovery-controls input {
      background: rgba(0,0,0,.3); border: 1px solid var(--border); border-radius: 6px;
      color: var(--ink); font-size: .8rem; padding: .35rem .6rem; outline: none;
    }
    .mint-discovery-controls input:focus { border-color: var(--accent2); }
    .mint-discovery-controls .actions { display: flex; gap: .55rem; }
    .mint-discovery-controls .actions button {
      border: none; border-radius: 7px; color: #fff; font-weight: 700; font-size: .78rem;
      padding: .52rem .95rem; cursor: pointer;
    }
    .mint-discovery-controls .actions button[disabled] { opacity: .5; cursor: not-allowed; }
    .mint-discovery-controls .run-lite { background: #ff7744; }
    .mint-discovery-controls .run-full { background: #ff2233; }
    .mint-meta {
      padding: .7rem 1rem; color: var(--muted); font-size: .77rem; border-bottom: 1px solid rgba(255,255,255,.04);
      display: flex; flex-wrap: wrap; gap: .8rem;
    }

    /* ── Tables ── */
    .table-wrap { overflow-x: auto; max-height: 340px; overflow-y: auto; }
    table { width: 100%; border-collapse: collapse; font-size: .78rem; }
    th { position: sticky; top: 0; background: rgba(16,5,7,.95); text-align: left; padding: .5rem .8rem; font-size: .66rem; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); }
    td { padding: .48rem .8rem; border-bottom: 1px solid rgba(255,255,255,.04); vertical-align: middle; }
    tr:hover td { background: rgba(255,255,255,.03); }
    .addr { font-family: monospace; font-size: .74rem; color: var(--ink); cursor: pointer; text-decoration: underline dotted; }
    .addr:hover { color: var(--accent2); }

    /* ── Score badges ── */
    .badge {
      display: inline-block; font-weight: 700; font-size: .7rem;
      padding: .15rem .45rem; border-radius: 5px; min-width: 34px; text-align: center;
    }
    .badge.green { background: rgba(0,230,118,.15); color: var(--success); }
    .badge.blue  { background: rgba(255,119,68,.15); color: var(--accent2); }
    .badge.orange{ background: rgba(255,107,53,.15);  color: var(--risk); }
    .badge.red   { background: rgba(255,45,45,.15);   color: var(--accent); }
    .badge.grey  { background: rgba(255,255,255,.07); color: var(--muted); }

    /* ── Classification tags ── */
    .tag {
      display: inline-block; font-size: .65rem; font-weight: 700; letter-spacing: .05em;
      padding: .12rem .4rem; border-radius: 4px; text-transform: uppercase; white-space: nowrap;
    }
    .tag.EARLY_ENTRANT  { background: rgba(0,230,118,.12); color: var(--success); }
    .tag.MOMENTUM_WALLET { background: rgba(255,119,68,.12); color: var(--accent2); }
    .tag.HIGH_RISK      { background: rgba(255,45,45,.12);   color: var(--accent); }
    .tag.WATCHLIST      { background: rgba(255,179,0,.12);   color: var(--warning); }
    .tag.IGNORE         { background: rgba(255,255,255,.05); color: var(--muted); }
    .tag.SAFER_SPECULATIVE { background: rgba(0,230,118,.12); color: var(--success); }
    .tag.EXTREME_RISK   { background: rgba(255,45,45,.18);   color: #ff6b6b; }

    /* ── Full-width launch feed ── */
    .launch-panel { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; margin-bottom: 1.5rem; }

    /* ── Empty state ── */
    .empty { text-align: center; padding: 2.5rem; color: var(--muted); font-size: .82rem; }
    .empty span { display: block; font-size: 2rem; margin-bottom: .5rem; opacity: .4; }

    /* ── Modal ── */
    .modal-overlay {
      display: none; position: fixed; inset: 0; background: rgba(0,0,0,.75);
      z-index: 200; align-items: center; justify-content: center;
    }
    .modal-overlay.open { display: flex; }
    .modal {
      background: #130608; border: 1px solid var(--border); border-radius: 14px;
      width: min(860px, 95vw); max-height: 90vh; overflow-y: auto; padding: 1.5rem;
    }
    .modal h2 { font-size: 1rem; font-weight: 800; margin-bottom: 1rem; color: var(--accent2); }
    .modal .close-btn {
      float: right; background: none; border: none; color: var(--muted);
      font-size: 1.3rem; cursor: pointer; line-height: 1; margin-top: -.2rem;
    }
    .modal .close-btn:hover { color: var(--ink); }
    .score-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px,1fr)); gap: .7rem; margin: 1rem 0; }
    .score-card {
      background: rgba(255,255,255,.04); border: 1px solid var(--border); border-radius: 9px;
      padding: .7rem .9rem;
    }
    .score-card .sc-label { font-size: .65rem; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); margin-bottom: .3rem; }
    .score-card .sc-value { font-size: 1.4rem; font-weight: 800; }
    .tags-row { display: flex; flex-wrap: wrap; gap: .35rem; margin-top: .5rem; }
    .modal table th { background: rgba(0,0,0,.4); }
    .section-title { font-size: .72rem; text-transform: uppercase; letter-spacing: .09em; color: var(--muted); margin: 1rem 0 .5rem; }

    /* ── Loader ── */
    .spin {
      display: inline-block; width: 14px; height: 14px;
      border: 2px solid rgba(255,255,255,.15); border-top-color: var(--accent);
      border-radius: 50%; animation: spin .6s linear infinite; vertical-align: middle; margin-right: .4rem;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>

<div class="topbar">
  <h1>FOILOPS</h1>
  <nav>
    <a href="/">Overview</a>
    <a href="/dashboard/trading-ops">Trading Ops</a>
    <a href="/dashboard/scam-wallets">Scam Intel</a>
    <a href="/dashboard/foilops" class="active">Intelligence</a>
    <a href="/logout">Logout</a>
  </nav>
</div>

<div class="content">

  <!-- ── Summary stats bar ─────────────────────────────────────── -->
  <div class="stats-bar" id="stats-bar">
    <div class="stat-card"><div class="label">Total Wallets</div><div class="value blue" id="s-total-wallets">…</div></div>
    <div class="stat-card"><div class="label">Early Entrants</div><div class="value green" id="s-early">…</div></div>
    <div class="stat-card"><div class="label">High-Risk Wallets</div><div class="value red" id="s-hr-wallets">…</div></div>
    <div class="stat-card"><div class="label">Total Tokens</div><div class="value blue" id="s-total-tokens">…</div></div>
    <div class="stat-card"><div class="label">High-Risk Tokens</div><div class="value orange" id="s-hr-tokens">…</div></div>
    <div class="stat-card"><div class="label">Extreme-Risk Tokens</div><div class="value red" id="s-extreme-tokens">…</div></div>
  </div>

  <!-- ── Filter bar ─────────────────────────────────────────────── -->
  <div class="filter-bar">
    <div class="field">
      <label>Min Opportunity Score <span class="range-val" id="lbl-opp">0</span></label>
      <input type="range" id="f-min-opp" min="0" max="100" value="0" oninput="document.getElementById('lbl-opp').textContent=this.value" />
    </div>
    <div class="field">
      <label>Max Risk Score <span class="range-val" id="lbl-risk">100</span></label>
      <input type="range" id="f-max-risk" min="0" max="100" value="100" oninput="document.getElementById('lbl-risk').textContent=this.value" />
    </div>
    <div class="field">
      <label>Classification</label>
      <select id="f-class">
        <option value="">All</option>
        <option value="EARLY_ENTRANT">Early Entrant</option>
        <option value="MOMENTUM_WALLET">Momentum Wallet</option>
        <option value="HIGH_RISK">High Risk</option>
        <option value="WATCHLIST">Watchlist</option>
        <option value="IGNORE">Ignore</option>
      </select>
    </div>
    <div class="field">
      <label>Rows</label>
      <input type="number" id="f-limit" value="50" min="1" max="100" style="width:80px" />
    </div>
    <button class="apply-btn" onclick="applyFilters()">Apply Filters</button>
  </div>

  <!-- ── 2-col panels: Top Wallets + High-Risk Wallets ─────────── -->
  <div class="launch-panel">
    <div class="panel-header">
      <h2>Mint Wallet Discovery (Helius)</h2>
      <span class="pill ok" id="pill-mint-discovery">Idle</span>
    </div>
    <div class="mint-discovery-controls">
      <div class="field" style="min-width:320px;flex:1">
        <label>Token Mint</label>
        <input id="mint-discovery-mint" type="text" placeholder="Enter token mint to discover wallets" />
      </div>
      <div class="field">
        <label>Max Signatures (Lite)</label>
        <input id="mint-discovery-lite-limit" type="number" min="25" max="1500" value="250" />
      </div>
      <div class="field">
        <label>Max Signatures (Full)</label>
        <input id="mint-discovery-full-limit" type="number" min="100" max="10000" value="5000" />
      </div>
      <div class="field">
        <label>Whale Threshold (USD)</label>
        <input id="mint-discovery-whale-threshold" type="number" min="1000" max="100000000" value="1000000" />
      </div>
      <div class="actions">
        <button class="run-lite" id="mint-discovery-run-lite" onclick="runMintDiscovery('lite')">Run Lite</button>
        <button class="run-full" id="mint-discovery-run-full" onclick="runMintDiscovery('full')">Run Full</button>
      </div>
    </div>
    <div class="mint-meta" id="mint-discovery-meta">Ready to discover wallets by token mint.</div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Wallet</th>
          <th>USD Spent</th>
          <th>Tx Count</th>
          <th>Token Acquired</th>
          <th>Whale</th>
          <th></th>
        </tr></thead>
        <tbody id="tbody-mint-discovery"><tr><td colspan="6" class="empty"><span>🧭</span>Run lite or full scan to load wallet candidates.</td></tr></tbody>
      </table>
    </div>
  </div>

  <div class="panels">

    <!-- Top Early Wallets -->
    <div class="panel">
      <div class="panel-header">
        <h2>Top Early-Entry Wallets</h2>
        <span class="pill" id="pill-top">0</span>
      </div>
      <div class="table-wrap">
        <table id="tbl-top-wallets">
          <thead><tr>
            <th>Address</th>
            <th>Opp</th>
            <th>Risk</th>
            <th>Class</th>
            <th>Delay</th>
            <th>Platform</th>
            <th></th>
          </tr></thead>
          <tbody id="tbody-top-wallets"><tr><td colspan="7" class="empty"><span>⏳</span>Loading…</td></tr></tbody>
        </table>
      </div>
    </div>

    <!-- High-Risk Wallets -->
    <div class="panel">
      <div class="panel-header">
        <h2>High-Risk Wallets</h2>
        <span class="pill danger" id="pill-hr-wallets">0</span>
      </div>
      <div class="table-wrap">
        <table id="tbl-hr-wallets">
          <thead><tr>
            <th>Address</th>
            <th>Risk</th>
            <th>Opp</th>
            <th>Class</th>
            <th>Tags</th>
            <th></th>
          </tr></thead>
          <tbody id="tbody-hr-wallets"><tr><td colspan="6" class="empty"><span>⏳</span>Loading…</td></tr></tbody>
        </table>
      </div>
    </div>

  </div>

  <!-- ── High-Risk Tokens ───────────────────────────────────────── -->
  <div class="panels">
    <div class="panel" style="grid-column: 1 / -1">
      <div class="panel-header">
        <h2>High-Risk Tokens</h2>
        <span class="pill danger" id="pill-hr-tokens">0</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Token Address</th>
            <th>Risk Score</th>
            <th>Classification</th>
            <th>Creator %</th>
            <th>Top10 %</th>
            <th>Liquidity USD</th>
            <th>Events</th>
            <th></th>
          </tr></thead>
          <tbody id="tbody-hr-tokens"><tr><td colspan="8" class="empty"><span>⏳</span>Loading…</td></tr></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- ── Recent Launch Feed ─────────────────────────────────────── -->
  <div class="launch-panel">
    <div class="panel-header">
      <h2>Recent Launch Feed</h2>
      <span class="pill" id="pill-feed">0</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Token</th>
          <th>Wallet</th>
          <th>Platform</th>
          <th>Entry Delay</th>
          <th>Exit Delay</th>
          <th>Participated At</th>
        </tr></thead>
        <tbody id="tbody-feed"><tr><td colspan="6" class="empty"><span>⏳</span>Loading…</td></tr></tbody>
      </table>
    </div>
  </div>

</div>

<!-- ── Wallet Detail Modal ─────────────────────────────────────────── -->
<div class="modal-overlay" id="wallet-modal">
  <div class="modal">
    <button class="close-btn" onclick="closeModal('wallet-modal')">✕</button>
    <h2 id="wm-title">Wallet Detail</h2>
    <div id="wm-body"><p style="color:var(--muted)">Loading…</p></div>
  </div>
</div>

<!-- ── Token Detail Modal ──────────────────────────────────────────── -->
<div class="modal-overlay" id="token-modal">
  <div class="modal">
    <button class="close-btn" onclick="closeModal('token-modal')">✕</button>
    <h2 id="tm-title">Token Detail</h2>
    <div id="tm-body"><p style="color:var(--muted)">Loading…</p></div>
  </div>
</div>

<script>
// ── Utilities ──────────────────────────────────────────────────────

function abbr(addr) {
  if (!addr) return '—'
  return addr.length > 16 ? addr.slice(0,6)+'…'+addr.slice(-4) : addr
}

function scoreBadge(n, invert) {
  if (n == null) return '<span class="badge grey">—</span>'
  const v = Math.round(n)
  let cls
  if (invert) {
    cls = v <= 30 ? 'green' : v <= 60 ? 'blue' : v <= 80 ? 'orange' : 'red'
  } else {
    cls = v >= 70 ? 'green' : v >= 45 ? 'blue' : v >= 25 ? 'orange' : 'red'
  }
  return \`<span class="badge \${cls}">\${v}</span>\`
}

function classBadge(c) {
  if (!c) return ''
  return \`<span class="tag \${c}">\${c.replace(/_/g,' ')}</span>\`
}

function fmtDelay(secs) {
  if (secs == null) return '—'
  if (secs < 60) return secs+'s'
  if (secs < 3600) return Math.round(secs/60)+'m'
  return (secs/3600).toFixed(1)+'h'
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined,{dateStyle:'short',timeStyle:'short'})
}

function openModal(id) { document.getElementById(id).classList.add('open') }
function closeModal(id) { document.getElementById(id).classList.remove('open') }
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open') })
})

function fmtUsd(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return '$' + Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function fmtTokenAmount(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  const n = Number(value)
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K'
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 3 })
  return n.toLocaleString(undefined, { maximumFractionDigits: 8 })
}

// ── Data loaders ───────────────────────────────────────────────────

async function loadSummary() {
  try {
    const r = await fetch('/api/foilops/summary')
    if (!r.ok) return
    const d = await r.json()
    document.getElementById('s-total-wallets').textContent = d.totalWallets ?? 0
    document.getElementById('s-early').textContent        = d.earlyEntrantCount ?? 0
    document.getElementById('s-hr-wallets').textContent   = d.highRiskWalletCount ?? 0
    document.getElementById('s-total-tokens').textContent = d.totalTokens ?? 0
    document.getElementById('s-hr-tokens').textContent    = d.highRiskTokenCount ?? 0
    document.getElementById('s-extreme-tokens').textContent = d.extremeRiskTokenCount ?? 0
  } catch(_) {}
}

async function loadTopWallets(params) {
  const qs = new URLSearchParams(params).toString()
  const r = await fetch('/api/foilops/wallets/top?' + qs)
  const d = await r.json()
  const wallets = d.wallets ?? []
  document.getElementById('pill-top').textContent = wallets.length
  const tbody = document.getElementById('tbody-top-wallets')
  if (!wallets.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty"><span>📭</span>No wallets found</td></tr>'
    return
  }
  tbody.innerHTML = wallets.map(w => \`
    <tr>
      <td><span class="addr" onclick="openWalletDetail('\${w.walletAddress}')">\${abbr(w.walletAddress)}</span></td>
      <td>\${scoreBadge(w.opportunityScore, false)}</td>
      <td>\${scoreBadge(w.riskScore, true)}</td>
      <td>\${classBadge(w.classification)}</td>
      <td>\${fmtDelay(w.entryTimingAvgSeconds)}</td>
      <td style="color:var(--muted);font-size:.72rem">\${w.lastSeenPlatform || '—'}</td>
      <td><button onclick="openWalletDetail('\${w.walletAddress}')" style="background:none;border:1px solid var(--accent2);color:var(--accent2);border-radius:5px;padding:.18rem .45rem;cursor:pointer;font-size:.68rem">Detail</button></td>
    </tr>\`).join('')
}

async function loadHighRiskWallets() {
  const r = await fetch('/api/foilops/wallets/high-risk?limit=50')
  const d = await r.json()
  const wallets = d.wallets ?? []
  document.getElementById('pill-hr-wallets').textContent = wallets.length
  const tbody = document.getElementById('tbody-hr-wallets')
  if (!wallets.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty"><span>✅</span>No high-risk wallets</td></tr>'
    return
  }
  tbody.innerHTML = wallets.map(w => \`
    <tr>
      <td><span class="addr" onclick="openWalletDetail('\${w.walletAddress}')">\${abbr(w.walletAddress)}</span></td>
      <td>\${scoreBadge(w.riskScore, true)}</td>
      <td>\${scoreBadge(w.opportunityScore, false)}</td>
      <td>\${classBadge(w.classification)}</td>
      <td style="font-size:.7rem;color:var(--muted)">\${(w.tags||[]).slice(0,2).join(', ') || '—'}</td>
      <td><button onclick="openWalletDetail('\${w.walletAddress}')" style="background:none;border:1px solid var(--accent);color:var(--accent);border-radius:5px;padding:.18rem .45rem;cursor:pointer;font-size:.68rem">Detail</button></td>
    </tr>\`).join('')
}

async function loadHighRiskTokens() {
  const r = await fetch('/api/foilops/tokens/high-risk?limit=50')
  const d = await r.json()
  const tokens = d.tokens ?? []
  document.getElementById('pill-hr-tokens').textContent = tokens.length
  const tbody = document.getElementById('tbody-hr-tokens')
  if (!tokens.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty"><span>✅</span>No high-risk tokens</td></tr>'
    return
  }
  tbody.innerHTML = tokens.map(t => \`
    <tr>
      <td><span class="addr" onclick="openTokenDetail('\${t.tokenAddress}')">\${abbr(t.tokenAddress)}</span></td>
      <td>\${scoreBadge(t.riskScore, true)}</td>
      <td>\${classBadge(t.classification)}</td>
      <td style="color:var(--muted)">\${t.creatorHoldPercent != null ? t.creatorHoldPercent.toFixed(1)+'%' : '—'}</td>
      <td style="color:var(--muted)">\${t.top10HolderPercent != null ? t.top10HolderPercent.toFixed(1)+'%' : '—'}</td>
      <td style="color:var(--muted)">\${t.liquidityUsd != null ? '$'+t.liquidityUsd.toLocaleString() : '—'}</td>
      <td style="color:var(--muted)">\${t.eventCount ?? '—'}</td>
      <td><button onclick="openTokenDetail('\${t.tokenAddress}')" style="background:none;border:1px solid var(--accent);color:var(--accent);border-radius:5px;padding:.18rem .45rem;cursor:pointer;font-size:.68rem">Detail</button></td>
    </tr>\`).join('')
}

async function loadFeed() {
  const r = await fetch('/api/foilops/feed/launches?limit=100')
  const d = await r.json()
  const launches = d.launches ?? []
  document.getElementById('pill-feed').textContent = launches.length
  const tbody = document.getElementById('tbody-feed')
  if (!launches.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty"><span>📭</span>No recent launches</td></tr>'
    return
  }
  tbody.innerHTML = launches.map(l => \`
    <tr>
      <td><span class="addr" onclick="openTokenDetail('\${l.tokenAddress}')">\${abbr(l.tokenAddress)}</span></td>
      <td><span class="addr" onclick="openWalletDetail('\${l.walletAddress}')">\${abbr(l.walletAddress)}</span></td>
      <td style="color:var(--muted);font-size:.72rem">\${l.platform || '—'}</td>
      <td>\${fmtDelay(l.entryDelaySeconds)}</td>
      <td>\${fmtDelay(l.exitDelaySeconds)}</td>
      <td style="color:var(--muted);font-size:.72rem">\${fmtDate(l.participatedAt)}</td>
    </tr>\`).join('')
}

async function runMintDiscovery(mode) {
  const mintInput = document.getElementById('mint-discovery-mint')
  const liteLimitInput = document.getElementById('mint-discovery-lite-limit')
  const fullLimitInput = document.getElementById('mint-discovery-full-limit')
  const whaleThresholdInput = document.getElementById('mint-discovery-whale-threshold')
  const runLiteButton = document.getElementById('mint-discovery-run-lite')
  const runFullButton = document.getElementById('mint-discovery-run-full')
  const statusPill = document.getElementById('pill-mint-discovery')
  const meta = document.getElementById('mint-discovery-meta')
  const tbody = document.getElementById('tbody-mint-discovery')

  const mint = (mintInput?.value || '').trim()
  if (!/^[A-Za-z0-9:_-]{32,66}$/.test(mint)) {
    if (meta) meta.textContent = 'Please enter a valid token mint.'
    if (statusPill) statusPill.textContent = 'Invalid mint'
    return
  }

  const maxSignatures = mode === 'full'
    ? Number(fullLimitInput?.value || 5000)
    : Number(liteLimitInput?.value || 250)
  const whaleThresholdUsd = Number(whaleThresholdInput?.value || 1000000)

  if (runLiteButton) runLiteButton.disabled = true
  if (runFullButton) runFullButton.disabled = true
  if (statusPill) statusPill.textContent = mode === 'full' ? 'Running full scan…' : 'Running lite scan…'
  if (meta) meta.textContent = 'Scanning mint activity on Helius. This may take up to a minute for full scans.'
  if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="empty"><span>⏳</span>Analyzing transactions…</td></tr>'

  try {
    const response = await fetch('/api/foilops/wallets/discover-by-mint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tokenMint: mint, scanMode: mode, maxSignatures, top: 50, whaleThresholdUsd }),
    })

    const payload = await response.json()
    if (!response.ok) {
      throw new Error(payload?.message || 'Discovery request failed')
    }

    const rows = Array.isArray(payload.topWallets) ? payload.topWallets : []
    const threshold = Number(payload.whaleThresholdUsd || whaleThresholdUsd)

    if (statusPill) {
      statusPill.textContent = mode === 'full' ? 'Full scan complete' : 'Lite scan complete'
    }
    if (meta) {
      const durationSeconds = Number(payload.durationMs || 0) / 1000
      meta.textContent =
        'Mint: ' + payload.tokenMint +
        ' | Signatures: ' + Number(payload.signaturesFetched || 0).toLocaleString() +
        ' | Parsed TX: ' + Number(payload.transactionsParsed || 0).toLocaleString() +
        ' | Wallets: ' + Number(payload.walletsCount || 0).toLocaleString() +
        ' | Whales: ' + Number((payload.whales || []).length).toLocaleString() +
        ' | Time: ' + durationSeconds.toFixed(1) + 's'
    }

    if (!tbody) {
      return
    }

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty"><span>📭</span>No wallet candidates found for this scan window.</td></tr>'
      return
    }

    tbody.innerHTML = rows.map((wallet) => {
      const whale = Number(wallet.usdSpent || 0) >= threshold
      return '<tr>' +
        '<td><span class="addr" onclick="openWalletDetail(\'' + wallet.address + '\')">' + abbr(wallet.address) + '</span></td>' +
        '<td>' + fmtUsd(wallet.usdSpent) + '</td>' +
        '<td>' + Number(wallet.txCount || 0).toLocaleString() + '</td>' +
        '<td>' + fmtTokenAmount(wallet.tokenAcquired) + '</td>' +
        '<td>' + (whale ? '<span class="tag EARLY_ENTRANT">WHALE</span>' : '<span class="tag IGNORE">NO</span>') + '</td>' +
        '<td><button onclick="openWalletDetail(\'' + wallet.address + '\')" style="background:none;border:1px solid var(--accent2);color:var(--accent2);border-radius:5px;padding:.18rem .45rem;cursor:pointer;font-size:.68rem">Detail</button></td>' +
      '</tr>'
    }).join('')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (statusPill) statusPill.textContent = 'Scan failed'
    if (meta) meta.textContent = 'Discovery failed: ' + message
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="empty"><span>⚠️</span>Discovery failed. Check RPC key and try again.</td></tr>'
  } finally {
    if (runLiteButton) runLiteButton.disabled = false
    if (runFullButton) runFullButton.disabled = false
  }
}

// ── Wallet detail modal ─────────────────────────────────────────────

async function openWalletDetail(addr) {
  openModal('wallet-modal')
  document.getElementById('wm-title').textContent = 'Wallet: ' + abbr(addr)
  document.getElementById('wm-body').innerHTML = '<p style="color:var(--muted)"><span class="spin"></span>Loading…</p>'
  try {
    const r = await fetch('/api/foilops/wallets/' + encodeURIComponent(addr))
    if (!r.ok) {
      const err = await r.json()
      document.getElementById('wm-body').innerHTML = \`<p style="color:var(--accent)">\${err.message}</p>\`
      return
    }
    const d = await r.json()
    // d: { wallet, scores, classification, tags, launchRecords, clusterEdges, computedAt }
    const s = d.scores || {}

    const scoreList = [
      ['Early Entry',       s.earlyEntryScore],
      ['Momentum',          s.momentumParticipationScore],
      ['Repeat Success',    s.repeatSuccessScore],
      ['Exit Timing',       s.exitTimingScore],
      ['Rug Risk',          s.rugRiskScore],
      ['Dump Severity',     s.dumpSeverityScore],
      ['Cluster Suspicion', s.clusterSuspicionScore],
      ['Susp. Funding',     s.suspiciousFundingScore],
    ]

    const scoreCardsHtml = scoreList.map(([label, val]) => {
      const v = val != null ? Math.round(val) : null
      const isRisk = ['Rug Risk','Dump Severity','Cluster Suspicion','Susp. Funding'].includes(label)
      const cls = v == null ? 'var(--muted)' : isRisk
        ? (v>=70?'var(--accent)':v>=40?'var(--risk)':'var(--success)')
        : (v>=70?'var(--success)':v>=40?'var(--accent2)':'var(--muted)')
      return \`<div class="score-card"><div class="sc-label">\${label}</div><div class="sc-value" style="color:\${cls}">\${v ?? '—'}</div></div>\`
    }).join('')

    const tagsHtml = (d.tags || []).map(t => \`<span class="tag WATCHLIST">\${t}</span>\`).join('')

    const launchRows = (d.launchRecords || []).slice(0,20).map(l => \`
      <tr>
        <td style="font-size:.72rem;font-family:monospace">\${abbr(l.tokenAddress)}</td>
        <td style="color:var(--muted)">\${l.platform||'—'}</td>
        <td>\${fmtDelay(l.entryDelaySeconds)}</td>
        <td>\${fmtDelay(l.exitDelaySeconds)}</td>
        <td style="color:var(--muted);font-size:.7rem">\${fmtDate(new Date(l.entryTimestamp).toISOString())}</td>
      </tr>\`).join('')

    const clusterRows = (d.clusterEdges || []).slice(0,10).map(e => \`
      <tr>
        <td style="font-size:.72rem;font-family:monospace">\${abbr(e.targetWallet !== addr ? e.targetWallet : e.sourceWallet)}</td>
        <td style="color:var(--muted)">\${e.linkType||'—'}</td>
        <td>\${scoreBadge(Math.round(e.confidence*100), true)}</td>
      </tr>\`).join('')

    document.getElementById('wm-body').innerHTML = \`
      <div style="display:flex;gap:.8rem;align-items:center;flex-wrap:wrap;margin-bottom:.5rem">
        <div><span style="font-size:.7rem;color:var(--muted)">OPPORTUNITY</span> \${scoreBadge(s.overallOpportunityScore, false)}</div>
        <div><span style="font-size:.7rem;color:var(--muted)">RISK</span> \${scoreBadge(s.overallRiskScore, true)}</div>
        <div>\${classBadge(d.classification)}</div>
      </div>
      <div class="section-title">Score Breakdown</div>
      <div class="score-grid">\${scoreCardsHtml}</div>
      \${tagsHtml ? \`<div class="section-title">Tags</div><div class="tags-row">\${tagsHtml}</div>\` : ''}
      \${launchRows ? \`
        <div class="section-title">Recent Launches (\${d.launchRecords?.length || 0})</div>
        <div style="overflow-x:auto">
          <table>
            <thead><tr><th>Token</th><th>Platform</th><th>Entry</th><th>Exit</th><th>Date</th></tr></thead>
            <tbody>\${launchRows}</tbody>
          </table>
        </div>\` : ''}
      \${clusterRows ? \`
        <div class="section-title">Cluster Links (\${d.clusterEdges?.length || 0})</div>
        <div style="overflow-x:auto">
          <table>
            <thead><tr><th>Linked Wallet</th><th>Link Type</th><th>Confidence</th></tr></thead>
            <tbody>\${clusterRows}</tbody>
          </table>
        </div>\` : ''}
    \`
  } catch(err) {
    document.getElementById('wm-body').innerHTML = \`<p style="color:var(--accent)">Error: \${err}</p>\`
  }
}

// ── Token detail modal ──────────────────────────────────────────────

async function openTokenDetail(addr) {
  openModal('token-modal')
  document.getElementById('tm-title').textContent = 'Token: ' + abbr(addr)
  document.getElementById('tm-body').innerHTML = '<p style="color:var(--muted)"><span class="spin"></span>Loading…</p>'
  try {
    const r = await fetch('/api/foilops/tokens/' + encodeURIComponent(addr))
    if (!r.ok) {
      const err = await r.json()
      document.getElementById('tm-body').innerHTML = \`<p style="color:var(--accent)">\${err.message}</p>\`
      return
    }
    const d = await r.json()
    // d: { tokenAddress, scores, tokenClassification, creatorHoldPercent, ... , events }
    const s = d.scores || {}

    const metrics = [
      ['Creator Hold %',  d.creatorHoldPercent, false],
      ['Top10 Holder %',  d.top10HolderPercent, false],
      ['Liquidity USD',   d.liquidityUsd, false],
      ['Liq Removal %',   d.liquidityRemovalPercent, true],
      ['Dump Pressure',   s.dumpPressureScore, true],
      ['Holder Risk',     s.walletConcentrationScore, true],
      ['Susp. Links',     d.suspiciousWalletLinks, true],
    ]

    const metricCards = metrics.map(([label, val, isRisk]) => {
      let display = val == null ? '—' : (typeof val === 'number' && val > 1000 ? '$'+val.toLocaleString() : (typeof val === 'number' ? val.toFixed(1) : String(val)))
      if (typeof val === 'number' && String(label).includes('%')) display = val.toFixed(1)+'%'
      const cls = (isRisk && typeof val === 'number' && val != null)
        ? (val>=70?'var(--accent)':val>=40?'var(--risk)':'var(--success)')
        : 'var(--ink)'
      return \`<div class="score-card"><div class="sc-label">\${label}</div><div class="sc-value" style="color:\${cls};font-size:1.1rem">\${display}</div></div>\`
    }).join('')

    const eventRows = (d.events || []).slice(0,20).map(ev => \`
      <tr>
        <td style="color:var(--muted);font-size:.72rem">\${ev.eventType||'—'}</td>
        <td style="font-size:.72rem;font-family:monospace">\${abbr(ev.walletAddress)}</td>
        <td style="color:var(--muted);font-size:.72rem">\${ev.details||'—'}</td>
        <td style="color:var(--muted);font-size:.72rem">\${fmtDate(new Date(ev.timestamp).toISOString())}</td>
      </tr>\`).join('')

    document.getElementById('tm-body').innerHTML = \`
      <div style="display:flex;gap:.8rem;align-items:center;flex-wrap:wrap;margin-bottom:.5rem">
        <div><span style="font-size:.7rem;color:var(--muted)">RISK SCORE</span> \${scoreBadge(s.overallTokenRiskScore, true)}</div>
        <div>\${classBadge(d.tokenClassification)}</div>
      </div>
      <div class="section-title">Risk Metrics</div>
      <div class="score-grid">\${metricCards}</div>
      \${eventRows ? \`
        <div class="section-title">Suspicious Events (\${d.events?.length || 0})</div>
        <div style="overflow-x:auto">
          <table>
            <thead><tr><th>Event</th><th>Actor Wallet</th><th>Details</th><th>Date</th></tr></thead>
            <tbody>\${eventRows}</tbody>
          </table>
        </div>\` : ''}
    \`
  } catch(err) {
    document.getElementById('tm-body').innerHTML = \`<p style="color:var(--accent)">Error: \${err}</p>\`
  }
}

// ── Filters ────────────────────────────────────────────────────────

function applyFilters() {
  const params = {
    limit:         document.getElementById('f-limit').value,
    classification:document.getElementById('f-class').value,
    minOpportunity:document.getElementById('f-min-opp').value,
    maxRisk:       document.getElementById('f-max-risk').value,
  }
  // Only pass non-empty params
  Object.keys(params).forEach(k => { if (!params[k]) delete params[k] })
  loadTopWallets(params)
}

// ── Init ───────────────────────────────────────────────────────────

loadSummary()
loadTopWallets({ limit: 50 })
loadHighRiskWallets()
loadHighRiskTokens()
loadFeed()
</script>
</body>
</html>`
}
