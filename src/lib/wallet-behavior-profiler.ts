import { ParsedInstruction, PublicKey } from '@solana/web3.js'
import { RpcConnectionManager } from '../providers/solana'

export type WalletBehaviorProfile = {
  classification: 'LIKELY_BOT' | 'LIKELY_DEV' | 'MIXED_BOT_AND_DEV' | 'UNCERTAIN'
  botProbability: number
  devProbability: number
  indicators: string[]
  metrics: {
    sampleTransactions: number
    txPerMinute: number
    medianIntervalSeconds: number
    outgoingTransfers: number
    uniqueDestinations: number
    tinyTransferRatio: number
    mintLikeLogCount: number
  }
}

export class WalletBehaviorProfiler {
  async profileWallet(address: string, sampleSize = 80): Promise<WalletBehaviorProfile> {
    const fallback: WalletBehaviorProfile = {
      classification: 'UNCERTAIN',
      botProbability: 0,
      devProbability: 0,
      indicators: ['insufficient on-chain sample'],
      metrics: {
        sampleTransactions: 0,
        txPerMinute: 0,
        medianIntervalSeconds: 0,
        outgoingTransfers: 0,
        uniqueDestinations: 0,
        tinyTransferRatio: 0,
        mintLikeLogCount: 0,
      },
    }

    let wallet: PublicKey
    try {
      wallet = new PublicKey(address)
    } catch {
      return {
        ...fallback,
        indicators: ['invalid wallet address'],
      }
    }

    const connection = RpcConnectionManager.getRandomConnection()
    const signatures = await connection.getSignaturesForAddress(wallet, { limit: sampleSize })
    if (signatures.length === 0) return fallback

    const times = signatures
      .map((s) => s.blockTime)
      .filter((value): value is number => typeof value === 'number')
      .sort((a, b) => b - a)

    const txPerMinute = this.computeTxPerMinute(times)
    const medianIntervalSeconds = this.computeMedianInterval(times)

    let outgoingTransfers = 0
    let tinyTransferCount = 0
    const destinations = new Set<string>()
    let mintLikeLogCount = 0

    const sampleToParse = signatures.slice(0, 35)

    for (const signatureInfo of sampleToParse) {
      const tx = await connection.getParsedTransaction(signatureInfo.signature, { maxSupportedTransactionVersion: 0 })
      if (!tx) continue

      const logs = (tx.meta?.logMessages || []).join(' ').toLowerCase()
      if (
        logs.includes('mint') ||
        logs.includes('create') ||
        logs.includes('pump') ||
        logs.includes('initializemint')
      ) {
        mintLikeLogCount += 1
      }

      const instructions = tx.transaction.message.instructions
      for (const rawInstruction of instructions) {
        if (!('parsed' in rawInstruction)) continue
        const instruction = rawInstruction as ParsedInstruction
        const parsed = instruction.parsed as {
          type?: string
          info?: {
            source?: string
            authority?: string
            destination?: string
            lamports?: number
            amount?: string
          }
        }

        if (!parsed?.type || !parsed.info) continue

        const source = parsed.info.source || parsed.info.authority
        const destination = parsed.info.destination
        if (source !== address || !destination) continue

        outgoingTransfers += 1
        destinations.add(destination)

        const lamports = parsed.info.lamports || Number(parsed.info.amount || 0)
        const amountSol = lamports / 1e9
        if (amountSol > 0 && amountSol <= 0.005) {
          tinyTransferCount += 1
        }
      }
    }

    const tinyTransferRatio = outgoingTransfers > 0 ? tinyTransferCount / outgoingTransfers : 0

    let botScore = 0
    let devScore = 0
    const indicators: string[] = []

    if (txPerMinute >= 4) {
      botScore += 30
      indicators.push(`high cadence (${txPerMinute.toFixed(2)} tx/min)`)
    }
    if (medianIntervalSeconds > 0 && medianIntervalSeconds <= 20) {
      botScore += 20
      indicators.push(`low median interval (${medianIntervalSeconds.toFixed(1)}s)`)
    }
    if (outgoingTransfers >= 15 && destinations.size >= 8) {
      botScore += 22
      indicators.push(`fan-out transfers (${outgoingTransfers} / ${destinations.size} destinations)`)
    }
    if (tinyTransferRatio >= 0.6 && outgoingTransfers >= 10) {
      botScore += 18
      indicators.push(`micro-transfer ratio ${(tinyTransferRatio * 100).toFixed(1)}%`)
    }

    if (mintLikeLogCount >= 8) {
      devScore += 55
      indicators.push(`frequent mint/create logs (${mintLikeLogCount})`)
    } else if (mintLikeLogCount >= 3) {
      devScore += 35
      indicators.push(`moderate mint/create logs (${mintLikeLogCount})`)
    }

    if (destinations.size <= 3 && mintLikeLogCount >= 3) {
      devScore += 15
      indicators.push('focused destination profile with repeated mint activity')
    }

    const botProbability = Math.max(0, Math.min(100, Math.round(botScore)))
    const devProbability = Math.max(0, Math.min(100, Math.round(devScore)))

    let classification: WalletBehaviorProfile['classification'] = 'UNCERTAIN'
    if (botProbability >= 65 && devProbability >= 45) {
      classification = 'MIXED_BOT_AND_DEV'
    } else if (botProbability >= 65) {
      classification = 'LIKELY_BOT'
    } else if (devProbability >= 55) {
      classification = 'LIKELY_DEV'
    }

    return {
      classification,
      botProbability,
      devProbability,
      indicators,
      metrics: {
        sampleTransactions: signatures.length,
        txPerMinute,
        medianIntervalSeconds,
        outgoingTransfers,
        uniqueDestinations: destinations.size,
        tinyTransferRatio,
        mintLikeLogCount,
      },
    }
  }

  private computeTxPerMinute(times: number[]): number {
    if (times.length < 2) return 0

    const newest = times[0]
    const oldest = times[times.length - 1]
    const spanSeconds = Math.max(1, newest - oldest)

    return (times.length / spanSeconds) * 60
  }

  private computeMedianInterval(times: number[]): number {
    if (times.length < 2) return 0

    const sorted = [...times].sort((a, b) => b - a)
    const intervals: number[] = []
    for (let i = 1; i < sorted.length; i += 1) {
      intervals.push(Math.max(0, sorted[i - 1] - sorted[i]))
    }

    if (intervals.length === 0) return 0
    const midpoint = Math.floor(intervals.length / 2)
    const asc = intervals.sort((a, b) => a - b)

    if (asc.length % 2 === 1) return asc[midpoint]
    return (asc[midpoint - 1] + asc[midpoint]) / 2
  }
}
