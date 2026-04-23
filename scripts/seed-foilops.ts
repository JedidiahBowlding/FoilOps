#!/usr/bin/env tsx
// ─── Seed FoilOps Intelligence Tables ────────────────────────────────────────
// Populates WalletProfileSnapshot, LaunchParticipationRecord, TokenRiskSnapshot,
// SuspiciousEvent, and WalletClusterEdge with realistic sample data so the
// dashboard renders immediately after deployment.
//
// Usage:  pnpm tsx scripts/seed-foilops.ts

import { PrismaClient, WalletClassification, TokenClassification, ClusterLinkType } from '@prisma/client'

const prisma = new PrismaClient()

// ─── Sample real Solana addresses ─────────────────────────────────────────────

const WALLETS = [
  '45Txh2SWXcHFbUUWG4YNNZgUmwtaHJYVWF5NEwi1ZwGS',
  '11111111111111111111111111111111',
  'Stake11111111111111111111111111111111111111',
  'Vote111111111111111111111111111111111111111',
  'Config1111111111111111111111111111111111111',
  'AddressLookupTab1e1111111111111111111111111',
  'ComputeBudget111111111111111111111111111111',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
]

const TOKENS = [
  'So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
]

const PLATFORMS = ['pump.fun', 'raydium', 'jupiter', 'orca', 'meteora']

function now() {
  return Date.now()
}
function daysAgo(n: number) {
  return now() - n * 86_400_000
}
function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}
function randFloat(min: number, max: number) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(2))
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ─── Wallet profile seed data ─────────────────────────────────────────────────

const walletSeeds: Array<{
  wallet: string
  classification: WalletClassification
  opportunityScore: number
  riskScore: number
  earlyEntry: number
  momentum: number
  repeatSuccess: number
  exitTiming: number
  rugRisk: number
  dumpSeverity: number
  clusterSuspicion: number
  suspiciousFunding: number
  liquidityPull: number
  launchParticipation: number
  tags: string[]
}> = [
  {
    wallet: WALLETS[0],
    classification: WalletClassification.EARLY_ENTRANT,
    opportunityScore: 87,
    riskScore: 18,
    earlyEntry: 91,
    momentum: 78,
    repeatSuccess: 72,
    exitTiming: 85,
    rugRisk: 10,
    dumpSeverity: 12,
    clusterSuspicion: 8,
    suspiciousFunding: 5,
    liquidityPull: 3,
    launchParticipation: 80,
    tags: ['early-entrant', 'consistent-exiter', 'clean-funding'],
  },
  {
    wallet: WALLETS[1],
    classification: WalletClassification.EARLY_ENTRANT,
    opportunityScore: 79,
    riskScore: 22,
    earlyEntry: 83,
    momentum: 65,
    repeatSuccess: 68,
    exitTiming: 75,
    rugRisk: 14,
    dumpSeverity: 15,
    clusterSuspicion: 12,
    suspiciousFunding: 10,
    liquidityPull: 5,
    launchParticipation: 70,
    tags: ['early-entrant', 'multi-platform'],
  },
  {
    wallet: WALLETS[2],
    classification: WalletClassification.MOMENTUM_WALLET,
    opportunityScore: 62,
    riskScore: 34,
    earlyEntry: 42,
    momentum: 88,
    repeatSuccess: 54,
    exitTiming: 60,
    rugRisk: 28,
    dumpSeverity: 22,
    clusterSuspicion: 18,
    suspiciousFunding: 14,
    liquidityPull: 8,
    launchParticipation: 65,
    tags: ['momentum-follower', 'mid-entry'],
  },
  {
    wallet: WALLETS[3],
    classification: WalletClassification.MOMENTUM_WALLET,
    opportunityScore: 55,
    riskScore: 41,
    earlyEntry: 35,
    momentum: 72,
    repeatSuccess: 48,
    exitTiming: 52,
    rugRisk: 35,
    dumpSeverity: 30,
    clusterSuspicion: 22,
    suspiciousFunding: 20,
    liquidityPull: 12,
    launchParticipation: 58,
    tags: ['momentum-follower'],
  },
  {
    wallet: WALLETS[4],
    classification: WalletClassification.HIGH_RISK,
    opportunityScore: 28,
    riskScore: 82,
    earlyEntry: 55,
    momentum: 40,
    repeatSuccess: 22,
    exitTiming: 25,
    rugRisk: 78,
    dumpSeverity: 72,
    clusterSuspicion: 65,
    suspiciousFunding: 58,
    liquidityPull: 45,
    launchParticipation: 30,
    tags: ['flagged', 'rapid-dumper', 'cluster-linked'],
  },
  {
    wallet: WALLETS[5],
    classification: WalletClassification.HIGH_RISK,
    opportunityScore: 15,
    riskScore: 91,
    earlyEntry: 48,
    momentum: 32,
    repeatSuccess: 18,
    exitTiming: 20,
    rugRisk: 88,
    dumpSeverity: 85,
    clusterSuspicion: 78,
    suspiciousFunding: 72,
    liquidityPull: 55,
    launchParticipation: 22,
    tags: ['flagged', 'rapid-dumper', 'mixer-funded', 'cluster-linked'],
  },
  {
    wallet: WALLETS[6],
    classification: WalletClassification.WATCHLIST,
    opportunityScore: 45,
    riskScore: 58,
    earlyEntry: 38,
    momentum: 52,
    repeatSuccess: 40,
    exitTiming: 42,
    rugRisk: 50,
    dumpSeverity: 44,
    clusterSuspicion: 38,
    suspiciousFunding: 32,
    liquidityPull: 20,
    launchParticipation: 45,
    tags: ['watchlist', 'inconsistent-exits'],
  },
  {
    wallet: WALLETS[7],
    classification: WalletClassification.WATCHLIST,
    opportunityScore: 38,
    riskScore: 62,
    earlyEntry: 30,
    momentum: 45,
    repeatSuccess: 35,
    exitTiming: 38,
    rugRisk: 55,
    dumpSeverity: 48,
    clusterSuspicion: 42,
    suspiciousFunding: 28,
    liquidityPull: 22,
    launchParticipation: 40,
    tags: ['watchlist'],
  },
  {
    wallet: WALLETS[8],
    classification: WalletClassification.IGNORE,
    opportunityScore: 18,
    riskScore: 25,
    earlyEntry: 12,
    momentum: 20,
    repeatSuccess: 15,
    exitTiming: 18,
    rugRisk: 20,
    dumpSeverity: 15,
    clusterSuspicion: 10,
    suspiciousFunding: 8,
    liquidityPull: 5,
    launchParticipation: 15,
    tags: [],
  },
  {
    wallet: WALLETS[9],
    classification: WalletClassification.EARLY_ENTRANT,
    opportunityScore: 71,
    riskScore: 28,
    earlyEntry: 76,
    momentum: 58,
    repeatSuccess: 64,
    exitTiming: 70,
    rugRisk: 22,
    dumpSeverity: 18,
    clusterSuspicion: 14,
    suspiciousFunding: 12,
    liquidityPull: 6,
    launchParticipation: 72,
    tags: ['early-entrant', 'clean-funding'],
  },
]

