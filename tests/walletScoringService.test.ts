import { describe, it, expect } from 'vitest'
import {
  calculateEarlyEntryScore,
  calculateMomentumParticipationScore,
  calculateRepeatSuccessScore,
  calculateExitTimingScore,
  calculateLaunchParticipationScore,
  calculateRugRiskScore,
  calculateDumpSeverityScore,
  calculateClusterSuspicionScore,
  calculateSuspiciousFundingScore,
  scoreWallet,
} from '../src/modules/foilops/services/walletScoringService'
import { LaunchParticipationRecord } from '../src/modules/foilops/types/wallet'
import { ClusterAnalysisResult } from '../src/modules/foilops/types/cluster'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WALLET = 'TestWallet111111111111111111111111111111111'

function makeLaunch(overrides: Partial<LaunchParticipationRecord> = {}): LaunchParticipationRecord {
  return {
    tokenAddress: 'Token1111111111111111111111111111111111111',
    entryTimestamp: Date.now(),
    entryDelaySeconds: 45,
    platform: 'pumpfun',
    ...overrides,
  }
}

function makeClusterResult(overrides: Partial<ClusterAnalysisResult> = {}): ClusterAnalysisResult {
  return {
    wallet: WALLET,
    links: [],
    reachableWallets: [],
    linkTypeDiversity: 0,
    clusterSuspicionScore: 0,
    maxLinkConfidence: 0,
    computedAt: new Date().toISOString(),
    ...overrides,
  }
}

const noFundingFlags = {
  fromKnownBadActor: false,
  fromMixer: false,
  fromExchangeWithdrawal: false,
  fromNewWallet: false,
}

// ─── Early entry score ─────────────────────────────────────────────────────────

