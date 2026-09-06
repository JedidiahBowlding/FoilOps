import { afterEach, describe, expect, it, vi } from 'vitest'
import { EvmLaunchEvidenceCollector } from '../src/lib/evm-launch-evidence-collector'
import type { DetectedLaunch } from '../src/lib/new-launch-types'

afterEach(() => vi.restoreAllMocks())

const word = (value: bigint) => value.toString(16).padStart(64, '0')
const addressTopic = (address: string) => `0x${address.slice(2).padStart(64, '0')}`

describe('EVM launch evidence collector', () => {
  it('reconstructs holder concentration and identifies contract-held pool candidates', async () => {
    const creator = '0x1111111111111111111111111111111111111111'
    const buyer = '0x2222222222222222222222222222222222222222'
    const pool = '0x3333333333333333333333333333333333333333'
    const zero = '0x0000000000000000000000000000000000000000'
    const launch: DetectedLaunch = {
      chain: 'robinhood', tokenMint: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', signature: '0xtx',
      creatorWallet: creator, source: 'robinhood-chain', slot: 100, detectedAt: new Date(),
    }
    const encodeString = (value: string) => `0x${word(BigInt(32))}${word(BigInt(value.length))}${Buffer.from(value).toString('hex').padEnd(64, '0')}`
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      let result: unknown = '0x'
      if (body.method === 'eth_call') {
        result = ({
          '0x06fdde03': encodeString('Token'), '0x95d89b41': encodeString('TOK'),
          '0x313ce567': `0x${word(BigInt(18))}`, '0x18160ddd': `0x${word(BigInt(1000))}`,
          '0x8da5cb5b': `0x${word(BigInt(0))}`,
        } as Record<string, string>)[body.params[0].data]
      } else if (body.method === 'eth_blockNumber') result = '0x78'
      else if (body.method === 'eth_getLogs') result = [
        { topics: ['0xddf', addressTopic(zero), addressTopic(creator)], data: `0x${word(BigInt(1000))}` },
        { topics: ['0xddf', addressTopic(creator), addressTopic(buyer)], data: `0x${word(BigInt(200))}` },
        { topics: ['0xddf', addressTopic(creator), addressTopic(pool)], data: `0x${word(BigInt(300))}` },
      ]
      else if (body.method === 'eth_getCode') result = body.params[0] === pool ? '0x6000' : '0x'
      return { ok: true, json: async () => ({ result }) }
    }))
    const stockTokens = { findByContract: vi.fn().mockResolvedValue(null) }
    const evidence = await new EvmLaunchEvidenceCollector(stockTokens as any).collect(launch)

    expect(evidence.holderAccountsSampled).toBe(3)
    expect(evidence.creatorHoldPercent).toBe(50)
    expect(evidence.top10HolderPercent).toBe(100)
    expect(evidence.holderHistoryComplete).toBe(true)
    expect(evidence.liquidityPools).toEqual([
      { address: pool, verifiedPair: false, tokenBalanceRaw: '300', tokenBalancePercent: 30, verifiedLiquidityUsd: null },
    ])
  })
})
