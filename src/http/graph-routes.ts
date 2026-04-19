import type { Express, Request, RequestHandler, Response } from 'express'
import { PublicKey } from '@solana/web3.js'
import { renderFuturisticPage } from '../lib/site-theme'
import { RpcConnectionManager } from '../providers/solana'

const SPL_TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')

type FlowStep = {
  from: string
  to: string
  signature: string
  amount: string
  asset: string
  hop: number
}

type ScamWalletRepositoryLike = {
  getLatestFlowTrace(wallet: string): Promise<{ metadata?: unknown } | null>
}

type WalletClusterServiceLike = {
  getLatestCluster(wallet: string): Promise<{
    clusterScore: number
    riskScore: number
    wallets: string[]
  } | null>
}

export type GraphRouteDeps = {
  scamWalletRepository: ScamWalletRepositoryLike
  walletClusterService: WalletClusterServiceLike
  aiAnalyzer?: {
    analyzeWallet(wallet: string): Promise<string>
  }
  apiAuthMiddleware?: RequestHandler
  pageAuthMiddleware?: RequestHandler
}

function extractFlowSteps(flowMetadata: unknown): FlowStep[] {
  const candidate = flowMetadata as { steps?: FlowStep[] } | undefined
  if (!candidate?.steps || !Array.isArray(candidate.steps)) return []
  return candidate.steps
}

