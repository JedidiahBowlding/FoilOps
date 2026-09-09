import { afterEach, describe, expect, it, vi } from 'vitest'
import { TradingAgentsClient } from '../src/lib/trading-agents-client'

const original = { ...process.env }
afterEach(() => { process.env = { ...original }; vi.restoreAllMocks() })

describe('TradingAgentsClient', () => {
  it('fails closed when disabled', async () => {
    process.env.TRADINGAGENTS_ENABLED = 'false'
    await expect(new TradingAgentsClient().analyzeTicker({ ticker: 'NVDA' })).rejects.toThrow('disabled')
  })

  it('authenticates only to the configured bridge', async () => {
    process.env.TRADINGAGENTS_ENABLED = 'true'
    process.env.TRADINGAGENTS_BRIDGE_URL = 'http://127.0.0.1:8790'
    process.env.TRADINGAGENTS_BRIDGE_TOKEN = 'test-token'
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"decision":"Hold"}', { status: 200 }))
    await new TradingAgentsClient().analyzeTicker({ ticker: 'NVDA' })
    expect(mock).toHaveBeenCalledWith('http://127.0.0.1:8790/v1/analyze/ticker', expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer test-token' }) }))
  })
})
