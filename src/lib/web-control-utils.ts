export type TradingQuickAction =
  | 'enable'
  | 'disable'
  | 'pause'
  | 'resume'
  | 'kill-switch'
  | 'tighten-risk'
  | 'retry-failed'

export type TradingSettingsInput = {
  profile?: string
  mode?: string
  executionMode?: string
  buyAmountSol?: number
  maxRiskScore?: number
  slippage?: number
  minAlertQualityScore?: number
  minTraceAlerts?: number
  buyOncePerToken?: boolean
  stopLossPercentage?: number
  takeProfitPercentage?: number
  mevService?: string
  maxConcurrentTrades?: number
  maxPositionSizeSol?: number
  minLiquidityUsd?: number
  allowedDexes?: string[]
  targetWallet?: string
  executionWalletPrivateKey?: string
  autoBlockSourceWalletAfterBuy?: boolean
  preBuyCheckSellRoute?: boolean
  preBuyCheckFreezeAuthority?: boolean
  preBuyCheckToken2022Extensions?: boolean
  preBuyCheckHoneypot?: boolean
  preBuyCheckSuspiciousTax?: boolean
  denylist?: string[]
  allowlist?: string[]
}

type TradingOperation = {
  path: string
  body: Record<string, unknown>
}

const QUICK_ACTION_PATHS: Record<TradingQuickAction, string> = {
  enable: '/trading/enable',
  disable: '/trading/disable',
  pause: '/trading/pause',
  resume: '/trading/resume',
  'kill-switch': '/trading/kill-switch',
  'tighten-risk': '/trading/tighten-risk',
  'retry-failed': '/trading/retry-failed',
}

export function getTradingBotBaseUrl(): string {
  const explicitUrl = process.env.TRADING_BOT_URL?.trim()
  if (explicitUrl) {
    return explicitUrl.replace(/\/$/, '')
  }

  const bind = process.env.SIGNAL_RECEIVER_BIND?.trim()
  if (bind) {
    const normalized = bind.replace(/^0\.0\.0\.0:/, '127.0.0.1:').replace(/^\[::\]:/, '127.0.0.1:')
    return normalized.startsWith('http://') || normalized.startsWith('https://') ? normalized : `http://${normalized}`
  }

  return 'http://127.0.0.1:8787'
}

export function resolveTradingQuickActionPath(action: string): string | null {
  if (action in QUICK_ACTION_PATHS) {
    return QUICK_ACTION_PATHS[action as TradingQuickAction]
  }

  return null
}

