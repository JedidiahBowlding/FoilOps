import { describe, it, expect } from 'vitest'
import { scoreToken } from '../src/modules/foilops/services/tokenRiskService'

const TOKEN = 'TokenMint111111111111111111111111111111111'

function baseInput() {
  return {
    tokenAddress: TOKEN,
    creatorHoldPercent: 5,
    top10HolderPercent: 30,
    liquidityUsd: 50_000,
    liquidityRemovalPercent: 0,
    suspiciousWalletLinks: 0,
    largeSellEventCount: 0,
    observedEvents: [],
  }
}

describe('scoreToken', () => {
  it('produces a low risk score for a healthy token', () => {
    const profile = scoreToken(baseInput())
    expect(profile.overallTokenRiskScore).toBeLessThan(30)
    expect(profile.tokenClassification).toBe('safer-speculative')
  })

  it('elevates risk when creator hold is dangerously high', () => {
    const profile = scoreToken({ ...baseInput(), creatorHoldPercent: 45 })
    expect(profile.overallTokenRiskScore).toBeGreaterThan(30)
  })

  it('elevates risk when top 10 holders are very concentrated', () => {
    const profile = scoreToken({ ...baseInput(), top10HolderPercent: 85 })
    expect(profile.overallTokenRiskScore).toBeGreaterThan(25)
  })

  it('elevates risk when liquidity is very low', () => {
    const profile = scoreToken({ ...baseInput(), liquidityUsd: 500 })
    expect(profile.overallTokenRiskScore).toBeGreaterThan(25)
  })

  it('returns extreme-risk when multiple factors compound', () => {
    const profile = scoreToken({
      tokenAddress: TOKEN,
      creatorHoldPercent: 50,
      top10HolderPercent: 90,
      liquidityUsd: 200,
      liquidityRemovalPercent: 80,
      suspiciousWalletLinks: 5,
      largeSellEventCount: 10,
      observedEvents: [],
    })
    expect(profile.overallTokenRiskScore).toBeGreaterThanOrEqual(75)
    expect(profile.tokenClassification).toBe('extreme-risk')
  })

  it('scoredAt is a valid ISO timestamp', () => {
    const profile = scoreToken(baseInput())
    expect(() => new Date(profile.scoredAt)).not.toThrow()
    expect(new Date(profile.scoredAt).getFullYear()).toBeGreaterThan(2020)
  })

  it('caps overall score at 100', () => {
    const profile = scoreToken({
      ...baseInput(),
      creatorHoldPercent: 100,
      top10HolderPercent: 100,
      liquidityUsd: 0,
      liquidityRemovalPercent: 100,
      suspiciousWalletLinks: 100,
      largeSellEventCount: 100,
    })
    expect(profile.overallTokenRiskScore).toBe(100)
  })
})