// ─── Token seed data ──────────────────────────────────────────────────────────

const tokenSeeds: Array<{
  tokenAddress: string
  riskScore: number
  classification: TokenClassification
  creatorHold: number
  top10Hold: number
  liquidityUsd: number
  liquidityRemoval: number
  suspiciousLinks: number
  walletConcentration: number
  dumpPressure: number
}> = [
  {
    tokenAddress: TOKENS[0],
    riskScore: 22,
    classification: TokenClassification.SAFER_SPECULATIVE,
    creatorHold: 3.5,
    top10Hold: 28.0,
    liquidityUsd: 185000,
    liquidityRemoval: 0,
    suspiciousLinks: 1,
    walletConcentration: 18,
    dumpPressure: 12,
  },
  {
    tokenAddress: TOKENS[1],
    riskScore: 55,
    classification: TokenClassification.WATCHLIST,
    creatorHold: 12.0,
    top10Hold: 48.5,
    liquidityUsd: 42000,
    liquidityRemoval: 5,
    suspiciousLinks: 4,
    walletConcentration: 45,
    dumpPressure: 38,
  },
  {
    tokenAddress: TOKENS[2],
    riskScore: 74,
    classification: TokenClassification.HIGH_RISK,
    creatorHold: 22.5,
    top10Hold: 65.0,
    liquidityUsd: 8500,
    liquidityRemoval: 18,
    suspiciousLinks: 8,
    walletConcentration: 68,
    dumpPressure: 62,
  },
  {
    tokenAddress: TOKENS[3],
    riskScore: 88,
    classification: TokenClassification.EXTREME_RISK,
    creatorHold: 38.0,
    top10Hold: 78.5,
    liquidityUsd: 1200,
    liquidityRemoval: 55,
    suspiciousLinks: 14,
    walletConcentration: 85,
    dumpPressure: 82,
  },
  {
    tokenAddress: TOKENS[4],
    riskScore: 68,
    classification: TokenClassification.HIGH_RISK,
    creatorHold: 18.0,
    top10Hold: 58.0,
    liquidityUsd: 15000,
    liquidityRemoval: 12,
    suspiciousLinks: 6,
    walletConcentration: 60,
    dumpPressure: 55,
  },
]

