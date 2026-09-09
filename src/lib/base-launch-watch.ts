import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import { BaseSwapService } from './base-swap-service'

type WatchStatus = 'WATCHING' | 'READY' | 'CANCELLED' | 'ERROR'
type LaunchWatch = {
  id: string; sellToken: string; buyToken: string; amount: string; slippageBps: number; riskOverride?: boolean; status: WatchStatus
  createdAt: string; updatedAt: string; attempts: number; lastError?: string; quote?: Record<string, unknown>
}

export class BaseLaunchWatchService {
  private readonly file = path.resolve(process.cwd(), 'data/base-launch-watches.json')
  private readonly watches = new Map<string, LaunchWatch>()
  private timer?: NodeJS.Timeout
  private busy = false

  constructor(private readonly swaps: BaseSwapService) {}

  async start() {
    await this.load()
    const interval = Math.max(10_000, Number(process.env.BASE_LAUNCH_WATCH_INTERVAL_MS || 15_000))
    this.timer = setInterval(() => void this.poll(), interval)
    this.timer.unref?.()
    void this.poll()
  }

  list() { return [...this.watches.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }

  async create(input: { sellToken?: string; buyToken?: string; amount?: string; slippageBps?: number; riskOverride?: boolean }) {
    const sellToken = String(input.sellToken || 'ETH').trim()
    const buyToken = String(input.buyToken || '').trim().toLowerCase()
    const amount = String(input.amount || '').trim()
    const slippageBps = Math.floor(Number(input.slippageBps || 100))
    if (!/^0x[a-f0-9]{40}$/.test(buyToken)) throw new Error('A valid Base token contract is required')
    if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) throw new Error('A positive trade amount is required')
    if (Number(amount) > this.swaps.status().maxTradeEth && ['eth', 'native'].includes(sellToken.toLowerCase())) throw new Error(`Amount exceeds the ${this.swaps.status().maxTradeEth} ETH limit`)
    if (slippageBps < 1 || slippageBps > this.swaps.status().maxSlippageBps) throw new Error(`Slippage must be between 1 and ${this.swaps.status().maxSlippageBps} bps`)
    const duplicate = this.list().find((watch) => watch.status === 'WATCHING' && watch.buyToken === buyToken)
    if (duplicate) {
      if (input.riskOverride === true && duplicate.riskOverride !== true) {
        duplicate.riskOverride = true; duplicate.updatedAt = new Date().toISOString(); await this.save()
      }
      return duplicate
    }
    const now = new Date().toISOString()
    const watch: LaunchWatch = { id: randomUUID(), sellToken, buyToken, amount, slippageBps, riskOverride: input.riskOverride === true, status: 'WATCHING', createdAt: now, updatedAt: now, attempts: 0 }
    this.watches.set(watch.id, watch); await this.save(); void this.poll()
    return watch
  }

  async cancel(id: string) {
    const watch = this.watches.get(id)
    if (!watch) throw new Error('Launch watch not found')
    watch.status = 'CANCELLED'; watch.updatedAt = new Date().toISOString(); delete watch.quote
    await this.save(); return watch
  }

  private async poll() {
    if (this.busy) return
    this.busy = true
    try {
      for (const watch of this.list().filter((item) => item.status === 'WATCHING')) {
        watch.attempts += 1; watch.updatedAt = new Date().toISOString()
        try {
          const quote = await this.swaps.quote(watch)
          watch.status = 'READY'; watch.quote = quote as unknown as Record<string, unknown>; delete watch.lastError
          await this.notify(watch)
        } catch (error) {
          watch.lastError = error instanceof Error ? error.message.slice(0, 300) : 'No executable route yet'
        }
        await this.save()
      }
    } finally { this.busy = false }
  }

  private async notify(watch: LaunchWatch) {
    const token = process.env.BOT_TOKEN?.trim(), chatId = process.env.ADMIN_CHAT_ID?.trim()
    if (!token || !chatId) return
    const app = (process.env.APP_URL || 'https://foilops.com').replace(/\/$/, '')
    const url = `${app}/dashboard/discovery?baseWatch=${encodeURIComponent(watch.id)}`
    const expected = String(watch.quote?.expectedBuyAmount || 'unknown')
    const symbol = String(watch.quote?.buySymbol || 'tokens')
    const text = [`🚨 <b>Base route is live</b>`, `<code>${watch.buyToken}</code>`, `Spend: <b>${watch.amount} ${String(watch.quote?.sellSymbol || 'ETH')}</b>`, `Expected: <b>${expected} ${symbol}</b>`, `Slippage limit: <b>${watch.slippageBps} bps</b>`, '', `Review and confirm: ${url}`].join('\n')
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }), signal: AbortSignal.timeout(10_000) }).catch(() => undefined)
  }

  private async load() {
    try {
      const rows = JSON.parse(await fs.readFile(this.file, 'utf8')) as LaunchWatch[]
      for (const row of rows) {
        if (row.status === 'READY') { row.status = 'WATCHING'; delete row.quote; row.lastError = 'Server restarted; refreshing the expired quote' }
        this.watches.set(row.id, row)
      }
    } catch { /* first run */ }
  }

  private async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    const temp = `${this.file}.tmp`
    await fs.writeFile(temp, JSON.stringify(this.list(), null, 2), { mode: 0o600 })
    await fs.rename(temp, this.file)
  }
}
