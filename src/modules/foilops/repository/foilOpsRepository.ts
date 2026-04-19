// ─── FoilOps Prisma Repository ────────────────────────────────────────────────
// Persistence layer for WalletProfileSnapshot, TokenRiskSnapshot, and
// WalletClusterEdge models. All write methods are upserts so callers can
// safely re-score without worrying about duplicates.

import { Prisma, WalletClassification, TokenClassification, ClusterLinkType } from '@prisma/client'
import prisma from '../../../providers/prisma'
import { WalletProfile, LaunchParticipationRecord } from '../types/wallet'
import { TokenRiskProfile, SuspiciousTokenEvent } from '../types/token'
import { WalletClusterLink } from '../types/cluster'

// ─── Type maps ────────────────────────────────────────────────────────────────

function toDbWalletClassification(c: string): WalletClassification {
  const map: Record<string, WalletClassification> = {
    'early-entrant': WalletClassification.EARLY_ENTRANT,
    'momentum-wallet': WalletClassification.MOMENTUM_WALLET,
    'high-risk': WalletClassification.HIGH_RISK,
    watchlist: WalletClassification.WATCHLIST,
    ignore: WalletClassification.IGNORE,
  }
  return map[c] ?? WalletClassification.IGNORE
}

function toDbTokenClassification(c: string): TokenClassification {
  const map: Record<string, TokenClassification> = {
    'safer-speculative': TokenClassification.SAFER_SPECULATIVE,
    watchlist: TokenClassification.WATCHLIST,
    'high-risk': TokenClassification.HIGH_RISK,
    'extreme-risk': TokenClassification.EXTREME_RISK,
  }
  return map[c] ?? TokenClassification.WATCHLIST
}

function toDbLinkType(t: string): ClusterLinkType {
  const map: Record<string, ClusterLinkType> = {
    'shared-funder': ClusterLinkType.SHARED_FUNDER,
    'co-launch': ClusterLinkType.CO_LAUNCH,
    'shared-counterparty': ClusterLinkType.SHARED_COUNTERPARTY,
    'similar-exit-pattern': ClusterLinkType.SIMILAR_EXIT_PATTERN,
    'downstream-consolidation': ClusterLinkType.DOWNSTREAM_CONSOLIDATION,
  }
  return map[t] ?? ClusterLinkType.CO_LAUNCH
}

function fromDbWalletClassification(c: WalletClassification): string {
  const map: Record<WalletClassification, string> = {
    EARLY_ENTRANT: 'early-entrant',
    MOMENTUM_WALLET: 'momentum-wallet',
    HIGH_RISK: 'high-risk',
    WATCHLIST: 'watchlist',
    IGNORE: 'ignore',
  }
  return map[c]
}

function fromDbTokenClassification(c: TokenClassification): string {
  const map: Record<TokenClassification, string> = {
    SAFER_SPECULATIVE: 'safer-speculative',
    WATCHLIST: 'watchlist',
    HIGH_RISK: 'high-risk',
    EXTREME_RISK: 'extreme-risk',
  }
  return map[c]
}

// ─── Repository class ─────────────────────────────────────────────────────────

export class FoilOpsRepository {
  // ─── Wallet snapshots ────────────────────────────────────────────────────────

