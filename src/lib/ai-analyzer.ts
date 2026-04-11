import { ScamRisk } from './scam-risk'
import { WalletClusterService } from './wallet-cluster'
import { PrismaScamWalletRepository } from '../repositories/prisma/scam-wallet'
import { WalletBehaviorProfiler } from './wallet-behavior-profiler'

export class AiAnalyzer {
  private clusterService: WalletClusterService
  private scamWalletRepository: PrismaScamWalletRepository
  private walletBehaviorProfiler: WalletBehaviorProfiler

  constructor() {
    this.clusterService = new WalletClusterService()
    this.scamWalletRepository = new PrismaScamWalletRepository()
    this.walletBehaviorProfiler = new WalletBehaviorProfiler()
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

    const behavior = await this.walletBehaviorProfiler.profileWallet(wallet)

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
      `Behavior class: ${behavior.classification}`,
      `Bot likelihood: ${behavior.botProbability}/100`,
      `Dev-wallet likelihood: ${behavior.devProbability}/100`,
      `Behavior indicators: ${behavior.indicators.length > 0 ? behavior.indicators.join(', ') : 'none from sample'}`,
      `Behavior metrics: tx/min=${behavior.metrics.txPerMinute.toFixed(2)}, median interval=${behavior.metrics.medianIntervalSeconds.toFixed(1)}s, outgoing=${behavior.metrics.outgoingTransfers}, destinations=${behavior.metrics.uniqueDestinations}, micro-transfer ratio=${(behavior.metrics.tinyTransferRatio * 100).toFixed(1)}%, mint-like logs=${behavior.metrics.mintLikeLogCount}`,
      `Key indicators: ${reasons.join(', ')}`,
    ].join('\n')
  }
}
