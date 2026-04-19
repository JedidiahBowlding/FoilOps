// ─── FoilOps Intelligence API Routes ──────────────────────────────────────────
// Exposes the launch intelligence engine over HTTP.
// All routes are secured by the dashboard auth middleware.

import type { Express, Request, RequestHandler, Response } from 'express'
import { scoreWallet, WalletScoringInput } from '../services/walletScoringService'
import { scoreToken, TokenScoringInput } from '../services/tokenRiskService'
import { analyseWalletCluster, CandidateWalletData } from '../services/clusterAnalysisService'
import {
  buildWalletSummaryPayload,
  buildWalletDetailPage,
  buildTokenSummaryPayload,
  buildTokenDetailPage,
} from '../services/summaryPayloadService'
import { ClusterAnalysisResult } from '../types/cluster'
import { LaunchParticipationRecord } from '../types/wallet'
import { SuspiciousTokenEvent } from '../types/token'
import { tracingRules } from '../config/foilOpsConfig'
import { walletOpportunityTier, walletRiskTier } from '../utils/thresholds'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function safeAddress(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  // Accept Solana base58 (32–44 chars) or EVM addresses
  if (!/^[A-Za-z0-9:_-]{32,66}$/.test(trimmed)) return null
  return trimmed
}

// ─── Route registration ────────────────────────────────────────────────────────

export type FoilOpsRouteDeps = {
  requireApiAuth: RequestHandler
  requirePageAuth: RequestHandler
}