function renderGraphPage(wallet: string) {
  const safeWallet = wallet.replace(/[^A-Za-z0-9_-]/g, '')

  return renderFuturisticPage({
    title: 'FoilOps Wallet Graph',
    activeNav: 'graph',
    headerActionsHtml:
      '<form class="logout-form" method="post" action="/logout"><button class="fx-button" type="submit">Logout</button></form>',
    extraStyles:
      '.wrap { display:grid; gap:16px; } .dot { width:10px; height:10px; border-radius:50%; display:inline-block; margin-right:5px; vertical-align:middle; } svg text { fill: #ffd0d4; font-family: "IBM Plex Mono", monospace; } svg line { stroke: rgba(255,40,60,.30); } .wallet-chip.chip-tracked { border-color: rgba(255, 30, 50, 0.30); background: rgba(255, 30, 50, 0.10); color: #ff9aa3; } .wallet-chip.chip-source { border-color: rgba(200, 0, 20, 0.30); background: rgba(200, 0, 20, 0.10); color: #ff8090; } .wallet-chip.chip-both { border-color: rgba(255, 119, 68, 0.30); background: rgba(255, 119, 68, 0.10); color: #ffcca8; box-shadow: 0 0 0 1px rgba(255, 119, 68, 0.08) inset; } .chip-legend { display:flex; flex-wrap:wrap; gap:10px; margin: 10px 0 0; } .chip-legend-item { display:inline-flex; align-items:center; gap:8px; color:#c9a0a0; font-size:0.82rem; } .chip-legend-item .wallet-chip { cursor:default; }',
    heroHtml: `
      <section class="page-header">
        <div>
          <p class="fx-eyebrow">Relationship analysis</p>
          <h1 class="page-title">Wallet Graph</h1>
          <p class="page-subtitle">Inspect linked wallets, cluster signals, and analyst-side summaries from the protected graph view.</p>
        </div>
        <div class="card" style="min-width:280px">
          <p class="eyebrow">Current query</p>
          <div class="big mono" id="graph-current-query">${safeWallet || 'none'}</div>
          <p>Load any wallet address to pull flow edges, inferred cluster links, and AI wallet analysis into one view.</p>
        </div>
      </section>
    `,
    contentHtml: `
      <div class="wrap">
        <div class="panel">
      <div class="top">
        <input id="wallet" value="${safeWallet}" placeholder="Enter wallet" />
        <button id="load" class="fx-button primary">Load Graph</button>
      </div>
      <div id="followed-wallets" class="wallet-list"></div>
      <div class="chip-legend" aria-label="Followed wallet legend">
        <span class="chip-legend-item"><span class="wallet-chip chip-tracked">Tracked</span><span>Tracked wallet only</span></span>
        <span class="chip-legend-item"><span class="wallet-chip chip-source">Source</span><span>Source watchlist only</span></span>
        <span class="chip-legend-item"><span class="wallet-chip chip-both">Tracked + Source</span><span>Present in both pools</span></span>
      </div>
      <div class="summary-grid" id="graph-summary">
        <article class="summary-tile"><p class="summary-tile-label">Selected Wallet</p><div class="summary-tile-value mono" id="graph-summary-wallet">Waiting for selection</div><p class="summary-tile-copy">The wallet currently loaded into the graph canvas.</p></article>
        <article class="summary-tile"><p class="summary-tile-label">Coverage</p><div class="summary-tile-value" id="graph-summary-coverage">Nodes 0 | Edges 0</div><p class="summary-tile-copy">Flow and cluster breadth currently rendered.</p></article>
        <article class="summary-tile"><p class="summary-tile-label">Cluster Status</p><div class="summary-tile-value" id="graph-summary-cluster">Waiting for graph</div><p class="summary-tile-copy">Quick read of cluster score and risk for the current wallet.</p></article>
        <article class="summary-tile"><p class="summary-tile-label">Analysis</p><div class="summary-tile-value" id="graph-summary-analysis">Idle</div><p class="summary-tile-copy">Analyst-side interpretation from the AI summary endpoint.</p></article>
      </div>
      <div id="meta" class="meta">Loading...</div>
      <div id="analysis-summary" class="analysis-panel">Analysis loading...</div>
      <div id="token-holdings-section" style="display:none">
        <p class="eyebrow" style="margin-top:18px">Token Holdings</p>
        <div id="token-holdings-list" class="meta">Loading tokens...</div>
      </div>
        </div>

        <div class="panel">
          <svg id="graph" viewBox="0 0 900 430" preserveAspectRatio="xMidYMid meet"></svg>
          <div class="legend">
            <span><span class="dot" style="background:#ff7744"></span>Cluster Wallet</span>
            <span><span class="dot" style="background:#ff5a7a"></span>Primary Wallet</span>
            <span><span class="dot" style="background:#cc0820"></span>Related Wallet</span>
          </div>
          <div id="wallet-list" class="wallet-list"></div>
        </div>

        <div id="wallet-popup" class="wallet-popup" role="dialog" aria-modal="false" aria-label="Wallet details">
          <div class="wallet-popup-title">Wallet Address</div>
          <div id="wallet-popup-value" class="wallet-popup-value"></div>
          <div class="wallet-popup-actions">
            <button id="wallet-popup-copy" class="fx-button primary" type="button">Copy Address</button>
            <button id="wallet-popup-analyze" class="fx-button" type="button">Analyze Wallet</button>
            <a id="wallet-popup-solscan" class="fx-button secondary" href="#" target="_blank" rel="noopener noreferrer">Open in Solscan</a>
            <button id="wallet-popup-close" class="fx-button" type="button">Close</button>
          </div>
          <div id="wallet-popup-analysis" class="wallet-popup-analysis">Analysis not loaded.</div>
        </div>
      </div>
    `,
    scriptHtml: `<script>

    const svg = document.getElementById('graph')
    const meta = document.getElementById('meta')
    const walletInput = document.getElementById('wallet')
    const button = document.getElementById('load')
    const walletList = document.getElementById('wallet-list')
    const analysisSummary = document.getElementById('analysis-summary')
    const tokenHoldingsSection = document.getElementById('token-holdings-section')
    const tokenHoldingsList = document.getElementById('token-holdings-list')
    const followedWallets = document.getElementById('followed-wallets')
    const walletPopup = document.getElementById('wallet-popup')
    const walletPopupValue = document.getElementById('wallet-popup-value')
    const walletPopupCopy = document.getElementById('wallet-popup-copy')
    const walletPopupAnalyze = document.getElementById('wallet-popup-analyze')
    const walletPopupClose = document.getElementById('wallet-popup-close')
    const walletPopupSolscan = document.getElementById('wallet-popup-solscan')
    const walletPopupAnalysis = document.getElementById('wallet-popup-analysis')
    const graphCurrentQuery = document.getElementById('graph-current-query')
    const graphSummaryWallet = document.getElementById('graph-summary-wallet')
    const graphSummaryCoverage = document.getElementById('graph-summary-coverage')
    const graphSummaryCluster = document.getElementById('graph-summary-cluster')
    const graphSummaryAnalysis = document.getElementById('graph-summary-analysis')
    let selectedWalletAddress = ''

    function short(value) {
      if (!value || value.length < 10) return value
      return value.slice(0, 5) + '...' + value.slice(-4)
    }

    function setCurrentQuery(wallet) {
      if (!graphCurrentQuery) return
      graphCurrentQuery.textContent = wallet ? wallet : 'none'
    }

    function formatTokenAmount(amount, decimals) {
      if (amount === 0) return '0'
      if (amount < 0.0001) return '<0.0001'
      if (amount >= 1e9) return (amount / 1e9).toFixed(2) + 'B'
      if (amount >= 1e6) return (amount / 1e6).toFixed(2) + 'M'
      if (amount >= 1e3) return (amount / 1e3).toFixed(2) + 'K'
      return amount.toFixed(decimals > 4 ? 4 : decimals)
    }

    async function loadTokenHoldings(wallet) {
      if (!tokenHoldingsSection || !tokenHoldingsList) return
      tokenHoldingsSection.style.display = 'block'
      tokenHoldingsList.textContent = 'Loading tokens...'
      try {
        const res = await fetch('/api/graph/tokens/' + encodeURIComponent(wallet))
        if (!res.ok) {
          tokenHoldingsList.textContent = 'Could not load token holdings.'
          return
        }
        const data = await res.json()
        const tokens = Array.isArray(data.tokens) ? data.tokens : []
        if (tokens.length === 0) {
          tokenHoldingsList.innerHTML = '<span style="color:#8ba4c0">No SPL token balances found.</span>'
          return
        }
        const rows = tokens.map(t => {
          const mintShort = t.mint ? t.mint.slice(0, 6) + '..' + t.mint.slice(-4) : '?'
          const link = 'https://solscan.io/token/' + encodeURIComponent(t.mint || '')
          return '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(100,140,180,0.1)">'
            + '<a href="' + link + '" target="_blank" rel="noopener noreferrer" class="mono" style="color:#81c4ff;font-size:0.82rem;text-decoration:none">' + mintShort + '</a>'
            + '<span class="mono" style="font-size:0.82rem;color:#d7e6ff">' + formatTokenAmount(t.amount, t.decimals) + '</span>'
            + '</div>'
        }).join('')
        tokenHoldingsList.innerHTML = rows
      } catch {
        tokenHoldingsList.textContent = 'Token fetch failed.'
      }
    }

    function clearSvg() {
      while (svg.firstChild) svg.removeChild(svg.firstChild)
    }

    async function copyWalletAddress(address) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(address)
        } else {
          const input = document.createElement('textarea')
          input.value = address
          document.body.appendChild(input)
          input.select()
          document.execCommand('copy')
          document.body.removeChild(input)
        }
        meta.textContent = 'Copied wallet: ' + address
      } catch {
        meta.textContent = 'Could not copy wallet address from browser clipboard.'
      }
    }

    function openWalletPopup(address) {
      selectedWalletAddress = address
      walletPopupValue.textContent = address
      walletPopupSolscan.href = 'https://solscan.io/account/' + encodeURIComponent(address)
      walletPopupAnalysis.textContent = 'Analysis loading...'
      walletPopup.classList.add('active')
      loadWalletAnalysis(address, walletPopupAnalysis)
    }

    function closeWalletPopup() {
      walletPopup.classList.remove('active')
      selectedWalletAddress = ''
    }

    async function loadWalletAnalysis(address, targetElement) {
      if (graphSummaryAnalysis) {
        graphSummaryAnalysis.textContent = 'Loading...'
      }
      try {
        const response = await fetch('/api/graph/analyze/' + encodeURIComponent(address))
        if (!response.ok) {
          targetElement.textContent = 'Analysis unavailable for this wallet right now.'
          if (graphSummaryAnalysis) {
            graphSummaryAnalysis.textContent = 'Unavailable'
          }
          return
        }

        const payload = await response.json()
        targetElement.textContent = payload.analysis || 'No analysis returned.'
        if (graphSummaryAnalysis) {
          graphSummaryAnalysis.textContent = 'Ready'
        }
      } catch {
        targetElement.textContent = 'Analysis request failed.'
        if (graphSummaryAnalysis) {
          graphSummaryAnalysis.textContent = 'Request failed'
        }
      }
    }

    function updateGraphSummary(data) {
      if (graphSummaryWallet) {
        graphSummaryWallet.textContent = data && data.wallet ? short(data.wallet) : 'Waiting for selection'
      }
      if (graphSummaryCoverage) {
        const nodes = Array.isArray(data?.nodes) ? data.nodes.length : 0
        const edges = Array.isArray(data?.edges) ? data.edges.length : 0
        graphSummaryCoverage.textContent = 'Nodes ' + nodes + ' | Edges ' + edges
      }
      if (graphSummaryCluster) {
        graphSummaryCluster.textContent = data?.cluster
          ? 'Score ' + data.cluster.score + ' | Risk ' + data.cluster.riskScore
          : 'No cluster found'
      }
    }

    function renderWalletList(data) {
      walletList.innerHTML = ''

      const sortedNodes = [...(data.nodes || [])].sort((a, b) => {
        if (a.id === data.wallet) return -1
        if (b.id === data.wallet) return 1
        return a.id.localeCompare(b.id)
      })

      sortedNodes.forEach((node) => {
        const chip = document.createElement('button')
        chip.className = 'wallet-chip'
        chip.type = 'button'
        chip.title = 'Click to view/copy full wallet address'
        chip.textContent = (node.id === data.wallet ? '[PRIMARY] ' : '') + node.label
        chip.addEventListener('click', () => openWalletPopup(node.label))
        walletList.appendChild(chip)
      })
    }

    function renderFollowedWallets(wallets) {
      if (!followedWallets) return
      followedWallets.innerHTML = ''

      if (!Array.isArray(wallets) || wallets.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'meta'
        empty.textContent = 'No followed wallets available yet. Add tracked/source wallets to auto-populate this graph view.'
        followedWallets.appendChild(empty)
        return
      }

      wallets.slice(0, 30).forEach((entry) => {
        const wallet = (entry && entry.wallet) ? String(entry.wallet) : ''
        if (!wallet) return
        const sourceList = Array.isArray(entry.sources) ? entry.sources.map((source) => String(source)) : []
        const sources = sourceList.length > 0 ? sourceList.join(' + ') : 'followed'
        const chip = document.createElement('button')
        chip.className = 'wallet-chip'
        if (sourceList.includes('tracked') && sourceList.includes('source')) {
          chip.classList.add('chip-both')
        } else if (sourceList.includes('source')) {
          chip.classList.add('chip-source')
        } else {
          chip.classList.add('chip-tracked')
        }
        chip.type = 'button'
        chip.title = 'Load graph for ' + wallet
        chip.textContent = short(wallet) + ' [' + sources + ']'
        chip.addEventListener('click', () => {
          walletInput.value = wallet
          loadGraph()
        })
        followedWallets.appendChild(chip)
      })
    }

    async function loadFollowedWallets() {
      try {
        const response = await fetch('/api/graph/followed-wallets')
        if (!response.ok) {
          return []
        }
        const payload = await response.json()
        const wallets = Array.isArray(payload.wallets) ? payload.wallets : []
        renderFollowedWallets(wallets)
        return wallets
      } catch {
        return []
      }
    }

    function mk(tag, attrs = {}) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)))
      return el
    }

    function draw(data) {
      clearSvg()
      const cx = 450
      const cy = 215
      const radius = 150
      const nodes = data.nodes || []
      const edges = data.edges || []

      const positions = new Map()
      nodes.forEach((node, idx) => {
        const angle = (Math.PI * 2 * idx) / Math.max(1, nodes.length)
        positions.set(node.id, {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
          node,
        })
      })

      edges.forEach((edge) => {
        const from = positions.get(edge.from)
        const to = positions.get(edge.to)
        if (!from || !to) return
        svg.appendChild(mk('line', {
          x1: from.x,
          y1: from.y,
          x2: to.x,
          y2: to.y,
          stroke: '#d8cbb6',
          'stroke-width': 1.6,
        }))
      })

      nodes.forEach((node) => {
        const point = positions.get(node.id)
        const isPrimary = node.id === data.wallet
        const fill = isPrimary ? '#b14a2c' : node.inCluster ? '#007a6e' : '#7a6f63'

        svg.appendChild(mk('circle', {
          cx: point.x,
          cy: point.y,
          r: isPrimary ? 11 : 8,
          fill,
        }))

        const circle = mk('circle', {
          cx: point.x,
          cy: point.y,
          r: isPrimary ? 15 : 12,
          fill: 'transparent',
          style: 'cursor:pointer;',
        })
        circle.addEventListener('click', () => openWalletPopup(node.label))
        svg.appendChild(circle)

        const label = mk('text', {
          x: point.x,
          y: point.y - 14,
          'text-anchor': 'middle',
          'font-size': 11,
          fill: '#1f1a14',
          style: 'cursor:pointer; user-select:none;',
        })
        label.textContent = short(node.label)
        label.setAttribute('title', 'Click to view/copy wallet address')
        label.addEventListener('click', () => openWalletPopup(node.label))
        svg.appendChild(label)
      })

      if (edges.length === 0) {
        const hint = mk('text', {
          x: cx,
          y: 390,
          'text-anchor': 'middle',
          'font-size': 12,
          fill: '#5f5446',
        })
        hint.textContent =
          nodes.length <= 1
            ? 'No flow/cluster links found yet for this wallet. Try /flag_wallet or /cluster to enrich data.'
            : 'Showing inferred cluster links. No recorded fund-flow edges for this wallet yet.'
        svg.appendChild(hint)
      }
    }

    async function loadGraph() {
      const wallet = walletInput.value.trim()
      if (!wallet) {
        meta.textContent = 'Enter a wallet to load graph.'
        setCurrentQuery('')
        updateGraphSummary(null)
        clearSvg()
        return
      }

      setCurrentQuery(wallet)
      meta.textContent = 'Loading graph...'
      if (graphSummaryWallet) {
        graphSummaryWallet.textContent = short(wallet)
      }
      if (graphSummaryCoverage) {
        graphSummaryCoverage.textContent = 'Loading...'
      }
      if (graphSummaryCluster) {
        graphSummaryCluster.textContent = 'Loading...'
      }
      const res = await fetch('/api/graph/' + encodeURIComponent(wallet))
      if (!res.ok) {
        meta.textContent = 'Failed to load graph data.'
        if (graphSummaryCoverage) {
          graphSummaryCoverage.textContent = 'Load failed'
        }
        if (graphSummaryCluster) {
          graphSummaryCluster.textContent = 'Unavailable'
        }
        clearSvg()
        return
      }

      const data = await res.json()
      const clusterSummary = data.cluster
        ? 'cluster score ' + data.cluster.score + ', risk ' + data.cluster.riskScore
        : 'no cluster found'

      meta.textContent = 'Nodes: ' + data.nodes.length + ' | Edges: ' + data.edges.length + ' | ' + clusterSummary
  updateGraphSummary(data)
      draw(data)
      renderWalletList(data)
      analysisSummary.textContent = 'Analysis loading...'
      loadWalletAnalysis(wallet, analysisSummary)
      loadTokenHoldings(wallet)
      history.replaceState({}, '', '/graph/' + encodeURIComponent(wallet))
    }

    button.addEventListener('click', loadGraph)
    walletPopupCopy.addEventListener('click', () => {
      if (selectedWalletAddress) {
        copyWalletAddress(selectedWalletAddress)
      }
    })
    walletPopupAnalyze.addEventListener('click', () => {
      if (selectedWalletAddress) {
        walletPopupAnalysis.textContent = 'Analysis loading...'
        loadWalletAnalysis(selectedWalletAddress, walletPopupAnalysis)
      }
    })
    walletPopupClose.addEventListener('click', closeWalletPopup)
    walletInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadGraph()
    })
    ;(async function bootstrap() {
      const followed = await loadFollowedWallets()
      if (!walletInput.value.trim() && followed.length > 0 && followed[0] && followed[0].wallet) {
        walletInput.value = String(followed[0].wallet)
      }
      setCurrentQuery(walletInput.value.trim())
      loadGraph()
    })()
  </script>`,
  })
}