  async upsertWalletSnapshot(profile: WalletProfile, launches: LaunchParticipationRecord[]): Promise<void> {
    const snapshotData = {
      overallOpportunityScore: profile.overallOpportunityScore,
      overallRiskScore: profile.overallRiskScore,
      classification: toDbWalletClassification(profile.classification),
      earlyEntryScore: profile.earlyEntryScore,
      launchParticipationScore: profile.launchParticipationScore,
      momentumParticipationScore: profile.momentumParticipationScore,
      repeatSuccessScore: profile.repeatSuccessScore,
      exitTimingScore: profile.exitTimingScore,
      rugRiskScore: profile.rugRiskScore,
      dumpSeverityScore: profile.dumpSeverityScore,
      clusterSuspicionScore: profile.clusterSuspicionScore,
      liquidityPullScore: profile.liquidityPullAssociationScore,
      suspiciousFundingScore: profile.suspiciousFundingScore,
      tags: profile.tags,
      computedAt: new Date(profile.scoredAt),
    }

    // Find the latest snapshot for this wallet and update it,
    // or create a new one if none exists.
    const existing = await prisma.walletProfileSnapshot.findFirst({
      where: { wallet: profile.wallet },
      orderBy: { computedAt: 'desc' },
      select: { id: true },
    })

    if (existing) {
      // Replace the launch records and update scores in place
      await prisma.launchParticipationRecord.deleteMany({ where: { snapshotId: existing.id } })
      await prisma.walletProfileSnapshot.update({
        where: { id: existing.id },
        data: {
          ...snapshotData,
          launchRecords: {
            create: launches.map((l) => ({
              wallet: profile.wallet,
              tokenAddress: l.tokenAddress,
              tokenSymbol: l.tokenSymbol ?? null,
              entryTimestamp: BigInt(l.entryTimestamp),
              entryDelaySeconds: l.entryDelaySeconds,
              exitTimestamp: l.exitTimestamp != null ? BigInt(l.exitTimestamp) : null,
              exitDelaySeconds: l.exitDelaySeconds ?? null,
              gainLossPct: l.gainLossPct ?? null,
              platform: l.platform,
            })),
          },
        },
      })
    } else {
      await prisma.walletProfileSnapshot.create({
        data: {
          wallet: profile.wallet,
          ...snapshotData,
          launchRecords: {
            create: launches.map((l) => ({
              wallet: profile.wallet,
              tokenAddress: l.tokenAddress,
              tokenSymbol: l.tokenSymbol ?? null,
              entryTimestamp: BigInt(l.entryTimestamp),
              entryDelaySeconds: l.entryDelaySeconds,
              exitTimestamp: l.exitTimestamp != null ? BigInt(l.exitTimestamp) : null,
              exitDelaySeconds: l.exitDelaySeconds ?? null,
              gainLossPct: l.gainLossPct ?? null,
              platform: l.platform,
            })),
          },
        },
      })
    }
  }

  async getTopWallets(opts: {
    limit: number
    classification?: string
    maxRiskScore?: number
    minOpportunityScore?: number
  }) {
    const where: Prisma.WalletProfileSnapshotWhereInput = {}
    if (opts.classification) {
      where.classification = toDbWalletClassification(opts.classification)
    }
    if (opts.maxRiskScore !== undefined) {
      where.overallRiskScore = { lte: opts.maxRiskScore }
    }
    if (opts.minOpportunityScore !== undefined) {
      where.overallOpportunityScore = {
        gte: opts.minOpportunityScore,
        ...((where.overallOpportunityScore ?? {}) as object),
      }
    }

    const rows = await prisma.walletProfileSnapshot.findMany({
      where,
      orderBy: { overallOpportunityScore: 'desc' },
      take: opts.limit,
      include: { launchRecords: { take: 10, orderBy: { entryTimestamp: 'desc' } } },
    })

    return rows.map((r) => {
      const delayValues = r.launchRecords.map((l) => l.entryDelaySeconds).filter((v) => v != null) as number[]
      const entryTimingAvgSeconds = delayValues.length
        ? Math.round(delayValues.reduce((a, b) => a + b, 0) / delayValues.length)
        : null
      return {
        walletAddress: r.wallet,
        opportunityScore: r.overallOpportunityScore,
        riskScore: r.overallRiskScore,
        classification: fromDbWalletClassification(r.classification),
        earlyEntryScore: r.earlyEntryScore,
        momentumParticipationScore: r.momentumParticipationScore,
        repeatSuccessScore: r.repeatSuccessScore,
        tags: r.tags,
        recentLaunchCount: r.launchRecords.length,
        lastSeenPlatform: r.launchRecords[0]?.platform ?? null,
        entryTimingAvgSeconds,
        computedAt: r.computedAt.toISOString(),
      }
    })
  }

  async getHighRiskWallets(limit: number) {
    const rows = await prisma.walletProfileSnapshot.findMany({
      where: { overallRiskScore: { gte: 65 } },
      orderBy: { overallRiskScore: 'desc' },
      take: limit,
    })
    return rows.map((r) => ({
      walletAddress: r.wallet,
      riskScore: r.overallRiskScore,
      opportunityScore: r.overallOpportunityScore,
      classification: fromDbWalletClassification(r.classification),
      rugRiskScore: r.rugRiskScore,
      clusterSuspicionScore: r.clusterSuspicionScore,
      dumpSeverityScore: r.dumpSeverityScore,
      tags: r.tags,
      computedAt: r.computedAt.toISOString(),
    }))
  }

