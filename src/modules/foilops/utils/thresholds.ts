// ─── Score Thresholds ──────────────────────────────────────────────────────────
// Named numeric boundaries referenced in classification logic and UI labels.

export const THRESHOLDS = {
  // Wallet opportunity
  wallet: {
    highOpportunity: 70,
    mediumOpportunity: 50,
    lowOpportunity: 30,
  },
  // Wallet risk
  risk: {
    critical: 80,
    high: 65,
    medium: 45,
    low: 25,
  },
  // Token risk
  token: {
    extreme: 75,
    high: 55,
    medium: 30,
    low: 0,
  },
  // Cluster suspicion
  cluster: {
    definitelySuspicious: 70,
    likelySuspicious: 45,
    possiblyLinked: 20,
  },
} as const

export type WalletOpportunityTier = 'high' | 'medium' | 'low' | 'none'
export type WalletRiskTier = 'critical' | 'high' | 'medium' | 'low'
export type TokenRiskTier = 'extreme' | 'high' | 'medium' | 'low'

export function walletOpportunityTier(score: number): WalletOpportunityTier {
  if (score >= THRESHOLDS.wallet.highOpportunity) return 'high'
  if (score >= THRESHOLDS.wallet.mediumOpportunity) return 'medium'
  if (score >= THRESHOLDS.wallet.lowOpportunity) return 'low'
  return 'none'
}

export function walletRiskTier(score: number): WalletRiskTier {
  if (score >= THRESHOLDS.risk.critical) return 'critical'
  if (score >= THRESHOLDS.risk.high) return 'high'
  if (score >= THRESHOLDS.risk.medium) return 'medium'
  return 'low'
}

export function tokenRiskTier(score: number): TokenRiskTier {
  if (score >= THRESHOLDS.token.extreme) return 'extreme'
  if (score >= THRESHOLDS.token.high) return 'high'
  if (score >= THRESHOLDS.token.medium) return 'medium'
  return 'low'
}
