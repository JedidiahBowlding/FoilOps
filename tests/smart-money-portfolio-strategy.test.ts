import { beforeEach, describe, expect, it } from 'vitest'
import { SmartMoneyPortfolioStrategy } from '../src/lib/smart-money-portfolio-strategy'

describe('smart-money portfolio strategy', () => {
  let strategy: SmartMoneyPortfolioStrategy

  beforeEach(() => {
    strategy = new SmartMoneyPortfolioStrategy()
  })

  it('waits for confirmation before promoting a buy', () => {
    const first = strategy.evaluate({
      tokenMint: 'mint-1',
      walletAddress: 'wallet-1',
      direction: 'buy',
      score: 80,
      confidence: 'HIGH',
      txSignature: 'sig-1',
      rationale: ['test'],
    })

    expect(first.action).toBe('WATCH')
    expect(first.confirmed).toBe(false)

    const second = strategy.evaluate({
      tokenMint: 'mint-1',
      walletAddress: 'wallet-2',
      direction: 'buy',
      score: 82,
      confidence: 'HIGH',
      txSignature: 'sig-2',
      rationale: ['test'],
    })

    expect(second.action).toBe('BUY')
    expect(second.confirmed).toBe(true)
    expect(second.confirmationCount).toBeGreaterThanOrEqual(2)

    const summary = strategy.getSummary()
    expect(summary.activePositions).toBe(1)
    expect(summary.confirmedBuys).toBe(1)
    expect(summary.watchedTokens).toBe(1)
  })

  it('requires an open position before selling', () => {
    const sellBeforeOpen = strategy.evaluate({
      tokenMint: 'mint-2',
      walletAddress: 'wallet-3',
      direction: 'sell',
      score: 90,
      confidence: 'HIGH',
      txSignature: 'sig-3',
      rationale: ['test'],
    })

    expect(sellBeforeOpen.action).toBe('WATCH')
    expect(sellBeforeOpen.confirmed).toBe(false)

    strategy.evaluate({
      tokenMint: 'mint-2',
      walletAddress: 'wallet-4',
      direction: 'buy',
      score: 80,
      confidence: 'HIGH',
      txSignature: 'sig-4',
      rationale: ['test'],
    })
    strategy.evaluate({
      tokenMint: 'mint-2',
      walletAddress: 'wallet-5',
      direction: 'buy',
      score: 81,
      confidence: 'HIGH',
      txSignature: 'sig-5',
      rationale: ['test'],
    })

    const sellAfterOpen = strategy.evaluate({
      tokenMint: 'mint-2',
      walletAddress: 'wallet-6',
      direction: 'sell',
      score: 72,
      confidence: 'HIGH',
      txSignature: 'sig-6',
      rationale: ['exit'],
    })

    expect(sellAfterOpen.action).toBe('SELL')
    expect(sellAfterOpen.confirmed).toBe(true)

    const summary = strategy.getSummary()
    expect(summary.activePositions).toBe(0)
    expect(summary.confirmedSells).toBe(1)
  })
})