  async getWalletDetail(wallet: string) {
    const snapshot = await prisma.walletProfileSnapshot.findFirst({
      where: { wallet },
      orderBy: { computedAt: 'desc' },
      include: { launchRecords: { orderBy: { entryTimestamp: 'desc' }, take: 50 } },
    })
    if (!snapshot) return null

    return {
      wallet: snapshot.wallet,
      scores: {
        overallOpportunityScore: snapshot.overallOpportunityScore,
        overallRiskScore: snapshot.overallRiskScore,
        earlyEntryScore: snapshot.earlyEntryScore,
        launchParticipationScore: snapshot.launchParticipationScore,
        momentumParticipationScore: snapshot.momentumParticipationScore,
        repeatSuccessScore: snapshot.repeatSuccessScore,
        exitTimingScore: snapshot.exitTimingScore,
        rugRiskScore: snapshot.rugRiskScore,
        dumpSeverityScore: snapshot.dumpSeverityScore,
        clusterSuspicionScore: snapshot.clusterSuspicionScore,
        liquidityPullScore: snapshot.liquidityPullScore,
        suspiciousFundingScore: snapshot.suspiciousFundingScore,
      },
      classification: fromDbWalletClassification(snapshot.classification),
      tags: snapshot.tags,
      launchRecords: snapshot.launchRecords.map((lr) => ({
        tokenAddress: lr.tokenAddress,
        tokenSymbol: lr.tokenSymbol,
        entryTimestamp: Number(lr.entryTimestamp),
        entryDelaySeconds: lr.entryDelaySeconds,
        exitTimestamp: lr.exitTimestamp != null ? Number(lr.exitTimestamp) : null,
        exitDelaySeconds: lr.exitDelaySeconds,
        gainLossPct: lr.gainLossPct,
        platform: lr.platform,
      })),
      computedAt: snapshot.computedAt.toISOString(),
    }
  }

  // ─── Token snapshots ─────────────────────────────────────────────────────────

  async upsertTokenSnapshot(profile: TokenRiskProfile, events: SuspiciousTokenEvent[]): Promise<void> {
    const existing = await prisma.tokenRiskSnapshot.findFirst({
      where: { tokenAddress: profile.tokenAddress },
      orderBy: { computedAt: 'desc' },
      select: { id: true },
    })

    const snapshotData = {
      overallTokenRiskScore: profile.overallTokenRiskScore,
      tokenClassification: toDbTokenClassification(profile.tokenClassification),
      creatorHoldPercent: profile.creatorHoldPercent,
      top10HolderPercent: profile.top10HolderPercent,
      liquidityUsd: profile.liquidityUsd,
      liquidityRemovalPercent: profile.liquidityRemovalPercent,
      suspiciousWalletLinks: profile.suspiciousWalletLinks,
      walletConcentrationScore: profile.walletConcentrationScore,
      dumpPressureScore: profile.dumpPressureScore,
      computedAt: new Date(profile.scoredAt),
    }

    if (existing) {
      await prisma.suspiciousEvent.deleteMany({ where: { snapshotId: existing.id } })
      await prisma.tokenRiskSnapshot.update({
        where: { id: existing.id },
        data: {
          ...snapshotData,
          suspiciousEvents: {
            create: events.map((e) => ({
              eventType: e.eventType,
              eventTimestamp: BigInt(e.timestamp),
              walletAddress: e.walletAddress ?? null,
              details: e.details,
            })),
          },
        },
      })
    } else {
      await prisma.tokenRiskSnapshot.create({
        data: {
          tokenAddress: profile.tokenAddress,
          ...snapshotData,
          suspiciousEvents: {
            create: events.map((e) => ({
              eventType: e.eventType,
              eventTimestamp: BigInt(e.timestamp),
              walletAddress: e.walletAddress ?? null,
              details: e.details,
            })),
          },
        },
      })
    }
  }

  async getHighRiskTokens(limit: number) {
    const rows = await prisma.tokenRiskSnapshot.findMany({
      where: { overallTokenRiskScore: { gte: 55 } },
      orderBy: { overallTokenRiskScore: 'desc' },
      take: limit,
      include: { suspiciousEvents: { take: 3, orderBy: { eventTimestamp: 'desc' } } },
    })
    return rows.map((r) => ({
      tokenAddress: r.tokenAddress,
      riskScore: r.overallTokenRiskScore,
      classification: fromDbTokenClassification(r.tokenClassification),
      creatorHoldPercent: r.creatorHoldPercent,
      top10HolderPercent: r.top10HolderPercent,
      liquidityUsd: r.liquidityUsd,
      liquidityRemovalPercent: r.liquidityRemovalPercent,
      suspiciousWalletLinks: r.suspiciousWalletLinks,
      eventCount: r.suspiciousEvents.length,
      computedAt: r.computedAt.toISOString(),
    }))
  }

