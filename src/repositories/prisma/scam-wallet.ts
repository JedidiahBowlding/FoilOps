import { Prisma, ScamEventType, ScamSource } from '@prisma/client'
import prisma from '../../providers/prisma'
import { KNOWN_SCAM_WALLETS, KnownScamWalletEntry } from '../../constants/known-scam-wallets'
import { ScamRisk } from '../../lib/scam-risk'
import { FlowTraceResult } from '../../lib/fund-flow-tracer'
import { WalletFundingSource } from '../../lib/token-investigator'

type ScamEventInput = {
  address: string
  eventType: ScamEventType
  txSignature?: string
  tokenMint?: string
  platform?: string
  details?: string
  metadata?: Prisma.InputJsonValue
}

export class PrismaScamWalletRepository {
  async ensureWallet(address: string) {
    const existingWallet = await prisma.wallet.findFirst({
      where: { address },
      select: { id: true, address: true },
    })

    if (existingWallet) {
      return existingWallet
    }

    return prisma.wallet.create({
      data: { address },
      select: { id: true, address: true },
    })
  }

  async syncKnownScamWallets() {
    for (const knownWallet of KNOWN_SCAM_WALLETS) {
      await this.upsertFlaggedWallet(knownWallet)
    }
  }

  async upsertFlaggedWallet(entry: KnownScamWalletEntry) {
    const wallet = await this.ensureWallet(entry.address)

    return prisma.scamWallet.upsert({
      where: { address: entry.address },
      update: {
        reason: entry.reason,
        baseRiskScore: entry.baseRiskScore,
        source: ScamSource.CURATED_DB,
        priorTokenMints: entry.priorTokenMints,
        isFlagged: true,
      },
      create: {
        walletId: wallet.id,
        address: entry.address,
        source: ScamSource.CURATED_DB,
        reason: entry.reason,
        baseRiskScore: entry.baseRiskScore,
        priorTokenMints: entry.priorTokenMints,
        isFlagged: true,
      },
    })
  }

  async manualFlagWallet(address: string, reason: string, baseRiskScore = 75) {
    const wallet = await this.ensureWallet(address)

    const upserted = await prisma.scamWallet.upsert({
      where: { address },
      update: {
        isFlagged: true,
        source: ScamSource.MANUAL,
        reason,
        baseRiskScore,
      },
      create: {
        walletId: wallet.id,
        address,
        isFlagged: true,
        source: ScamSource.MANUAL,
        reason,
        baseRiskScore,
      },
    })

    await this.recordEvent({
      address,
      eventType: ScamEventType.MANUAL_FLAG,
      details: reason,
      metadata: { baseRiskScore },
    })

    return upserted
  }

  async manualUnflagWallet(address: string, reason = 'Unflagged by admin') {
    const scamWallet = await prisma.scamWallet.findUnique({ where: { address } })

    if (!scamWallet) return null

    const updated = await prisma.scamWallet.update({
      where: { address },
      data: {
        isFlagged: false,
        reason,
      },
    })

    await this.recordEvent({
      address,
      eventType: ScamEventType.MANUAL_UNFLAG,
      details: reason,
    })

    return updated
  }

