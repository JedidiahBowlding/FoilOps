// ─── Cluster Analysis Service ──────────────────────────────────────────────────
// Detects relationship links between wallets based on co-activity evidence.
// This is a standalone, pure-computation service that accepts pre-fetched data
// so it can be tested without database dependencies.

import {
  WalletClusterLink,
  ClusterLinkType,
  ClusterAnalysisResult,
} from '../types/cluster'
import { tracingRules, walletRules } from '../config/foilOpsConfig'
import { additiveCap, clamp100 } from '../utils/scoringMath'

// ─── Candidate wallet data ─────────────────────────────────────────────────────

export type CandidateWalletData = {
  address: string
  // Token mint addresses this wallet has participated in
  launchParticipations: string[]
  // Wallets that funded this wallet within the lookback window
  fundingSources: string[]
  // Counterparties (both directions) this wallet transacted with
  counterparties: string[]
  // Whether this wallet exhibits suspicious exit patterns (e.g. rapid sells)
  hasSuspiciousExitPattern: boolean
  // Downstream wallets that received funds from this wallet
  downstreamRecipients: string[]
}

// ─── Link detectors ────────────────────────────────────────────────────────────

function detectCoLaunchLinks(
  targetAddress: string,
  targetLaunches: Set<string>,
  candidates: CandidateWalletData[],
  minCount: number,
): WalletClusterLink[] {
  const links: WalletClusterLink[] = []
  for (const candidate of candidates) {
    if (candidate.address === targetAddress) continue
    const shared = candidate.launchParticipations.filter((m) => targetLaunches.has(m))
    if (shared.length >= minCount) {
      const confidence = clamp100(Math.min(100, shared.length * 20)) / 100
      links.push({
        sourceWallet: targetAddress,
        targetWallet: candidate.address,
        linkType: 'co-launch',
        confidence,
        evidence: shared.map((m) => `co-participated in token: ${m}`),
      })
    }
  }
  return links
}

function detectSharedFunderLinks(
  targetAddress: string,
  targetFunders: Set<string>,
  candidates: CandidateWalletData[],
): WalletClusterLink[] {
  const links: WalletClusterLink[] = []
  for (const candidate of candidates) {
    if (candidate.address === targetAddress) continue
    const shared = candidate.fundingSources.filter((f) => targetFunders.has(f))
    if (shared.length > 0) {
      const confidence = clamp100(Math.min(100, shared.length * 35)) / 100
      links.push({
        sourceWallet: targetAddress,
        targetWallet: candidate.address,
        linkType: 'shared-funder',
        confidence,
        evidence: shared.map((f) => `shared funding source: ${f}`),
      })
    }
  }
  return links
}

function detectSharedCounterpartyLinks(
  targetAddress: string,
  targetCounterparties: Set<string>,
  candidates: CandidateWalletData[],
): WalletClusterLink[] {
  const links: WalletClusterLink[] = []
  for (const candidate of candidates) {
    if (candidate.address === targetAddress) continue
    const shared = candidate.counterparties.filter((c) => targetCounterparties.has(c))
    if (shared.length >= 2) {
      const confidence = clamp100(Math.min(100, shared.length * 15)) / 100
      links.push({
        sourceWallet: targetAddress,
        targetWallet: candidate.address,
        linkType: 'shared-counterparty',
        confidence,
        evidence: shared.map((c) => `shared counterparty: ${c}`),
      })
    }
  }
  return links
}

function detectSimilarExitPatternLinks(
  targetAddress: string,
  targetHasSuspiciousExit: boolean,
  candidates: CandidateWalletData[],
): WalletClusterLink[] {
  if (!targetHasSuspiciousExit) return []
  const links: WalletClusterLink[] = []
  for (const candidate of candidates) {
    if (candidate.address === targetAddress) continue
    if (candidate.hasSuspiciousExitPattern) {
      links.push({
        sourceWallet: targetAddress,
        targetWallet: candidate.address,
        linkType: 'similar-exit-pattern',
        confidence: 0.4,
        evidence: ['both wallets show suspicious rapid-sell exit patterns'],
      })
    }
  }
  return links
}

function detectDownstreamConsolidationLinks(
  targetAddress: string,
  targetDownstream: Set<string>,
  candidates: CandidateWalletData[],
): WalletClusterLink[] {
  const links: WalletClusterLink[] = []
  for (const candidate of candidates) {
    if (candidate.address === targetAddress) continue
    // If candidate is a downstream recipient of target, or vice-versa
    if (
      targetDownstream.has(candidate.address) ||
      candidate.downstreamRecipients.includes(targetAddress)
    ) {
      links.push({
        sourceWallet: targetAddress,
        targetWallet: candidate.address,
        linkType: 'downstream-consolidation',
        confidence: 0.6,
        evidence: ['funds transferred between wallets post-event'],
      })
    }
  }
  return links
}

// ─── Suspicion score from links ────────────────────────────────────────────────

function clusterSuspicionFromLinks(links: WalletClusterLink[]): number {
  const lw = walletRules.cluster.linkWeights
  const minConf = walletRules.cluster.minLinkConfidence
  const contributions = links
    .filter((l) => l.confidence >= minConf)
    .map((l) => {
      const baseWeight = lw[l.linkType as keyof typeof lw] ?? 10
      return baseWeight * l.confidence
    })
  return additiveCap(contributions)
}

// ─── Main analyser ─────────────────────────────────────────────────────────────

export function analyseWalletCluster(
  targetAddress: string,
  targetData: CandidateWalletData,
  candidates: CandidateWalletData[],
): ClusterAnalysisResult {
  const targetLaunches = new Set(targetData.launchParticipations)
  const targetFunders = new Set(targetData.fundingSources)
  const targetCounterparties = new Set(targetData.counterparties)
  const targetDownstream = new Set(targetData.downstreamRecipients)

  const allLinks: WalletClusterLink[] = [
    ...detectCoLaunchLinks(targetAddress, targetLaunches, candidates, tracingRules.coLaunchMinCount),
    ...detectSharedFunderLinks(targetAddress, targetFunders, candidates),
    ...detectSharedCounterpartyLinks(targetAddress, targetCounterparties, candidates),
    ...detectSimilarExitPatternLinks(targetAddress, targetData.hasSuspiciousExitPattern, candidates),
    ...detectDownstreamConsolidationLinks(targetAddress, targetDownstream, candidates),
  ]

  // De-duplicate — keep highest-confidence link per (source, target, type) triplet
  const seen = new Map<string, WalletClusterLink>()
  for (const link of allLinks) {
    const key = `${link.sourceWallet}:${link.targetWallet}:${link.linkType}`
    const existing = seen.get(key)
    if (!existing || link.confidence > existing.confidence) {
      seen.set(key, link)
    }
  }
  const dedupedLinks = Array.from(seen.values())

  const reachableWallets = [...new Set(dedupedLinks.map((l) => l.targetWallet))]
  const linkTypeSet = new Set(dedupedLinks.map((l) => l.linkType as ClusterLinkType))
  const maxLinkConfidence = dedupedLinks.reduce((max, l) => Math.max(max, l.confidence), 0)

  return {
    wallet: targetAddress,
    links: dedupedLinks,
    reachableWallets,
    linkTypeDiversity: linkTypeSet.size,
    clusterSuspicionScore: clusterSuspicionFromLinks(dedupedLinks),
    maxLinkConfidence,
    computedAt: new Date().toISOString(),
  }
}
