import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TradeSignalEmitter } from '../src/lib/trade-signal-emitter'

describe('trade signal emitter integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.TRADE_SIGNAL_ENDPOINT = 'http://localhost:8787/signals'
    process.env.TRADE_SIGNAL_DRY_RUN = 'true'
    process.env.TRADE_SIGNAL_REQUIRE_AUTH = 'false'
    process.env.TRADE_SIGNAL_AUTH_SECRET = ''
  })

  it('emits copy trade with normalized direction metadata and action hint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' }),
    })

    ;(globalThis as any).fetch = fetchMock

    const emitter = new TradeSignalEmitter()

    await emitter.emitCopyTradeSignal({
      tokenMint: 'mint-1',
      riskScore: 42,
      direction: 'short',
      trackedWallet: 'wallet-A',
      copiedWallet: 'wallet-B',
      copiedTxSignature: 'sig-1',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body)

    expect(payload.signalType).toBe('COPY_TRADE')
    expect(payload.actionHint).toBe('SELL')
    expect(payload.metadata.direction).toBe('short')
    expect(payload.metadata.copiedWallet).toBe('wallet-B')
  })

  it('emits auto action signal with explicit signal type', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' }),
    })

    ;(globalThis as any).fetch = fetchMock

    const emitter = new TradeSignalEmitter()

    await emitter.emitAutoActionSignal({
      signalType: 'AUTO_AVOID',
      actionHint: 'AUTO_AVOID',
      tokenMint: 'mint-2',
      trackedWallet: 'wallet-C',
      riskScore: 90,
      metadata: { trigger: 'high_risk' },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body)

    expect(payload.signalType).toBe('AUTO_AVOID')
    expect(payload.actionHint).toBe('AUTO_AVOID')
    expect(payload.metadata.trigger).toBe('high_risk')
  })

  it('emits smart money trade with score metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' }),
    })

    ;(globalThis as any).fetch = fetchMock

    const emitter = new TradeSignalEmitter()

    await emitter.emitSmartMoneyTradeSignal({
      tokenMint: 'mint-3',
      riskScore: 78,
      direction: 'buy',
      smartMoneyScore: 82,
      smartMoneyConfidence: 'HIGH',
      trackedWallet: 'wallet-D',
      copiedWallet: 'wallet-E',
      copiedTxSignature: 'sig-2',
      rationale: ['wallet winrate: 72.0%', 'platform: pumpfun'],
      metadata: { source: 'test' },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body)

    expect(payload.signalType).toBe('SMART_MONEY_TRADE')
    expect(payload.actionHint).toBe('BUY')
    expect(payload.metadata.smartMoneyScore).toBe(82)
    expect(payload.metadata.smartMoneyConfidence).toBe('HIGH')
    expect(payload.metadata.copiedWallet).toBe('wallet-E')
  })
})
