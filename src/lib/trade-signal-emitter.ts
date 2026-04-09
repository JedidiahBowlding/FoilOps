import { createHmac, randomUUID } from 'crypto'
import { ScamRisk } from './scam-risk'
import { isTradeSignalV1, TradeSignalType, TradeSignalV1 } from '../types/trade-signal'

export class TradeSignalEmitter {
  private endpoint: string
  private timeoutMs: number
  private authSecret?: string
  private requireAuth: boolean

  constructor() {
    this.endpoint = process.env.TRADE_SIGNAL_ENDPOINT || 'http://127.0.0.1:8787/signals'
    this.timeoutMs = Number(process.env.TRADE_SIGNAL_TIMEOUT_MS || 4000)
    this.authSecret = process.env.TRADE_SIGNAL_AUTH_SECRET
    this.requireAuth = process.env.TRADE_SIGNAL_REQUIRE_AUTH === 'true'
  }

  createSignal(input: {
    signalType: TradeSignalType
    riskScore: number
    trackedWallet?: string
    developerWallet?: string
    tokenMint?: string
    traceAlerts?: string[]
    metadata?: Record<string, unknown>
  }): TradeSignalV1 {
    const normalizedRisk = ScamRisk.clampRisk(input.riskScore)

    return {
      schemaVersion: '1.0',
      signalId: randomUUID(),
      emittedAt: new Date().toISOString(),
      sourceSystem: 'handi-cat-intelligence',
      signalType: input.signalType,
      dryRun: true,
      riskScore: normalizedRisk,
      riskLevel: ScamRisk.describeRisk(normalizedRisk),
      trackedWallet: input.trackedWallet,
      developerWallet: input.developerWallet,
      tokenMint: input.tokenMint,
      traceAlerts: input.traceAlerts || [],
      actionHint: 'WATCH_ONLY',
      metadata: input.metadata,
    }
  }

  async emit(signal: TradeSignalV1): Promise<void> {
    if (!isTradeSignalV1(signal)) {
      console.log('TRADE_SIGNAL_SKIP_INVALID_PAYLOAD')
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const payload = JSON.stringify(signal)
      const timestamp = String(Math.floor(Date.now() / 1000))
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Signal-Source': 'handi-cat-intelligence',
        'X-Idempotency-Key': signal.signalId,
      }

      if (this.authSecret) {
        const signature = createHmac('sha256', this.authSecret).update(`${timestamp}.${payload}`).digest('hex')
        headers['X-Signal-Timestamp'] = timestamp
        headers['X-Signal-Signature'] = signature
      } else if (this.requireAuth) {
        console.log('TRADE_SIGNAL_EMIT_BLOCKED missing TRADE_SIGNAL_AUTH_SECRET while auth is required')
        return
      }

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: payload,
        signal: controller.signal,
      })

      if (!response.ok) {
        console.log(`TRADE_SIGNAL_EMIT_FAILED status=${response.status}`)
        return
      }

      console.log(`TRADE_SIGNAL_EMITTED id=${signal.signalId} type=${signal.signalType} dryRun=true`)
    } catch (error) {
      console.log('TRADE_SIGNAL_EMIT_ERROR', error)
    } finally {
      clearTimeout(timeout)
    }
  }
}

export const tradeSignalEmitter = new TradeSignalEmitter()
