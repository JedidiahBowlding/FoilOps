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

  if (typeof input.profile === 'string' && input.profile.trim()) {
    operations.push({ path: '/trading/profile', body: { profile: input.profile.trim() } })
  }

  if (typeof input.mode === 'string' && input.mode.trim()) {
    operations.push({ path: '/trading/mode', body: { mode: input.mode.trim() } })
  }

  if (typeof input.executionMode === 'string' && input.executionMode.trim()) {
    operations.push({ path: '/trading/execution-mode', body: { mode: input.executionMode.trim() } })
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

  return operations
}
