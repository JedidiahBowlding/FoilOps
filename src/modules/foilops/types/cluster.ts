// ─── Wallet Cluster Link ───────────────────────────────────────────────────────
// A directional edge in the wallet relationship graph.

export type ClusterLinkType =
  | 'shared-funder'
  | 'co-launch'
  | 'shared-counterparty'
  | 'similar-exit-pattern'
  | 'downstream-consolidation'

export type WalletClusterLink = {
  sourceWallet: string
  targetWallet: string
  linkType: ClusterLinkType
  // 0.0–1.0 how confident we are this relationship is real
  confidence: number
  // Evidence that contributed to this link
  evidence: string[]
}

// ─── Cluster Analysis Result ───────────────────────────────────────────────────
// Returned by the cluster analysis service for a given wallet.

export type ClusterAnalysisResult = {
  wallet: string
  links: WalletClusterLink[]
  // All unique wallets reachable from this wallet across all link types
  reachableWallets: string[]
  // Number of distinct link types present
  linkTypeDiversity: number
  // 0–100 composite cluster suspicion score
  clusterSuspicionScore: number
  // Highest confidence value across all links
  maxLinkConfidence: number
  computedAt: string
}

// ─── Persistent cluster edge ───────────────────────────────────────────────────

export type WalletClusterEdge = {
  sourceWallet: string
  targetWallet: string
  linkType: ClusterLinkType
  confidence: number
  evidence: string[]
  createdAt: Date
}
