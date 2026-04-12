import axios from 'axios'

type DashboardSnapshot = {
  status: Record<string, unknown>
  safety: Record<string, unknown>
  sources: Record<string, unknown>
  metrics: Record<string, unknown>
  journal: Array<Record<string, unknown>>
  failures: Array<Record<string, unknown>>
  decisions: Array<Record<string, unknown>>
}

export class TradingOpsDashboard {
  private readonly tradingBotUrl: string

  constructor() {
    const explicitUrl = process.env.TRADING_BOT_URL?.trim()
    if (explicitUrl) {
      this.tradingBotUrl = explicitUrl.replace(/\/$/, '')
      return
    }

    const bind = process.env.SIGNAL_RECEIVER_BIND?.trim()
    if (bind) {
      const normalized = bind.replace(/^0\.0\.0\.0:/, '127.0.0.1:').replace(/^\[::\]:/, '127.0.0.1:')
      this.tradingBotUrl =
        normalized.startsWith('http://') || normalized.startsWith('https://') ? normalized : `http://${normalized}`
      return
    }

    this.tradingBotUrl = 'http://127.0.0.1:8787'
  }

  async getDashboardData(): Promise<DashboardSnapshot> {
    const [status, safety, sources, metrics, journal, failures, decisions] = await Promise.all([
      this.fetchJson('/trading/status', {}),
      this.fetchJson('/trading/safety', {}),
      this.fetchJson('/trading/source-wallets', { watchlist: [], caps: {}, profiles: {} }),
      this.fetchJson('/trading/metrics', { executionMode: 'paper', deadLetterCount: 0, metrics: {} }),
      this.fetchJson('/trading/journal', { entries: [] }),
      this.fetchJson('/trading/dead-letters', { entries: [] }),
      this.fetchJson('/trading/decisions', { decisions: [] }),
    ])

    return {
      status,
      safety,
      sources,
      metrics,
      journal: Array.isArray(journal.entries) ? journal.entries : [],
      failures: Array.isArray(failures.entries) ? failures.entries : [],
      decisions: Array.isArray(decisions.decisions) ? decisions.decisions : [],
    }
  }

  async exportSnapshot(format: 'json' | 'csv'): Promise<{ contentType: string; body: string }> {
    const data = await this.getDashboardData()

    if (format === 'csv') {
      const header = [
        'type',
        'timestamp',
        'requestId',
        'signalId',
        'status',
        'action',
        'tokenMint',
        'sourceWallet',
        'reason',
      ]
      const journalRows = data.journal.map((entry) => [
        'journal',
        this.csv(entry.timestamp),
        this.csv(entry.requestId),
        '',
        this.csv(entry.status),
        this.csv(entry.action),
        this.csv(entry.tokenMint),
        this.csv(entry.sourceWallet),
        this.csv(entry.reason),
      ])
      const failureRows = data.failures.map((entry) => [
        'dead_letter',
        this.csv(entry.lastFailedAt),
        '',
        this.csv(entry.signalId),
        this.csv(entry.status),
        '',
        this.csv(entry.tokenMint),
        this.csv(entry.sourceWallet),
        this.csv(entry.reason),
      ])

      const lines = [
        header.join(','),
        ...journalRows.map((row) => row.join(',')),
        ...failureRows.map((row) => row.join(',')),
      ]
      return { contentType: 'text/csv; charset=utf-8', body: lines.join('\n') }
    }

    return { contentType: 'application/json; charset=utf-8', body: JSON.stringify(data, null, 2) }
  }

