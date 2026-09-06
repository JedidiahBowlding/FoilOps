import { describe, expect, it } from 'vitest'
import { scoreLaunchCandidate } from '../src/lib/launch-candidate-scorer'
import type { DetectedLaunch, LaunchEvidence } from '../src/lib/new-launch-types'

const launch: DetectedLaunch = {
  chain: 'solana',
  tokenMint: 'mint',
  signature: 'signature',
  creatorWallet: 'creator',
  source: 'pump-fun',
  slot: 1,
  detectedAt: new Date('2026-01-01T00:00:00Z'),
}

function evidence(overrides: Partial<LaunchEvidence> = {}): LaunchEvidence {
  return {
    chain: 'solana',
    tokenMint: 'mint',
    creatorWallet: 'creator',
    mintAuthority: null,
    freezeAuthority: null,
    decimals: 6,
    supplyRaw: '1000000000',
    top10HolderPercent: 20,
    creatorHoldPercent: 2,
    creatorSolBalance: 5,
    holderAccountsSampled: 20,
    liquidityUsd: 25_000,
    marketCapUsd: 100_000,
    name: 'Candidate',
    symbol: 'CAND',
    evidenceSources: ['solana-rpc'],
    collectionErrors: [],
    collectedAt: '2026-01-01T00:01:00Z',
    assetCategory: 'SPECULATIVE_TOKEN',
    officialStockToken: null,
    holderHistoryComplete: true,
    liquidityPools: [],
    ...overrides,
  }
}

describe('launch candidate scorer', () => {
  it('promotes only candidates with verified safety and liquidity evidence', () => {
    const result = scoreLaunchCandidate(launch, evidence())
    expect(result.classification).toBe('PROMISING')
    expect(result.opportunityScore).toBeGreaterThanOrEqual(70)
    expect(result.riskScore).toBeLessThanOrEqual(30)
  })

  it('rejects a candidate with unknown liquidity', () => {
    const result = scoreLaunchCandidate(launch, evidence({ liquidityUsd: null }))
    expect(result.classification).toBe('REJECT')
    expect(result.rationale).toContain('liquidity unverified or below $10k')
  })

  it('rejects a candidate below $10k verified liquidity', () => {
    const result = scoreLaunchCandidate(launch, evidence({ liquidityUsd: 9_999 }))
    expect(result.classification).toBe('REJECT')
  })

  it('rejects concentrated launches with active authorities', () => {
    const result = scoreLaunchCandidate(
      launch,
      evidence({ mintAuthority: 'mint-authority', freezeAuthority: 'freeze-authority', top10HolderPercent: 95 }),
    )
    expect(result.classification).toBe('REJECT')
  })

  it('separates official Robinhood stock tokens from speculative candidates', () => {
    const result = scoreLaunchCandidate(
      { ...launch, chain: 'robinhood', tokenMint: '0xstock' },
      evidence({
        chain: 'robinhood',
        tokenMint: '0xstock',
        assetCategory: 'OFFICIAL_STOCK_TOKEN',
        officialStockToken: {
          id: 'asset-id',
          symbol: 'AAPL',
          name: 'Apple • Robinhood Token',
          status: 'ASSET_STATUS_ACTIVE',
          currentMultiplier: '1.000000000000000000',
          bidUsd: 200,
          askUsd: 201,
          tokenBidUsd: 200,
          tokenAskUsd: 201,
          isTradingHalt: false,
          oracleFeedAddress: '0xfeed',
          oraclePriceUsd: 200.5,
          oracleUpdatedAt: '2026-01-01T00:00:00Z',
          oracleHeartbeatSeconds: 86400,
          oracleStale: false,
          restOracleDivergencePct: 0,
          oraclePaused: false,
          onchainMultiplier: '1',
          multiplierMatchesRest: true,
        },
      }),
    )
    expect(result.classification).toBe('OFFICIAL_STOCK_TOKEN')
    expect(result.opportunityScore).toBe(0)
  })
})
