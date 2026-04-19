// ─── Wallet Scoring Service ────────────────────────────────────────────────────
// Converts raw on-chain evidence into structured opportunity + risk scores.
// All inputs come from repositories / callers — this service is pure computation.

import {
  WalletOpportunityProfile,
  WalletRiskProfile,
  WalletProfile,
  LaunchParticipationRecord,
} from '../types/wallet'
import { ClusterAnalysisResult } from '../types/cluster'
import { walletRules } from '../config/foilOpsConfig'
import {
  clamp100,
  clamp1,
  weightedMean,
  earlyEntryScore,
  participationScore,
  additiveCap,
} from '../utils/scoringMath'
import { classifyWalletProfile } from './classificationService'

// ─── Input types ───────────────────────────────────────────────────────────────

export type WalletScoringInput = {
  wallet: string
  launches: LaunchParticipationRecord[]
  isFlagged: boolean
  rugEventCount: number
  // Funding chain analysis (from fund-flow-tracer)
  fundingFlags: {
    fromKnownBadActor: boolean
    fromMixer: boolean
    fromExchangeWithdrawal: boolean
    fromNewWallet: boolean
  }
  // Pre-computed cluster result (from cluster analysis service)
  clusterResult: ClusterAnalysisResult | null
  // Observable rapid-dump events on this wallet
  rapidDumpEventCount: number
  largeSellEventCount: number
}

// ─── Sub-score calculators ─────────────────────────────────────────────────────

export function calculateEarlyEntryScore(launches: LaunchParticipationRecord[]): number {
  if (launches.length === 0) return 0
  const r = walletRules.earlyEntry
  const scores = launches.map((l) =>
    earlyEntryScore(l.entryDelaySeconds, r.veryEarlyThresholdSeconds, r.earlyThresholdSeconds, r.lateThresholdSeconds),
  )
  return clamp100(scores.reduce((a, b) => a + b, 0) / scores.length)
}

export function calculateMomentumParticipationScore(launches: LaunchParticipationRecord[]): number {
  // Proxy: use early + mid entry events as momentum proxies
  if (launches.length === 0) return 0
  const r = walletRules.earlyEntry
  const momentumHits = launches.filter((l) => l.entryDelaySeconds <= r.earlyThresholdSeconds).length
  const rate = clamp1(momentumHits / launches.length)
  const mw = walletRules.momentum.weights
  if (rate >= 0.7) return mw.alwaysPresent
  if (rate >= 0.4) return mw.oftenPresent
  return mw.rarelyPresent
}

export function calculateRepeatSuccessScore(launches: LaunchParticipationRecord[]): number {
  const withGain = launches.filter((l) => l.gainLossPct !== undefined && l.gainLossPct > 0)
  if (launches.length === 0) return 0
  const rate = withGain.length / launches.length
  const sw = walletRules.success
  if (rate >= sw.highSuccessRateThreshold) return sw.weights.highSuccessRate
  if (rate >= sw.medSuccessRateThreshold) return sw.weights.medSuccessRate
  return sw.weights.lowSuccessRate
}

export function calculateExitTimingScore(launches: LaunchParticipationRecord[]): number {
  const withExit = launches.filter(
    (l): l is LaunchParticipationRecord & { exitDelaySeconds: number } => l.exitDelaySeconds !== undefined,
  )
  if (withExit.length === 0) return 50 // neutral when no data
  const r = walletRules.exitTiming
  const scores = withExit.map((l) => {
    const fraction = l.exitDelaySeconds / Math.max(l.entryDelaySeconds + 1, l.exitDelaySeconds)
    if (fraction <= r.goodExitFractionThreshold) return r.weights.earlyExit
    if (fraction <= 0.75) return r.weights.midExit
    return r.weights.lateExit
  })
  return clamp100(scores.reduce((a, b) => a + b, 0) / scores.length)
}

export function calculateLaunchParticipationScore(launches: LaunchParticipationRecord[]): number {
  const pr = walletRules.participation
  if (launches.length < pr.minLaunchSampleSize) {
    // Scale linearly until we hit the minimum sample
    return clamp100((launches.length / pr.minLaunchSampleSize) * pr.weights.medium)
  }
  // Treat non-zero launches as "participated"
  const rate = clamp1(launches.length > 0 ? 1 : 0)
  return participationScore(rate, pr.highRateThreshold, pr.mediumRateThreshold)
}

export function calculateRugRiskScore(input: Pick<WalletScoringInput, 'isFlagged' | 'rugEventCount' | 'clusterResult'>): number {
  const rr = walletRules.rugRisk
  const flagScore = input.isFlagged ? rr.weights.flagged : 0
  const eventScore = Math.min(60, input.rugEventCount * rr.weights.perEvent)
  const clusterScore = (input.clusterResult?.clusterSuspicionScore ?? 0) >= 50 ? rr.weights.clusterOverlap : 0
  return additiveCap([flagScore, eventScore, clusterScore])
}

