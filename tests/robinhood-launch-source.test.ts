import { afterEach, describe, expect, it, vi } from 'vitest'
import { RobinhoodChainLaunchSource } from '../src/lib/evm-contract-launch-source'

const originalEnabled = process.env.ROBINHOOD_CHAIN_INGESTION_ENABLED
const originalRpc = process.env.ROBINHOOD_CHAIN_RPC_URL
const originalChainId = process.env.ROBINHOOD_CHAIN_ID

afterEach(() => {
  process.env.ROBINHOOD_CHAIN_INGESTION_ENABLED = originalEnabled
  process.env.ROBINHOOD_CHAIN_RPC_URL = originalRpc
  process.env.ROBINHOOD_CHAIN_ID = originalChainId
  vi.restoreAllMocks()
})

describe('Robinhood Chain launch source', () => {
  it('discovers successful contract deployments on the verified chain', async () => {
    process.env.ROBINHOOD_CHAIN_INGESTION_ENABLED = 'true'
    process.env.ROBINHOOD_CHAIN_RPC_URL = 'https://rpc.example'
    process.env.ROBINHOOD_CHAIN_ID = '4663'

    const results: Record<string, unknown> = {
      eth_chainId: '0x1237',
      eth_blockNumber: '0x64',
      eth_getBlockByNumber: {
        number: '0x64',
        timestamp: '0x65920080',
        transactions: [{ hash: '0xtx', from: '0xCreator', to: null }],
      },
      eth_getTransactionReceipt: { status: '0x1', contractAddress: '0xToken' },
    }
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const method = JSON.parse(String(init?.body)).method
      return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: results[method] }) }
    }))

    const result = await new RobinhoodChainLaunchSource().fetchSince('99', 10)
    expect(result.cursor).toBe('100')
    expect(result.launches).toHaveLength(1)
    expect(result.launches[0]).toMatchObject({ chain: 'robinhood', tokenMint: '0xtoken', signature: '0xtx' })
  })

  it('rejects an RPC connected to the wrong chain', async () => {
    process.env.ROBINHOOD_CHAIN_INGESTION_ENABLED = 'true'
    process.env.ROBINHOOD_CHAIN_ID = '4663'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ result: '0x1' }) })))

    await expect(new RobinhoodChainLaunchSource().fetchSince(null, 10)).rejects.toThrow('chain ID mismatch')
  })
})