export function registerFoilOpsRoutes(app: Express, deps: FoilOpsRouteDeps): void {
  const { requireApiAuth, requirePageAuth } = deps

  // ─── GET /api/foilops/wallets/top ─────────────────────────────────────────
  // Returns the top N wallets by opportunity score, given a simple scoring pass
  // over a caller-supplied list of candidate inputs.
  // In a future pass this will be backed by the WalletProfileSnapshot table.
  app.get('/api/foilops/wallets/top', requireApiAuth, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || tracingRules.feedTopWalletCount))
      const classificationFilter = typeof req.query.classification === 'string' ? req.query.classification : undefined

      // For the first pass: caller provides a JSON body list of scoring inputs via query
      // (or we return an empty result — the table will be populated by the scoring cron).
      res.status(200).json({
        note: 'Wallet feed will be populated by the scoring pipeline. No snapshots stored yet.',
        limit,
        classificationFilter: classificationFilter ?? null,
        wallets: [],
      })
    } catch (error) {
      console.error('[FoilOps] /api/foilops/wallets/top error', error)
      res.status(500).json({ message: 'Failed to fetch top wallets' })
    }
  })

  // ─── POST /api/foilops/wallets/score ─────────────────────────────────────
  // On-demand score computation for a single wallet.
  // Caller provides the full WalletScoringInput as the request body.
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

      res.status(200).json({ profile, summary })
    } catch (error) {
      console.error('[FoilOps] /api/foilops/wallets/score error', error)
      res.status(500).json({ message: 'Failed to score wallet' })
    }
  })

  // ─── GET /api/foilops/wallets/:address ────────────────────────────────────
  // Returns a scored wallet detail page.
  // In future: backed by WalletProfileSnapshot + LaunchParticipationRecord table.
  app.get('/api/foilops/wallets/:address', requireApiAuth, async (req: Request, res: Response) => {
    try {
      const addr = safeAddress(req.params.address)
      if (!addr) {
        res.status(400).json({ message: 'Invalid wallet address format' })
        return
      }

      // First pass: return an empty scaffold. Populated by the scoring pipeline.
      res.status(200).json({
        wallet: addr,
        note: 'Wallet profile not yet scored. Submit via POST /api/foilops/wallets/score.',
        profile: null,
        recentLaunches: [],
        entryTimingAvgSeconds: 0,
        exitTimingAvgSeconds: 0,
        connectedClusterWallets: [],
        riskTags: [],
      })
    } catch (error) {
      console.error('[FoilOps] /api/foilops/wallets/:address error', error)
      res.status(500).json({ message: 'Failed to fetch wallet detail' })
    }
  })

  // ─── POST /api/foilops/tokens/score ──────────────────────────────────────
  // On-demand token risk score computation.
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

      // First pass: scaffold only. Will be backed by TokenRiskSnapshot table.
      res.status(200).json({
        tokenAddress: addr,
        note: 'Token not yet scored. Submit via POST /api/foilops/tokens/score.',
        riskProfile: null,
        linkedSuspiciousWallets: [],
        suspiciousEvents: [],
      })
    } catch (error) {
      console.error('[FoilOps] /api/foilops/tokens/:address error', error)
      res.status(500).json({ message: 'Failed to fetch token detail' })
    }
  })

  // ─── POST /api/foilops/cluster ────────────────────────────────────────────
  // On-demand cluster analysis for a target wallet against a candidate set.
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
      res.status(200).json(result)
    } catch (error) {
      console.error('[FoilOps] /api/foilops/cluster error', error)
      res.status(500).json({ message: 'Failed to run cluster analysis' })
    }
  })

  // ─── GET /api/foilops/cluster/:address ───────────────────────────────────
  // Returns the most recent cluster edges for a given wallet (from DB snapshot).
  // First pass: returns empty scaffold.
  app.get('/api/foilops/cluster/:address', requireApiAuth, async (req: Request, res: Response) => {
    try {
      const addr = safeAddress(req.params.address)
      if (!addr) {
        res.status(400).json({ message: 'Invalid wallet address format' })
        return
      }

      res.status(200).json({
        wallet: addr,
        note: 'Cluster edges will be populated by the scoring pipeline.',
        links: [],
        reachableWallets: [],
        clusterSuspicionScore: 0,
      })
    } catch (error) {
      console.error('[FoilOps] /api/foilops/cluster/:address error', error)
      res.status(500).json({ message: 'Failed to fetch cluster graph' })
    }
  })

  // ─── GET /api/foilops/feed/launches ──────────────────────────────────────
  // Returns the most recent launch events across all tracked tokens.
  // First pass: returns empty scaffold.
  app.get('/api/foilops/feed/launches', requireApiAuth, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || tracingRules.feedLaunchCount))
      res.status(200).json({
        note: 'Launch feed will be populated by the token discovery pipeline.',
        limit,
        launches: [],
      })
    } catch (error) {
      console.error('[FoilOps] /api/foilops/feed/launches error', error)
      res.status(500).json({ message: 'Failed to fetch launch feed' })
    }
  })

  // ─── GET /dashboard/foilops ───────────────────────────────────────────────
  // The FoilOps launch intelligence dashboard page (HTML).
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
      --bg: #0a0e27;
      --panel: rgba(15, 20, 45, 0.85);
      --ink: #e8ecff;
      --muted: #7a84a0;
      --accent: #ff2d2d;
      --accent2: #4d7cff;
      --border: rgba(255,45,45,0.18);
      --success: #00e676;
      --warning: #ffb300;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--ink);
      font-family: 'Inter', system-ui, sans-serif;
      min-height: 100vh;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 2rem;
      background: var(--panel);
      border-bottom: 1px solid var(--border);
    }
    .topbar h1 { font-size: 1.2rem; font-weight: 700; letter-spacing: .05em; color: var(--accent); }
    .topbar nav a {
      color: var(--muted);
      text-decoration: none;
      margin-left: 1.5rem;
      font-size: .875rem;
      transition: color .15s;
    }
    .topbar nav a:hover { color: var(--ink); }
    .hero {
      max-width: 860px;
      margin: 4rem auto;
      padding: 0 1.5rem;
      text-align: center;
    }
    .hero h2 { font-size: 2rem; font-weight: 800; margin-bottom: .75rem; }
    .hero p { color: var(--muted); line-height: 1.6; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 1rem;
      max-width: 1100px;
      margin: 2.5rem auto;
      padding: 0 1.5rem;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.4rem;
    }
    .card h3 { font-size: .95rem; font-weight: 600; margin-bottom: .5rem; color: var(--accent2); }
    .card p { font-size: .8rem; color: var(--muted); line-height: 1.5; }
    .card a {
      display: inline-block;
      margin-top: .75rem;
      font-size: .78rem;
      color: var(--accent);
      text-decoration: none;
      border: 1px solid var(--accent);
      padding: .3rem .7rem;
      border-radius: 6px;
      transition: background .15s;
    }
    .card a:hover { background: rgba(255,45,45,.1); }
    .section-label {
      max-width: 1100px;
      margin: 2rem auto .5rem;
      padding: 0 1.5rem;
      font-size: .75rem;
      font-weight: 700;
      letter-spacing: .1em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .search-bar {
      max-width: 600px;
      margin: 2rem auto;
      padding: 0 1.5rem;
      display: flex;
      gap: .5rem;
    }
    .search-bar input {
      flex: 1;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: .6rem 1rem;
      color: var(--ink);
      font-size: .875rem;
      outline: none;
    }
    .search-bar input:focus { border-color: var(--accent2); }
    .search-bar button {
      background: var(--accent);
      border: none;
      border-radius: 8px;
      padding: .6rem 1.2rem;
      color: #fff;
      font-weight: 600;
      cursor: pointer;
      font-size: .875rem;
    }
    #result-panel {
      max-width: 860px;
      margin: 0 auto 2rem;
      padding: 0 1.5rem;
      font-size: .8rem;
      color: var(--muted);
      white-space: pre-wrap;
      word-break: break-all;
    }
  </style>
