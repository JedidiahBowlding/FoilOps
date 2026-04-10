export type TradeSignalType = 'TOKEN_INVESTIGATION' | 'SUSPICIOUS_TOKEN_LAUNCH'

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
  actionHint: 'WATCH_ONLY'
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
    (candidate.signalType === 'TOKEN_INVESTIGATION' || candidate.signalType === 'SUSPICIOUS_TOKEN_LAUNCH') &&
    typeof candidate.dryRun === 'boolean' &&
    typeof candidate.riskScore === 'number' &&
    ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(String(candidate.riskLevel)) &&
    Array.isArray(candidate.traceAlerts) &&
    candidate.actionHint === 'WATCH_ONLY'
  )
}
