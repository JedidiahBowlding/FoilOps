export type TradeSignalType =
  | 'TOKEN_INVESTIGATION'
  | 'SUSPICIOUS_TOKEN_LAUNCH'
  | 'SUSPICIOUS_PRELAUNCH_SIGNAL'
  | 'COPY_TRADE'
  | 'AUTO_SELL'
  | 'AUTO_AVOID'
  | 'AUTO_WATCH'

export type TradeActionHint = 'WATCH_ONLY' | 'BUY' | 'SELL' | 'AUTO_SELL' | 'AUTO_AVOID' | 'AUTO_WATCH'

export type TradeSignalV1 = {
  schemaVersion: '1.0'
  signalId: string
  emittedAt: string
  sourceSystem: 'foilops-intelligence'
  signalType: TradeSignalType
  dryRun: boolean
  riskScore: number
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  trackedWallet?: string
  developerWallet?: string
  tokenMint?: string
  traceAlerts: string[]
  actionHint: TradeActionHint
  metadata?: Record<string, unknown>
}

export const isTradeSignalV1 = (value: unknown): value is TradeSignalV1 => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<TradeSignalV1>

  return (
    candidate.schemaVersion === '1.0' &&
    typeof candidate.signalId === 'string' &&
    typeof candidate.emittedAt === 'string' &&
    candidate.sourceSystem === 'foilops-intelligence' &&
    (candidate.signalType === 'TOKEN_INVESTIGATION' ||
      candidate.signalType === 'SUSPICIOUS_TOKEN_LAUNCH' ||
      candidate.signalType === 'SUSPICIOUS_PRELAUNCH_SIGNAL' ||
      candidate.signalType === 'COPY_TRADE' ||
      candidate.signalType === 'AUTO_SELL' ||
      candidate.signalType === 'AUTO_AVOID' ||
      candidate.signalType === 'AUTO_WATCH') &&
    typeof candidate.dryRun === 'boolean' &&
    typeof candidate.riskScore === 'number' &&
    ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(String(candidate.riskLevel)) &&
    Array.isArray(candidate.traceAlerts) &&
    (candidate.actionHint === 'WATCH_ONLY' ||
      candidate.actionHint === 'BUY' ||
      candidate.actionHint === 'SELL' ||
      candidate.actionHint === 'AUTO_SELL' ||
      candidate.actionHint === 'AUTO_AVOID' ||
      candidate.actionHint === 'AUTO_WATCH')
  )
}
