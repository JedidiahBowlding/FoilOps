import { describe, expect, it } from 'vitest'
import { resolveSmartMoneyTradeRiskScore } from '../src/lib/smart-money-risk'

describe('smart-money trade risk', () => {
  it('uses the independently configured risk instead of the opportunity score', () => {
    expect(resolveSmartMoneyTradeRiskScore('35')).toBe(35)
  })

  it('uses a safe fallback for invalid configuration', () => {
    expect(resolveSmartMoneyTradeRiskScore('not-a-number')).toBe(35)
  })

  it('clamps configured risk to the signal range', () => {
    expect(resolveSmartMoneyTradeRiskScore('-5')).toBe(0)
    expect(resolveSmartMoneyTradeRiskScore('120')).toBe(100)
  })
})
