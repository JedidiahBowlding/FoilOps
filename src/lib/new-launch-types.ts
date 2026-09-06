export type DetectedLaunch = {
  chain: 'solana' | 'robinhood'
  tokenMint: string
  signature: string
  creatorWallet: string | null
  source: string
  slot: number
  detectedAt: Date
}

export type LaunchEvidence = {
  chain: 'solana' | 'robinhood'
  tokenMint: string
  creatorWallet: string | null
  mintAuthority: string | null
  freezeAuthority: string | null
  decimals: number
  supplyRaw: string
  top10HolderPercent: number
  creatorHoldPercent: number
  creatorSolBalance: number | null
  holderAccountsSampled: number
  liquidityUsd: number | null
  marketCapUsd: number | null
  name: string | null
  symbol: string | null
  website?: string | null
  twitter?: string | null
  telegram?: string | null
  evidenceSources: string[]
  collectionErrors: string[]
  collectedAt: string
  assetCategory: 'SPECULATIVE_TOKEN' | 'OFFICIAL_STOCK_TOKEN' | 'UNVERIFIED_CONTRACT'
  officialStockToken: {
    id: string
    symbol: string
    name: string
    status: string
    currentMultiplier: string
    bidUsd: number | null
    askUsd: number | null
    tokenBidUsd: number | null
    tokenAskUsd: number | null
    isTradingHalt: boolean | null
    oracleFeedAddress: string | null
    oraclePriceUsd: number | null
    oracleUpdatedAt: string | null
    oracleHeartbeatSeconds: number | null
    oracleStale: boolean | null
    restOracleDivergencePct: number | null
    oraclePaused: boolean | null
    onchainMultiplier: string | null
    multiplierMatchesRest: boolean | null
  } | null
  holderHistoryComplete: boolean
  liquidityPools: Array<{
    address: string
    verifiedPair: boolean
    tokenBalanceRaw: string
    tokenBalancePercent: number
    verifiedLiquidityUsd: number | null
  }>
}

export type ScoredLaunchCandidate = DetectedLaunch & {
  evidence: LaunchEvidence
  opportunityScore: number
  riskScore: number
  classification: 'REJECT' | 'WATCH' | 'PROMISING' | 'OFFICIAL_STOCK_TOKEN'
  status: 'SCORED'
  rationale: string[]
}
