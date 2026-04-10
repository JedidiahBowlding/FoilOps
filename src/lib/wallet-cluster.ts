import { PrismaWalletClusterRepository, ClusterBehavior } from '../repositories/prisma/wallet-cluster'
import { PrismaScamWalletRepository } from '../repositories/prisma/scam-wallet'
import { ScamRisk } from './scam-risk'

export type WalletClusterResult = {
  wallet: string
  linkedWallets: string[]
  sharedBehaviors: ClusterBehavior
  clusterScore: number
  combinedRiskScore: number
}

export class WalletClusterService {
  private clusterRepository: PrismaWalletClusterRepository
  private scamWalletRepository: PrismaScamWalletRepository

  constructor() {
    this.clusterRepository = new PrismaWalletClusterRepository()
    this.scamWalletRepository = new PrismaScamWalletRepository()
  }

  async buildCluster(wallet: string): Promise<WalletClusterResult> {
    const flaggedWallets = await this.scamWalletRepository.getFlaggedWallets()
    const target = flaggedWallets.find((row) => row.address === wallet)

    const linkedWallets = new Set<string>()
    const sharedFundingSources = new Set<string>()
    const repeatedInteractionPatterns = new Set<string>()
    const flowOverlaps = new Set<string>()
    const deploymentRelationships = new Set<string>()

    const targetMints = new Set(target?.priorTokenMints || [])

    for (const candidate of flaggedWallets) {
      if (candidate.address === wallet) continue

      let points = 0
      const candidateMints = new Set(candidate.priorTokenMints || [])
      const sharedMintCount = [...targetMints].filter((mint) => candidateMints.has(mint)).length

      if (sharedMintCount > 0) {
        points += Math.min(3, sharedMintCount)
        deploymentRelationships.add(`shared token deployments: ${sharedMintCount}`)
      }

      const candidateFlowEvents = candidate.events.filter((event) => event.eventType === 'FLOW_TRACE')
      if (candidateFlowEvents.length > 0 && (target?.events || []).some((event) => event.eventType === 'FLOW_TRACE')) {
        points += 2
        flowOverlaps.add(`flow trace overlap with ${candidate.address}`)
      }

      const candidateLaunches = candidate.events.filter((event) => event.eventType === 'SUSPICIOUS_TOKEN_LAUNCH').length
      if (candidateLaunches >= 2) {
        points += 1
        repeatedInteractionPatterns.add(`repeated launch behavior: ${candidateLaunches}`)
      }

      if (points >= 3) {
        linkedWallets.add(candidate.address)
      }
    }

    if (linkedWallets.size > 0) {
      sharedFundingSources.add('shared upstream activity detected via flow traces')
    }

    const linkedCount = linkedWallets.size
    const clusterScore = Math.min(100, linkedCount * 20 + deploymentRelationships.size * 10 + flowOverlaps.size * 10)
    const combinedRiskScore = ScamRisk.clampRisk(
      50 + linkedCount * 8 + deploymentRelationships.size * 5 + flowOverlaps.size * 5,
    )

    const behavior: ClusterBehavior = {
      sharedFundingSources: Array.from(sharedFundingSources),
      repeatedInteractionPatterns: Array.from(repeatedInteractionPatterns),
      flowOverlaps: Array.from(flowOverlaps),
      deploymentRelationships: Array.from(deploymentRelationships),
    }

    const wallets = [wallet, ...Array.from(linkedWallets)]
    await this.clusterRepository.createCluster({
      wallets,
      clusterScore,
      riskScore: combinedRiskScore,
      behavior,
    })

    return {
      wallet,
      linkedWallets: Array.from(linkedWallets),
      sharedBehaviors: behavior,
      clusterScore,
      combinedRiskScore,
    }
  }

  async getLatestCluster(wallet: string) {
    return this.clusterRepository.latestClusterByWallet(wallet)
  }
}
