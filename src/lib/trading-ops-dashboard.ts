import axios from 'axios'
import { renderFuturisticPage } from './site-theme'
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
    const observedTokensByWallet = this.buildObservedTokensByWallet(data.journal, data.failures, data.decisions)

    const profileCards = watchlist
      .slice(0, 18)
      .map((wallet) => {
        const profile = sourceProfiles[String(wallet)] || {}
        const observedTokens = observedTokensByWallet.get(String(wallet)) || []
        return this.renderSourceWalletProfileCard(String(wallet), profile, observedTokens)
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

    return renderFuturisticPage({
      title: 'FoilOps Trading Ops',
      activeNav: 'trading',
      headerActionsHtml: `
        <a class="fx-button secondary" href="/api/trading-ops">JSON Snapshot</a>
        <a class="fx-button secondary" href="/api/trading-ops/export?format=json">Export JSON</a>
        <a class="fx-button secondary" href="/api/trading-ops/export?format=csv">Export CSV</a>
        <form method="post" action="/logout"><button class="fx-button" type="submit">Logout</button></form>
      `,
      heroHtml: `
        <section class="hero">
          <div>
            <p class="fx-eyebrow">Execution control layer</p>
            <h1>Trading Ops Command Surface</h1>
            <p class="fx-lead">Live receiver health, watchlist-driven copy-trade controls, retry queue inspection, and execution journal review. This page is tuned for rapid state changes without losing audit visibility.</p>
          </div>
          <div class="card" style="min-width:280px">
            <p class="eyebrow">Current posture</p>
            <div class="big">${data.metrics.executionMode || data.status.executionMode || 'paper'}</div>
            <p>Mode ${data.status.mode || 'signal_based'} | ${data.status.enabled ? 'enabled' : 'disabled'} | slippage ${slippageValue || 'n/a'}</p>
          </div>
        </section>
      `,
      contentHtml: `
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

      `,
      scriptHtml: `<script>
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

        const escapeHtml = (value) => String(value || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\"/g, '&quot;')
          .replace(/'/g, '&#39;')

        const badgeTone = (badge) => {
          const key = String(badge || '').toUpperCase()
          if (key === 'DO_NOT_TRACK' || key === 'BANNED' || key === 'RAPID_DUMPER' || key === 'FLAGGED') {
            return 'risk'
          }
          return 'badge'
        }

        trackedWalletList.innerHTML = wallets.map((wallet) => {
          const badges = Array.isArray(wallet.badges) ? wallet.badges : [wallet.status]
          const badgeHtml = badges
            .map((badge) => '<span class="' + badgeTone(badge) + '">' + escapeHtml(String(badge).replace(/_/g, ' ')) + '</span>')
            .join(' ')

          const warning = wallet.doNotTrack
            ? '<span class="risk">Do not track: flagged rapid-dumper pattern</span>'
            : ''

          return '<div class="tracked-wallet-item">'
            + '<div class="tracked-wallet-meta">'
            + '<strong>' + escapeHtml(wallet.displayAddress) + '</strong>'
            + '<span>' + escapeHtml(wallet.name || 'No label') + ' | ' + escapeHtml(wallet.chain) + '</span>'
            + '<div>' + badgeHtml + '</div>'
            + (warning ? '<div style="margin-top:6px">' + warning + '</div>' : '')
            + '</div>'
            + '<button type="button" data-remove-wallet="' + escapeHtml(wallet.displayAddress) + '">Remove</button>'
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
    </script>`,
    })
  }

  private async fetchJson<T extends Record<string, unknown>>(path: string, fallback: T): Promise<T> {
    try {
      const response = await axios.get(`${this.tradingBotUrl}${path}`, { timeout: 5000 })
      return response.data as T
    } catch (error) {
      return fallback
    }
  }

  private renderSourceWalletProfileCard(
    wallet: string,
    profile: Record<string, unknown>,
    observedTokens: string[],
  ): string {
    const earlyEntries = this.pickNumber(profile, [
      'earlyEntries',
      'early_entries',
      'earlyEntryCount',
      'early_entry_count',
      'earlyEntryHits',
    ])
    const totalSignals = this.pickNumber(profile, ['totalSignals', 'total_signals', 'signalsSeen', 'signal_count'])
    const totalEntries = this.pickNumber(profile, ['totalEntries', 'total_entries', 'entryCount', 'entry_count'])
    const momentumHits = this.pickNumber(profile, ['momentumHits', 'momentum_hits', 'momentumCount'])
    const wins = this.pickNumber(profile, ['wins', 'winCount', 'win_count'])
    const winRateRaw = this.pickNumber(profile, ['winRate', 'win_rate', 'successRate', 'success_rate'])
    const avgRisk = this.pickNumber(profile, ['avgRiskScore', 'avg_risk_score', 'averageRiskScore'])
    const avgEntryDelay = this.pickNumber(profile, ['avgEntryDelaySeconds', 'avg_entry_delay_seconds', 'entryDelayAvg'])
    const avgExitDelay = this.pickNumber(profile, ['avgExitDelaySeconds', 'avg_exit_delay_seconds', 'exitDelayAvg'])
    const pnlPct = this.pickNumber(profile, ['avgPnlPct', 'avg_pnl_pct', 'averagePnlPct'])
    const rapidDumps = this.pickNumber(profile, ['rapidDumps', 'rapid_dump_count', 'rapidDumperEvents'])

    const winRate = winRateRaw == null ? null : winRateRaw <= 1 ? Math.round(winRateRaw * 100) : Math.round(winRateRaw)
    const actions = Array.isArray(profile.allowedActions)
      ? profile.allowedActions.map((a) => this.escapeHtml(String(a))).join(', ')
      : 'default'
    const profileTokens = this.extractTokensFromProfile(profile)
    const tokens = [...new Set([...profileTokens, ...observedTokens])].slice(0, 12)
    const tokenHtml = tokens.length
      ? tokens.map((token) => `<span class="badge mono">${this.escapeHtml(token)}</span>`).join(' ')
      : '<span class="badge">Not available yet</span>'

    return `
      <article class="mini-card">
        <h3>${this.escapeHtml(wallet)}</h3>
        <p><strong>Preset:</strong> ${this.escapeHtml(profile.preset || 'none')}</p>
        <p><strong>Enabled:</strong> ${profile.enabled === false ? 'no' : 'yes'}</p>
        <p><strong>Actions:</strong> ${actions}</p>
        <p><strong>Observed Tokens:</strong></p>
        <div class="wallet-list" style="margin: 6px 0 10px;">${tokenHtml}</div>
        <div class="micro-grid" style="margin-top:10px">
          ${this.renderScoreCard('Early Entries', earlyEntries)}
          ${this.renderScoreCard('Total Entries', totalEntries)}
          ${this.renderScoreCard('Momentum Hits', momentumHits)}
          ${this.renderScoreCard('Signals', totalSignals)}
          ${this.renderScoreCard('Wins', wins)}
          ${this.renderScoreCard('Win Rate', winRate, '%')}
          ${this.renderScoreCard('Avg Risk', avgRisk)}
          ${this.renderScoreCard('Avg Entry Delay', avgEntryDelay, 's')}
          ${this.renderScoreCard('Avg Exit Delay', avgExitDelay, 's')}
          ${this.renderScoreCard('Avg PnL', pnlPct, '%')}
          ${this.renderScoreCard('Rapid Dumps', rapidDumps)}
        </div>
      </article>
    `
  }

  private renderScoreCard(label: string, value: number | null, suffix = ''): string {
    const display = value == null ? 'Not available' : `${value}${suffix}`
    return `<div class="card"><p class="eyebrow">${label}</p><p><strong>${display}</strong></p></div>`
  }

  private pickNumber(source: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
      const value = source[key]
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value
      }
      if (typeof value === 'string') {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) {
          return parsed
        }
      }
    }

    return null
  }

  private buildObservedTokensByWallet(
    journal: Array<Record<string, unknown>>,
    failures: Array<Record<string, unknown>>,
    decisions: Array<Record<string, unknown>>,
  ): Map<string, string[]> {
    const byWallet = new Map<string, Set<string>>()

    const collect = (wallet: unknown, token: unknown) => {
      const walletKey = String(wallet || '').trim()
      const tokenValue = String(token || '').trim()
      if (!walletKey || !tokenValue) {
        return
      }

      const set = byWallet.get(walletKey) || new Set<string>()
      set.add(tokenValue)
      byWallet.set(walletKey, set)
    }

    for (const row of journal || []) {
      collect(row.sourceWallet, row.tokenMint)
    }
    for (const row of failures || []) {
      collect(row.sourceWallet, row.tokenMint)
    }
    for (const row of decisions || []) {
      collect(row.sourceWallet, row.tokenMint)
    }

    const normalized = new Map<string, string[]>()
    for (const [wallet, tokens] of byWallet.entries()) {
      normalized.set(wallet, Array.from(tokens).slice(0, 20))
    }

    return normalized
  }

  private extractTokensFromProfile(profile: Record<string, unknown>): string[] {
    const tokenBuckets = [
      profile.tokens,
      profile.tokenMints,
      profile.token_mints,
      profile.observedTokens,
      profile.observed_tokens,
      profile.recentTokens,
      profile.recent_tokens,
    ]

    const out = new Set<string>()
    for (const bucket of tokenBuckets) {
      if (!Array.isArray(bucket)) {
        continue
      }

      for (const item of bucket) {
        if (typeof item === 'string' && item.trim()) {
          out.add(item.trim())
          continue
        }

        if (item && typeof item === 'object') {
          const value =
            (item as Record<string, unknown>).mint ||
            (item as Record<string, unknown>).tokenMint ||
            (item as Record<string, unknown>).address ||
            (item as Record<string, unknown>).symbol
          if (typeof value === 'string' && value.trim()) {
            out.add(value.trim())
          }
        }
      }
    }

    return Array.from(out)
  }

  private escapeHtml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  private csv(value: unknown): string {
    const raw = value == null ? '' : String(value)
    return `"${raw.replace(/"/g, '""')}"`
  }
}
