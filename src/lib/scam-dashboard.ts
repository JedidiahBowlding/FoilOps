import { PrismaScamWalletRepository } from '../repositories/prisma/scam-wallet'
import { renderFuturisticPage } from './site-theme'

export class ScamDashboard {
  private scamWalletRepository: PrismaScamWalletRepository

  constructor() {
    this.scamWalletRepository = new PrismaScamWalletRepository()
  }

  async getDashboardData() {
    const [wallets, tokenInvestigations] = await Promise.all([
      this.scamWalletRepository.getDashboardRows(),
      this.scamWalletRepository.getTokenInvestigationRows(),
    ])

    return {
      wallets,
      tokenInvestigations,
    }
  }

  async renderHtmlDashboard() {
    const { wallets, tokenInvestigations } = await this.getDashboardData()
    const highRisk = wallets.filter((wallet) => wallet.riskScore >= 70).length
    const mediumRisk = wallets.filter((wallet) => wallet.riskScore >= 40 && wallet.riskScore < 70).length
    const lowRisk = Math.max(0, wallets.length - highRisk - mediumRisk)
    const riskTotal = Math.max(1, wallets.length)
    const highRiskEnd = (highRisk / riskTotal) * 100
    const mediumRiskEnd = highRiskEnd + (mediumRisk / riskTotal) * 100
    const averageRisk = wallets.length
      ? Math.round(wallets.reduce((total, wallet) => total + wallet.riskScore, 0) / wallets.length)
      : 0
    const riskiestWallets = [...wallets].sort((a, b) => b.riskScore - a.riskScore).slice(0, 6)

    const cards = wallets
      .map((row) => {
        const launches = row.launches
          .slice(0, 5)
          .map(
            (launch) => `
              <li>
                <span class="token">${launch.tokenMint || 'unknown token'}</span>
                <span class="meta">risk ${launch.riskScoreSnapshot}/100 • ${launch.createdAt.toISOString()}</span>
              </li>
            `,
          )
          .join('')

        const priorTokens = row.priorTokenMints.length > 0 ? row.priorTokenMints.join(', ') : 'none recorded'
        const flowSteps =
          row.flowMap && typeof row.flowMap === 'object' && 'steps' in row.flowMap
            ? (
                row.flowMap as {
                  steps?: Array<{ hop: number; from: string; to: string; amount: string; asset: string }>
                }
              ).steps || []
            : []

        const flowList = flowSteps
          .slice(0, 6)
          .map(
            (step) =>
              `<li><span class="token">Hop ${step.hop}</span> ${step.from} → ${step.to} <span class="meta">${step.amount} ${step.asset}</span></li>`,
          )
          .join('')

        return `
          <article class="card ${row.isFlagged ? 'flagged' : 'unflagged'}">
            <header>
              <h3>${row.address}</h3>
              <span class="risk">${row.riskLevel} (${row.riskScore})</span>
            </header>
            <p><strong>Status:</strong> ${row.isFlagged ? 'Flagged' : 'Unflagged'} • <strong>Source:</strong> ${row.source}</p>
            <p><strong>Reason:</strong> ${row.reason}</p>
            <p><strong>Prior tokens:</strong> ${priorTokens}</p>
            <p><strong>Recent suspicious launches:</strong></p>
            <ul>${launches || '<li>None yet</li>'}</ul>
            <p><strong>Flow map (latest trace):</strong></p>
            <ul>${flowList || '<li>No traced flow steps yet</li>'}</ul>
          </article>
        `
      })
      .join('')

    const tokenInvestigationCards = tokenInvestigations
      .map(
        (item) => `
          <article class="card investigation-card">
            <header>
              <h3>${item.tokenMint}</h3>
              <span class="risk">risk ${item.riskScoreSnapshot}</span>
            </header>
            <p><strong>Developer wallet:</strong> ${item.developerWallet}</p>
            <p><strong>Resolution source:</strong> ${item.developerResolutionSource}</p>
            <p><strong>Related tokens:</strong> ${item.relatedTokens.length > 0 ? item.relatedTokens.join(', ') : 'none recorded'}</p>
            <p><strong>Investigated at:</strong> ${item.createdAt.toISOString()}</p>
          </article>
        `,
      )
      .join('')

    return renderFuturisticPage({
      title: 'FoilOps Scam Intelligence',
      activeNav: 'scam',
      headerActionsHtml:
        '<form class="logout-form" method="post" action="/logout"><button class="fx-button" type="submit">Logout</button></form>',
      heroHtml: `
        <section class="topbar">
          <div class="topbar-copy">
            <p class="fx-eyebrow">Investigation and persistence layer</p>
            <h1>Scam Intelligence Dashboard</h1>
            <p class="fx-lead">Flagged wallet histories, suspicious launch correlation, developer-wallet investigations, and reusable fund-flow context for repeated scam patterns.</p>
          </div>
          <div class="card" style="min-width:280px">
            <p class="eyebrow">Coverage</p>
            <div class="big">${wallets.length}</div>
            <p>Flagged or monitored wallet records with ${tokenInvestigations.length} stored token investigations.</p>
          </div>
        </section>
      `,
      extraStyles:
        '.control-form { grid-template-columns:minmax(0,1fr) auto; align-items:end; } .card.flagged { border-color: rgba(251,113,133,.36); } .card.unflagged { border-color: rgba(52,211,153,.2); } .investigation-card { border-color: rgba(139,92,246,.28); } .risk-donut { background:conic-gradient(var(--fx-danger) 0 var(--p1),var(--fx-secondary) var(--p1) var(--p2),var(--fx-success) var(--p2) 100%); } .legend-row{display:flex;justify-content:space-between;gap:10px;color:var(--fx-muted)} .legend-row span{display:flex;align-items:center;gap:9px}.legend-row i{width:10px;height:10px;border-radius:50%;background:var(--dot);box-shadow:0 0 12px var(--dot)} .risk-fill{background:linear-gradient(90deg,var(--fx-warning),var(--fx-danger));} @media (max-width: 720px) { .control-form { grid-template-columns:1fr; } }',
      contentHtml: `
        <section class="viz-grid">
          <article class="card viz-card">
            <div class="viz-head"><div><p class="eyebrow">Threat posture</p><h2 class="viz-title">Risk distribution</h2><p class="viz-caption">Monitored wallets grouped by their current risk score.</p></div><span class="badge">Avg ${averageRisk}</span></div>
            <div class="donut-wrap">
              <div class="donut risk-donut" style="--p1:${highRiskEnd.toFixed(2)}%;--p2:${mediumRiskEnd.toFixed(2)}%"><div class="donut-label">${highRisk}<small>high risk</small></div></div>
              <div class="bar-list">
                <div class="legend-row"><span><i style="--dot:var(--fx-danger)"></i>High · 70–100</span><strong>${highRisk}</strong></div>
                <div class="legend-row"><span><i style="--dot:var(--fx-secondary)"></i>Medium · 40–69</span><strong>${mediumRisk}</strong></div>
                <div class="legend-row"><span><i style="--dot:var(--fx-success)"></i>Low · 0–39</span><strong>${lowRisk}</strong></div>
              </div>
            </div>
          </article>
          <article class="card viz-card">
            <div class="viz-head"><div><p class="eyebrow">Priority queue</p><h2 class="viz-title">Highest-risk wallets</h2><p class="viz-caption">The records that deserve analyst attention first.</p></div><span class="badge">${wallets.length} watched</span></div>
            <div class="bar-list">
              ${riskiestWallets.map((wallet) => `<div class="bar-row"><div class="bar-meta"><span class="mono">${wallet.address.slice(0, 8)}…${wallet.address.slice(-4)}</span><strong>${wallet.riskScore}</strong></div><div class="bar-track"><span class="bar-fill risk-fill" style="--value:${Math.max(0, Math.min(100, wallet.riskScore))}%"></span></div></div>`).join('') || '<div class="empty-state"><strong>No monitored wallets</strong><span>Flagged records will appear here.</span></div>'}
            </div>
          </article>
        </section>
        <section class="section panel">
          <div class="section-header">
            <div class="section-header-copy">
              <p class="fx-eyebrow">New audit surface</p>
              <h2>Mixer Route Audit</h2>
              <p class="section-subtitle">Open the grouped mixer-trace dashboard to review every flagged source wallet that touched a mixer, filter by wallet/date, and export the current view as CSV.</p>
            </div>
            <a class="fx-button secondary" href="/dashboard/mixer-routes">Open Mixer Route Audit</a>
          </div>
        </section>
        <section class="section control-shell">
      <div class="section-header">
        <div class="section-header-copy">
          <h2>Start Token Investigation</h2>
          <p class="section-subtitle">Enter a token mint to identify the likely developer wallet, trace related funds, persist the investigation, and refresh scam monitoring from the website.</p>
        </div>
      </div>
      <form id="token-investigation-form" class="control-form">
        <label>Token mint
          <input name="tokenMint" type="text" placeholder="Token mint or contract address" />
        </label>
        <button type="submit">Investigate Token</button>
      </form>
      <div id="token-investigation-status" class="control-status">Use this form to run the same investigation workflow exposed through the API and Telegram admin tooling.</div>
      <div id="token-investigation-result" class="control-result">Results will appear here after a successful investigation.</div>
    </section>
        <section class="grid">${cards || '<article class="card"><p>No scam-intelligence records available yet.</p></article>'}</section>
        <section class="section panel">
          <div class="section-header">
            <div class="section-header-copy">
              <p class="fx-eyebrow">Resolved investigations</p>
              <h2>Developer-wallet investigations from token input</h2>
              <p class="section-subtitle">These records capture developer resolution source, related token history, and the operator time the investigation was persisted.</p>
            </div>
          </div>
        </section>
        <section class="grid">${tokenInvestigationCards || '<article class="card"><p>No token investigations recorded yet.</p></article>'}</section>
      `,
      scriptHtml: `<script>
      const tokenInvestigationForm = document.getElementById('token-investigation-form')
      const tokenInvestigationStatus = document.getElementById('token-investigation-status')
      const tokenInvestigationResult = document.getElementById('token-investigation-result')

      function setInvestigationStatus(message, tone) {
        tokenInvestigationStatus.textContent = message
        tokenInvestigationStatus.classList.toggle('error', tone === 'error')
      }

      tokenInvestigationForm.addEventListener('submit', async (event) => {
        event.preventDefault()
        const formData = new FormData(tokenInvestigationForm)
        const tokenMint = String(formData.get('tokenMint') || '').trim()

        if (!tokenMint) {
          setInvestigationStatus('Token mint is required.', 'error')
          return
        }

        setInvestigationStatus('Running token investigation...')
        tokenInvestigationResult.textContent = 'Investigation in progress.'

        try {
          const response = await fetch('/api/token-investigation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tokenMint }),
          })

          const payload = await response.json().catch(() => ({ message: 'Unexpected response' }))
          if (!response.ok) {
            throw new Error(payload.message || 'Investigation failed')
          }

          const relatedTokens = Array.isArray(payload.relatedTokens) ? payload.relatedTokens.join(', ') : 'none recorded'
          const traceSteps = payload.trace && Array.isArray(payload.trace.steps) ? payload.trace.steps.length : 0
          tokenInvestigationResult.innerHTML = '<strong>Developer wallet:</strong> ' + payload.developerWallet
            + '<br /><strong>Resolution source:</strong> ' + payload.resolutionSource
            + '<br /><strong>Related tokens:</strong> ' + relatedTokens
            + '<br /><strong>Trace steps:</strong> ' + traceSteps
            + '<br /><strong>Graph view:</strong> <a href="/graph/' + encodeURIComponent(payload.developerWallet) + '">Open wallet graph</a>'
          setInvestigationStatus('Token investigation completed and scam monitoring refreshed.')
        } catch (error) {
          setInvestigationStatus(error.message || 'Token investigation failed.', 'error')
          tokenInvestigationResult.textContent = 'Investigation failed.'
        }
      })
    </script>`,
    })
  }
}
