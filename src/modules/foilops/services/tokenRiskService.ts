// ─── Token Risk Service ────────────────────────────────────────────────────────
// Scores a token launch for risk based on on-chain signals.

import { TokenRiskProfile, SuspiciousTokenEvent } from '../types/token'
import { tokenRules } from '../config/foilOpsConfig'
import { additiveCap, clamp100 } from '../utils/scoringMath'
import { classifyToken } from './classificationService'

// ─── Input type ────────────────────────────────────────────────────────────────

export type TokenScoringInput = {
  tokenAddress: string
  creatorHoldPercent: number
  top10HolderPercent: number
  liquidityUsd: number
  liquidityRemovalPercent: number
  suspiciousWalletLinks: number
  // Number of large sell events in the early observation window
  largeSellEventCount: number
  // Events already known (e.g. from a prior investigation pass)
  observedEvents: SuspiciousTokenEvent[]
}

// ─── Sub-score helpers ─────────────────────────────────────────────────────────

function creatorHoldScore(pct: number): number {
  const r = tokenRules.creatorHold
  if (pct >= r.severeThreshold) return r.weights.severe
  if (pct >= r.dangerousThreshold) return r.weights.dangerous
  return 0
}

function top10HolderScore(pct: number): number {
  const r = tokenRules.top10Holders
  if (pct >= r.severeThreshold) return r.weights.severe
  if (pct >= r.dangerousThreshold) return r.weights.dangerous
  return 0
}

function liquidityScore(liquidityUsd: number): number {
  const r = tokenRules.liquidity
  if (liquidityUsd <= r.severeThreshold) return r.weights.severe
  if (liquidityUsd <= r.dangerousThreshold) return r.weights.dangerous
  return 0
}

function liquidityRemovalScore(pct: number): number {
  const r = tokenRules.liquidityRemoval
  if (pct >= r.severeThreshold) return r.weights.severe
  if (pct >= r.dangerousThreshold) return r.weights.dangerous
  return 0
}

function dumpPressureScore(largeSellCount: number): number {
  const r = tokenRules.dumpPressure
  if (largeSellCount >= r.largeSellCountThreshold * 2) return r.weights.severe
  if (largeSellCount >= r.largeSellCountThreshold) return r.weights.moderate
  return 0
}

function suspiciousWalletScore(count: number): number {
  const r = tokenRules.suspiciousWalletLinks
  return Math.min(r.weights.maxContribution, count * r.weights.perWallet)
}

// ─── Wallet concentration proxy ────────────────────────────────────────────────
// We use top10HolderPercent as a proxy for concentration (0–100).
function walletConcentrationScore(top10Pct: number): number {
  return clamp100(top10Pct)
}

// ─── Main scorer ──────────────────────────────────────────────────────────────

export function scoreToken(input: TokenScoringInput): TokenRiskProfile {
  const rawDumpPressure = dumpPressureScore(input.largeSellEventCount)
  const rawCreator = creatorHoldScore(input.creatorHoldPercent)
  const rawTop10 = top10HolderScore(input.top10HolderPercent)
  const rawLiquidity = liquidityScore(input.liquidityUsd)
  const rawRemoval = liquidityRemovalScore(input.liquidityRemovalPercent)
  const rawSuspWallets = suspiciousWalletScore(input.suspiciousWalletLinks)

  const overallTokenRiskScore = additiveCap([
    rawCreator,
    rawTop10,
    rawLiquidity,
    rawRemoval,
    rawDumpPressure,
    rawSuspWallets,
  ])

  const tokenClassification = classifyToken(overallTokenRiskScore)

  return {
    tokenAddress: input.tokenAddress,
    creatorHoldPercent: input.creatorHoldPercent,
    top10HolderPercent: input.top10HolderPercent,
    liquidityUsd: input.liquidityUsd,
    liquidityRemovalPercent: input.liquidityRemovalPercent,
    suspiciousWalletLinks: input.suspiciousWalletLinks,
    walletConcentrationScore: walletConcentrationScore(input.top10HolderPercent),
    dumpPressureScore: clamp100(rawDumpPressure),
    overallTokenRiskScore,
    tokenClassification,
    scoredAt: new Date().toISOString(),
  }
}