export function calculateDumpSeverityScore(
  input: Pick<WalletScoringInput, 'rapidDumpEventCount' | 'largeSellEventCount'>,
): number {
  const dw = walletRules.dumpSeverity.weights
  const rapid = Math.min(80, input.rapidDumpEventCount * dw.rapidDump)
  const large = Math.min(50, input.largeSellEventCount * dw.largeSell)
  return additiveCap([rapid, large])
}

export function calculateClusterSuspicionScore(clusterResult: ClusterAnalysisResult | null): number {
  if (!clusterResult) return 0
  return clamp100(clusterResult.clusterSuspicionScore)
}

export function calculateSuspiciousFundingScore(
  flags: WalletScoringInput['fundingFlags'],
): number {
  const fw = walletRules.suspiciousFunding.weights
  return additiveCap([
    flags.fromKnownBadActor ? fw.fromKnownBadActor : 0,
    flags.fromMixer ? fw.fromMixer : 0,
    flags.fromExchangeWithdrawal ? fw.fromExchangeWithdrawal : 0,
    flags.fromNewWallet ? fw.fromNewWallet : 0,
  ])
}

export function calculateLiquidityPullAssociation(clusterResult: ClusterAnalysisResult | null): number {
  // If the cluster is highly suspicious, elevate liquidity pull association
  if (!clusterResult) return 0
  const cs = clusterResult.clusterSuspicionScore
  if (cs >= 70) return 60
  if (cs >= 45) return 30
  return 0
}

// ─── Main scorer ──────────────────────────────────────────────────────────────

export function scoreWallet(input: WalletScoringInput): WalletProfile {
  const opportunity: WalletOpportunityProfile = {
    wallet: input.wallet,
    earlyEntryScore: calculateEarlyEntryScore(input.launches),
    launchParticipationScore: calculateLaunchParticipationScore(input.launches),
    momentumParticipationScore: calculateMomentumParticipationScore(input.launches),
    repeatSuccessScore: calculateRepeatSuccessScore(input.launches),
    exitTimingScore: calculateExitTimingScore(input.launches),
  }

  const risk: WalletRiskProfile = {
    wallet: input.wallet,
    rugRiskScore: calculateRugRiskScore(input),
    dumpSeverityScore: calculateDumpSeverityScore(input),
    clusterSuspicionScore: calculateClusterSuspicionScore(input.clusterResult),
    liquidityPullAssociationScore: calculateLiquidityPullAssociation(input.clusterResult),
    suspiciousFundingScore: calculateSuspiciousFundingScore(input.fundingFlags),
  }

  const overallOpportunityScore = clamp100(
    weightedMean([
      [opportunity.earlyEntryScore, 3],
      [opportunity.launchParticipationScore, 2],
      [opportunity.momentumParticipationScore, 2],
      [opportunity.repeatSuccessScore, 2],
      [opportunity.exitTimingScore, 1],
    ]),
  )

  const overallRiskScore = clamp100(
    weightedMean([
      [risk.rugRiskScore, 3],
      [risk.dumpSeverityScore, 2],
      [risk.clusterSuspicionScore, 2],
      [risk.liquidityPullAssociationScore, 1],
      [risk.suspiciousFundingScore, 2],
    ]),
  )

  const tags = buildWalletTags(opportunity, risk)
  const classification = classifyWalletProfile(overallOpportunityScore, overallRiskScore)

  return {
    ...opportunity,
    ...risk,
    overallOpportunityScore,
    overallRiskScore,
    classification,
    tags,
    scoredAt: new Date().toISOString(),
  }
}

// ─── Tag builder ───────────────────────────────────────────────────────────────

function buildWalletTags(
  opportunity: WalletOpportunityProfile,
  risk: WalletRiskProfile,
): string[] {
  const tags: string[] = []
  if (opportunity.earlyEntryScore >= 80) tags.push('ultra-early-entrant')
  else if (opportunity.earlyEntryScore >= 60) tags.push('early-entrant')
  if (opportunity.momentumParticipationScore >= 80) tags.push('momentum-player')
  if (opportunity.repeatSuccessScore >= 70) tags.push('consistent-winner')
  if (opportunity.exitTimingScore >= 75) tags.push('clean-exits')
  if (risk.rugRiskScore >= 65) tags.push('rug-associated')
  if (risk.dumpSeverityScore >= 50) tags.push('aggressive-dumper')
  if (risk.clusterSuspicionScore >= 45) tags.push('cluster-linked')
  if (risk.suspiciousFundingScore >= 40) tags.push('suspicious-funding')
  if (risk.liquidityPullAssociationScore >= 30) tags.push('liquidity-pull-risk')
  return tags
}
