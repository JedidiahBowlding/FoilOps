import { PrismaScamWalletRepository } from '../repositories/prisma/scam-wallet'

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

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>FoilOps Scam Intelligence</title>
    <style>
      :root {
        --bg: #0a0e27;
        --bg-alt: #0f1440;
        --ink: #ffffff;
        --muted: #a0a8c0;
        --hot: #ff2d2d;
        --warn: #ff7070;
        --ok: #44d27a;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        padding: 24px;
        color: var(--ink);
        background: linear-gradient(135deg, #0a0e27 0%, #0f1440 50%, #0a0e27 100%);
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      }

      h1 {
        margin-top: 0;
        margin-bottom: 8px;
        font-size: clamp(1.5rem, 3vw, 2.4rem);
        letter-spacing: 0.03em;
      }

      .topbar {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        align-items: start;
        margin-bottom: 18px;
      }

      .topbar-copy {
        min-width: 0;
      }

      p.lead {
        margin-top: 0;
        margin-bottom: 24px;
        color: var(--muted);
      }

      .logout-form {
        margin: 0;
      }

      .logout-button {
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(10, 20, 40, 0.72);
        color: var(--ink);
        border-radius: 999px;
        padding: 10px 14px;
        font: inherit;
        cursor: pointer;
        white-space: nowrap;
      }

      .control-shell {
        margin-bottom: 18px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(10, 20, 40, 0.72);
        border-radius: 16px;
        padding: 16px;
        backdrop-filter: blur(8px);
      }

      .control-form {
        display: grid;
        gap: 12px;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: end;
      }

      .control-form label {
        display: grid;
        gap: 6px;
        font-size: 0.92rem;
        color: var(--muted);
      }

      .control-form input {
        width: 100%;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 12px;
        padding: 12px 14px;
        background: rgba(255,255,255,0.08);
        color: var(--ink);
        font: inherit;
      }

      .control-form button {
        border: 0;
        border-radius: 999px;
        background: linear-gradient(135deg, #0d7267, #174a7c);
        color: #fff;
        padding: 12px 16px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }

      .control-status,
      .control-result {
        margin-top: 12px;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 14px;
        padding: 12px 14px;
        background: rgba(255,255,255,0.06);
        color: var(--muted);
      }

      .control-status.error {
        color: #ffb8a6;
        border-color: rgba(255, 93, 93, 0.28);
      }

      .control-result a {
        color: #b6ffdb;
      }

      .grid {
        display: grid;
        gap: 14px;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      }

      .card {
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(10, 20, 40, 0.72);
        border-radius: 16px;
        padding: 16px;
        backdrop-filter: blur(8px);
      }

      .card.flagged { border-color: rgba(255, 93, 93, 0.5); }
      .card.unflagged { border-color: rgba(68, 210, 122, 0.4); }
      .investigation-card { border-color: rgba(95, 177, 255, 0.45); }

      .card header {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        align-items: center;
      }

      .card h3 {
        margin: 0;
        font-size: 0.9rem;
        word-break: break-all;
      }

      .risk {
        font-weight: 700;
        color: var(--warn);
      }

      ul {
        margin: 8px 0 0;
        padding-left: 18px;
      }

      li { margin-bottom: 6px; }

      .token {
        font-family: "IBM Plex Mono", monospace;
        color: #b6ffdb;
      }

      .meta {
        display: block;
        color: var(--muted);
        font-size: 0.85rem;
      }

      @media (max-width: 720px) {
        .topbar {
          flex-direction: column;
        }

        .control-form {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="topbar">
      <div class="topbar-copy">
        <h1>FoilOps Scam Intelligence Dashboard</h1>
        <p class="lead">Flagged wallet histories, prior token links, and suspicious launch risk scoring.</p>
      </div>
      <form class="logout-form" method="post" action="/logout">
        <button class="logout-button" type="submit">Logout</button>
      </form>
    </div>
    <section class="control-shell">
      <h2>Start Token Investigation</h2>
      <p class="lead">Enter a token mint to identify the likely developer wallet, trace related funds, persist the investigation, and refresh scam monitoring from the website.</p>
      <form id="token-investigation-form" class="control-form">
        <label>Token mint
          <input name="tokenMint" type="text" placeholder="Token mint or contract address" />
        </label>
        <button type="submit">Investigate Token</button>
      </form>
      <div id="token-investigation-status" class="control-status">Use this form to run the same investigation workflow exposed through the API and Telegram admin tooling.</div>
      <div id="token-investigation-result" class="control-result">Results will appear here after a successful investigation.</div>
    </section>
    <section class="grid">${cards || '<p>No scam-intelligence records available yet.</p>'}</section>
    <h1>Token Investigations</h1>
    <p class="lead">Developer-wallet investigations started from token contract input, with related token history.</p>
    <section class="grid">${tokenInvestigationCards || '<p>No token investigations recorded yet.</p>'}</section>
    <script>
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
    </script>
  </body>
</html>`
  }
}
