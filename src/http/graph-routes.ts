import type { Express, Request, RequestHandler, Response } from 'express'

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

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Wallet Graph</title>
  <style>
    :root {
      --bg: #f6efe4;
      --panel: #fffaf2;
      --ink: #1f1a14;
      --muted: #5f5446;
      --accent: #007a6e;
      --accent-2: #b14a2c;
      --line: #d8cbb6;
    }

    body {
      margin: 0;
      font-family: "Avenir Next", "Segoe UI", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(1200px 800px at 5% -10%, #f8d9b8 0%, transparent 55%),
        radial-gradient(1000px 700px at 95% 10%, #d3efe7 0%, transparent 55%),
        var(--bg);
    }

    .wrap {
      max-width: 980px;
      margin: 0 auto;
      padding: 20px;
    }

    .page-header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      margin-bottom: 14px;
    }

    .page-title {
      margin: 0;
      font-size: clamp(1.5rem, 3vw, 2.2rem);
    }

    .page-subtitle {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 14px;
    }

    .logout-form {
      margin: 0;
    }

    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 14px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.06);
      padding: 16px;
      margin-bottom: 14px;
    }

    .top {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }

    input {
      flex: 1;
      min-width: 280px;
      font-size: 14px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }

    button {
      border: 0;
      border-radius: 8px;
      background: var(--accent);
      color: #fff;
      padding: 10px 14px;
      font-weight: 700;
      cursor: pointer;
    }

    .logout-button {
      background: var(--panel);
      color: var(--ink);
      border: 1px solid var(--line);
    }

    .meta {
      color: var(--muted);
      font-size: 13px;
      margin-top: 8px;
    }

    .analysis-panel {
      margin-top: 10px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fff;
      padding: 10px;
      font-family: Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      max-height: 180px;
      overflow-y: auto;
    }

    svg {
      width: 100%;
      height: 430px;
      border-radius: 10px;
      border: 1px solid var(--line);
      background: #fff;
    }

    .legend {
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
      font-size: 12px;
      color: var(--muted);
      margin-top: 8px;
    }

    .wallet-list {
      margin-top: 12px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 8px;
    }

    .wallet-chip {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      color: var(--ink);
      text-align: left;
      font-size: 12px;
      padding: 8px 10px;
      cursor: pointer;
      font-family: Menlo, Monaco, Consolas, monospace;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
      line-height: 1.4;
      max-width: 100%;
    }

    .wallet-chip:hover {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px rgba(0, 122, 110, 0.12);
    }

    .wallet-popup {
      position: fixed;
      right: 14px;
      bottom: 14px;
      width: min(420px, calc(100vw - 28px));
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 12px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.16);
      padding: 12px;
      z-index: 20;
      display: none;
    }

    .wallet-popup.active {
      display: block;
    }

    .wallet-popup-title {
      font-weight: 700;
      font-size: 13px;
      margin-bottom: 8px;
    }

    .wallet-popup-value {
      font-family: Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      background: #fbf7f0;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px;
      overflow-wrap: anywhere;
      word-break: break-word;
      margin-bottom: 10px;
    }

    .wallet-popup-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .wallet-popup-analysis {
      margin-top: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fbf7f0;
      padding: 8px;
      font-family: Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      max-height: 160px;
      overflow-y: auto;
    }

    .wallet-popup-actions button,
    .wallet-popup-actions a {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      color: var(--ink);
      padding: 7px 10px;
      font-size: 12px;
      text-decoration: none;
      cursor: pointer;
    }

    .wallet-popup-actions button.primary {
      border: 0;
      background: var(--accent);
      color: #fff;
      font-weight: 700;
    }

    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
      margin-right: 5px;
      vertical-align: middle;
    }

    @media (max-width: 720px) {
      .page-header {
        flex-direction: column;
        align-items: flex-start;
      }
      svg {
        height: 360px;
      }
      .wrap {
        padding: 12px;
      }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="page-header">
      <div>
        <h1 class="page-title">Wallet Graph</h1>
        <p class="page-subtitle">Inspect linked wallets, cluster signals, and AI analysis from the protected graph view.</p>
      </div>
      <form class="logout-form" method="post" action="/logout">
        <button class="logout-button" type="submit">Logout</button>
      </form>
    </div>
    <div class="panel">
      <div class="top">
        <input id="wallet" value="${safeWallet}" placeholder="Enter wallet" />
        <button id="load">Load Graph</button>
      </div>
      <div id="meta" class="meta">Loading...</div>
      <div id="analysis-summary" class="analysis-panel">Analysis loading...</div>
    </div>

    <div class="panel">
      <svg id="graph" viewBox="0 0 900 430" preserveAspectRatio="xMidYMid meet"></svg>
      <div class="legend">
        <span><span class="dot" style="background:#007a6e"></span>Cluster Wallet</span>
        <span><span class="dot" style="background:#b14a2c"></span>Primary Wallet</span>
        <span><span class="dot" style="background:#7a6f63"></span>Related Wallet</span>
      </div>
      <div id="wallet-list" class="wallet-list"></div>
    </div>

    <div id="wallet-popup" class="wallet-popup" role="dialog" aria-modal="false" aria-label="Wallet details">
      <div class="wallet-popup-title">Wallet Address</div>
      <div id="wallet-popup-value" class="wallet-popup-value"></div>
      <div class="wallet-popup-actions">
        <button id="wallet-popup-copy" class="primary" type="button">Copy Address</button>
        <button id="wallet-popup-analyze" type="button">Analyze Wallet</button>
        <a id="wallet-popup-solscan" href="#" target="_blank" rel="noopener noreferrer">Open in Solscan</a>
        <button id="wallet-popup-close" type="button">Close</button>
      </div>
      <div id="wallet-popup-analysis" class="wallet-popup-analysis">Analysis not loaded.</div>
    </div>
  </div>

  <script>
    const svg = document.getElementById('graph')
    const meta = document.getElementById('meta')
    const walletInput = document.getElementById('wallet')
    const button = document.getElementById('load')
    const walletList = document.getElementById('wallet-list')
    const analysisSummary = document.getElementById('analysis-summary')
    const walletPopup = document.getElementById('wallet-popup')
    const walletPopupValue = document.getElementById('wallet-popup-value')
    const walletPopupCopy = document.getElementById('wallet-popup-copy')
    const walletPopupAnalyze = document.getElementById('wallet-popup-analyze')
    const walletPopupClose = document.getElementById('wallet-popup-close')
    const walletPopupSolscan = document.getElementById('wallet-popup-solscan')
    const walletPopupAnalysis = document.getElementById('wallet-popup-analysis')
    let selectedWalletAddress = ''

    function short(value) {
      if (!value || value.length < 10) return value
      return value.slice(0, 5) + '...' + value.slice(-4)
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
      try {
        const response = await fetch('/api/graph/analyze/' + encodeURIComponent(address))
        if (!response.ok) {
          targetElement.textContent = 'Analysis unavailable for this wallet right now.'
          return
        }

        const payload = await response.json()
        targetElement.textContent = payload.analysis || 'No analysis returned.'
      } catch {
        targetElement.textContent = 'Analysis request failed.'
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
        clearSvg()
        return
      }

      meta.textContent = 'Loading graph...'
      const res = await fetch('/api/graph/' + encodeURIComponent(wallet))
      if (!res.ok) {
        meta.textContent = 'Failed to load graph data.'
        clearSvg()
        return
      }

      const data = await res.json()
      const clusterSummary = data.cluster
        ? 'cluster score ' + data.cluster.score + ', risk ' + data.cluster.riskScore
        : 'no cluster found'

      meta.textContent = 'Nodes: ' + data.nodes.length + ' | Edges: ' + data.edges.length + ' | ' + clusterSummary
      draw(data)
      renderWalletList(data)
      analysisSummary.textContent = 'Analysis loading...'
      loadWalletAnalysis(wallet, analysisSummary)
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
    loadGraph()
  </script>
</body>
</html>`
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