  async renderHtmlDashboard(): Promise<string> {
    const data = await this.getDashboardData()
    const metrics = (data.metrics.metrics as Record<string, number | string | undefined>) || {}
    const safety = data.safety
    const sourceProfiles = (data.sources.profiles as Record<string, Record<string, unknown>>) || {}
    const watchlist = Array.isArray(data.sources.watchlist) ? data.sources.watchlist : []

    const profileCards = watchlist
      .slice(0, 18)
      .map((wallet) => {
        const profile = sourceProfiles[String(wallet)] || {}
        return `
          <article class="mini-card">
            <h3>${wallet}</h3>
            <p><strong>Preset:</strong> ${profile.preset || 'none'}</p>
            <p><strong>Enabled:</strong> ${profile.enabled === false ? 'no' : 'yes'}</p>
            <p><strong>Actions:</strong> ${Array.isArray(profile.allowedActions) ? profile.allowedActions.join(', ') : 'default'}</p>
          </article>
        `
      })
      .join('')

    const journalRows = data.journal
      .slice(0, 14)
      .map(
        (entry) => `
          <tr>
            <td>${entry.timestamp || ''}</td>
            <td>${entry.status || ''}</td>
            <td>${entry.action || ''}</td>
            <td>${entry.tokenMint || ''}</td>
            <td>${entry.sourceWallet || ''}</td>
            <td>${entry.profilePreset || ''}</td>
            <td>${entry.amountSol || ''}</td>
            <td>${entry.reason || ''}</td>
          </tr>
        `,
      )
      .join('')

    const failureRows = data.failures
      .slice(0, 12)
      .map(
        (entry) => `
          <tr>
            <td>${entry.signalId || ''}</td>
            <td>${entry.status || ''}</td>
            <td>${entry.signalType || ''}</td>
            <td>${entry.sourceWallet || ''}</td>
            <td>${entry.retryCount || 0}</td>
            <td>${entry.reason || ''}</td>
          </tr>
        `,
      )
      .join('')

    const decisionRows = data.decisions
      .slice(0, 10)
      .map(
        (entry) => `
          <tr>
            <td>${entry.signalId || ''}</td>
            <td>${entry.status || ''}</td>
            <td>${entry.signalType || ''}</td>
            <td>${entry.riskScore ?? ''}</td>
            <td>${Array.isArray(entry.safetyReasons) ? entry.safetyReasons.join(', ') : ''}</td>
          </tr>
        `,
      )
      .join('')

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>FoilOps Trading Ops</title>
    <style>
      :root {
        --bg: #f5efe2;
        --paper: rgba(255, 249, 239, 0.92);
        --ink: #1f1a14;
        --muted: #6c6256;
        --line: rgba(43, 31, 19, 0.12);
        --accent: #c24d2c;
        --accent-2: #1d6b63;
        --warn: #a6452b;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 28px;
        color: var(--ink);
        background:
          radial-gradient(circle at 12% 18%, rgba(194,77,44,0.22), transparent 28%),
          radial-gradient(circle at 88% 12%, rgba(29,107,99,0.18), transparent 24%),
          linear-gradient(145deg, #f7f1e3, #e7ddca 60%, #ddd1bc);
        font-family: "Avenir Next", "Trebuchet MS", sans-serif;
      }
      h1, h2, h3 { margin: 0; }
      .hero {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: end;
        margin-bottom: 24px;
      }
      .hero p { color: var(--muted); max-width: 720px; }
      .actions { display: flex; gap: 10px; flex-wrap: wrap; }
      .actions a {
        text-decoration: none;
        color: var(--ink);
        background: var(--paper);
        border: 1px solid var(--line);
        padding: 10px 14px;
        border-radius: 999px;
      }
      .stats, .profiles { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
      .card, .mini-card, .table-card {
        background: var(--paper);
        border: 1px solid var(--line);
        border-radius: 20px;
        box-shadow: 0 16px 40px rgba(52, 37, 24, 0.08);
      }
      .card { padding: 18px; }
      .mini-card { padding: 16px; }
      .eyebrow { text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.74rem; color: var(--muted); }
      .big { font-size: 2rem; margin-top: 8px; }
      .section { margin-top: 26px; }
      .table-card { overflow: auto; padding: 12px; }
      table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
      th, td { text-align: left; padding: 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
      th { color: var(--muted); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; }
      .pill { display: inline-block; padding: 4px 10px; border-radius: 999px; background: rgba(29,107,99,0.12); color: var(--accent-2); }
      @media (max-width: 720px) {
        body { padding: 16px; }
        .hero { flex-direction: column; align-items: start; }
      }
    </style>
  </head>
  <body>
    <section class="hero">
      <div>
        <h1>FoilOps Trading Ops Dashboard</h1>
        <p>Live receiver health, watchlist-driven copy-trade controls, retry queue, and execution journal. Refresh the page for updated state.</p>
      </div>
      <div class="actions">
        <a href="/api/trading-ops">JSON Snapshot</a>
        <a href="/api/trading-ops/export?format=json">Export JSON</a>
        <a href="/api/trading-ops/export?format=csv">Export CSV</a>
      </div>
    </section>

    <section class="stats">
      <article class="card"><div class="eyebrow">Execution</div><div class="big">${data.metrics.executionMode || data.status.executionMode || 'paper'}</div><p>Bot mode ${data.status.mode || 'signal_based'} | ${data.status.enabled ? 'enabled' : 'disabled'}</p></article>
      <article class="card"><div class="eyebrow">Signals</div><div class="big">${metrics.receivedTotal || 0}</div><p>${metrics.executedTotal || 0} executed, ${metrics.blockedTotal || 0} blocked, ${metrics.failedTotal || 0} failed</p></article>
      <article class="card"><div class="eyebrow">Risk Gates</div><div class="big">${safety.maxRiskScore || 'n/a'}</div><p>Min quality ${safety.minAlertQualityScore || 0} | min trace alerts ${safety.minTraceAlerts || 0}</p></article>
      <article class="card"><div class="eyebrow">Queue</div><div class="big">${data.metrics.deadLetterCount || 0}</div><p>${metrics.retriedTotal || 0} retry attempts recorded</p></article>
    </section>

    <section class="section">
      <h2>Source Wallet Profiles</h2>
      <p class="eyebrow">Watchlist size ${watchlist.length} | Profile count ${safety.sourceWalletProfileCount || Object.keys(sourceProfiles).length}</p>
      <div class="profiles">${profileCards || '<article class="mini-card"><p>No watchlisted wallets yet.</p></article>'}</div>
    </section>

    <section class="section table-card">
      <h2>Trade Journal</h2>
      <table>
        <thead><tr><th>Time</th><th>Status</th><th>Action</th><th>Token</th><th>Source</th><th>Profile</th><th>Amount</th><th>Reason</th></tr></thead>
        <tbody>${journalRows || '<tr><td colspan="8">No journal entries yet.</td></tr>'}</tbody>
      </table>
    </section>

    <section class="section table-card">
      <h2>Dead Letters</h2>
      <table>
        <thead><tr><th>Signal ID</th><th>Status</th><th>Type</th><th>Source</th><th>Retries</th><th>Reason</th></tr></thead>
        <tbody>${failureRows || '<tr><td colspan="6">No failed signals queued.</td></tr>'}</tbody>
      </table>
    </section>

    <section class="section table-card">
      <h2>Decision Feed</h2>
      <table>
        <thead><tr><th>Signal ID</th><th>Status</th><th>Type</th><th>Risk</th><th>Safety</th></tr></thead>
        <tbody>${decisionRows || '<tr><td colspan="5">No decisions yet.</td></tr>'}</tbody>
      </table>
    </section>
  </body>
</html>`
  }

  private async fetchJson<T extends Record<string, unknown>>(path: string, fallback: T): Promise<T> {
    try {
      const response = await axios.get(`${this.tradingBotUrl}${path}`, { timeout: 5000 })
      return response.data as T
    } catch (error) {
      return fallback
    }
  }

  private csv(value: unknown): string {
    const raw = value == null ? '' : String(value)
    return `"${raw.replace(/"/g, '""')}"`
  }
}