describe('calculateEarlyEntryScore', () => {
  it('returns 0 for empty launches', () => {
    expect(calculateEarlyEntryScore([])).toBe(0)
  })

  it('returns ~100 for very early entries (<= 60s)', () => {
    const score = calculateEarlyEntryScore([makeLaunch({ entryDelaySeconds: 30 })])
    expect(score).toBe(100)
  })

  it('returns partial score for medium-early entry (61–300s)', () => {
    const score = calculateEarlyEntryScore([makeLaunch({ entryDelaySeconds: 180 })])
    expect(score).toBeGreaterThan(50)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('returns 0 for very late entries (> 900s)', () => {
    const score = calculateEarlyEntryScore([makeLaunch({ entryDelaySeconds: 2000 })])
    expect(score).toBe(0)
  })

  it('averages across multiple launches', () => {
    const mixed = [
      makeLaunch({ entryDelaySeconds: 30 }), // 100
      makeLaunch({ entryDelaySeconds: 2000 }), // 0
    ]
    const score = calculateEarlyEntryScore(mixed)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(100)
  })
})

// ─── Momentum participation score ─────────────────────────────────────────────

describe('calculateMomentumParticipationScore', () => {
  it('returns 0 for no launches', () => {
    expect(calculateMomentumParticipationScore([])).toBe(0)
  })

  it('returns alwaysPresent score when all entries are early', () => {
    const launches = [makeLaunch({ entryDelaySeconds: 30 }), makeLaunch({ entryDelaySeconds: 50 })]
    const score = calculateMomentumParticipationScore(launches)
    expect(score).toBe(100)
  })

  it('returns rarelyPresent score when no entries are early', () => {
    const launches = [makeLaunch({ entryDelaySeconds: 5000 }), makeLaunch({ entryDelaySeconds: 6000 })]
    const score = calculateMomentumParticipationScore(launches)
    expect(score).toBeLessThan(50)
  })
})

// ─── Repeat success score ──────────────────────────────────────────────────────

describe('calculateRepeatSuccessScore', () => {
  it('returns 0 for no launches', () => {
    expect(calculateRepeatSuccessScore([])).toBe(0)
  })

  it('returns high score when most exits are profitable', () => {
    const launches = [makeLaunch({ gainLossPct: 50 }), makeLaunch({ gainLossPct: 20 }), makeLaunch({ gainLossPct: 80 })]
    const score = calculateRepeatSuccessScore(launches)
    expect(score).toBeGreaterThan(70)
  })

  it('returns low score when most exits are losses', () => {
    const launches = [makeLaunch({ gainLossPct: -30 }), makeLaunch({ gainLossPct: -10 })]
    const score = calculateRepeatSuccessScore(launches)
    expect(score).toBeLessThan(30)
  })
})

// ─── Rug risk score ────────────────────────────────────────────────────────────

describe('calculateRugRiskScore', () => {
  it('returns 0 for a clean wallet', () => {
    const score = calculateRugRiskScore({ isFlagged: false, rugEventCount: 0, clusterResult: null })
    expect(score).toBe(0)
  })

  it('adds flagged contribution', () => {
    const score = calculateRugRiskScore({ isFlagged: true, rugEventCount: 0, clusterResult: null })
    expect(score).toBeGreaterThan(0)
  })

  it('scales with rug event count', () => {
    const low = calculateRugRiskScore({ isFlagged: false, rugEventCount: 1, clusterResult: null })
    const high = calculateRugRiskScore({ isFlagged: false, rugEventCount: 5, clusterResult: null })
    expect(high).toBeGreaterThan(low)
  })

  it('caps at 100', () => {
    const score = calculateRugRiskScore({
      isFlagged: true,
      rugEventCount: 100,
      clusterResult: makeClusterResult({ clusterSuspicionScore: 80 }),
    })
    expect(score).toBe(100)
  })
})

// ─── Suspicious funding score ─────────────────────────────────────────────────

describe('calculateSuspiciousFundingScore', () => {
  it('returns 0 for clean funding', () => {
    expect(calculateSuspiciousFundingScore(noFundingFlags)).toBe(0)
  })

  it('returns high score for known-bad-actor funding', () => {
    const score = calculateSuspiciousFundingScore({ ...noFundingFlags, fromKnownBadActor: true })
    expect(score).toBeGreaterThan(40)
  })

  it('accumulates multiple flags', () => {
    const single = calculateSuspiciousFundingScore({ ...noFundingFlags, fromMixer: true })
    const multi = calculateSuspiciousFundingScore({ ...noFundingFlags, fromMixer: true, fromNewWallet: true })
    expect(multi).toBeGreaterThan(single)
  })
})

// ─── Dump severity score ──────────────────────────────────────────────────────

describe('calculateDumpSeverityScore', () => {
  it('returns 0 for no dump events', () => {
    expect(calculateDumpSeverityScore({ rapidDumpEventCount: 0, largeSellEventCount: 0 })).toBe(0)
  })

  it('returns elevated score for rapid dumps', () => {
    const score = calculateDumpSeverityScore({ rapidDumpEventCount: 1, largeSellEventCount: 0 })
    expect(score).toBeGreaterThan(0)
  })

  it('caps at 100', () => {
    const score = calculateDumpSeverityScore({ rapidDumpEventCount: 100, largeSellEventCount: 100 })
    expect(score).toBe(100)
  })
})

// ─── scoreWallet integration ───────────────────────────────────────────────────

describe('scoreWallet', () => {
  it('classifies a clean ultra-early wallet as early-entrant', () => {
    const launches = Array.from({ length: 5 }, (_, i) =>
      makeLaunch({
        entryDelaySeconds: 20 + i * 5,
        gainLossPct: 30,
        exitDelaySeconds: 120,
      }),
    )
    const profile = scoreWallet({
      wallet: WALLET,
      launches,
      isFlagged: false,
      rugEventCount: 0,
      fundingFlags: noFundingFlags,
      clusterResult: makeClusterResult(),
      rapidDumpEventCount: 0,
      largeSellEventCount: 0,
    })
    expect(profile.overallOpportunityScore).toBeGreaterThan(60)
    expect(profile.overallRiskScore).toBeLessThan(30)
    expect(profile.classification).toBe('early-entrant')
    expect(profile.tags).toContain('ultra-early-entrant')
  })

  it('classifies a flagged serial-rug wallet as high-risk', () => {
    const profile = scoreWallet({
      wallet: WALLET,
      launches: [],
      isFlagged: true,
      rugEventCount: 5,
      fundingFlags: { fromKnownBadActor: true, fromMixer: false, fromExchangeWithdrawal: false, fromNewWallet: false },
      clusterResult: makeClusterResult({ clusterSuspicionScore: 75 }),
      rapidDumpEventCount: 3,
      largeSellEventCount: 2,
    })
    expect(profile.overallRiskScore).toBeGreaterThan(60)
    expect(profile.classification).toBe('high-risk')
    expect(profile.tags).toContain('rug-associated')
  })

  it('scoredAt is a valid ISO string', () => {
    const profile = scoreWallet({
      wallet: WALLET,
      launches: [],
      isFlagged: false,
      rugEventCount: 0,
      fundingFlags: noFundingFlags,
      clusterResult: null,
      rapidDumpEventCount: 0,
      largeSellEventCount: 0,
    })
    expect(() => new Date(profile.scoredAt)).not.toThrow()
    expect(new Date(profile.scoredAt).getFullYear()).toBeGreaterThan(2020)
  })
})