</head>
<body>
  <div class="topbar">
    <h1>FOILOPS — Launch Intelligence</h1>
    <nav>
      <a href="/dashboard/trading-ops">Trading Ops</a>
      <a href="/dashboard/scam-wallets">Scam Intel</a>
      <a href="/dashboard/foilops">Intelligence</a>
      <a href="/logout">Logout</a>
    </nav>
  </div>

  <div class="hero">
    <h2>Launch Intelligence Engine</h2>
    <p>Score wallets, classify token launches, detect clusters, and surface opportunity signals — all in real time.</p>
  </div>

  <div class="search-bar">
    <input id="addr-input" type="text" placeholder="Enter wallet or token address…" />
    <button onclick="scoreAddress()">Score</button>
  </div>
  <pre id="result-panel">Output will appear here.</pre>

  <div class="section-label">API Endpoints</div>
  <div class="grid">
    <div class="card">
      <h3>Wallet Scorer</h3>
      <p>Submit a wallet with on-chain evidence to get opportunity + risk scores, classification, and tags.</p>
      <a href="#" onclick="copyEndpoint('/api/foilops/wallets/score')">POST /api/foilops/wallets/score</a>
    </div>
    <div class="card">
      <h3>Token Risk Scorer</h3>
      <p>Submit a token with holder + liquidity data to get a risk score and classification.</p>
      <a href="#" onclick="copyEndpoint('/api/foilops/tokens/score')">POST /api/foilops/tokens/score</a>
    </div>
    <div class="card">
      <h3>Cluster Analysis</h3>
      <p>Run wallet cluster detection against a candidate set to surface co-launch and funding relationships.</p>
      <a href="#" onclick="copyEndpoint('/api/foilops/cluster')">POST /api/foilops/cluster</a>
    </div>
    <div class="card">
      <h3>Top Wallets Feed</h3>
      <p>Retrieve the highest-scoring wallets from the scoring pipeline snapshot.</p>
      <a href="/api/foilops/wallets/top">GET /api/foilops/wallets/top</a>
    </div>
    <div class="card">
      <h3>Launch Feed</h3>
      <p>Recent token launch events across all monitored programs.</p>
      <a href="/api/foilops/feed/launches">GET /api/foilops/feed/launches</a>
    </div>
    <div class="card">
      <h3>Cluster Graph</h3>
      <p>Retrieve stored cluster edges for a specific wallet address.</p>
      <a href="#" onclick="copyEndpoint('/api/foilops/cluster/{address}')">GET /api/foilops/cluster/:address</a>
    </div>
  </div>

  <script>
    async function scoreAddress() {
      const addr = document.getElementById('addr-input').value.trim()
      if (!addr) return
      const panel = document.getElementById('result-panel')
      panel.textContent = 'Fetching…'
      try {
        // Try wallet detail first, then token detail
        const r = await fetch('/api/foilops/wallets/' + encodeURIComponent(addr))
        if (r.ok) {
          panel.textContent = JSON.stringify(await r.json(), null, 2)
        } else {
          const tr = await fetch('/api/foilops/tokens/' + encodeURIComponent(addr))
          panel.textContent = JSON.stringify(await tr.json(), null, 2)
        }
      } catch (e) {
        panel.textContent = 'Error: ' + String(e)
      }
    }

    function copyEndpoint(path) {
      navigator.clipboard?.writeText(window.location.origin + path)
        .then(() => alert('Endpoint copied: ' + path))
        .catch(() => alert('Endpoint: ' + path))
      return false
    }

    document.getElementById('addr-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') scoreAddress()
    })
  </script>
</body>
</html>`
}
