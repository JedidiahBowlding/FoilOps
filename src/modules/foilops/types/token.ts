// ─── Token Risk Profile ────────────────────────────────────────────────────────
// Scores how dangerous a new token launch is based on on-chain evidence.

export type TokenClassification =
  | 'safer-speculative'
  | 'watchlist'
  | 'high-risk'
  | 'extreme-risk'

export type TokenRiskProfile = {
  tokenAddress: string
  // What percentage of supply the creator wallet holds
  creatorHoldPercent: number
  // What percentage of supply the top 10 wallets hold combined
  top10HolderPercent: number
  // USD value of current liquidity pool
  liquidityUsd: number
  // Percentage of liquidity removed shortly after launch
  liquidityRemovalPercent: number
  // Count of wallets with suspicious signals linked to this token
  suspiciousWalletLinks: number
  // How concentrated supply is across all wallets (0–100)
  walletConcentrationScore: number
  // How much sell pressure occurred in the first N minutes (0–100)
  dumpPressureScore: number
  // 0–100 composite risk score
  overallTokenRiskScore: number
  tokenClassification: TokenClassification
  // ISO timestamp when this score was computed
  scoredAt: string
}

// ─── Token Detail Page ─────────────────────────────────────────────────────────

export type SuspiciousTokenEvent = {
  eventType:
    | 'large-sell'
    | 'liquidity-removal'
    | 'suspicious-wallet-entry'
    | 'cluster-overlap'
    | 'rapid-dump'
  timestamp: number
  walletAddress?: string
  details: string
}

export type TokenDetailPage = {
  tokenAddress: string
  riskProfile: TokenRiskProfile
  creatorWallet?: string
  linkedSuspiciousWallets: string[]
  liquidityHistory: Array<{ timestamp: number; liquidityUsd: number }>
  suspiciousEvents: SuspiciousTokenEvent[]
  aiSummaryPayload: Record<string, unknown>
}

// ─── Token Risk Snapshot (persistence) ────────────────────────────────────────

export type TokenRiskSnapshot = {
  tokenAddress: string
  riskProfile: TokenRiskProfile
  suspiciousEvents: SuspiciousTokenEvent[]
  computedAt: Date
}
