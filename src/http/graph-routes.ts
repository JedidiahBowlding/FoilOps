import type { Express, Request, Response } from 'express'

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

    .meta {
      color: var(--muted);
      font-size: 13px;
      margin-top: 8px;
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

    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
      margin-right: 5px;
      vertical-align: middle;
    }

    @media (max-width: 720px) {
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
    <div class="panel">
      <div class="top">
        <input id="wallet" value="${safeWallet}" placeholder="Enter wallet" />
        <button id="load">Load Graph</button>
      </div>
      <div id="meta" class="meta">Loading...</div>
    </div>

    <div class="panel">
      <svg id="graph" viewBox="0 0 900 430" preserveAspectRatio="xMidYMid meet"></svg>
      <div class="legend">
        <span><span class="dot" style="background:#007a6e"></span>Cluster Wallet</span>
        <span><span class="dot" style="background:#b14a2c"></span>Primary Wallet</span>
        <span><span class="dot" style="background:#7a6f63"></span>Related Wallet</span>
      </div>
    </div>
  </div>

  <script>
    const svg = document.getElementById('graph')
    const meta = document.getElementById('meta')
    const walletInput = document.getElementById('wallet')
    const button = document.getElementById('load')

    function short(value) {
      if (!value || value.length < 10) return value
      return value.slice(0, 5) + '...' + value.slice(-4)
    }

    function clearSvg() {
      while (svg.firstChild) svg.removeChild(svg.firstChild)
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

        const label = mk('text', {
          x: point.x,
          y: point.y - 14,
          'text-anchor': 'middle',
          'font-size': 11,
          fill: '#1f1a14',
        })
        label.textContent = short(node.label)
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
      history.replaceState({}, '', '/graph/' + encodeURIComponent(wallet))
    }

    button.addEventListener('click', loadGraph)
    walletInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadGraph()
    })
    loadGraph()
  </script>
</body>
</html>`
}

export function registerGraphRoutes(app: Express, deps: GraphRouteDeps) {
  app.get('/api/graph/:wallet', async (req: Request, res: Response) => {
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

  app.get('/graph/:wallet?', (req: Request, res: Response) => {
    const wallet = (req.params.wallet || '').trim()
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.status(200).send(renderGraphPage(wallet))
  })
}
