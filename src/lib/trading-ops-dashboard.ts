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
  strategy: Record<string, unknown>
}

export class TradingOpsDashboard {
  private readonly tradingBotUrl: string

  constructor() {
    this.tradingBotUrl = getTradingBotBaseUrl()
  }

  async getDashboardData(): Promise<DashboardSnapshot> {
    const [status, config, safety, sources, metrics, journal, failures, decisions, slippage, strategy] =
      await Promise.all([
        this.fetchJson('/trading/status', {}),
        this.fetchJson('/trading/config', {}),
        this.fetchJson('/trading/safety', {}),
        this.fetchJson('/trading/source-wallets', { watchlist: [], caps: {}, profiles: {} }),
        this.fetchJson('/trading/metrics', { executionMode: 'paper', deadLetterCount: 0, metrics: {} }),
        this.fetchJson('/trading/journal', { entries: [] }),
        this.fetchJson('/trading/dead-letters', { entries: [] }),
        this.fetchJson('/trading/decisions', { decisions: [] }),
        this.fetchJson('/trading/slippage', { slippage: 0 }),
        this.fetchJson('/api/trading/strategy', {
          activePositions: 0,
          watchedTokens: 0,
          confirmedBuys: 0,
          confirmedSells: 0,
        }),
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
      strategy,
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

  async renderHtmlDashboard(preloadedData?: DashboardSnapshot): Promise<string> {
    const data = preloadedData || (await this.getDashboardData())
    const metrics = (data.metrics.metrics as Record<string, number | string | undefined>) || {}
    const config = data.config
    const safety = data.safety
    const slippage = data.slippage
    const sourceProfiles = (data.sources.profiles as Record<string, Record<string, unknown>>) || {}
    const watchlist = Array.isArray(data.sources.watchlist) ? data.sources.watchlist : []
    const buyAmountSol = config.buyAmountSol || config.buy_amount_sol || ''
    const maxRiskScore = safety.maxRiskScore ?? safety.max_risk_score ?? ''
    const stopLossPercentage = safety.stopLossPercentage ?? config.stop_loss_percentage ?? 20
    const takeProfitPercentage = safety.takeProfitPercentage ?? config.take_profit_percentage ?? 50
    const minAlertQualityScore = safety.minAlertQualityScore ?? 0
    const minTraceAlerts = safety.minTraceAlerts ?? 0
    const buyOncePerToken = Boolean(config.buyOncePerToken ?? config.buy_once_per_token)
    const slippageValue = slippage.slippage ?? config.slippage ?? ''
    const mevServiceValue = String(config.mev_service ?? config.mevService ?? 'none')
    const maxConcurrentTrades = Number(config.max_concurrent_trades ?? config.maxConcurrentTrades ?? 5)
    const maxPositionSizeSolValue = config.max_position_size_sol ?? config.maxPositionSizeSol ?? ''
    const minLiquidityUsdValue = config.min_liquidity_usd ?? config.minLiquidityUsd ?? ''
    const allowedDexesValue: string[] = Array.isArray(config.allowed_dexes)
      ? config.allowed_dexes
      : Array.isArray(config.allowedDexes)
        ? config.allowedDexes
        : ['pump_fun', 'raydium']
    const targetWalletValue = String(config.target_wallet ?? config.targetWallet ?? '')
    const autoBlockSourceWallet = Boolean(
      config.auto_block_source_wallet_after_buy ?? config.autoBlockSourceWalletAfterBuy ?? false,
    )
    const legacyPreBuySafetyEnabled = Boolean(
      config.pre_buy_safety_checks_enabled ??
        config.preBuySafetyChecksEnabled ??
        safety.preBuySafetyChecksEnabled ??
        true,
    )
    const preBuyChecksConfig =
      (config.pre_buy_checks as Record<string, unknown>) ||
      (config.preBuyChecks as Record<string, unknown>) ||
      (safety.preBuyChecks as Record<string, unknown>) ||
      {}
    const preBuyCheckSellRoute = Boolean(
      preBuyChecksConfig.sellRoute ?? preBuyChecksConfig.sell_route ?? legacyPreBuySafetyEnabled,
    )
    const preBuyCheckFreezeAuthority = Boolean(
      preBuyChecksConfig.freezeAuthority ?? preBuyChecksConfig.freeze_authority ?? legacyPreBuySafetyEnabled,
    )
    const preBuyCheckToken2022Extensions = Boolean(
      preBuyChecksConfig.token2022Extensions ?? preBuyChecksConfig.token2022_extensions ?? legacyPreBuySafetyEnabled,
    )
    const preBuyCheckHoneypot = Boolean(preBuyChecksConfig.honeypot ?? legacyPreBuySafetyEnabled)
    const preBuyCheckSuspiciousTax = Boolean(
      preBuyChecksConfig.suspiciousTax ?? preBuyChecksConfig.suspicious_tax ?? legacyPreBuySafetyEnabled,
    )
    const preBuyChecksEnabledCount = [
      preBuyCheckSellRoute,
      preBuyCheckFreezeAuthority,
      preBuyCheckToken2022Extensions,
      preBuyCheckHoneypot,
      preBuyCheckSuspiciousTax,
    ].filter(Boolean).length
    const denylistValue = Array.isArray(config.denylist) ? (config.denylist as string[]).join('\n') : ''
    const allowlistValue = Array.isArray(config.allowlist) ? (config.allowlist as string[]).join('\n') : ''
    const currentMode = String(data.status.mode || 'signal_based')
    const currentProfile = String(config.profile || config.profilePreset || 'conservative')
    const currentExecutionMode = String(data.metrics.executionMode || data.status.executionMode || 'paper')
    const observedTokensByWallet = this.buildObservedTokensByWallet(data.journal, data.failures, data.decisions)
    const walletAttribution = this.buildWalletAttribution(data.journal, data.decisions)
    const attributionRows = this.renderWalletAttributionRows(walletAttribution)
    const driftAlerts = this.buildProfileDriftAlerts(sourceProfiles, walletAttribution)
    const driftAlertCount = driftAlerts.length
    const watchlistCount = watchlist.length
    const profileCount = Number(safety.sourceWalletProfileCount || Object.keys(sourceProfiles).length || 0)
    const attributedWalletCount = walletAttribution.size
    const tokenExposureCount = observedTokensByWallet.size
    const journalCount = data.journal.length
    const blockedBuyEntries = data.journal
      .filter((entry) => {
        const status = String(entry.status || entry.status_code || '').toLowerCase()
        const action = String(entry.action || '').toLowerCase()
        return status === 'blocked' && action === 'buy'
      })
      .slice(0, 8)
    const failureCount = data.failures.length
    const decisionCount = data.decisions.length
    const strategy = (data.strategy as Record<string, unknown>) || {}
    const strategyActivePositions = Number(strategy.activePositions || 0)
    const strategyWatchedTokens = Number(strategy.watchedTokens || 0)
    const strategyConfirmedBuys = Number(strategy.confirmedBuys || 0)
    const strategyConfirmedSells = Number(strategy.confirmedSells || 0)
    const smartMoneySignals = data.decisions.filter(
      (entry) => String(entry.signalType || entry.signal_type || '').toUpperCase() === 'SMART_MONEY_TRADE',
    )
    const smartMoneyExecuted = smartMoneySignals.filter(
      (entry) => String(entry.status || '').toLowerCase() === 'executed',
    )
    const smartMoneyBlocked = smartMoneySignals.filter(
      (entry) => String(entry.status || '').toLowerCase() === 'blocked',
    )
    const smartMoneyExecutionRate = smartMoneySignals.length
      ? Math.round((smartMoneyExecuted.length / smartMoneySignals.length) * 100)
      : 0
    const tokenLiquidityGateHits = this.pickMetricCount(metrics, [
      'tokenLiquidityGateCount',
      'token_liquidity_gate_count',
      'token_liquidity_gate',
    ])
    const holderConcentrationGateHits = this.pickMetricCount(metrics, [
      'holderConcentrationGateCount',
      'holder_concentration_gate_count',
      'holder_concentration_gate',
    ])
    const rugHeuristicsGateHits = this.pickMetricCount(metrics, [
      'rugHeuristicsGateCount',
      'rug_heuristics_gate_count',
      'rug_heuristics_gate',
    ])
    const honeypotGateHits = this.pickMetricCount(metrics, [
      'honeypotGateCount',
      'honeypot_gate_count',
      'honeypot_gate',
    ])
    const creatorControlGateHits = this.pickMetricCount(metrics, [
      'creatorControlGateCount',
      'creator_control_gate_count',
      'creator_control_gate',
    ])
    const marketRiskGateTotal =
      tokenLiquidityGateHits +
      holderConcentrationGateHits +
      rugHeuristicsGateHits +
      honeypotGateHits +
      creatorControlGateHits
    const driftAlertHtml = driftAlerts.length
      ? driftAlerts.map((alert) => `<div class="notice warning">${this.escapeHtml(alert)}</div>`).join('')
      : '<div class="notice">No profile drift alerts detected from current telemetry.</div>'
    const tokenExposureRows = this.renderTokenExposureRows(observedTokensByWallet)
    const replay = this.buildReplaySimulation(data.decisions, Number(maxRiskScore) || 50)
    const replayRows = replay.samples
      .map(
        (row) => `
          <tr>
            <td>${this.escapeHtml(row.signalId)}</td>
            <td>${this.escapeHtml(row.actual)}</td>
            <td>${this.escapeHtml(row.simulated)}</td>
            <td>${this.escapeHtml(String(row.riskScore))}</td>
            <td>${this.escapeHtml(row.reason)}</td>
          </tr>
        `,
      )
      .join('')

    const profileCards = watchlist
      .slice(0, 18)
      .map((wallet) => {
        const profile = sourceProfiles[String(wallet)] || {}
        const observedTokens = observedTokensByWallet.get(String(wallet)) || []
        const attribution = walletAttribution.get(String(wallet))
        return this.renderSourceWalletProfileCard(String(wallet), profile, observedTokens, attribution)
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

    const blockedBuyRows = blockedBuyEntries
      .map(
        (entry) => `
          <tr>
            <td>${this.escapeHtml(String(entry.timestamp || ''))}</td>
            <td>${this.escapeHtml(String(entry.tokenMint || entry.token_mint || ''))}</td>
            <td>${this.escapeHtml(String(entry.sourceWallet || entry.source_wallet || ''))}</td>
            <td>${this.escapeHtml(String(entry.amountSol || entry.amount_sol || ''))}</td>
            <td>${this.escapeHtml(String(entry.reason || ''))}</td>
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
            <td>${this.explainDecision(entry)}</td>
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
      <div class="section-header">
        <div class="section-header-copy">
          <h2>Operator Snapshot</h2>
          <p class="section-subtitle">Immediate scan line for posture, coverage, and backlog before you drill into controls or telemetry tables.</p>
        </div>
      </div>
      <div class="signal-strip">
        <span class="signal-pill"><strong>Receiver</strong>${data.status.enabled ? 'Enabled' : 'Disabled'}</span>
        <span class="signal-pill"><strong>Execution</strong>${currentExecutionMode}</span>
        <span class="signal-pill"><strong>Mode</strong>${currentMode}</span>
        <span class="signal-pill"><strong>Profile</strong>${currentProfile}</span>
        <span class="signal-pill"><strong>Buy Once/Token</strong>${buyOncePerToken ? 'on' : 'off'}</span>
        <span class="signal-pill"><strong>Pre-Buy Checks</strong>${preBuyChecksEnabledCount}/5 on</span>
        <span class="signal-pill"><strong>Min Liquidity</strong>$${minLiquidityUsdValue || 0}</span>
        <span class="signal-pill"><strong>Max Position</strong>${maxPositionSizeSolValue || 'n/a'} SOL</span>
        <span class="signal-pill"><strong>Watchlist</strong>${watchlistCount}</span>
        <span class="signal-pill"><strong>Dead Letters</strong>${failureCount}</span>
      </div>
      <div class="summary-grid">
        <article class="summary-tile"><p class="summary-tile-label">Profile Coverage</p><div class="summary-tile-value">${profileCount}</div><p class="summary-tile-copy">Source-wallet presets currently available to guide copy-trade behavior.</p></article>
        <article class="summary-tile"><p class="summary-tile-label">Attributed Wallets</p><div class="summary-tile-value">${attributedWalletCount}</div><p class="summary-tile-copy">Wallets with enough telemetry to show attribution, drift, or replay context.</p></article>
        <article class="summary-tile"><p class="summary-tile-label">Decision History</p><div class="summary-tile-value">${decisionCount}</div><p class="summary-tile-copy">Recent decision records available for replay and guardrail tuning.</p></article>
        <article class="summary-tile"><p class="summary-tile-label">Alert Pressure</p><div class="summary-tile-value">${driftAlertCount}</div><p class="summary-tile-copy">Drift alerts currently calling for review before loosening execution posture.</p></article>
      </div>
    </section>

    <section class="section">
      <div class="section-header">
        <div class="section-header-copy">
          <h2>Portfolio Strategy</h2>
          <p class="section-subtitle">Multi-signal confirmation and open-position tracking for smart-money execution.</p>
        </div>
      </div>
      <div class="summary-grid">
        <article class="summary-tile"><p class="summary-tile-label">Active Positions</p><div class="summary-tile-value">${strategyActivePositions}</div><p class="summary-tile-copy">Tokens currently open in the smart-money portfolio.</p></article>
        <article class="summary-tile"><p class="summary-tile-label">Watched Tokens</p><div class="summary-tile-value">${strategyWatchedTokens}</div><p class="summary-tile-copy">Unique token mints seen by the confirmation engine.</p></article>
        <article class="summary-tile"><p class="summary-tile-label">Confirmed Buys</p><div class="summary-tile-value">${strategyConfirmedBuys}</div><p class="summary-tile-copy">Buy decisions promoted after repeated confirmation.</p></article>
        <article class="summary-tile"><p class="summary-tile-label">Confirmed Sells</p><div class="summary-tile-value">${strategyConfirmedSells}</div><p class="summary-tile-copy">Exit decisions promoted after confirmation.</p></article>
      </div>
    </section>

    <section class="section" id="smart-money">
      <div class="section-header">
        <div class="section-header-copy">
          <h2>Smart-Money Canary Telemetry</h2>
          <p class="section-subtitle">Live readout for SMART_MONEY_TRADE flow and token market-risk gate pressure.</p>
        </div>
      </div>
      <div class="summary-grid">
        <article class="summary-tile"><p class="summary-tile-label">Smart-Money Signals</p><div class="summary-tile-value">${smartMoneySignals.length}</div><p class="summary-tile-copy">Total SMART_MONEY_TRADE decisions captured in the current feed.</p></article>
        <article class="summary-tile"><p class="summary-tile-label">Execution Rate</p><div class="summary-tile-value">${smartMoneyExecutionRate}%</div><p class="summary-tile-copy">Executed ${smartMoneyExecuted.length} of ${smartMoneySignals.length}; blocked ${smartMoneyBlocked.length}.</p></article>
        <article class="summary-tile"><p class="summary-tile-label">Market Risk Gate Hits</p><div class="summary-tile-value">${marketRiskGateTotal}</div><p class="summary-tile-copy">Token market checks currently rejecting risky live entries.</p></article>
        <article class="summary-tile"><p class="summary-tile-label">Canary Posture</p><div class="summary-tile-value">${currentExecutionMode === 'live' && data.status.enabled ? 'LIVE' : 'SAFE'}</div><p class="summary-tile-copy">Mode ${currentExecutionMode} | ${data.status.enabled ? 'enabled' : 'disabled'} | max risk ${maxRiskScore || 'n/a'}.</p></article>
      </div>
      <div class="micro-grid" style="margin-top: 10px;">
        <div class="card"><p class="eyebrow">Liquidity Gate</p><p><strong>${tokenLiquidityGateHits}</strong> blocks</p></div>
        <div class="card"><p class="eyebrow">Holder Concentration</p><p><strong>${holderConcentrationGateHits}</strong> blocks</p></div>
        <div class="card"><p class="eyebrow">Rug Heuristics</p><p><strong>${rugHeuristicsGateHits}</strong> blocks</p></div>
        <div class="card"><p class="eyebrow">Honeypot</p><p><strong>${honeypotGateHits}</strong> blocks</p></div>
        <div class="card"><p class="eyebrow">Creator Control</p><p><strong>${creatorControlGateHits}</strong> blocks</p></div>
      </div>
    </section>

    <section class="section table-card" id="trend-charts">
      <div class="section-header">
        <div class="section-header-copy">
          <h2>Durable Trend Charts</h2>
          <p class="section-subtitle">Persisted analytics history from snapshots. Use this to spot velocity and regime changes.</p>
        </div>
      </div>
      <div class="micro-grid trend-toolbar">
        <label>Range (hours)
          <select id="trend-range">
            <option value="24">24h</option>
            <option value="72">72h</option>
            <option value="168" selected>7d</option>
            <option value="336">14d</option>
            <option value="720">30d</option>
          </select>
        </label>
        <button class="fx-button secondary" id="capture-snapshot" type="button">Capture Snapshot</button>
        <div class="notice" id="trend-last-updated">Last snapshot: waiting for history...</div>
        <div class="notice" id="trend-status">Loading persisted trend snapshots...</div>
      </div>
      <div class="micro-grid" style="margin-top: 10px;">
        <div class="card"><p class="eyebrow">Signal Throughput</p><div class="chart-legend" id="legend-throughput"></div><canvas id="chart-throughput" height="160"></canvas></div>
        <div class="card"><p class="eyebrow">Execution Outcomes</p><div class="chart-legend" id="legend-outcomes"></div><canvas id="chart-outcomes" height="160"></canvas></div>
        <div class="card"><p class="eyebrow">Risk + Queue</p><div class="chart-legend" id="legend-risk"></div><canvas id="chart-risk" height="160"></canvas></div>
        <div class="card"><p class="eyebrow">Attribution Baselines</p><div class="chart-legend" id="legend-attribution"></div><div class="notice" id="chart-attribution-empty">Waiting for realized trade outcomes. Tracked-wallet count will still populate immediately.</div><canvas id="chart-attribution" height="160"></canvas></div>
      </div>
    </section>

    <section class="section">
      <div class="section-header">
        <div class="section-header-copy">
          <h2>Flight Path</h2>
          <p class="section-subtitle">Understand the control flow in 30 seconds.</p>
        </div>
      </div>
      <div class="help-grid">
        <article class="help-card"><p class="eyebrow">Step 1</p><h3>Set Guardrails</h3><p>Apply preset or custom risk limits before enabling execution.</p></article>
        <article class="help-card"><p class="eyebrow">Step 2</p><h3>Curate Wallets</h3><p>Keep source and tracked wallets clean. Flagged rapid-dumper wallets are enforced.</p></article>
        <article class="help-card"><p class="eyebrow">Step 3</p><h3>Watch Drift</h3><p>Monitor attribution, token exposure, and replay mismatches to tune profiles.</p></article>
      </div>
      <div class="quick-nav">
        <a class="fx-button secondary" href="#controls">Controls</a>
        <a class="fx-button secondary" href="#smart-money">Smart Money</a>
        <a class="fx-button secondary" href="#profiles">Profiles</a>
        <a class="fx-button secondary" href="#attribution">Attribution</a>
        <a class="fx-button secondary" href="#exposure">Exposure</a>
        <a class="fx-button secondary" href="#decision-feed">Decisions</a>
        <a class="fx-button secondary" href="#simulation">Simulation</a>
      </div>
    </section>

    <section class="section" id="controls">
      <div class="section-header">
        <div class="section-header-copy">
          <h2>Web Control Surface</h2>
          <p class="section-subtitle">The same live backend can now be controlled from this website as well as Telegram admin commands.</p>
        </div>
      </div>
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
            <label>Stop Loss %
              <input name="stopLossPercentage" type="number" step="1" min="1" max="99" value="${stopLossPercentage}" />
            </label>
            <label>Take Profit %
              <input name="takeProfitPercentage" type="number" step="1" min="1" max="999" value="${takeProfitPercentage}" />
            </label>
            <label>Min alert quality score
              <input name="minAlertQualityScore" type="number" step="1" min="0" max="100" value="${minAlertQualityScore}" />
            </label>
            <label>Min trace alerts
              <input name="minTraceAlerts" type="number" step="1" min="0" value="${minTraceAlerts}" />
            </label>
            <label style="display:flex;align-items:center;gap:10px;grid-column:1 / -1;">
              <input name="buyOncePerToken" type="checkbox" ${buyOncePerToken ? 'checked' : ''} />
              Buy once per token (reject repeat buys for any token already bought once)
            </label>
            <fieldset style="grid-column:1 / -1;border:1px solid #444;padding:8px 12px;border-radius:6px;">
              <legend>Pre-Buy Safety Checks</legend>
              <label style="display:flex;align-items:center;gap:8px;">
                <input name="preBuyCheckSellRoute" type="checkbox" ${preBuyCheckSellRoute ? 'checked' : ''} />
                Reverse sell route exists before buy
              </label>
              <label style="display:flex;align-items:center;gap:8px;">
                <input name="preBuyCheckFreezeAuthority" type="checkbox" ${preBuyCheckFreezeAuthority ? 'checked' : ''} />
                Block tokens with freeze authority
              </label>
              <label style="display:flex;align-items:center;gap:8px;">
                <input name="preBuyCheckToken2022Extensions" type="checkbox" ${preBuyCheckToken2022Extensions ? 'checked' : ''} />
                Block risky Token-2022 extensions
              </label>
              <label style="display:flex;align-items:center;gap:8px;">
                <input name="preBuyCheckHoneypot" type="checkbox" ${preBuyCheckHoneypot ? 'checked' : ''} />
                Block honeypot metadata flags
              </label>
              <label style="display:flex;align-items:center;gap:8px;">
                <input name="preBuyCheckSuspiciousTax" type="checkbox" ${preBuyCheckSuspiciousTax ? 'checked' : ''} />
                Block suspicious buy/sell tax metadata
              </label>
            </fieldset>
            <label>MEV Service
              <select name="mevService">
                <option value="none" ${mevServiceValue === 'none' ? 'selected' : ''}>None</option>
                <option value="jito" ${mevServiceValue === 'jito' ? 'selected' : ''}>Jito</option>
                <option value="nozomi" ${mevServiceValue === 'nozomi' ? 'selected' : ''}>Nozomi</option>
                <option value="zero_slot" ${mevServiceValue === 'zero_slot' ? 'selected' : ''}>Zero Slot</option>
              </select>
            </label>
            <label>Max concurrent trades
              <input name="maxConcurrentTrades" type="number" step="1" min="1" max="50" value="${maxConcurrentTrades}" />
            </label>
            <label>Max position size (SOL)
              <input name="maxPositionSizeSol" type="number" step="0.0001" min="0.001" value="${maxPositionSizeSolValue}" />
            </label>
            <label>Min liquidity (USD)
              <input name="minLiquidityUsd" type="number" step="1" min="0" value="${minLiquidityUsdValue}" />
            </label>
            <label>Target wallet (copy-trade)
              <input name="targetWallet" type="text" placeholder="Base58 wallet address" value="${targetWalletValue}" />
            </label>
            <fieldset style="grid-column:1 / -1;border:1px solid #444;padding:8px 12px;border-radius:6px;">
              <legend>Allowed DEXes</legend>
              <label style="display:flex;align-items:center;gap:8px;">
                <input name="allowedDexPumpFun" type="checkbox" ${allowedDexesValue.includes('pump_fun') ? 'checked' : ''} />
                Pump.fun
              </label>
              <label style="display:flex;align-items:center;gap:8px;">
                <input name="allowedDexRaydium" type="checkbox" ${allowedDexesValue.includes('raydium') ? 'checked' : ''} />
                Raydium
              </label>
            </fieldset>
            <label style="display:flex;align-items:center;gap:10px;grid-column:1 / -1;">
              <input name="autoBlockSourceWalletAfterBuy" type="checkbox" ${autoBlockSourceWallet ? 'checked' : ''} />
              Auto-block source wallet after buy (one-shot copy-trade)
            </label>
            <label style="grid-column:1 / -1;">Denylist (one mint per line)
              <textarea name="denylist" rows="4" style="width:100%;font-family:monospace;font-size:12px;">${denylistValue}</textarea>
            </label>
            <label style="grid-column:1 / -1;">Allowlist (one mint per line — empty = all allowed)
              <textarea name="allowlist" rows="4" style="width:100%;font-family:monospace;font-size:12px;">${allowlistValue}</textarea>
            </label>
            <div class="button-row">
              <button class="primary" type="submit">Apply Settings</button>
            </div>
            <div class="button-row" id="safe-preset-buttons">
              <button type="button" data-safe-preset="paper-test">Paper Test</button>
              <button type="button" data-safe-preset="strict-canary-live">Strict Canary Live</button>
              <button type="button" data-safe-preset="cautious-live">Cautious Live</button>
              <button type="button" data-safe-preset="aggressive-live">Aggressive Live</button>
              <button type="button" data-one-click-buy-once="true">Enable Buy Once</button>
              <button type="button" data-one-click-buy-once="false">Disable Buy Once</button>
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

    <section class="section" id="profiles">
      <div class="section-header">
        <div class="section-header-copy">
          <h2>Source Wallet Profiles</h2>
          <p class="section-subtitle">Watchlist size ${watchlistCount} | Profile count ${profileCount}</p>
        </div>
      </div>
      <div class="profiles">${profileCards || '<article class="empty-state"><strong>No watchlisted wallets yet.</strong><span>Add source wallets to start seeing profile cards, observed tokens, and attribution overlays.</span></article>'}</div>
    </section>

    <section class="section">
      <div class="section-header">
        <div class="section-header-copy">
          <h2>Profile Drift Alerts</h2>
          <p class="section-subtitle">Automatic drift checks for sudden quality degradation, risk increase, and rapid-dump spikes.</p>
        </div>
        <div class="table-meta"><span class="badge">Active alerts: ${driftAlertCount}</span></div>
      </div>
      <div class="control-form">${driftAlertHtml}</div>
    </section>

    <section class="section table-card" id="attribution">
      <div class="section-header">
        <div class="section-header-copy">
          <h2>Wallet Attribution</h2>
          <p class="section-subtitle">Execution quality attribution by source wallet.</p>
        </div>
        <div class="table-meta"><span class="badge">Wallets: ${attributedWalletCount}</span><span class="badge">Journal rows: ${journalCount}</span></div>
      </div>
      <table>
        <thead><tr><th>Source Wallet</th><th>Trades</th><th>Wins</th><th>Win Rate</th><th>Realized PnL</th><th>Avg Slippage</th><th>Lifecycle</th></tr></thead>
        <tbody>${attributionRows || '<tr><td colspan="7">No attribution data available yet.</td></tr>'}</tbody>
      </table>
    </section>

    <section class="section table-card" id="exposure">
      <div class="section-header">
        <div class="section-header-copy">
          <h2>Token Exposure</h2>
          <p class="section-subtitle">Current observed token breadth per source wallet.</p>
        </div>
        <div class="table-meta"><span class="badge">Wallets: ${tokenExposureCount}</span></div>
      </div>
      <table>
        <thead><tr><th>Source Wallet</th><th>Distinct Tokens</th><th>Suggested Cap</th><th>Tokens</th></tr></thead>
        <tbody>${tokenExposureRows || '<tr><td colspan="4">No token exposure telemetry yet.</td></tr>'}</tbody>
      </table>
    </section>

    <section class="section table-card">
      <div class="section-header">
        <div class="section-header-copy">
          <h2>Blocked Buy Checks</h2>
          <p class="section-subtitle">Most recent buys rejected before execution because the token failed pre-buy safety validation.</p>
        </div>
        <div class="table-meta"><span class="badge">Blocked buys: ${blockedBuyEntries.length}</span></div>
      </div>
      <table>
        <thead><tr><th>Time</th><th>Token</th><th>Source</th><th>Amount</th><th>Reason</th></tr></thead>
        <tbody>${blockedBuyRows || '<tr><td colspan="5">No blocked buys from pre-buy safety checks yet.</td></tr>'}</tbody>
      </table>
    </section>

    <section class="section table-card">
      <div class="section-header">
        <div class="section-header-copy">
          <h2>Trade Journal</h2>
          <p class="section-subtitle">Most recent execution and gating records visible to the operator.</p>
        </div>
        <div class="table-meta"><span class="badge">Entries: ${journalCount}</span></div>
      </div>
      <table>
        <thead><tr><th>Time</th><th>Status</th><th>Action</th><th>Token</th><th>Source</th><th>Profile</th><th>Amount</th><th>Reason</th></tr></thead>
        <tbody>${journalRows || '<tr><td colspan="8">No journal entries yet.</td></tr>'}</tbody>
      </table>
    </section>

    <section class="section table-card">
      <div class="section-header">
        <div class="section-header-copy">
          <h2>Dead Letters</h2>
          <p class="section-subtitle">Signals that failed execution and may need replay or root-cause review.</p>
        </div>
        <div class="table-meta"><span class="badge">Queued: ${failureCount}</span></div>
      </div>
      <table>
        <thead><tr><th>Signal ID</th><th>Status</th><th>Type</th><th>Source</th><th>Retries</th><th>Reason</th></tr></thead>
        <tbody>${failureRows || '<tr><td colspan="6">No failed signals queued.</td></tr>'}</tbody>
      </table>
    </section>

    <section class="section table-card" id="decision-feed">
      <div class="section-header">
        <div class="section-header-copy">
          <h2>Decision Feed</h2>
          <p class="section-subtitle">Recent acceptance, rejection, and safety-gate rationale for the receiver.</p>
        </div>
        <div class="table-meta"><span class="badge">Decisions: ${decisionCount}</span></div>
      </div>
      <table>
        <thead><tr><th>Signal ID</th><th>Status</th><th>Type</th><th>Risk</th><th>Safety</th><th>Explanation</th></tr></thead>
        <tbody>${decisionRows || '<tr><td colspan="6">No decisions yet.</td></tr>'}</tbody>
      </table>
    </section>

    <section class="section table-card" id="simulation">
      <div class="section-header">
        <div class="section-header-copy">
          <h2>Simulation Replay</h2>
          <p class="section-subtitle">Replay of recent decisions against current max risk gate (${maxRiskScore || 'n/a'}).</p>
        </div>
        <div class="table-meta"><span class="badge">Samples: ${replay.total}</span><span class="badge">Mismatches: ${replay.mismatchCount}</span></div>
      </div>
      <div class="micro-grid">
        ${this.renderScoreCard('Replayed', replay.total)}
        ${this.renderScoreCard('Would Execute', replay.wouldExecute)}
        ${this.renderScoreCard('Would Block', replay.wouldBlock)}
        ${this.renderScoreCard('Gate Mismatches', replay.mismatchCount)}
      </div>
      <table>
        <thead><tr><th>Signal ID</th><th>Actual</th><th>Simulated</th><th>Risk</th><th>Reason</th></tr></thead>
        <tbody>${replayRows || '<tr><td colspan="5">No decision history to replay.</td></tr>'}</tbody>
      </table>
    </section>

      `,
      scriptHtml: `<script>
      const controlStatus = document.getElementById('control-status')
      const trackedWalletList = document.getElementById('tracked-wallet-list')
      const trackedWalletForm = document.getElementById('tracked-wallet-form')
      const sourceWalletForm = document.getElementById('source-wallet-form')
      const tradingSettingsForm = document.getElementById('trading-settings-form')
      const trendRange = document.getElementById('trend-range')
      const trendStatus = document.getElementById('trend-status')
      const trendLastUpdated = document.getElementById('trend-last-updated')
      const captureSnapshotButton = document.getElementById('capture-snapshot')
      const attributionEmptyState = document.getElementById('chart-attribution-empty')

      function applyTone(element, tone) {
        if (!element) return
        element.classList.remove('success', 'warning', 'error')
        if (tone === 'success' || tone === 'warning' || tone === 'error') {
          element.classList.add(tone)
        }
      }

      function inferStatusTone(message, fallbackTone) {
        const normalized = String(message || '').toLowerCase()
        if (/fail|error|refus|invalid|unsupported|could not/.test(normalized)) return 'error'
        if (/disabled|paused|kill switch|tighten risk|do not track|flagged|blocked|warning/.test(normalized)) {
          return 'warning'
        }
        return fallbackTone || 'success'
      }

      function setControlStatus(message, tone) {
        controlStatus.textContent = message
        applyTone(controlStatus, inferStatusTone(message, tone))
      }

      function setTrendStatus(message, tone) {
        if (!trendStatus) return
        trendStatus.textContent = message
        applyTone(trendStatus, tone)
      }

      function formatTrendValue(value, suffix) {
        if (value == null || value === '') return 'n/a'
        if (typeof value === 'number' && Number.isFinite(value)) {
          if (suffix === '%') {
            return value.toFixed(Math.abs(value) >= 10 ? 0 : 2) + suffix
          }
          return Number.isInteger(value) ? String(value) : value.toFixed(2)
        }
        return String(value) + (suffix || '')
      }

      function formatRelativeTime(timestamp) {
        if (!timestamp) return 'waiting for history...'
        const date = new Date(timestamp)
        if (!Number.isFinite(date.getTime())) return 'waiting for history...'
        const deltaMs = Date.now() - date.getTime()
        if (deltaMs < 60_000) return 'just now'
        const minutes = Math.floor(deltaMs / 60_000)
        if (minutes < 60) return minutes + 'm ago'
        const hours = Math.floor(minutes / 60)
        if (hours < 24) return hours + 'h ago'
        const days = Math.floor(hours / 24)
        return days + 'd ago'
      }

      function updateTrendTimestamp(timestamp) {
        if (!trendLastUpdated) return
        trendLastUpdated.textContent = 'Last snapshot: ' + formatRelativeTime(timestamp)
      }

      function renderChartLegend(legendId, latestPoint, lines) {
        const legend = document.getElementById(legendId)
        if (!legend) return
        if (!latestPoint) {
          legend.innerHTML = '<span class="legend-chip muted">No snapshot loaded</span>'
          return
        }

        legend.innerHTML = lines.map((line) => {
          const rawValue = latestPoint[line.key]
          const value = rawValue == null ? 'n/a' : formatTrendValue(rawValue, line.suffix)
          return '<span class="legend-chip"><span class="legend-swatch" style="background:' + line.color + '"></span>'
            + line.label + ': ' + value + '</span>'
        }).join('')
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

      function drawLineChart(canvasId, series, lines) {
        const canvas = document.getElementById(canvasId)
        if (!(canvas instanceof HTMLCanvasElement)) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const width = canvas.width = canvas.clientWidth || 560
        const height = canvas.height = canvas.height || 160
        ctx.clearRect(0, 0, width, height)

        if (!Array.isArray(series) || series.length < 2) {
          ctx.fillStyle = 'rgba(145,165,210,0.8)'
          ctx.fillText('Not enough snapshots yet.', 14, 20)
          return
        }

        const allValues = lines.flatMap((line) => series.map((point) => Number(point[line.key] || 0)))
        const min = Math.min(...allValues)
        const max = Math.max(...allValues)
        const span = Math.max(1, max - min)

        const px = (index) => 12 + (index / Math.max(1, series.length - 1)) * (width - 24)
        const py = (value) => height - 12 - ((value - min) / span) * (height - 24)

        ctx.strokeStyle = 'rgba(255,40,60,0.15)'
        ctx.lineWidth = 1
        for (let i = 0; i < 4; i++) {
          const y = 12 + i * ((height - 24) / 3)
          ctx.beginPath()
          ctx.moveTo(10, y)
          ctx.lineTo(width - 10, y)
          ctx.stroke()
        }

        lines.forEach((line) => {
          ctx.strokeStyle = line.color
          ctx.lineWidth = 2
          ctx.beginPath()
          series.forEach((point, index) => {
            const x = px(index)
            const y = py(Number(point[line.key] || 0))
            if (index === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          })
          ctx.stroke()
        })
      }

      async function loadTrendCharts() {
        const hours = Number((trendRange && trendRange.value) || 168)
        try {
          const payload = await requestJson('/api/analytics/trends?hours=' + hours, { method: 'GET' })
          const snapshots = Array.isArray(payload.snapshots) ? payload.snapshots : []
          const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null
          setTrendStatus(
            snapshots.length > 0
              ? 'Loaded ' + snapshots.length + ' persisted snapshots.'
              : 'No persisted snapshots yet. Use the dashboard for a few minutes to collect trend data.'
          )
          updateTrendTimestamp(latest && latest.timestamp)

          drawLineChart('chart-throughput', snapshots, [
            { key: 'receivedTotal', color: '#ff2233' },
            { key: 'executedTotal', color: '#ff7744' },
          ])
          renderChartLegend('legend-throughput', latest, [
            { key: 'receivedTotal', color: '#ff2233', label: 'Received' },
            { key: 'executedTotal', color: '#ff7744', label: 'Executed' },
          ])
          drawLineChart('chart-outcomes', snapshots, [
            { key: 'blockedTotal', color: '#ffbc68' },
            { key: 'failedTotal', color: '#ff5a7a' },
          ])
          renderChartLegend('legend-outcomes', latest, [
            { key: 'blockedTotal', color: '#ffbc68', label: 'Blocked' },
            { key: 'failedTotal', color: '#ff5a7a', label: 'Failed' },
          ])
          drawLineChart('chart-risk', snapshots, [
            { key: 'maxRiskScore', color: '#cc0820' },
            { key: 'deadLetterCount', color: '#ff2233' },
            { key: 'watchlistSize', color: '#ff7744' },
          ])
          renderChartLegend('legend-risk', latest, [
            { key: 'maxRiskScore', color: '#cc0820', label: 'Max Risk' },
            { key: 'deadLetterCount', color: '#ff2233', label: 'Dead Letters' },
            { key: 'watchlistSize', color: '#ff7744', label: 'Watchlist' },
          ])
          drawLineChart('chart-attribution', snapshots, [
            { key: 'trackedWalletCount', color: '#ff2233' },
            { key: 'avgWalletWinRate', color: '#ff7744' },
            { key: 'avgWalletPnl', color: '#ffbc68' },
          ])
          renderChartLegend('legend-attribution', latest, [
            { key: 'trackedWalletCount', color: '#ff2233', label: 'Tracked Wallets' },
            { key: 'avgWalletWinRate', color: '#ff7744', label: 'Avg Win Rate', suffix: '%' },
            { key: 'avgWalletPnl', color: '#ffbc68', label: 'Avg PnL', suffix: '%' },
          ])

          if (attributionEmptyState) {
            const noAttributionTelemetry = !latest || (latest.avgWalletWinRate == null && latest.avgWalletPnl == null)
            attributionEmptyState.textContent = noAttributionTelemetry
              ? 'Waiting for realized trade outcomes. Tracked-wallet count is live, but win-rate and PnL history need journaled executions first.'
              : 'Attribution telemetry is live and historical.'
            attributionEmptyState.classList.toggle('warning', noAttributionTelemetry)
          }
        } catch (error) {
          setTrendStatus((error && error.message) ? error.message : 'Failed to load trend charts.', 'error')
          if (trendLastUpdated) {
            trendLastUpdated.textContent = 'Last snapshot: unavailable'
          }
        }
      }

      async function captureSnapshotNow() {
        if (captureSnapshotButton instanceof HTMLButtonElement) {
          captureSnapshotButton.disabled = true
          captureSnapshotButton.textContent = 'Capturing...'
        }

        try {
          const response = await requestJson('/api/analytics/snapshot', { method: 'POST' })
          setTrendStatus(response.message || 'Analytics snapshot captured.', 'success')
          await loadTrendCharts()
        } catch (error) {
          setTrendStatus(error.message || 'Failed to capture snapshot.', 'error')
        } finally {
          if (captureSnapshotButton instanceof HTMLButtonElement) {
            captureSnapshotButton.disabled = false
            captureSnapshotButton.textContent = 'Capture Snapshot'
          }
        }
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
            + '<div class="button-row">'
            + (wallet.chain === 'solana'
              ? '<button type="button" class="fx-button secondary" data-open-wallet-profile="' + escapeHtml(wallet.displayAddress) + '">Profile</button>'
              : '')
            + '<button type="button" class="fx-button secondary" data-open-graph="' + escapeHtml(wallet.displayAddress) + '">Open Graph</button>'
            + '<button type="button" data-remove-wallet="' + escapeHtml(wallet.displayAddress) + '">Remove</button>'
            + '</div>'
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
              setControlStatus(payload.message || ('Trading action ' + action + ' completed.'), 'success')
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
          buyOncePerToken: formData.get('buyOncePerToken') !== null,
          preBuyCheckSellRoute: formData.get('preBuyCheckSellRoute') !== null,
          preBuyCheckFreezeAuthority: formData.get('preBuyCheckFreezeAuthority') !== null,
          preBuyCheckToken2022Extensions: formData.get('preBuyCheckToken2022Extensions') !== null,
          preBuyCheckHoneypot: formData.get('preBuyCheckHoneypot') !== null,
          preBuyCheckSuspiciousTax: formData.get('preBuyCheckSuspiciousTax') !== null,
          stopLossPercentage: parseOptionalNumber(formData.get('stopLossPercentage')),
          takeProfitPercentage: parseOptionalNumber(formData.get('takeProfitPercentage')),
          mevService: String(formData.get('mevService') || ''),
          maxConcurrentTrades: parseOptionalNumber(formData.get('maxConcurrentTrades')),
          maxPositionSizeSol: parseOptionalNumber(formData.get('maxPositionSizeSol')),
          minLiquidityUsd: parseOptionalNumber(formData.get('minLiquidityUsd')),
          allowedDexes: [
            ...(formData.get('allowedDexPumpFun') !== null ? ['pump_fun'] : []),
            ...(formData.get('allowedDexRaydium') !== null ? ['raydium'] : []),
          ],
          targetWallet: String(formData.get('targetWallet') || ''),
          autoBlockSourceWalletAfterBuy: formData.get('autoBlockSourceWalletAfterBuy') !== null,
          denylist: String(formData.get('denylist') || '').split('\n').map((s: string) => s.trim()).filter(Boolean),
          allowlist: String(formData.get('allowlist') || '').split('\n').map((s: string) => s.trim()).filter(Boolean),
        }

        try {
          const response = await requestJson('/api/control/trading/settings', {
            method: 'POST',
            body: JSON.stringify(payload),
          })
          setControlStatus(response.message || 'Trading settings updated.', 'success')
          window.setTimeout(() => window.location.reload(), 700)
        } catch (error) {
          setControlStatus(error.message || 'Trading settings update failed.', 'error')
        }
      })

      function applyPresetToForm(preset) {
        const set = (name, value) => {
          const field = tradingSettingsForm.querySelector('[name="' + name + '"]')
          if (!field) return
          if (field instanceof HTMLInputElement && field.type === 'checkbox') {
            field.checked = Boolean(value)
            return
          }
          field.value = String(value)
        }

        if (preset === 'paper-test') {
          set('executionMode', 'paper')
          set('profile', 'conservative')
          set('mode', 'signal_based')
          set('buyAmountSol', '0.005')
          set('maxRiskScore', '35')
          set('slippage', '1')
          set('minAlertQualityScore', '50')
          set('minTraceAlerts', '1')
          set('buyOncePerToken', true)
          return
        }

        if (preset === 'cautious-live') {
          set('executionMode', 'live')
          set('profile', 'conservative')
          set('mode', 'signal_based')
          set('buyAmountSol', '0.01')
          set('maxRiskScore', '45')
          set('slippage', '2')
          set('minAlertQualityScore', '60')
          set('minTraceAlerts', '2')
          set('buyOncePerToken', true)
          return
        }

        if (preset === 'strict-canary-live') {
          set('executionMode', 'live')
          set('profile', 'conservative')
          set('mode', 'signal_based')
          set('buyAmountSol', '0.002')
          set('maxRiskScore', '55')
          set('slippage', '1')
          set('minAlertQualityScore', '70')
          set('minTraceAlerts', '1')
          set('maxConcurrentTrades', '1')
          set('maxPositionSizeSol', '0.01')
          set('minLiquidityUsd', '10000')
          set('stopLossPercentage', '12')
          set('takeProfitPercentage', '18')
          set('buyOncePerToken', true)
          return
        }

        if (preset === 'aggressive-live') {
          set('executionMode', 'live')
          set('profile', 'aggressive')
          set('mode', 'copy_trade')
          set('buyAmountSol', '0.02')
          set('maxRiskScore', '60')
          set('slippage', '3')
          set('minAlertQualityScore', '35')
          set('minTraceAlerts', '0')
          set('buyOncePerToken', true)
        }
      }

      document.querySelectorAll('[data-safe-preset]').forEach((button) => {
        button.addEventListener('click', async () => {
          const preset = button.getAttribute('data-safe-preset')
          if (!preset) return

          applyPresetToForm(preset)
          setControlStatus('Preset ' + preset + ' loaded. Applying settings...', 'warning')

          try {
            await tradingSettingsForm.requestSubmit()
          } catch (error) {
            setControlStatus('Failed to apply preset settings.', 'error')
          }
        })
      })

      document.querySelectorAll('[data-one-click-buy-once]').forEach((button) => {
        button.addEventListener('click', async () => {
          const enabled = button.getAttribute('data-one-click-buy-once') === 'true'
          try {
            const response = await requestJson('/api/control/trading/settings', {
              method: 'POST',
              body: JSON.stringify({ buyOncePerToken: enabled }),
            })
            setControlStatus(response.message || ('Buy once per token set to ' + enabled + '.'), 'success')
            window.setTimeout(() => window.location.reload(), 700)
          } catch (error) {
            setControlStatus(error.message || 'Failed to update buy-once-per-token setting.', 'error')
          }
        })
      })

      if (trendRange) {
        trendRange.addEventListener('change', loadTrendCharts)
      }

      if (captureSnapshotButton) {
        captureSnapshotButton.addEventListener('click', captureSnapshotNow)
      }

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
          setControlStatus(response.message || 'Source wallet controls updated.', 'success')
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
          setControlStatus(response.message || 'Tracked wallets updated.', response.doNotTrack ? 'warning' : 'success')
          await loadTrackedWallets()
        } catch (error) {
          setControlStatus(error.message || 'Tracked wallet update failed.', 'error')
        }
      })

      trackedWalletList.addEventListener('click', async (event) => {
        const target = event.target
        if (!(target instanceof HTMLButtonElement)) return

        const wallet = target.getAttribute('data-remove-wallet')
        if (wallet) {
          try {
            const response = await requestJson('/api/control/tracked-wallets', {
              method: 'POST',
              body: JSON.stringify({ action: 'remove', wallet }),
            })
            setControlStatus(response.message || 'Tracked wallet removed.', 'success')
            await loadTrackedWallets()
          } catch (error) {
            setControlStatus(error.message || 'Tracked wallet removal failed.', 'error')
          }
          return
        }

        const graphWallet = target.getAttribute('data-open-graph')
        if (graphWallet) {
          window.location.assign('/graph/' + encodeURIComponent(graphWallet))
          return
        }

        const profileWallet = target.getAttribute('data-open-wallet-profile')
        if (profileWallet) {
          window.location.assign('/dashboard/wallet-profile/' + encodeURIComponent(profileWallet))
        }
      })

      loadTrackedWallets()
      loadTrendCharts()
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
    attribution?: {
      trades: number
      wins: number
      winRatePct: number
      realizedPnl: number
      avgSlippage: number | null
      rapidDumpCount: number
    },
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
    const profileUpdatedAt = this.pickDate(profile, ['updatedAt', 'updated_at', 'lastUpdatedAt', 'last_updated_at'])

    const winRate = winRateRaw == null ? null : winRateRaw <= 1 ? Math.round(winRateRaw * 100) : Math.round(winRateRaw)
    const actions = Array.isArray(profile.allowedActions)
      ? profile.allowedActions.map((a) => this.escapeHtml(String(a))).join(', ')
      : 'default'
    const profileTokens = this.extractTokensFromProfile(profile)
    const tokens = [...new Set([...profileTokens, ...observedTokens])].slice(0, 12)
    const tokenHtml = tokens.length
      ? tokens.map((token) => `<span class="badge mono">${this.escapeHtml(token)}</span>`).join(' ')
      : '<span class="badge">Not available yet</span>'
    const completeness = this.calculateProfileCompleteness([
      earlyEntries,
      totalEntries,
      momentumHits,
      totalSignals,
      wins,
      winRate,
      avgRisk,
      avgEntryDelay,
      avgExitDelay,
      pnlPct,
      rapidDumps,
    ])
    const confidence = this.calculateProfileConfidence(completeness, attribution)
    const lifecycle = this.deriveLifecycleState({
      winRate,
      avgRisk,
      rapidDumps,
      confidence,
      trades: attribution?.trades ?? totalSignals,
    })
    const freshLabel = this.formatFreshness(profileUpdatedAt)

    return `
      <article class="mini-card">
        <h3>${this.escapeHtml(wallet)}</h3>
        <p><strong>Preset:</strong> ${this.escapeHtml(profile.preset || 'none')}</p>
        <p><strong>Enabled:</strong> ${profile.enabled === false ? 'no' : 'yes'}</p>
        <p><strong>Actions:</strong> ${actions}</p>
        <p><strong>Lifecycle:</strong> <span class="badge">${lifecycle}</span></p>
        <p><strong>Freshness:</strong> ${freshLabel}</p>
        <p><strong>Confidence:</strong> ${confidence}% | <strong>Completeness:</strong> ${completeness}%</p>
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

  private pickDate(source: Record<string, unknown>, keys: string[]): Date | null {
    for (const key of keys) {
      const value = source[key]
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value
      }
      if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value)
        if (!Number.isNaN(date.getTime())) {
          return date
        }
      }
    }

    return null
  }

  private calculateProfileCompleteness(values: Array<number | null>): number {
    if (values.length === 0) return 0
    const present = values.filter((value) => value != null).length
    return Math.round((present / values.length) * 100)
  }

  private calculateProfileConfidence(
    completeness: number,
    attribution?: { trades: number; winRatePct: number; rapidDumpCount: number },
  ): number {
    const tradeBonus = attribution ? Math.min(25, attribution.trades * 2) : 0
    const stabilityBonus = attribution && attribution.rapidDumpCount === 0 ? 10 : 0
    const qualityBonus = attribution && attribution.winRatePct >= 55 ? 10 : 0
    return Math.min(100, Math.round(completeness * 0.55 + tradeBonus + stabilityBonus + qualityBonus))
  }

  private deriveLifecycleState(input: {
    winRate: number | null
    avgRisk: number | null
    rapidDumps: number | null
    confidence: number
    trades: number | null
  }): string {
    if ((input.rapidDumps || 0) >= 2 || (input.avgRisk || 0) >= 75) return 'BLOCKED'
    if (input.confidence < 45 || (input.trades || 0) < 3) return 'CANDIDATE'
    if ((input.winRate || 0) < 45 || (input.avgRisk || 0) > 60) return 'WATCH'
    return 'ACTIVE'
  }

  private formatFreshness(updatedAt: Date | null): string {
    if (!updatedAt) return 'Not available'
    const diffMs = Date.now() - updatedAt.getTime()
    if (diffMs < 60_000) return 'Updated just now'
    const minutes = Math.floor(diffMs / 60_000)
    if (minutes < 60) return `Updated ${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `Updated ${hours}h ago`
    const days = Math.floor(hours / 24)
    return `Updated ${days}d ago`
  }

  private buildWalletAttribution(
    journal: Array<Record<string, unknown>>,
    decisions: Array<Record<string, unknown>>,
  ): Map<
    string,
    {
      trades: number
      wins: number
      winRatePct: number
      realizedPnl: number
      avgSlippage: number | null
      rapidDumpCount: number
    }
  > {
    const map = new Map<
      string,
      {
        trades: number
        wins: number
        winRatePct: number
        realizedPnl: number
        avgSlippage: number | null
        rapidDumpCount: number
      }
    >()

    const ensure = (wallet: string) => {
      const existing = map.get(wallet)
      if (existing) return existing
      const next = {
        trades: 0,
        wins: 0,
        winRatePct: 0,
        realizedPnl: 0,
        avgSlippage: null as number | null,
        rapidDumpCount: 0,
      }
      map.set(wallet, next)
      return next
    }

    for (const row of journal || []) {
      const wallet = String(row.sourceWallet || '').trim()
      if (!wallet) continue
      const target = ensure(wallet)
      target.trades += 1
      const pnl =
        typeof row.pnlPct === 'number' ? row.pnlPct : typeof row.gainLossPct === 'number' ? row.gainLossPct : null
      if (pnl != null) {
        target.realizedPnl += pnl
        if (pnl > 0) target.wins += 1
      }
      const reason = String(row.reason || '').toLowerCase()
      if (/rapid[-\s]?dump|aggressive[-\s]?dump/.test(reason)) {
        target.rapidDumpCount += 1
      }
    }

    for (const row of decisions || []) {
      const wallet = String(row.sourceWallet || '').trim()
      if (!wallet) continue
      const target = ensure(wallet)
      const safetyReasons = Array.isArray(row.safetyReasons)
        ? row.safetyReasons.map((r) => String(r).toLowerCase())
        : []
      if (safetyReasons.some((reason) => reason.includes('rapid') && reason.includes('dump'))) {
        target.rapidDumpCount += 1
      }
    }

    for (const [, value] of map) {
      value.winRatePct = value.trades > 0 ? Math.round((value.wins / value.trades) * 100) : 0
    }

    return map
  }

  private renderWalletAttributionRows(
    attribution: Map<
      string,
      {
        trades: number
        wins: number
        winRatePct: number
        realizedPnl: number
        avgSlippage: number | null
        rapidDumpCount: number
      }
    >,
  ): string {
    const rows = Array.from(attribution.entries())
      .sort((a, b) => b[1].realizedPnl - a[1].realizedPnl)
      .slice(0, 24)

    return rows
      .map(([wallet, value]) => {
        const lifecycle = this.deriveLifecycleState({
          winRate: value.winRatePct,
          avgRisk: null,
          rapidDumps: value.rapidDumpCount,
          confidence: Math.min(100, 45 + value.trades * 4),
          trades: value.trades,
        })
        return `
          <tr>
            <td>${this.escapeHtml(wallet)}</td>
            <td>${value.trades}</td>
            <td>${value.wins}</td>
            <td>${value.winRatePct}%</td>
            <td>${value.realizedPnl.toFixed(2)}%</td>
            <td>${value.avgSlippage == null ? 'n/a' : `${value.avgSlippage.toFixed(2)}%`}</td>
            <td>${lifecycle}</td>
          </tr>
        `
      })
      .join('')
  }

  private renderTokenExposureRows(observed: Map<string, string[]>): string {
    return Array.from(observed.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 24)
      .map(([wallet, tokens]) => {
        const cap = tokens.length > 6 ? 'tighten cap' : tokens.length > 3 ? 'moderate cap' : 'standard cap'
        const tokenText = tokens
          .slice(0, 6)
          .map((token) => this.escapeHtml(token))
          .join(', ')
        return `
          <tr>
            <td>${this.escapeHtml(wallet)}</td>
            <td>${tokens.length}</td>
            <td>${cap}</td>
            <td>${tokenText || 'n/a'}</td>
          </tr>
        `
      })
      .join('')
  }

  private buildProfileDriftAlerts(
    profiles: Record<string, Record<string, unknown>>,
    attribution: Map<string, { trades: number; winRatePct: number; rapidDumpCount: number }>,
  ): string[] {
    const alerts: string[] = []
    for (const [wallet, profile] of Object.entries(profiles)) {
      const avgRisk = this.pickNumber(profile, ['avgRiskScore', 'avg_risk_score', 'averageRiskScore'])
      const rapidDumps = this.pickNumber(profile, ['rapidDumps', 'rapid_dump_count', 'rapidDumperEvents'])
      const stats = attribution.get(wallet)

      if ((rapidDumps || 0) >= 2 || (stats?.rapidDumpCount || 0) >= 2) {
        alerts.push(`${wallet}: rapid-dump pressure increased. Move wallet to WATCH or BLOCKED.`)
      }
      if ((avgRisk || 0) >= 70) {
        alerts.push(`${wallet}: risk profile is elevated (${avgRisk}). Tighten limits.`)
      }
      if ((stats?.trades || 0) >= 5 && (stats?.winRatePct || 0) < 35) {
        alerts.push(`${wallet}: execution quality dropped to ${stats?.winRatePct}% win rate.`)
      }
    }

    return alerts.slice(0, 12)
  }

  private buildReplaySimulation(
    decisions: Array<Record<string, unknown>>,
    maxRiskScore: number,
  ): {
    total: number
    wouldExecute: number
    wouldBlock: number
    mismatchCount: number
    samples: Array<{ signalId: string; actual: string; simulated: string; riskScore: number; reason: string }>
  } {
    let wouldExecute = 0
    let wouldBlock = 0
    let mismatchCount = 0

    const samples = (decisions || []).slice(0, 20).map((row) => {
      const riskScore = typeof row.riskScore === 'number' ? row.riskScore : Number(row.riskScore || 0)
      const simulated = Number.isFinite(riskScore) && riskScore <= maxRiskScore ? 'executed' : 'blocked'
      if (simulated === 'executed') {
        wouldExecute += 1
      } else {
        wouldBlock += 1
      }

      const actual = String(row.status || 'unknown').toLowerCase()
      if ((actual.includes('executed') ? 'executed' : 'blocked') !== simulated) {
        mismatchCount += 1
      }

      return {
        signalId: String(row.signalId || 'n/a'),
        actual: String(row.status || 'unknown'),
        simulated,
        riskScore: Number.isFinite(riskScore) ? riskScore : 0,
        reason:
          simulated === 'blocked'
            ? `risk ${Number.isFinite(riskScore) ? riskScore : 'n/a'} > max ${maxRiskScore}`
            : 'passes risk gate',
      }
    })

    return {
      total: samples.length,
      wouldExecute,
      wouldBlock,
      mismatchCount,
      samples,
    }
  }

  private explainDecision(entry: Record<string, unknown>): string {
    const safety = Array.isArray(entry.safetyReasons) ? entry.safetyReasons.map((r) => String(r)) : []
    if (safety.length === 0) {
      return entry.status === 'executed' ? 'Passed configured gates' : 'No explicit gate reason provided'
    }

    return safety.join(' | ')
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

  private pickMetricCount(metrics: Record<string, number | string | undefined>, keys: string[]): number {
    for (const key of keys) {
      const value = metrics[key]
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

    return 0
  }
}
