import { ScamRisk } from './scam-risk'
import { WalletClusterService } from './wallet-cluster'
import { PrismaScamWalletRepository } from '../repositories/prisma/scam-wallet'

export class AiAnalyzer {
  private clusterService: WalletClusterService
  private scamWalletRepository: PrismaScamWalletRepository

  constructor() {
    this.clusterService = new WalletClusterService()
    this.scamWalletRepository = new PrismaScamWalletRepository()
  }

  async analyzeWallet(wallet: string): Promise<string> {
    const scamWallet = await this.scamWalletRepository.getScamWalletByAddress(wallet)
    const cluster = await this.clusterService.getLatestCluster(wallet)

    const eventCount = scamWallet?.events.length || 0
    const priorLaunches = (scamWallet?.events || []).filter(
      (event) => event.eventType === 'SUSPICIOUS_TOKEN_LAUNCH',
    ).length

    const prediction = ScamRisk.predictScamProbability({
      walletAgeDays: 30,
      priorLaunches,
      liquidityRisk: priorLaunches >= 2 ? 12 : 5,
      flowRecyclingRisk: Math.min(15, eventCount),
      clusterRisk: cluster?.riskScore ? Math.round(cluster.riskScore / 5) : 0,
      isFlagged: scamWallet?.isFlagged || false,
    })

    const reasons = [
      `prior launches: ${priorLaunches}`,
      `event activity: ${eventCount}`,
      `cluster risk: ${prediction.metadata.clusterRisk}`,
      `flagged: ${prediction.metadata.isFlagged ? 'yes' : 'no'}`,
    ]

    return [
      'AI Intelligence Summary',
      `Wallet: ${wallet}`,
      `Scam likelihood: ${prediction.probability}/100`,
      `Confidence: ${prediction.confidence}`,
      `Key indicators: ${reasons.join(', ')}`,
    ].join('\n')
  }
}
