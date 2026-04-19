import axios from 'axios'
import { getTradingBotBaseUrl } from './web-control-utils'

type DashboardSnapshot = {
  status: Record<string, unknown>
  config: Record<string, unknown>
  safety: Record<string, unknown>
  sources: Record<string, unknown>
  metrics: Record<string, unknown>
  journal: Array<Record<string, unknown>>
  failures: Array<Record<string, unknown>>
  decisions: Array<Record<string, unknown>>
  slippage: Record<string, unknown>
}

export class TradingOpsDashboard {
  private readonly tradingBotUrl: string

  constructor() {
    this.tradingBotUrl = getTradingBotBaseUrl()
  }

  async getDashboardData(): Promise<DashboardSnapshot> {
    const [status, config, safety, sources, metrics, journal, failures, decisions, slippage] = await Promise.all([
      this.fetchJson('/trading/status', {}),
      this.fetchJson('/trading/config', {}),
      this.fetchJson('/trading/safety', {}),
      this.fetchJson('/trading/source-wallets', { watchlist: [], caps: {}, profiles: {} }),
      this.fetchJson('/trading/metrics', { executionMode: 'paper', deadLetterCount: 0, metrics: {} }),
      this.fetchJson('/trading/journal', { entries: [] }),
      this.fetchJson('/trading/dead-letters', { entries: [] }),
      this.fetchJson('/trading/decisions', { decisions: [] }),
      this.fetchJson('/trading/slippage', { slippage: 0 }),
    ])

    return {
      status,
      config,
      safety,
      sources,
      metrics,
      journal: Array.isArray(journal.entries) ? journal.entries : [],
      failures: Array.isArray(failures.entries) ? failures.entries : [],
      decisions: Array.isArray(decisions.decisions) ? decisions.decisions : [],
      slippage,
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
    const config = data.config
    const safety = data.safety
    const slippage = data.slippage
    const sourceProfiles = (data.sources.profiles as Record<string, Record<string, unknown>>) || {}
    const watchlist = Array.isArray(data.sources.watchlist) ? data.sources.watchlist : []
    const buyAmountSol = config.buyAmountSol || config.buy_amount_sol || ''
    const maxRiskScore = safety.maxRiskScore ?? safety.max_risk_score ?? ''
    const minAlertQualityScore = safety.minAlertQualityScore ?? 0
    const minTraceAlerts = safety.minTraceAlerts ?? 0
    const slippageValue = slippage.slippage ?? config.slippage ?? ''
    const currentMode = String(data.status.mode || 'signal_based')
    const currentProfile = String(config.profile || config.profilePreset || 'conservative')
    const currentExecutionMode = String(data.metrics.executionMode || data.status.executionMode || 'paper')

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
      .actions form { margin: 0; }
      .actions button {
        color: var(--ink);
        background: var(--paper);
        border: 1px solid var(--line);
        padding: 10px 14px;
        border-radius: 999px;
        font: inherit;
        cursor: pointer;
      }
      .control-status {
        margin-top: 18px;
        padding: 14px 16px;
        border-radius: 18px;
        background: rgba(29,107,99,0.1);
        border: 1px solid rgba(29,107,99,0.16);
      }
      .control-status.error {
        background: rgba(166,69,43,0.1);
        border-color: rgba(166,69,43,0.18);
        color: var(--warn);
      }
      .control-grid {
        display: grid;
        gap: 14px;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        margin-top: 16px;
      }
      .control-card {
        padding: 18px;
        background: var(--paper);
        border: 1px solid var(--line);
        border-radius: 20px;
        box-shadow: 0 16px 40px rgba(52, 37, 24, 0.08);
      }
      .control-card p {
        color: var(--muted);
        line-height: 1.6;
      }
      .control-form {
        display: grid;
        gap: 12px;
        margin-top: 12px;
      }
      .control-form label {
        display: grid;
        gap: 6px;
        font-size: 0.88rem;
        color: var(--muted);
      }
      .control-form input,
      .control-form select,
      .control-form textarea {
        width: 100%;
        padding: 11px 12px;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: rgba(255,255,255,0.72);
        font: inherit;
        color: var(--ink);
      }
      .control-form textarea {
        min-height: 92px;
        resize: vertical;
      }
      .button-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .button-row button {
        border: 1px solid var(--line);
        border-radius: 999px;
        background: rgba(255,255,255,0.7);
        color: var(--ink);
        padding: 10px 14px;
        font: inherit;
        cursor: pointer;
      }
      .button-row button.primary {
        background: var(--accent-2);
        color: #fff;
        border-color: transparent;
      }
      .button-row button.danger {
        background: var(--warn);
        color: #fff;
        border-color: transparent;
      }
      .tracked-wallet-list {
        margin-top: 12px;
        display: grid;
        gap: 8px;
      }
      .tracked-wallet-item {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: start;
        padding: 12px 14px;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: rgba(255,255,255,0.62);
      }
      .tracked-wallet-meta {
        min-width: 0;
      }
      .tracked-wallet-meta strong,
      .tracked-wallet-meta span {
        display: block;
        overflow-wrap: anywhere;
      }
      .tracked-wallet-meta span {
        color: var(--muted);
        font-size: 0.88rem;
        margin-top: 4px;
      }
      .tracked-wallet-item button {
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 8px 12px;
        font: inherit;
        background: rgba(255,255,255,0.8);
        cursor: pointer;
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
        <form method="post" action="/logout">
          <button type="submit">Logout</button>
        </form>
      </div>
    </section>

    <section class="stats">
      <article class="card"><div class="eyebrow">Execution</div><div class="big">${data.metrics.executionMode || data.status.executionMode || 'paper'}</div><p>Bot mode ${data.status.mode || 'signal_based'} | ${data.status.enabled ? 'enabled' : 'disabled'}</p></article>
      <article class="card"><div class="eyebrow">Signals</div><div class="big">${metrics.receivedTotal || 0}</div><p>${metrics.executedTotal || 0} executed, ${metrics.blockedTotal || 0} blocked, ${metrics.failedTotal || 0} failed</p></article>
      <article class="card"><div class="eyebrow">Risk Gates</div><div class="big">${safety.maxRiskScore || 'n/a'}</div><p>Min quality ${safety.minAlertQualityScore || 0} | min trace alerts ${safety.minTraceAlerts || 0}</p></article>
      <article class="card"><div class="eyebrow">Queue</div><div class="big">${data.metrics.deadLetterCount || 0}</div><p>${metrics.retriedTotal || 0} retry attempts recorded</p></article>
    </section>

    <section class="section">
      <h2>Web Control Surface</h2>
      <p class="eyebrow">The same live backend can now be controlled from this website as well as Telegram admin commands.</p>
      <div id="control-status" class="control-status">Choose an action, submit a setting update, or manage tracked wallets directly from the dashboard.</div>
      <div class="control-grid">
        <article class="control-card">
          <h3>Receiver Actions</h3>
          <p>Toggle the execution receiver without leaving the browser. Use the kill switch only when you need an immediate stop.</p>
          <div class="button-row" id="quick-action-buttons">
            <button class="primary" type="button" data-trading-action="enable">Enable</button>
            <button type="button" data-trading-action="disable">Disable</button>
            <button type="button" data-trading-action="pause">Pause</button>
            <button type="button" data-trading-action="resume">Resume</button>
            <button type="button" data-trading-action="tighten-risk">Tighten Risk</button>
            <button type="button" data-trading-action="retry-failed">Retry Dead Letters</button>
            <button class="danger" type="button" data-trading-action="kill-switch">Kill Switch</button>
          </div>
        </article>

        <article class="control-card">
          <h3>Trading Settings</h3>
          <p>Update the receiver profile, signal mode, execution mode, position sizing, slippage, and alert-quality thresholds.</p>
          <form id="trading-settings-form" class="control-form">
            <label>Profile preset
              <select name="profile">
                <option value="ultra_conservative" ${currentProfile === 'ultra_conservative' ? 'selected' : ''}>ultra_conservative</option>
                <option value="conservative" ${currentProfile === 'conservative' ? 'selected' : ''}>conservative</option>
                <option value="normal" ${currentProfile === 'normal' ? 'selected' : ''}>normal</option>
                <option value="aggressive" ${currentProfile === 'aggressive' ? 'selected' : ''}>aggressive</option>
              </select>
            </label>
            <label>Signal mode
              <select name="mode">
                <option value="signal_based" ${currentMode === 'signal_based' ? 'selected' : ''}>signal_based</option>
                <option value="copy_trade" ${currentMode === 'copy_trade' ? 'selected' : ''}>copy_trade</option>
              </select>
            </label>
            <label>Execution mode
              <select name="executionMode">
                <option value="paper" ${currentExecutionMode === 'paper' ? 'selected' : ''}>paper</option>
                <option value="live" ${currentExecutionMode === 'live' ? 'selected' : ''}>live</option>
              </select>
            </label>
            <label>Buy amount (SOL)
              <input name="buyAmountSol" type="number" step="0.0001" min="0" value="${buyAmountSol}" />
            </label>
            <label>Max risk score
              <input name="maxRiskScore" type="number" step="1" min="0" max="100" value="${maxRiskScore}" />
            </label>
            <label>Slippage
              <input name="slippage" type="number" step="0.01" min="0" value="${slippageValue}" />
            </label>
            <label>Min alert quality score
              <input name="minAlertQualityScore" type="number" step="1" min="0" max="100" value="${minAlertQualityScore}" />
            </label>
            <label>Min trace alerts
              <input name="minTraceAlerts" type="number" step="1" min="0" value="${minTraceAlerts}" />
            </label>
            <div class="button-row">
              <button class="primary" type="submit">Apply Settings</button>
            </div>
          </form>
        </article>

        <article class="control-card">
          <h3>Source Wallet Controls</h3>
          <p>Manage the Rust receiver watchlist for copy-trade source wallets, caps, and profile presets.</p>
          <form id="source-wallet-form" class="control-form">
            <label>Action
              <select name="action">
                <option value="add">add</option>
                <option value="remove">remove</option>
                <option value="cap">cap</option>
                <option value="uncap">uncap</option>
                <option value="profile">profile</option>
              </select>
            </label>
            <label>Solana wallet
              <input name="wallet" type="text" placeholder="Base58 wallet address" />
            </label>
            <label>Max position size cap (SOL)
              <input name="maxPositionSizeSol" type="number" step="0.0001" min="0" placeholder="Used for cap action" />
            </label>
            <label>Profile preset
              <select name="preset">
                <option value="shadow">shadow</option>
                <option value="scalp">scalp</option>
                <option value="swing">swing</option>
                <option value="defensive">defensive</option>
                <option value="blocked">blocked</option>
              </select>
            </label>
            <label>Notes
              <textarea name="notes" placeholder="Optional notes for profile action"></textarea>
            </label>
            <div class="button-row">
              <button class="primary" type="submit">Update Source Wallet</button>
            </div>
          </form>
        </article>

        <article class="control-card">
          <h3>Tracked Wallets</h3>
          <p>Manage the website and Telegram tracked-wallet pool from the browser using the configured admin account.</p>
          <form id="tracked-wallet-form" class="control-form">
            <label>Action
              <select name="action">
                <option value="add">add</option>
                <option value="remove">remove</option>
              </select>
            </label>
            <label>Wallet input
              <input name="wallet" type="text" placeholder="Solana base58 or prefixed EVM input" />
            </label>
            <label>Wallet name
              <input name="name" type="text" placeholder="Optional label used when adding" />
            </label>
            <div class="button-row">
              <button class="primary" type="submit">Update Tracked Wallets</button>
            </div>
          </form>
          <div id="tracked-wallet-list" class="tracked-wallet-list"></div>
        </article>
      </div>
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

    <script>
      const controlStatus = document.getElementById('control-status')
      const trackedWalletList = document.getElementById('tracked-wallet-list')
      const trackedWalletForm = document.getElementById('tracked-wallet-form')
      const sourceWalletForm = document.getElementById('source-wallet-form')
      const tradingSettingsForm = document.getElementById('trading-settings-form')

      function setControlStatus(message, tone) {
        controlStatus.textContent = message
        controlStatus.classList.toggle('error', tone === 'error')
      }

      async function requestJson(url, options) {
        const response = await fetch(url, {
          headers: {
            'Content-Type': 'application/json',
          },
          ...options,
        })

        const payload = await response.json().catch(() => ({ message: 'Unexpected response' }))
        if (!response.ok) {
          throw new Error(payload.message || 'Request failed')
        }

        return payload
      }

      function parseOptionalNumber(value) {
        const normalized = String(value || '').trim()
        if (!normalized) {
          return undefined
        }

        const parsed = Number(normalized)
        return Number.isFinite(parsed) ? parsed : undefined
      }

      function renderTrackedWallets(wallets) {
        if (!Array.isArray(wallets) || wallets.length === 0) {
          trackedWalletList.innerHTML = '<div class="tracked-wallet-item"><div class="tracked-wallet-meta"><strong>No tracked wallets found.</strong><span>Use the form above to add one from the website.</span></div></div>'
          return
        }

        trackedWalletList.innerHTML = wallets.map((wallet) => {
          return '<div class="tracked-wallet-item">'
            + '<div class="tracked-wallet-meta">'
            + '<strong>' + wallet.displayAddress + '</strong>'
            + '<span>' + (wallet.name || 'No label') + ' | ' + wallet.chain + ' | ' + wallet.status + '</span>'
            + '</div>'
            + '<button type="button" data-remove-wallet="' + wallet.displayAddress + '">Remove</button>'
            + '</div>'
        }).join('')
      }

      async function loadTrackedWallets() {
        try {
          const payload = await requestJson('/api/control/tracked-wallets', { method: 'GET' })
          renderTrackedWallets(payload.wallets)
        } catch (error) {
          renderTrackedWallets([])
          setControlStatus(error.message || 'Failed to load tracked wallets.', 'error')
        }
      }

      document.querySelectorAll('[data-trading-action]').forEach((button) => {
        button.addEventListener('click', async () => {
          const action = button.getAttribute('data-trading-action')
          if (!action) return

          if (action === 'kill-switch' && !window.confirm('Trigger the trading kill switch?')) {
            return
          }

          try {
            const payload = await requestJson('/api/control/trading/action', {
              method: 'POST',
              body: JSON.stringify({ action }),
            })
            setControlStatus(payload.message || ('Trading action ' + action + ' completed.'))
            window.setTimeout(() => window.location.reload(), 700)
          } catch (error) {
            setControlStatus(error.message || 'Trading action failed.', 'error')
          }
        })
      })

      tradingSettingsForm.addEventListener('submit', async (event) => {
        event.preventDefault()
        const formData = new FormData(tradingSettingsForm)
        const payload = {
          profile: String(formData.get('profile') || ''),
          mode: String(formData.get('mode') || ''),
          executionMode: String(formData.get('executionMode') || ''),
          buyAmountSol: parseOptionalNumber(formData.get('buyAmountSol')),
          maxRiskScore: parseOptionalNumber(formData.get('maxRiskScore')),
          slippage: parseOptionalNumber(formData.get('slippage')),
          minAlertQualityScore: parseOptionalNumber(formData.get('minAlertQualityScore')),
          minTraceAlerts: parseOptionalNumber(formData.get('minTraceAlerts')),
        }

        try {
          const response = await requestJson('/api/control/trading/settings', {
            method: 'POST',
            body: JSON.stringify(payload),
          })
          setControlStatus(response.message || 'Trading settings updated.')
          window.setTimeout(() => window.location.reload(), 700)
        } catch (error) {
          setControlStatus(error.message || 'Trading settings update failed.', 'error')
        }
      })

      sourceWalletForm.addEventListener('submit', async (event) => {
        event.preventDefault()
        const formData = new FormData(sourceWalletForm)
        const payload = {
          action: String(formData.get('action') || ''),
          wallet: String(formData.get('wallet') || ''),
          maxPositionSizeSol: parseOptionalNumber(formData.get('maxPositionSizeSol')),
          preset: String(formData.get('preset') || ''),
          notes: String(formData.get('notes') || ''),
        }

        try {
          const response = await requestJson('/api/control/trading/source-wallets', {
            method: 'POST',
            body: JSON.stringify(payload),
          })
          setControlStatus(response.message || 'Source wallet controls updated.')
          window.setTimeout(() => window.location.reload(), 700)
        } catch (error) {
          setControlStatus(error.message || 'Source wallet update failed.', 'error')
        }
      })

      trackedWalletForm.addEventListener('submit', async (event) => {
        event.preventDefault()
        const formData = new FormData(trackedWalletForm)
        const payload = {
          action: String(formData.get('action') || ''),
          wallet: String(formData.get('wallet') || ''),
          name: String(formData.get('name') || ''),
        }

        try {
          const response = await requestJson('/api/control/tracked-wallets', {
            method: 'POST',
            body: JSON.stringify(payload),
          })
          trackedWalletForm.reset()
          setControlStatus(response.message || 'Tracked wallets updated.')
          await loadTrackedWallets()
        } catch (error) {
          setControlStatus(error.message || 'Tracked wallet update failed.', 'error')
        }
      })

      trackedWalletList.addEventListener('click', async (event) => {
        const target = event.target
        if (!(target instanceof HTMLButtonElement)) return

        const wallet = target.getAttribute('data-remove-wallet')
        if (!wallet) return

        try {
          const response = await requestJson('/api/control/tracked-wallets', {
            method: 'POST',
            body: JSON.stringify({ action: 'remove', wallet }),
          })
          setControlStatus(response.message || 'Tracked wallet removed.')
          await loadTrackedWallets()
        } catch (error) {
          setControlStatus(error.message || 'Tracked wallet removal failed.', 'error')
        }
      })

      loadTrackedWallets()
    </script>
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
