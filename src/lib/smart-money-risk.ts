export function resolveSmartMoneyTradeRiskScore(configuredValue: string | undefined): number {
  const parsed = Number(configuredValue ?? 35)
  if (!Number.isFinite(parsed)) {
    return 35
  }

  return Math.max(0, Math.min(100, parsed))
}
