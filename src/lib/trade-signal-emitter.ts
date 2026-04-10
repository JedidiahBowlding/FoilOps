import { createHmac, randomUUID } from 'crypto'
import { ScamRisk } from './scam-risk'
import { isTradeSignalV1, TradeActionHint, TradeSignalType, TradeSignalV1 } from '../types/trade-signal'

export class TradeSignalEmitter {
  private endpoint: string
  private timeoutMs: number
  private authSecret?: string
  private requireAuth: boolean
  private signalIdempotencyMap: Map<string, number> = new Map() // For deduplication tracking

  constructor() {
    this.endpoint = process.env.TRADE_SIGNAL_ENDPOINT || 'http://127.0.0.1:8787/signals'
    this.timeoutMs = Number(process.env.TRADE_SIGNAL_TIMEOUT_MS || 4000)
    this.authSecret = process.env.TRADE_SIGNAL_AUTH_SECRET
    this.requireAuth = process.env.TRADE_SIGNAL_REQUIRE_AUTH === 'true'

    // Phase 3: Start cleanup of old idempotency records every 60 seconds
    this.startIdempotencyCleanup()
  }

  /**
   * Phase 3: Idempotency tracking - cleanup old records
   */
  private startIdempotencyCleanup(): void {
    const cleanupTimer = setInterval(() => {
      const now = Date.now()
      const dedup_window = Number(process.env.TRADE_SIGNAL_DEDUP_WINDOW_SECONDS || 300) * 1000

      for (const [key, timestamp] of this.signalIdempotencyMap.entries()) {
        if (now - timestamp > dedup_window) {
          this.signalIdempotencyMap.delete(key)
        }
      }
    }, 60000) // Cleanup every minute

    if (typeof (cleanupTimer as unknown as { unref?: () => void }).unref === 'function') {
      ;(cleanupTimer as unknown as { unref: () => void }).unref()
    }
  }

  createSignal(input: {
    signalType: TradeSignalType
    riskScore: number
    actionHint?: TradeActionHint
    trackedWallet?: string
    developerWallet?: string
    tokenMint?: string
    traceAlerts?: string[]
    metadata?: Record<string, unknown>
  }): TradeSignalV1 {
    const normalizedRisk = ScamRisk.clampRisk(input.riskScore)
    const isLiveMode = process.env.TRADE_SIGNAL_DRY_RUN !== 'true'

    return {
      schemaVersion: '1.0',
      signalId: randomUUID(),
      emittedAt: new Date().toISOString(),
      sourceSystem: 'foilops-intelligence',
      signalType: input.signalType,
      dryRun: !isLiveMode,
      riskScore: normalizedRisk,
      riskLevel: ScamRisk.describeRisk(normalizedRisk),
      trackedWallet: input.trackedWallet,
      developerWallet: input.developerWallet,
      tokenMint: input.tokenMint,
      traceAlerts: input.traceAlerts || [],
      actionHint: input.actionHint || 'WATCH_ONLY',
      metadata: input.metadata,
    }
  }

  /**
   * Phase 2 & 3: Check if signal would be deduplicated
   */
  private shouldDeduplicate(signal: TradeSignalV1): boolean {
    // Use token mint as deduplication key if available, otherwise signal ID
    const dedupKey = signal.tokenMint || signal.signalId

    if (this.signalIdempotencyMap.has(dedupKey)) {
      return true
    }

    this.signalIdempotencyMap.set(dedupKey, Date.now())
    return false
  }

