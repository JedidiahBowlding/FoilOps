import { ScamWallet, ScamWalletEvent } from '@prisma/client'

export type RiskPrediction = {
  probability: number
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  metadata: {
    walletAgeDays: number
    priorLaunches: number
    liquidityRisk: number
    flowRecyclingRisk: number
    clusterRisk: number
    isFlagged: boolean
  }
}

export class ScamRisk {
  static clampRisk(score: number): number {
    if (score < 0) return 0
    if (score > 100) return 100
    return Math.round(score)
  }

  static calculateWalletRisk(
    wallet: Pick<ScamWallet, 'baseRiskScore' | 'isFlagged' | 'priorTokenMints'>,
    eventsCount: number,
  ) {
    const base = wallet.baseRiskScore
    const historyBoost = Math.min(12, wallet.priorTokenMints.length * 2)
    const activityBoost = Math.min(18, eventsCount * 3)
    const flagBoost = wallet.isFlagged ? 10 : 0

    return ScamRisk.clampRisk(base + historyBoost + activityBoost + flagBoost)
  }

  static describeRisk(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (score >= 85) return 'CRITICAL'
    if (score >= 70) return 'HIGH'
    if (score >= 45) return 'MEDIUM'
    return 'LOW'
  }

  static latestLaunchEvents(events: ScamWalletEvent[]) {
    return events.filter((event) => event.eventType === 'SUSPICIOUS_TOKEN_LAUNCH')
  }

  static predictScamProbability(input: {
    walletAgeDays: number
    priorLaunches: number
    liquidityRisk: number
    flowRecyclingRisk: number
    clusterRisk: number
    isFlagged: boolean
  }): RiskPrediction {
    const ageRisk = input.walletAgeDays <= 7 ? 20 : input.walletAgeDays <= 30 ? 10 : 0
    const priorLaunchRisk = Math.min(25, input.priorLaunches * 5)
    const liquidityRisk = Math.min(20, Math.max(0, input.liquidityRisk))
    const recyclingRisk = Math.min(20, Math.max(0, input.flowRecyclingRisk))
    const clusterRisk = Math.min(20, Math.max(0, input.clusterRisk))
    const flagBoost = input.isFlagged ? 10 : 0

    const probability = ScamRisk.clampRisk(
      ageRisk + priorLaunchRisk + liquidityRisk + recyclingRisk + clusterRisk + flagBoost,
    )

    let confidence: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW'
    if (input.priorLaunches >= 3 || input.clusterRisk >= 12 || input.flowRecyclingRisk >= 12) {
      confidence = 'HIGH'
    } else if (input.priorLaunches >= 1 || input.liquidityRisk >= 8) {
      confidence = 'MEDIUM'
    }

    return {
      probability,
      confidence,
      metadata: {
        walletAgeDays: input.walletAgeDays,
        priorLaunches: input.priorLaunches,
        liquidityRisk,
        flowRecyclingRisk: recyclingRisk,
        clusterRisk,
        isFlagged: input.isFlagged,
      },
    }
  }
}