// ─── Cluster edge seed data ───────────────────────────────────────────────────

const clusterSeeds: Array<{
  source: string
  target: string
  linkType: ClusterLinkType
  confidence: number
  evidence: string[]
}> = [
  {
    source: WALLETS[4],
    target: WALLETS[5],
    linkType: ClusterLinkType.SHARED_FUNDER,
    confidence: 0.92,
    evidence: ['Both funded from the same intermediate wallet within 5 minutes'],
  },
  {
    source: WALLETS[4],
    target: WALLETS[6],
    linkType: ClusterLinkType.CO_LAUNCH,
    confidence: 0.75,
    evidence: ['Co-bought 3 of the same tokens within the first 60 seconds of launch'],
  },
  {
    source: WALLETS[5],
    target: WALLETS[7],
    linkType: ClusterLinkType.SIMILAR_EXIT_PATTERN,
    confidence: 0.68,
    evidence: ['Simultaneous exit within 10-second windows on 4 tokens'],
  },
  {
    source: WALLETS[0],
    target: WALLETS[1],
    linkType: ClusterLinkType.SHARED_COUNTERPARTY,
    confidence: 0.45,
    evidence: ['Traded against the same market maker on 5 occasions'],
  },
  {
    source: WALLETS[5],
    target: WALLETS[4],
    linkType: ClusterLinkType.DOWNSTREAM_CONSOLIDATION,
    confidence: 0.83,
    evidence: ['Profits routed to the same consolidation address after 3 rug events'],
  },
]

// ─── Main seeder ──────────────────────────────────────────────────────────────

async function seedWallets() {
  console.log('Seeding wallet snapshots…')
  for (const w of walletSeeds) {
    // Upsert the snapshot
    const existing = await prisma.walletProfileSnapshot.findFirst({
      where: { wallet: w.wallet },
      select: { id: true },
    })

    if (existing) {
      await prisma.launchParticipationRecord.deleteMany({ where: { snapshotId: existing.id } })
      await prisma.walletProfileSnapshot.update({
        where: { id: existing.id },
        data: {
          overallOpportunityScore: w.opportunityScore,
          overallRiskScore: w.riskScore,
          classification: w.classification,
          earlyEntryScore: w.earlyEntry,
          launchParticipationScore: w.launchParticipation,
          momentumParticipationScore: w.momentum,
          repeatSuccessScore: w.repeatSuccess,
          exitTimingScore: w.exitTiming,
          rugRiskScore: w.rugRisk,
          dumpSeverityScore: w.dumpSeverity,
          clusterSuspicionScore: w.clusterSuspicion,
          liquidityPullScore: w.liquidityPull,
          suspiciousFundingScore: w.suspiciousFunding,
          tags: w.tags,
          computedAt: new Date(),
        },
      })
      // Add launch records
      for (let i = 0; i < 5; i++) {
        const entryTs = BigInt(daysAgo(randInt(1, 30)))
        await prisma.launchParticipationRecord.create({
          data: {
            snapshotId: existing.id,
            wallet: w.wallet,
            tokenAddress: pick(TOKENS),
            tokenSymbol: `TOKEN${randInt(1, 99)}`,
            entryTimestamp: entryTs,
            entryDelaySeconds: randInt(10, 600),
            exitTimestamp: entryTs + BigInt(randInt(300, 86400) * 1000),
            exitDelaySeconds: randInt(300, 86400),
            gainLossPct: randFloat(-40, 200),
            platform: pick(PLATFORMS),
          },
        })
      }
    } else {
      await prisma.walletProfileSnapshot.create({
        data: {
          wallet: w.wallet,
          overallOpportunityScore: w.opportunityScore,
          overallRiskScore: w.riskScore,
          classification: w.classification,
          earlyEntryScore: w.earlyEntry,
          launchParticipationScore: w.launchParticipation,
          momentumParticipationScore: w.momentum,
          repeatSuccessScore: w.repeatSuccess,
          exitTimingScore: w.exitTiming,
          rugRiskScore: w.rugRisk,
          dumpSeverityScore: w.dumpSeverity,
          clusterSuspicionScore: w.clusterSuspicion,
          liquidityPullScore: w.liquidityPull,
          suspiciousFundingScore: w.suspiciousFunding,
          tags: w.tags,
          computedAt: new Date(),
          launchRecords: {
            create: Array.from({ length: 5 }, (_, i) => {
              const entryTs = BigInt(daysAgo(randInt(1, 30)))
              return {
                wallet: w.wallet,
                tokenAddress: pick(TOKENS),
                tokenSymbol: `TOKEN${randInt(1, 99)}`,
                entryTimestamp: entryTs,
                entryDelaySeconds: randInt(10, 600),
                exitTimestamp: entryTs + BigInt(randInt(300, 86400) * 1000),
                exitDelaySeconds: randInt(300, 86400),
                gainLossPct: randFloat(-40, 200),
                platform: pick(PLATFORMS),
              }
            }),
          },
        },
      })
    }
  }
  console.log(`  ✓ ${walletSeeds.length} wallet snapshots upserted`)
}