  async getTokenDetail(tokenAddress: string) {
    const snapshot = await prisma.tokenRiskSnapshot.findFirst({
      where: { tokenAddress },
      orderBy: { computedAt: 'desc' },
      include: { suspiciousEvents: { orderBy: { eventTimestamp: 'desc' } } },
    })
    if (!snapshot) return null

    return {
      tokenAddress: snapshot.tokenAddress,
      scores: {
        overallTokenRiskScore: snapshot.overallTokenRiskScore,
        walletConcentrationScore: snapshot.walletConcentrationScore,
        dumpPressureScore: snapshot.dumpPressureScore,
      },
      tokenClassification: fromDbTokenClassification(snapshot.tokenClassification),
      creatorHoldPercent: snapshot.creatorHoldPercent,
      top10HolderPercent: snapshot.top10HolderPercent,
      liquidityUsd: snapshot.liquidityUsd,
      liquidityRemovalPercent: snapshot.liquidityRemovalPercent,
      suspiciousWalletLinks: snapshot.suspiciousWalletLinks,
      events: snapshot.suspiciousEvents.map((e) => ({
        eventType: e.eventType,
        timestamp: Number(e.eventTimestamp),
        walletAddress: e.walletAddress,
        details: e.details,
      })),
      computedAt: snapshot.computedAt.toISOString(),
    }
  }

  // ─── Cluster edges ───────────────────────────────────────────────────────────

  async upsertClusterEdges(links: WalletClusterLink[]): Promise<void> {
    for (const link of links) {
      await prisma.walletClusterEdge.upsert({
        where: {
          sourceWallet_targetWallet_linkType: {
            sourceWallet: link.sourceWallet,
            targetWallet: link.targetWallet,
            linkType: toDbLinkType(link.linkType),
          },
        },
        update: {
          confidence: link.confidence,
          evidence: link.evidence,
        },
        create: {
          sourceWallet: link.sourceWallet,
          targetWallet: link.targetWallet,
          linkType: toDbLinkType(link.linkType),
          confidence: link.confidence,
          evidence: link.evidence,
        },
      })
    }
  }

  async getClusterEdges(wallet: string) {
    const edges = await prisma.walletClusterEdge.findMany({
      where: {
        OR: [{ sourceWallet: wallet }, { targetWallet: wallet }],
      },
      orderBy: { confidence: 'desc' },
    })
    return edges.map((e) => ({
      sourceWallet: e.sourceWallet,
      targetWallet: e.targetWallet,
      linkType: e.linkType as string,
      confidence: e.confidence,
      evidence: e.evidence,
      createdAt: e.createdAt.toISOString(),
    }))
  }

  // ─── Launch feed ─────────────────────────────────────────────────────────────

  async getRecentLaunchFeed(limit: number) {
    const rows = await prisma.launchParticipationRecord.findMany({
      orderBy: { entryTimestamp: 'desc' },
      take: limit,
      include: {
        snapshot: {
          select: {
            wallet: true,
            classification: true,
            overallOpportunityScore: true,
            overallRiskScore: true,
            tags: true,
          },
        },
      },
    })

    return rows.map((r) => ({
      walletAddress: r.snapshot.wallet,
      tokenAddress: r.tokenAddress,
      tokenSymbol: r.tokenSymbol,
      entryTimestamp: Number(r.entryTimestamp),
      entryDelaySeconds: r.entryDelaySeconds,
      exitDelaySeconds: r.exitDelaySeconds ?? null,
      platform: r.platform,
      participatedAt: new Date(Number(r.entryTimestamp)).toISOString(),
      walletClassification: fromDbWalletClassification(r.snapshot.classification),
      walletOpportunityScore: r.snapshot.overallOpportunityScore,
      walletRiskScore: r.snapshot.overallRiskScore,
      walletTags: r.snapshot.tags,
    }))
  }

  // ─── Dashboard summary ────────────────────────────────────────────────────────

  async getDashboardSummary() {
    const [
      totalWallets,
      earlyEntrantCount,
      highRiskWalletCount,
      totalTokens,
      highRiskTokenCount,
      extremeRiskTokenCount,
    ] = await Promise.all([
      prisma.walletProfileSnapshot.count(),
      prisma.walletProfileSnapshot.count({ where: { classification: WalletClassification.EARLY_ENTRANT } }),
      prisma.walletProfileSnapshot.count({ where: { overallRiskScore: { gte: 65 } } }),
      prisma.tokenRiskSnapshot.count(),
      prisma.tokenRiskSnapshot.count({ where: { overallTokenRiskScore: { gte: 55 } } }),
      prisma.tokenRiskSnapshot.count({ where: { tokenClassification: TokenClassification.EXTREME_RISK } }),
    ])
    return {
      totalWallets,
      earlyEntrantCount,
      highRiskWalletCount,
      totalTokens,
      highRiskTokenCount,
      extremeRiskTokenCount,
    }
  }
}
