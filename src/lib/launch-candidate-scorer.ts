import { scoreToken } from '../modules/foilops/services/tokenRiskService'
import { DetectedLaunch, LaunchEvidence, ScoredLaunchCandidate } from './new-launch-types'

export function scoreLaunchCandidate(launch: DetectedLaunch, evidence: LaunchEvidence): ScoredLaunchCandidate {
  if (evidence.assetCategory === 'OFFICIAL_STOCK_TOKEN') {
    return {
      ...launch,
      evidence,
      opportunityScore: 0,
      riskScore: 0,
      classification: 'OFFICIAL_STOCK_TOKEN',
      status: 'SCORED',
      rationale: ['Official Robinhood Stock Token; excluded from speculative hidden-gem ranking'],
    }
  }

  const tokenRisk = scoreToken({
    tokenAddress: launch.tokenMint,
    creatorHoldPercent: evidence.creatorHoldPercent,
    top10HolderPercent: evidence.top10HolderPercent,
    liquidityUsd: evidence.liquidityUsd ?? 0,
    liquidityRemovalPercent: 0,
    suspiciousWalletLinks: 0,
    largeSellEventCount: 0,
    observedEvents: [],
  })

  const rationale: string[] = []
  let opportunityScore = 50

  if (evidence.mintAuthority === null) {
    opportunityScore += 12
    rationale.push('mint authority revoked')
  } else {
    opportunityScore -= 18
    rationale.push('mint authority active')
  }
  if (evidence.freezeAuthority === null) {
    opportunityScore += 8
    rationale.push('freeze authority revoked')
  } else {
    opportunityScore -= 15
    rationale.push('freeze authority active')
  }
  if (evidence.top10HolderPercent <= 35) {
    opportunityScore += 15
    rationale.push(`distributed holders: top 10 ${evidence.top10HolderPercent.toFixed(1)}%`)
  } else if (evidence.top10HolderPercent >= 80) {
    opportunityScore -= 25
    rationale.push(`extreme concentration: top 10 ${evidence.top10HolderPercent.toFixed(1)}%`)
  }
  if (evidence.creatorHoldPercent <= 5) {
    opportunityScore += 8
  } else if (evidence.creatorHoldPercent >= 20) {
    opportunityScore -= 20
    rationale.push(`creator concentration ${evidence.creatorHoldPercent.toFixed(1)}%`)
  }
  if (evidence.liquidityUsd !== null && evidence.liquidityUsd >= 10_000) {
    opportunityScore += 12
    rationale.push(`liquidity $${Math.round(evidence.liquidityUsd).toLocaleString()}`)
  } else {
    opportunityScore -= 15
    rationale.push('liquidity unverified or below $10k')
  }
  opportunityScore -= Math.min(20, evidence.collectionErrors.length * 5)
  opportunityScore = Math.max(0, Math.min(100, Math.round(opportunityScore)))

  const hasMinimumLiquidity = evidence.liquidityUsd !== null && evidence.liquidityUsd >= 10_000
  const independentlySafe =
    evidence.mintAuthority === null &&
    evidence.freezeAuthority === null &&
    evidence.top10HolderPercent <= 50 &&
    evidence.creatorHoldPercent <= 20 &&
    hasMinimumLiquidity

  const classification =
    !hasMinimumLiquidity
      ? 'REJECT'
      : independentlySafe && opportunityScore >= 70 && tokenRisk.overallTokenRiskScore <= 30
        ? 'PROMISING'
        : tokenRisk.overallTokenRiskScore >= 65 || opportunityScore < 35
          ? 'REJECT'
          : 'WATCH'

  return {
    ...launch,
    evidence,
    opportunityScore,
    riskScore: tokenRisk.overallTokenRiskScore,
    classification,
    status: 'SCORED',
    rationale,
  }
}
