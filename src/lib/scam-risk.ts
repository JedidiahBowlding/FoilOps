import { ScamWallet, ScamWalletEvent } from '@prisma/client'

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
}