async function seedTokens() {
  console.log('Seeding token risk snapshots…')
  for (const t of tokenSeeds) {
    const existing = await prisma.tokenRiskSnapshot.findFirst({
      where: { tokenAddress: t.tokenAddress },
      select: { id: true },
    })

    const eventTypes = ['LARGE_SELL', 'LIQUIDITY_REMOVAL', 'RAPID_DUMP', 'CREATOR_SELL', 'CLUSTER_BUY']
    const suspiciousEvents = Array.from({ length: randInt(2, 6) }, () => ({
      eventType: pick(eventTypes),
      eventTimestamp: BigInt(daysAgo(randInt(0, 7))),
      walletAddress: pick(WALLETS),
      details: `Detected abnormal activity — confidence ${randInt(60, 99)}%`,
    }))

    if (existing) {
      await prisma.suspiciousEvent.deleteMany({ where: { snapshotId: existing.id } })
      await prisma.tokenRiskSnapshot.update({
        where: { id: existing.id },
        data: {
          overallTokenRiskScore: t.riskScore,
          tokenClassification: t.classification,
          creatorHoldPercent: t.creatorHold,
          top10HolderPercent: t.top10Hold,
          liquidityUsd: t.liquidityUsd,
          liquidityRemovalPercent: t.liquidityRemoval,
          suspiciousWalletLinks: t.suspiciousLinks,
          walletConcentrationScore: t.walletConcentration,
          dumpPressureScore: t.dumpPressure,
          computedAt: new Date(),
          suspiciousEvents: { create: suspiciousEvents },
        },
      })
    } else {
      await prisma.tokenRiskSnapshot.create({
        data: {
          tokenAddress: t.tokenAddress,
          overallTokenRiskScore: t.riskScore,
          tokenClassification: t.classification,
          creatorHoldPercent: t.creatorHold,
          top10HolderPercent: t.top10Hold,
          liquidityUsd: t.liquidityUsd,
          liquidityRemovalPercent: t.liquidityRemoval,
          suspiciousWalletLinks: t.suspiciousLinks,
          walletConcentrationScore: t.walletConcentration,
          dumpPressureScore: t.dumpPressure,
          computedAt: new Date(),
          suspiciousEvents: { create: suspiciousEvents },
        },
      })
    }
  }
  console.log(`  ✓ ${tokenSeeds.length} token snapshots upserted`)
}

async function seedClusterEdges() {
  console.log('Seeding cluster edges…')
  for (const e of clusterSeeds) {
    await prisma.walletClusterEdge.upsert({
      where: {
        sourceWallet_targetWallet_linkType: {
          sourceWallet: e.source,
          targetWallet: e.target,
          linkType: e.linkType,
        },
      },
      update: { confidence: e.confidence, evidence: e.evidence },
      create: {
        sourceWallet: e.source,
        targetWallet: e.target,
        linkType: e.linkType,
        confidence: e.confidence,
        evidence: e.evidence,
      },
    })
  }
  console.log(`  ✓ ${clusterSeeds.length} cluster edges upserted`)
}

async function main() {
  console.log('\n=== FoilOps Seed Script ===\n')
  await seedWallets()
  await seedTokens()
  await seedClusterEdges()
  console.log('\n✓ FoilOps seed complete. Visit /dashboard/foilops to verify.\n')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
