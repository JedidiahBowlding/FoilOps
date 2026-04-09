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
    <title>Handi Cat Scam Intelligence</title>
    <style>
      :root {
        --bg: #0a111f;
        --bg-alt: #12213f;
        --ink: #f1f5ff;
        --muted: #a8b3d1;
        --hot: #ff5d5d;
        --warn: #ffad42;
        --ok: #44d27a;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        padding: 24px;
        color: var(--ink);
        background: radial-gradient(circle at 10% 10%, #17315f, var(--bg) 42%), linear-gradient(130deg, #0a111f, #091a3b 80%);
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      }

      h1 {
        margin-top: 0;
        margin-bottom: 8px;
        font-size: clamp(1.5rem, 3vw, 2.4rem);
        letter-spacing: 0.03em;
      }

      p.lead {
        margin-top: 0;
        margin-bottom: 24px;
        color: var(--muted);
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
    </style>
  </head>
  <body>
    <h1>Handi Cat Scam Intelligence Dashboard</h1>
    <p class="lead">Flagged wallet histories, prior token links, and suspicious launch risk scoring.</p>
    <section class="grid">${cards || '<p>No scam-intelligence records available yet.</p>'}</section>
    <h1>Token Investigations</h1>
    <p class="lead">Developer-wallet investigations started from token contract input, with related token history.</p>
    <section class="grid">${tokenInvestigationCards || '<p>No token investigations recorded yet.</p>'}</section>
  </body>
</html>`
  }
}
