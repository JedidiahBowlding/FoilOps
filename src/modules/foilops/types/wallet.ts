// ─── Wallet Opportunity Profile ───────────────────────────────────────────────
// Scores that measure how useful a wallet is to follow for launch opportunities.

export type WalletOpportunityProfile = {
  wallet: string
  // How early (in seconds after liquidity add) the wallet typically enters tokens
  earlyEntryScore: number
  // How frequently the wallet participates in new launches
  launchParticipationScore: number
  // Whether the wallet consistently shows up during high-momentum price windows
  momentumParticipationScore: number
  // Whether past early entries resulted in profitable exits
  repeatSuccessScore: number
  // How clean the wallet's exit timing is (exits before dumps = higher score)
  exitTimingScore: number
}

// ─── Wallet Risk Profile ───────────────────────────────────────────────────────
// Scores that measure how dangerous or suspicious a wallet is.

export type WalletRiskProfile = {
  wallet: string
  // Composite probability the wallet is a rug participant or scam operator
  rugRiskScore: number
  // Whether the wallet shows aggressive dump behavior after entry
  dumpSeverityScore: number
  // Whether the wallet appears alongside known suspicious wallets
  clusterSuspicionScore: number
  // Whether the wallet has been associated with liquidity removal events
  liquidityPullAssociationScore: number
  // Whether the wallet's own funding comes from suspicious or recycled sources
  suspiciousFundingScore: number
}

// ─── Combined Wallet Profile ───────────────────────────────────────────────────

export type WalletClassification =
  | 'early-entrant'
  | 'momentum-wallet'
  | 'high-risk'
  | 'watchlist'
  | 'ignore'

export type WalletProfile = WalletOpportunityProfile &
  WalletRiskProfile & {
    overallOpportunityScore: number
    overallRiskScore: number
    classification: WalletClassification
    // ISO timestamp of last score computation
    scoredAt: string
    // Human-readable labels for this wallet
    tags: string[]
  }

// ─── Wallet Detail Page ───────────────────────────────────────────────────────
// Aggregated data for the wallet investigation view.

export type LaunchParticipationRecord = {
  tokenAddress: string
  tokenSymbol?: string
  entryTimestamp: number
  // Seconds after token creation or liquidity add
  entryDelaySeconds: number
  exitTimestamp?: number
  exitDelaySeconds?: number
  gainLossPct?: number
  platform: string
}

export type WalletDetailPage = {
  wallet: string
  profile: WalletProfile
  recentLaunches: LaunchParticipationRecord[]
  entryTimingAvgSeconds: number
  exitTimingAvgSeconds: number
  connectedClusterWallets: string[]
  riskTags: string[]
  aiSummaryPayload: Record<string, unknown>
}

// ─── Snapshot persistence model ───────────────────────────────────────────────
// Used when writing scored wallet profiles to the database.

export type WalletProfileSnapshot = {
  wallet: string
  opportunityScores: WalletOpportunityProfile
  riskScores: WalletRiskProfile
  overallOpportunityScore: number
  overallRiskScore: number
  classification: WalletClassification
  tags: string[]
  computedAt: Date
}