  /**
   * Phase 2, 3, 4: Main signal emission with full infrastructure
   */
  async emit(signal: TradeSignalV1): Promise<void> {
    if (!isTradeSignalV1(signal)) {
      console.log('TRADE_SIGNAL_SKIP_INVALID_PAYLOAD')
      return
    }

    // Phase 3: Check for deduplication
    if (this.shouldDeduplicate(signal)) {
      console.log(`TRADE_SIGNAL_DEDUPLICATED id=${signal.signalId}`)
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const payload = JSON.stringify(signal)
      const timestamp = String(Math.floor(Date.now() / 1000))
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Signal-Source': 'foilops-intelligence',
        'X-Idempotency-Key': signal.signalId,
      }

      // Phase 3: Authentication and signature generation
      if (this.authSecret) {
        const signature = createHmac('sha256', this.authSecret).update(`${timestamp}.${payload}`).digest('hex')
        headers['X-Signal-Timestamp'] = timestamp
        headers['X-Signal-Signature'] = signature
      } else if (this.requireAuth) {
        console.log('TRADE_SIGNAL_EMIT_BLOCKED missing TRADE_SIGNAL_AUTH_SECRET while auth is required')
        return
      }

      // Phase 4: Live vs dry-run mode selection
      const mode = signal.dryRun ? 'dry-run' : 'live'

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: payload,
        signal: controller.signal,
      })

      if (!response.ok) {
        console.log(`TRADE_SIGNAL_EMIT_FAILED status=${response.status} id=${signal.signalId}`)
        return
      }

      const responseData = await response.json()
      console.log(
        `TRADE_SIGNAL_EMITTED id=${signal.signalId} type=${signal.signalType} mode=${mode} status=${responseData.status || 'ok'}`,
      )
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log(`TRADE_SIGNAL_EMIT_TIMEOUT id=${signal.signalId}`)
      } else {
        console.log('TRADE_SIGNAL_EMIT_ERROR', error)
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Phase 2: Emit signal for token investigation (low risk, monitor)
   */
  async emitTokenInvestigationSignal(input: {
    tokenMint: string
    riskScore: number
    investigationReason: string
    trackedWallets?: string[]
    metadata?: Record<string, unknown>
  }): Promise<void> {
    const signal = this.createSignal({
      signalType: 'TOKEN_INVESTIGATION',
      riskScore: input.riskScore,
      tokenMint: input.tokenMint,
      trackedWallet: input.trackedWallets?.[0],
      metadata: {
        ...input.metadata,
        investigationReason: input.investigationReason,
      },
    })

    await this.emit(signal)
  }

  /**
   * Phase 2: Emit signal for suspicious launch (higher risk, defensive action)
   */
  async emitSuspiciousLaunchSignal(input: {
    tokenMint: string
    developerWallet: string
    riskScore: number
    suspiciousIndicators: string[]
    metadata?: Record<string, unknown>
  }): Promise<void> {
    const signal = this.createSignal({
      signalType: 'SUSPICIOUS_TOKEN_LAUNCH',
      riskScore: input.riskScore,
      tokenMint: input.tokenMint,
      developerWallet: input.developerWallet,
      traceAlerts: input.suspiciousIndicators,
      metadata: input.metadata,
    })

    await this.emit(signal)
  }

  async emitCopyTradeSignal(input: {
    tokenMint: string
    riskScore: number
    direction: 'buy' | 'sell' | 'long' | 'short'
    trackedWallet?: string
    developerWallet?: string
    copiedWallet?: string
    copiedTxSignature?: string
    metadata?: Record<string, unknown>
  }): Promise<void> {
    const normalizedDirection = input.direction.toLowerCase()
    const actionHint: TradeActionHint =
      normalizedDirection === 'sell' || normalizedDirection === 'short' ? 'SELL' : 'BUY'

    const signal = this.createSignal({
      signalType: 'COPY_TRADE',
      riskScore: input.riskScore,
      actionHint,
      tokenMint: input.tokenMint,
      trackedWallet: input.trackedWallet,
      developerWallet: input.developerWallet,
      metadata: {
        ...input.metadata,
        direction: normalizedDirection,
        copiedWallet: input.copiedWallet,
        copiedTxSignature: input.copiedTxSignature,
      },
    })

    await this.emit(signal)
  }

  async emitAutoActionSignal(input: {
    signalType: 'AUTO_SELL' | 'AUTO_AVOID' | 'AUTO_WATCH'
    actionHint: 'AUTO_SELL' | 'AUTO_AVOID' | 'AUTO_WATCH'
    tokenMint?: string
    trackedWallet?: string
    developerWallet?: string
    riskScore: number
    traceAlerts?: string[]
    metadata?: Record<string, unknown>
  }): Promise<void> {
    const signal = this.createSignal({
      signalType: input.signalType,
      riskScore: input.riskScore,
      actionHint: input.actionHint,
      tokenMint: input.tokenMint,
      trackedWallet: input.trackedWallet,
      developerWallet: input.developerWallet,
      traceAlerts: input.traceAlerts,
      metadata: input.metadata,
    })

    await this.emit(signal)
  }
}

export const tradeSignalEmitter = new TradeSignalEmitter()
