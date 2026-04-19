// ─── Classification Service ────────────────────────────────────────────────────
// Converts numeric scores into human-readable labels for wallets and tokens.

import { WalletClassification } from '../types/wallet'
import { TokenClassification } from '../types/token'
import { walletRules, tokenRules } from '../config/foilOpsConfig'

// ─── Wallet classification ─────────────────────────────────────────────────────

export function classifyWalletProfile(
  overallOpportunityScore: number,
  overallRiskScore: number,
): WalletClassification {
  const r = walletRules.classification

  // High-risk trumps everything
  if (overallRiskScore >= r.highRiskMinRisk) return 'high-risk'

  // Must have low enough risk to be in the opportunity tiers
  if (
    overallOpportunityScore >= r.earlyEntrantMinOpportunity &&
    overallRiskScore <= r.earlyEntrantMaxRisk
  ) {
    return 'early-entrant'
  }

  if (
    overallOpportunityScore >= r.momentumMinOpportunity &&
    overallRiskScore <= r.momentumMaxRisk
  ) {
    return 'momentum-wallet'
  }

  if (overallOpportunityScore >= r.watchlistMinOpportunity) return 'watchlist'

  return 'ignore'
}

// ─── Token classification ──────────────────────────────────────────────────────

export function classifyToken(overallTokenRiskScore: number): TokenClassification {
  const tc = tokenRules.classification
  if (overallTokenRiskScore > tc.highRiskMax) return 'extreme-risk'
  if (overallTokenRiskScore > tc.watchlistMax) return 'high-risk'
  if (overallTokenRiskScore > tc.saferMax) return 'watchlist'
  return 'safer-speculative'
}