  async getFlaggedWallets() {
    return prisma.scamWallet.findMany({
      where: { isFlagged: true },
      include: {
        events: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
      orderBy: { updatedAt: 'desc' },
    })
  }

  async getScamWalletByAddress(address: string) {
    return prisma.scamWallet.findUnique({
      where: { address },
      include: {
        events: {
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
      },
    })
  }

  async recordEvent(input: ScamEventInput) {
    const wallet = await this.ensureWallet(input.address)

    const scamWallet = await prisma.scamWallet.upsert({
      where: { address: input.address },
      update: {
        walletId: wallet.id,
        isFlagged: true,
        source: ScamSource.DETECTED,
        reason: 'Detected suspicious wallet activity',
        lastSeenAt: new Date(),
      },
      create: {
        walletId: wallet.id,
        address: input.address,
        isFlagged: true,
        source: ScamSource.DETECTED,
        reason: 'Detected suspicious wallet activity',
        baseRiskScore: 70,
        lastSeenAt: new Date(),
      },
    })

    const eventCount = await prisma.scamWalletEvent.count({
      where: {
        scamWalletId: scamWallet.id,
      },
    })

    const riskScoreSnapshot = ScamRisk.calculateWalletRisk(scamWallet, eventCount + 1)

    try {
      return await prisma.scamWalletEvent.create({
        data: {
          scamWalletId: scamWallet.id,
          eventType: input.eventType,
          txSignature: input.txSignature,
          tokenMint: input.tokenMint,
          platform: input.platform,
          details: input.details,
          metadata: input.metadata,
          riskScoreSnapshot,
        },
      })
    } catch (error) {
      return null
    }
  }

  async getRecentAlerts(limit = 15) {
    return prisma.scamWalletEvent.findMany({
      where: {
        eventType: {
          in: [
            ScamEventType.SUSPICIOUS_TOKEN_LAUNCH,
            ScamEventType.SUSPICIOUS_PRELAUNCH_SIGNAL,
            ScamEventType.ANOMALY_DETECTED,
            ScamEventType.CLUSTER_ALERT,
            ScamEventType.PLATFORM_INTERACTION,
            ScamEventType.FLOW_TO_NEW_LAUNCH,
          ],
        },
      },
      include: {
        scamWallet: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
    })
  }

  async appendPriorTokenMints(address: string, tokenMints: string[]) {
    const existing = await prisma.scamWallet.findUnique({
      where: { address },
      select: { priorTokenMints: true },
    })

    const mergedMints = Array.from(new Set([...(existing?.priorTokenMints || []), ...tokenMints]))

    return prisma.scamWallet.update({
      where: { address },
      data: {
        priorTokenMints: mergedMints,
      },
    })
  }

  async saveFlowTrace(
    address: string,
    trace: FlowTraceResult,
    trigger: 'MANUAL_FLAG' | 'SUSPICIOUS_LAUNCH' | 'TOKEN_INVESTIGATION',
  ) {
    await this.recordEvent({
      address,
      eventType: ScamEventType.FLOW_TRACE,
      details: `Flow trace captured (${trace.steps.length} steps)`,
      metadata: {
        trigger,
        tracedAt: trace.tracedAt,
        maxHops: trace.maxHops,
        steps: trace.steps,
      },
    })

    for (const step of trace.steps) {
      const interactedKnownPlatform = step.categories.some((category) =>
        ['MIXER', 'EXCHANGE', 'SCAM', 'DEFI', 'BRIDGE', 'CUSTODY'].includes(category),
      )

      if (interactedKnownPlatform) {
        await this.recordEvent({
          address,
          eventType: ScamEventType.PLATFORM_INTERACTION,
          txSignature: step.signature,
          tokenMint: step.tokenMint,
          platform: step.matchedPlatforms.join(', '),
          details: `Trace hop ${step.hop} interacted with ${step.matchedPlatforms.join(', ') || 'known platform'}`,
          metadata: {
            step,
          },
        })
      }

      if (step.linkedToLaunchPattern) {
        await this.recordEvent({
          address,
          eventType: ScamEventType.FLOW_TO_NEW_LAUNCH,
          txSignature: step.signature,
          tokenMint: step.tokenMint,
          platform: step.matchedPlatforms.join(', '),
          details: `Trace hop ${step.hop} linked to new token launch pattern`,
          metadata: {
            step,
          },
        })
      }
    }
  }

  async getLatestFlowTrace(address: string) {
    const latestFlowEvent = await prisma.scamWalletEvent.findFirst({
      where: {
        scamWallet: {
          address,
        },
        eventType: ScamEventType.FLOW_TRACE,
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    return latestFlowEvent
  }

  async getDashboardRows() {
    const wallets = await prisma.scamWallet.findMany({
      include: {
        events: {
          orderBy: { createdAt: 'desc' },
          take: 25,
        },
      },
      orderBy: { updatedAt: 'desc' },
    })

    return wallets.map((wallet) => {
      const launchEvents = ScamRisk.latestLaunchEvents(wallet.events)
      const riskScore = ScamRisk.calculateWalletRisk(wallet, launchEvents.length)
      const latestFlowEvent = wallet.events.find((event) => event.eventType === ScamEventType.FLOW_TRACE)
      const flowMap = latestFlowEvent?.metadata || null

      return {
        id: wallet.id,
        address: wallet.address,
        source: wallet.source,
        isFlagged: wallet.isFlagged,
        reason: wallet.reason,
        priorTokenMints: wallet.priorTokenMints,
        riskScore,
        riskLevel: ScamRisk.describeRisk(riskScore),
        launches: launchEvents,
        flowMap,
      }
    })
  }

  async getTokenInvestigationRows() {
    const investigationEvents = await prisma.scamWalletEvent.findMany({
      where: {
        eventType: ScamEventType.TOKEN_INVESTIGATION,
      },
      include: {
        scamWallet: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
    })

    return investigationEvents.map((event) => {
      const metadata = (event.metadata as {
        tokenMint?: string
        developerResolutionSource?: string
        relatedTokens?: string[]
      } | null) ?? { relatedTokens: [] }

      return {
        id: event.id,
        tokenMint: metadata.tokenMint || event.tokenMint || 'unknown',
        developerWallet: event.scamWallet.address,
        developerResolutionSource: metadata.developerResolutionSource || event.platform || 'unknown',
        relatedTokens: metadata.relatedTokens || [],
        createdAt: event.createdAt,
        riskScoreSnapshot: event.riskScoreSnapshot,
      }
    })
  }

  async saveTokenInvestigation(
    address: string,
    tokenMint: string,
    developerResolutionSource: string,
    relatedTokens: string[],
    initialFundingSource?: WalletFundingSource | null,
  ) {
    await this.appendPriorTokenMints(address, relatedTokens)

    return this.recordEvent({
      address,
      eventType: ScamEventType.TOKEN_INVESTIGATION,
      tokenMint,
      platform: developerResolutionSource,
      details: `Token investigation linked ${tokenMint} to developer wallet ${address}`,
      metadata: {
        tokenMint,
        developerResolutionSource,
        relatedTokens,
        initialFundingSource,
      },
    })
  }
}