export function registerGraphRoutes(app: Express, deps: GraphRouteDeps) {
  const apiAuthMiddleware = deps.apiAuthMiddleware || ((_req, _res, next) => next())
  const pageAuthMiddleware = deps.pageAuthMiddleware || ((_req, _res, next) => next())

  app.get('/api/graph/:wallet', apiAuthMiddleware, async (req: Request, res: Response) => {
    try {
      const wallet = req.params.wallet
      const latestFlow = await deps.scamWalletRepository.getLatestFlowTrace(wallet)
      const cluster = await deps.walletClusterService.getLatestCluster(wallet)

      const steps = extractFlowSteps(latestFlow?.metadata)
      const nodeSet = new Set<string>([wallet])
      const edges = steps.map((step) => {
        nodeSet.add(step.from)
        nodeSet.add(step.to)
        return {
          from: step.from,
          to: step.to,
          label: `${step.amount} ${step.asset}`,
          signature: step.signature,
          hop: step.hop,
        }
      })

      const clusterWallets = Array.isArray(cluster?.wallets) ? cluster.wallets : []
      for (const clusterWallet of clusterWallets) {
        nodeSet.add(clusterWallet)
      }

      if (edges.length === 0) {
        for (const clusterWallet of clusterWallets) {
          if (clusterWallet === wallet) continue
          edges.push({
            from: wallet,
            to: clusterWallet,
            label: 'cluster-link',
            signature: 'cluster-link',
            hop: 0,
          })
        }
      }

      const nodes = Array.from(nodeSet).map((address) => ({
        id: address,
        label: address,
        inCluster: clusterWallets.includes(address),
      }))

      res.status(200).json({
        wallet,
        nodes,
        edges,
        cluster: cluster
          ? {
              score: cluster.clusterScore,
              riskScore: cluster.riskScore,
              wallets: cluster.wallets,
            }
          : null,
      })
    } catch (error) {
      console.error('Graph API error', error)
      res.status(500).json({ message: 'Failed to build graph data' })
    }
  })

  app.get('/api/graph/tokens/:wallet', apiAuthMiddleware, async (req: Request, res: Response) => {
    try {
      const wallet = req.params.wallet
      if (!wallet || wallet.length < 32) {
        res.status(400).json({ message: 'Invalid wallet address' })
        return
      }
      const connection = RpcConnectionManager.getRandomConnection()
      const pubkey = new PublicKey(wallet)
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, { programId: SPL_TOKEN_PROGRAM_ID })
      const tokens = tokenAccounts.value
        .map((account) => {
          const info = (
            account.account.data as {
              parsed?: { info?: { mint?: string; tokenAmount?: { uiAmount?: number; decimals?: number } } }
            }
          ).parsed?.info
          if (!info) return null
          const amount = info.tokenAmount?.uiAmount ?? 0
          const decimals = info.tokenAmount?.decimals ?? 0
          return { mint: info.mint, amount, decimals }
        })
        .filter((t): t is { mint: string | undefined; amount: number; decimals: number } => t !== null && t.amount > 0)
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 50)
      res.status(200).json({ wallet, tokens })
    } catch (error) {
      console.error('Token holdings error', error)
      res.status(500).json({ message: 'Failed to fetch token accounts' })
    }
  })

  app.get('/api/graph/analyze/:wallet', apiAuthMiddleware, async (req: Request, res: Response) => {
    try {
      const wallet = req.params.wallet
      if (!deps.aiAnalyzer) {
        res.status(200).json({
          wallet,
          analysis: 'Analyzer is not configured for graph mode.',
        })
        return
      }

      const analysis = await deps.aiAnalyzer.analyzeWallet(wallet)
      res.status(200).json({ wallet, analysis })
    } catch (error) {
      console.error('Graph analyze API error', error)
      res.status(500).json({ message: 'Failed to analyze wallet for graph view' })
    }
  })

  app.get('/graph/:wallet?', pageAuthMiddleware, (req: Request, res: Response) => {
    const wallet = (req.params.wallet || '').trim()
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.status(200).send(renderGraphPage(wallet))
  })
}
