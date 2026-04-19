// ─── Summary Payload Service ───────────────────────────────────────────────────
// Builds the structured JSON payloads used by:
//  - AI summariser (ai-analyzer.ts)
//  - API response bodies
//  - Telegram message formatters
//
// Both wallet and token payloads are plain Record<string, unknown> so they can
// be serialised without any special handling.

import { WalletProfile, WalletDetailPage, LaunchParticipationRecord } from '../types/wallet'
import { TokenRiskProfile, TokenDetailPage, SuspiciousTokenEvent } from '../types/token'
import { ClusterAnalysisResult } from '../types/cluster'
import { walletRiskTier, walletOpportunityTier, tokenRiskTier } from '../utils/thresholds'
import { median } from '../utils/scoringMath'

// ─── Wallet summary ────────────────────────────────────────────────────────────

export type WalletSummaryPayload = {
  wallet: string
  classification: string
  opportunityTier: string
  riskTier: string
  scores: {
    opportunity: number
    risk: number
    earlyEntry: number
    momentum: number
    repeatSuccess: number
    exitTiming: number
    rugRisk: number
    dumpSeverity: number
    clusterSuspicion: number
    suspiciousFunding: number
  }
  tags: string[]
  recentActivity: {
    launchCount: number
    avgEntryDelaySeconds: number
    avgExitDelaySeconds: number | null
    winRate: number | null
    lastSeenPlatform: string | null
  }
  clusterSummary: {
    linkedWalletCount: number
    linkTypes: string[]
    topSuspicion: number
  }
}

export function buildWalletSummaryPayload(
  profile: WalletProfile,
  launches: LaunchParticipationRecord[],
  clusterResult: ClusterAnalysisResult | null,
): WalletSummaryPayload {
  const entryDelays = launches.map((l) => l.entryDelaySeconds)
  const exitDelays = launches
    .filter((l): l is LaunchParticipationRecord & { exitDelaySeconds: number } => l.exitDelaySeconds !== undefined)
    .map((l) => l.exitDelaySeconds)
  const wins = launches.filter((l) => l.gainLossPct !== undefined && l.gainLossPct > 0)

  return {
    wallet: profile.wallet,
    classification: profile.classification,
    opportunityTier: walletOpportunityTier(profile.overallOpportunityScore),
    riskTier: walletRiskTier(profile.overallRiskScore),
    scores: {
      opportunity: profile.overallOpportunityScore,
      risk: profile.overallRiskScore,
      earlyEntry: profile.earlyEntryScore,
      momentum: profile.momentumParticipationScore,
      repeatSuccess: profile.repeatSuccessScore,
      exitTiming: profile.exitTimingScore,
      rugRisk: profile.rugRiskScore,
      dumpSeverity: profile.dumpSeverityScore,
      clusterSuspicion: profile.clusterSuspicionScore,
      suspiciousFunding: profile.suspiciousFundingScore,
    },
    tags: profile.tags,
    recentActivity: {
      launchCount: launches.length,
      avgEntryDelaySeconds: entryDelays.length > 0 ? Math.round(median(entryDelays)) : 0,
      avgExitDelaySeconds: exitDelays.length > 0 ? Math.round(median(exitDelays)) : null,
      winRate: launches.length > 0 ? Math.round((wins.length / launches.length) * 100) / 100 : null,
      lastSeenPlatform: launches.at(-1)?.platform ?? null,
    },
    clusterSummary: {
      linkedWalletCount: clusterResult?.reachableWallets.length ?? 0,
      linkTypes: clusterResult ? [...new Set(clusterResult.links.map((l) => l.linkType))] : [],
      topSuspicion: clusterResult?.clusterSuspicionScore ?? 0,
    },
  }
}

export function buildWalletDetailPage(
  profile: WalletProfile,
  launches: LaunchParticipationRecord[],
  clusterResult: ClusterAnalysisResult | null,
): WalletDetailPage {
  const entryDelays = launches.map((l) => l.entryDelaySeconds)
  const exitDelays = launches
    .filter((l): l is LaunchParticipationRecord & { exitDelaySeconds: number } => l.exitDelaySeconds !== undefined)
    .map((l) => l.exitDelaySeconds)

  return {
    wallet: profile.wallet,
    profile,
    recentLaunches: launches,
    entryTimingAvgSeconds: entryDelays.length > 0 ? Math.round(median(entryDelays)) : 0,
    exitTimingAvgSeconds: exitDelays.length > 0 ? Math.round(median(exitDelays)) : 0,
    connectedClusterWallets: clusterResult?.reachableWallets ?? [],
    riskTags: profile.tags.filter((t) =>
      ['rug-associated', 'aggressive-dumper', 'cluster-linked', 'suspicious-funding', 'liquidity-pull-risk'].includes(
        t,
      ),
    ),
    aiSummaryPayload: buildWalletSummaryPayload(profile, launches, clusterResult) as unknown as Record<string, unknown>,
  }
}

// ─── Token summary ─────────────────────────────────────────────────────────────

export type TokenSummaryPayload = {
  tokenAddress: string
  classification: string
  riskTier: string
  scores: {
    overall: number
    creatorHold: number
    top10Concentration: number
    dumpPressure: number
    walletConcentration: number
  }
  metrics: {
    creatorHoldPercent: number
    top10HolderPercent: number
    liquidityUsd: number
    liquidityRemovalPercent: number
    suspiciousWalletLinks: number
  }
  events: SuspiciousTokenEvent[]
}

export function buildTokenSummaryPayload(
  profile: TokenRiskProfile,
  events: SuspiciousTokenEvent[],
): TokenSummaryPayload {
  return {
    tokenAddress: profile.tokenAddress,
    classification: profile.tokenClassification,
    riskTier: tokenRiskTier(profile.overallTokenRiskScore),
    scores: {
      overall: profile.overallTokenRiskScore,
      creatorHold: Math.round(profile.creatorHoldPercent),
      top10Concentration: Math.round(profile.top10HolderPercent),
      dumpPressure: profile.dumpPressureScore,
      walletConcentration: profile.walletConcentrationScore,
    },
    metrics: {
      creatorHoldPercent: profile.creatorHoldPercent,
      top10HolderPercent: profile.top10HolderPercent,
      liquidityUsd: profile.liquidityUsd,
      liquidityRemovalPercent: profile.liquidityRemovalPercent,
      suspiciousWalletLinks: profile.suspiciousWalletLinks,
    },
    events,
  }
}

export function buildTokenDetailPage(
  profile: TokenRiskProfile,
  events: SuspiciousTokenEvent[],
  creatorWallet?: string,
  linkedSuspiciousWallets?: string[],
  liquidityHistory?: Array<{ timestamp: number; liquidityUsd: number }>,
): TokenDetailPage {
  return {
    tokenAddress: profile.tokenAddress,
    riskProfile: profile,
    creatorWallet,
    linkedSuspiciousWallets: linkedSuspiciousWallets ?? [],
    liquidityHistory: liquidityHistory ?? [],
    suspiciousEvents: events,
    aiSummaryPayload: buildTokenSummaryPayload(profile, events) as unknown as Record<string, unknown>,
  }
}
