import fs from 'fs'
import path from 'path'

export type TradingAnalyticsSnapshot = {
  timestamp: string
  executionEnabled: boolean
  maxRiskScore: number | null
  deadLetterCount: number
  receivedTotal: number
  executedTotal: number
  blockedTotal: number
  failedTotal: number
  watchlistSize: number
  trackedWalletCount: number | null
  avgWalletWinRate: number | null
  avgWalletPnl: number | null
}

type TradingAnalyticsDocument = {
  version: 1
  snapshots: TradingAnalyticsSnapshot[]
}

export class TradingAnalyticsStore {
  private readonly filePath: string

  constructor(filePath = path.resolve(process.cwd(), 'data', 'trading-analytics.json')) {
    this.filePath = filePath
  }

  appendSnapshot(snapshot: TradingAnalyticsSnapshot, minIntervalMinutes = 10): { appended: boolean; reason?: string } {
    const doc = this.readDocument()
    const latest = doc.snapshots[doc.snapshots.length - 1]
    if (latest && minIntervalMinutes > 0) {
      const deltaMs = new Date(snapshot.timestamp).getTime() - new Date(latest.timestamp).getTime()
      if (Number.isFinite(deltaMs) && deltaMs < minIntervalMinutes * 60_000) {
        return { appended: false, reason: 'min-interval-not-reached' }
      }
    }

    doc.snapshots.push(snapshot)
    doc.snapshots = doc.snapshots.slice(-5000)
    this.writeDocument(doc)
    return { appended: true }
  }

  getTrends(hours = 24 * 7): { snapshots: TradingAnalyticsSnapshot[] } {
    const doc = this.readDocument()
    const now = Date.now()
    const maxAgeMs = Math.max(1, hours) * 60 * 60 * 1000
    const snapshots = doc.snapshots.filter((row) => {
      const t = new Date(row.timestamp).getTime()
      return Number.isFinite(t) && now - t <= maxAgeMs
    })

    return { snapshots }
  }

  private readDocument(): TradingAnalyticsDocument {
    try {
      if (!fs.existsSync(this.filePath)) {
        return { version: 1, snapshots: [] }
      }

      const raw = fs.readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as TradingAnalyticsDocument
      if (!parsed || !Array.isArray(parsed.snapshots)) {
        return { version: 1, snapshots: [] }
      }

      return {
        version: 1,
        snapshots: parsed.snapshots,
      }
    } catch {
      return { version: 1, snapshots: [] }
    }
  }

  private writeDocument(doc: TradingAnalyticsDocument): void {
    const dir = path.dirname(this.filePath)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(this.filePath, JSON.stringify(doc, null, 2), 'utf8')
  }
}