export function buildTradingSettingsOperations(input: TradingSettingsInput): TradingOperation[] {
  const operations: TradingOperation[] = []
  let modeOperation: TradingOperation | null = null
  let executionModeOperation: TradingOperation | null = null

  if (typeof input.profile === 'string' && input.profile.trim()) {
    operations.push({ path: '/trading/profile', body: { profile: input.profile.trim() } })
  }

  if (typeof input.mode === 'string' && input.mode.trim()) {
    modeOperation = { path: '/trading/mode', body: { mode: input.mode.trim() } }
  }

  if (typeof input.executionMode === 'string' && input.executionMode.trim()) {
    executionModeOperation = { path: '/trading/execution-mode', body: { mode: input.executionMode.trim() } }
  }

  if (Number.isFinite(input.buyAmountSol) && (input.buyAmountSol as number) > 0) {
    operations.push({ path: '/trading/size', body: { buy_amount_sol: input.buyAmountSol } })
  }

  if (Number.isFinite(input.maxRiskScore)) {
    operations.push({ path: '/trading/risk', body: { max_risk_score: input.maxRiskScore } })
  }

  if (Number.isFinite(input.slippage)) {
    operations.push({ path: '/trading/slippage', body: { slippage: input.slippage } })
  }

  const alertQualityBody: Record<string, number> = {}
  if (Number.isFinite(input.minAlertQualityScore)) {
    alertQualityBody.min_alert_quality_score = input.minAlertQualityScore as number
  }
  if (Number.isFinite(input.minTraceAlerts)) {
    alertQualityBody.min_trace_alerts = input.minTraceAlerts as number
  }
  if (Object.keys(alertQualityBody).length > 0) {
    operations.push({ path: '/trading/alert-quality', body: alertQualityBody })
  }

  if (typeof input.buyOncePerToken === 'boolean') {
    operations.push({ path: '/trading/buy-once-per-token', body: { enabled: input.buyOncePerToken } })
  }

  if (Number.isFinite(input.stopLossPercentage)) {
    operations.push({ path: '/trading/stop-loss', body: { stop_loss_percentage: input.stopLossPercentage } })
  }

  if (Number.isFinite(input.takeProfitPercentage)) {
    operations.push({ path: '/trading/take-profit', body: { take_profit_percentage: input.takeProfitPercentage } })
  }

  if (typeof input.mevService === 'string' && input.mevService.trim()) {
    operations.push({ path: '/trading/mev', body: { service: input.mevService.trim() } })
  }

  if (Number.isFinite(input.maxConcurrentTrades) && (input.maxConcurrentTrades as number) > 0) {
    operations.push({
      path: '/trading/max-concurrent-trades',
      body: { max_concurrent_trades: input.maxConcurrentTrades },
    })
  }

  if (Number.isFinite(input.maxPositionSizeSol) && (input.maxPositionSizeSol as number) > 0) {
    operations.push({ path: '/trading/max-position-size', body: { max_position_size_sol: input.maxPositionSizeSol } })
  }

  if (Number.isFinite(input.minLiquidityUsd) && (input.minLiquidityUsd as number) >= 0) {
    operations.push({ path: '/trading/min-liquidity', body: { min_liquidity_usd: input.minLiquidityUsd } })
  }

  if (Array.isArray(input.allowedDexes)) {
    operations.push({ path: '/trading/allowed-dexes', body: { allowed_dexes: input.allowedDexes } })
  }

  if (typeof input.targetWallet === 'string') {
    operations.push({ path: '/trading/target', body: { wallet: input.targetWallet.trim() } })
  }

  if (typeof input.executionWalletPrivateKey === 'string' && input.executionWalletPrivateKey.trim()) {
    operations.push({
      path: '/trading/execution-wallet',
      body: { private_key: input.executionWalletPrivateKey.trim() },
    })
  }

  if (typeof input.autoBlockSourceWalletAfterBuy === 'boolean') {
    operations.push({
      path: '/trading/auto-block-source-wallet',
      body: { auto_block_source_wallet_after_buy: input.autoBlockSourceWalletAfterBuy },
    })
  }

  if (
    typeof input.preBuyCheckSellRoute === 'boolean' ||
    typeof input.preBuyCheckFreezeAuthority === 'boolean' ||
    typeof input.preBuyCheckToken2022Extensions === 'boolean' ||
    typeof input.preBuyCheckHoneypot === 'boolean' ||
    typeof input.preBuyCheckSuspiciousTax === 'boolean'
  ) {
    operations.push({
      path: '/trading/pre-buy-checks',
      body: {
        sell_route: input.preBuyCheckSellRoute,
        freeze_authority: input.preBuyCheckFreezeAuthority,
        token2022_extensions: input.preBuyCheckToken2022Extensions,
        honeypot: input.preBuyCheckHoneypot,
        suspicious_tax: input.preBuyCheckSuspiciousTax,
      },
    })
  }

  if (Array.isArray(input.denylist)) {
    operations.push({ path: '/trading/denylist', body: { denylist: input.denylist } })
  }

  if (Array.isArray(input.allowlist)) {
    operations.push({ path: '/trading/allowlist', body: { allowlist: input.allowlist } })
  }

  // Apply execution/mode last so explicit operator intent is not overridden by
  // profile presets or other setting mutations in the same request batch.
  if (executionModeOperation) {
    operations.push(executionModeOperation)
  }
  if (modeOperation) {
    operations.push(modeOperation)
  }

  return operations
}
