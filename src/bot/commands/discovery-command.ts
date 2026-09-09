import TelegramBot from 'node-telegram-bot-api'
import { BotMiddleware } from '../../config/bot-middleware'
import { NewLaunchIngestor } from '../../lib/new-launch-ingestor'
import { PrismaLaunchCandidateRepository } from '../../repositories/prisma/launch-candidate'
import { promises as fs } from 'fs'
import path from 'path'
import { OrderStateStore } from '../../lib/liquidity-auto-buy/order-state-store'

export class DiscoveryCommand {
  constructor(
    private readonly bot: TelegramBot,
    private readonly ingestor: NewLaunchIngestor,
    private readonly repository: PrismaLaunchCandidateRepository,
  ) {}

  registerHandlers(): void {
    this.bot.onText(/^\/monitoring(?:@\w+)?$/i, async (msg) => this.sendMonitoring(msg))
    this.bot.onText(/^\/base_watches(?:@\w+)?$/i, async (msg) => this.sendBaseWatches(msg))
    this.bot.onText(/^\/autobuy_orders(?:@\w+)?$/i, async (msg) => this.sendAutoBuyOrders(msg))
    this.bot.onText(/^\/discovery(?:@\w+)?$/i, async (msg) => this.sendOverview(msg.chat.id))
    this.bot.onText(/^\/discovery_status(?:@\w+)?$/i, async (msg) => this.sendStatus(msg.chat.id))
    this.bot.onText(/^\/discoveries(?:@\w+)?(?:\s+(solana|robinhood))?(?:\s+(\d+))?$/i, async (msg, match) => {
      await this.sendCandidates(msg.chat.id, match?.[1]?.toLowerCase(), Number(match?.[2]) || 5)
    })
    this.bot.onText(/^\/robinhood(?:@\w+)?(?:\s+(\d+))?$/i, async (msg, match) => {
      await this.sendCandidates(msg.chat.id, 'robinhood', Number(match?.[1]) || 5)
    })
    this.bot.onText(/^\/candidate(?:@\w+)?(?:\s+(solana|robinhood))?(?:\s+(\S+))?$/i, async (msg, match) => {
      await this.sendCandidate(msg.chat.id, match?.[1]?.toLowerCase(), match?.[2])
    })
    this.bot.onText(/^\/discovery_scan(?:@\w+)?$/i, async (msg) => {
      const userId = String(msg.from?.id || '')
      if (!BotMiddleware.isUserBotAdmin(userId)) {
        await this.bot.sendMessage(msg.chat.id, '❌ Access denied. Admin only command.')
        return
      }
      const result = await this.ingestor.pollOnce()
      await this.bot.sendMessage(
        msg.chat.id,
        `✅ <b>Discovery scan complete</b>\nDetected: <b>${result.detected}</b>\nProcessed: <b>${result.processed}</b>`,
        { parse_mode: 'HTML' },
      )
    })
  }

  private isAdmin(msg: TelegramBot.Message): boolean {
    return BotMiddleware.isUserBotAdmin(String(msg.from?.id || ''))
  }

  private async deny(msg: TelegramBot.Message): Promise<boolean> {
    if (this.isAdmin(msg)) return false
    await this.bot.sendMessage(msg.chat.id, '❌ Access denied. Monitoring details are admin only.')
    return true
  }

  private async sendMonitoring(msg: TelegramBot.Message): Promise<void> {
    if (await this.deny(msg)) return
    await this.sendBaseWatches(msg, false)
    await this.sendAutoBuyOrders(msg, false)
  }

  private async sendBaseWatches(msg: TelegramBot.Message, checkAdmin = true): Promise<void> {
    if (checkAdmin && await this.deny(msg)) return
    let watches: any[] = []
    try { watches = JSON.parse(await fs.readFile(path.resolve(process.cwd(), 'data/base-launch-watches.json'), 'utf8')) }
    catch { /* no watches yet */ }
    const active = watches.filter((watch) => !['CANCELLED'].includes(String(watch.status))).slice(0, 10)
    const lines = ['👁 <b>Base Launch Watches</b>', '']
    if (!active.length) lines.push('No active Base launch watches.')
    for (const watch of active) lines.push(
      `<b>${this.escape(watch.status)}</b>${watch.riskOverride ? ' · ⚠️ RISK OVERRIDE' : ''}`,
      `<code>${this.escape(watch.buyToken)}</code>`,
      `Spend: <b>${this.escape(watch.amount)} ${this.escape(watch.sellToken)}</b> · Slippage: <b>${this.escape(watch.slippageBps)} bps</b>`,
      `Checks: <b>${this.escape(watch.attempts)}</b>`,
      `Last result: ${this.escape(watch.lastError || (watch.quote ? 'Route ready for review' : 'Waiting'))}`,
      '',
    )
    await this.bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Open Execution', url: `${this.appUrl()}/dashboard/execution` }]] } })
  }

  private async sendAutoBuyOrders(msg: TelegramBot.Message, checkAdmin = true): Promise<void> {
    if (checkAdmin && await this.deny(msg)) return
    const store = new OrderStateStore()
    const [control, orders] = await Promise.all([store.getControl(), store.list()])
    const lines = ['🤖 <b>Liquidity Auto-Buy</b>', `Master switch: <b>${control.enabled ? 'ON' : 'OFF'}</b>`, '']
    if (!orders.length) lines.push('No auto-buy orders configured.')
    for (const order of orders.slice(0, 10)) lines.push(
      `<b>${this.escape(order.state)}</b> · ${this.escape(order.sellToken)} ${this.escape(order.spendAmount)}`,
      `<code>${this.escape(order.tokenAddress)}</code>`,
      `AUTO authorization: <b>${order.autoBuyEnabled ? 'ON' : 'OFF'}</b> · Attempts: <b>${order.monitorAttempts}</b>`,
      `Liquidity: <b>${this.money(order.currentLiquidityUsd)}</b> · Impact limit: <b>${order.maxPriceImpactBps} bps</b>`,
      `Last result: ${this.escape(order.lastReason || 'Waiting')}`,
      order.transactionHash ? `Transaction: <code>${this.escape(order.transactionHash)}</code>` : '',
      '',
    )
    await this.bot.sendMessage(msg.chat.id, lines.filter(Boolean).join('\n'), { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Open Auto-Buy', url: `${this.appUrl()}/dashboard/execution` }]] } })
  }

  private async sendOverview(chatId: number): Promise<void> {
    const appUrl = this.appUrl()
    await this.bot.sendMessage(
      chatId,
      [
        '💎 <b>Hidden-Gem Discovery</b>',
        '',
        'FoilOps monitors Solana launches and Robinhood Chain contracts, then scores independently collected liquidity, holder, authority, contract, and project-link evidence.',
        '',
        '🔎 <b>/discoveries</b> — top candidates across chains',
        '🟣 <b>/discoveries solana</b> — Solana candidates',
        '🟢 <b>/robinhood</b> — Robinhood Chain candidates',
        '🧾 <b>/candidate solana &lt;mint&gt;</b> — evidence summary',
        '📡 <b>/discovery_status</b> — ingestion health',
        '🔄 <b>/discovery_scan</b> — scan now (admin)',
        '👁 <b>/monitoring</b> — Base watches and auto-buy orders (admin)',
        '',
        'Candidates are research signals, not buy recommendations.',
      ].join('\n'),
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '🌐 Open Discovery Dashboard', url: `${appUrl}/dashboard/discovery` }]],
        },
      },
    )
  }

  private async sendStatus(chatId: number): Promise<void> {
    const status = this.ingestor.getStatus()
    await this.bot.sendMessage(
      chatId,
      [
        '📡 <b>Discovery Ingestion Status</b>',
        `Enabled: <b>${status.enabled ? 'Yes' : 'No'}</b>`,
        `Scanning now: <b>${status.running ? 'Yes' : 'No'}</b>`,
        `Sources: <b>${status.sources.map((source) => this.escape(source)).join(', ')}</b>`,
        `Last scan: <b>${status.lastPollAt ? this.escape(new Date(status.lastPollAt).toLocaleString()) : 'Not yet'}</b>`,
        `Processed this run: <b>${status.processedTotal}</b>`,
        `Rescored this run: <b>${status.rescoredTotal}</b>`,
        `Last error: <b>${status.lastError ? this.escape(status.lastError) : 'None'}</b>`,
      ].join('\n'),
      { parse_mode: 'HTML' },
    )
  }

  private async sendCandidates(chatId: number, chain?: string, requestedLimit = 5): Promise<void> {
    const limit = Math.max(1, Math.min(10, requestedLimit))
    const candidates = await this.repository.list({ limit, chain })
    if (candidates.length === 0) {
      await this.bot.sendMessage(chatId, `No ${chain || ''} discovery candidates have been collected yet.`.trim())
      return
    }

    const lines = [
      `💎 <b>${chain === 'robinhood' ? 'Robinhood Chain' : chain === 'solana' ? 'Solana' : 'Top'} Candidates</b>`,
      '',
    ]
    for (const [index, candidate] of candidates.entries()) {
      const evidence = (candidate.evidence || {}) as Record<string, unknown>
      const label = this.escape(evidence.symbol || evidence.name || candidate.tokenMint.slice(0, 10))
      const liquidity = this.money(evidence.liquidityUsd)
      const website = this.safeUrl(evidence.website)
      lines.push(
        `<b>${index + 1}. ${label}</b> · ${this.escape(candidate.chain)}`,
        `Verdict: <b>${this.escape(candidate.classification)}</b> · Opportunity: <b>${candidate.opportunityScore}</b> · Risk: <b>${candidate.riskScore}</b>`,
        `Liquidity: <b>${liquidity}</b>`,
        `<code>${this.escape(candidate.tokenMint)}</code>`,
        website ? `<a href="${this.escape(website)}">Project website</a>` : 'Website: not found',
        `<a href="${this.appUrl()}/dashboard/discovery/${encodeURIComponent(candidate.chain)}/${encodeURIComponent(candidate.tokenMint)}">Evidence history</a>`,
        '',
      )
    }
    lines.push('A candidate is a research signal—not a buy recommendation.')
    await this.bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML', disable_web_page_preview: true })
  }

  private async sendCandidate(chatId: number, chain?: string, tokenMint?: string): Promise<void> {
    if (!chain || !tokenMint) {
      await this.bot.sendMessage(
        chatId,
        'Usage: <code>/candidate &lt;solana|robinhood&gt; &lt;token_address&gt;</code>',
        {
          parse_mode: 'HTML',
        },
      )
      return
    }
    const history = await this.repository.getHistory(chain, tokenMint, 1)
    if (!history) {
      await this.bot.sendMessage(chatId, 'Discovery candidate not found.')
      return
    }
    const candidate = history.candidate
    const evidence = (candidate.evidence || {}) as Record<string, unknown>
    const rationale = Array.isArray(evidence.rationale) ? evidence.rationale.map(String).slice(0, 6) : []
    const links = [evidence.website, evidence.twitter, evidence.telegram]
      .map((value) => this.safeUrl(value))
      .filter((value): value is string => Boolean(value))
    await this.bot.sendMessage(
      chatId,
      [
        `🧾 <b>${this.escape(evidence.symbol || evidence.name || tokenMint.slice(0, 10))} Evidence</b>`,
        `Chain: <b>${this.escape(chain)}</b>`,
        `Verdict: <b>${this.escape(candidate.classification)}</b>`,
        `Opportunity: <b>${candidate.opportunityScore}</b> · Risk: <b>${candidate.riskScore}</b>`,
        `Verified liquidity: <b>${this.money(evidence.liquidityUsd)}</b>`,
        `Top 10 holders: <b>${this.percent(evidence.top10HolderPercent)}</b>`,
        `Creator holdings: <b>${this.percent(evidence.creatorHoldPercent)}</b>`,
        `Mint authority: <b>${evidence.mintAuthority === null ? 'Revoked' : 'Active or unknown'}</b>`,
        `Freeze authority: <b>${evidence.freezeAuthority === null ? 'Revoked' : 'Active or unknown'}</b>`,
        '',
        '<b>Why:</b>',
        ...(rationale.length ? rationale.map((item) => `• ${this.escape(item)}`) : ['• No rationale recorded']),
        '',
        links.length
          ? links.map((link) => `<a href="${this.escape(link)}">${this.escape(new URL(link).hostname)}</a>`).join(' · ')
          : 'Project links: none found',
        `<a href="${this.appUrl()}/dashboard/discovery/${encodeURIComponent(chain)}/${encodeURIComponent(tokenMint)}">Open full evidence history</a>`,
      ].join('\n'),
      { parse_mode: 'HTML', disable_web_page_preview: true },
    )
  }

  private appUrl(): string {
    return (process.env.APP_URL?.trim() || 'https://foilops.com').replace(/\/$/, '')
  }

  private escape(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  private money(value: unknown): string {
    const amount = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(amount) && value !== null
      ? `$${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
      : 'Not verified'
  }

  private percent(value: unknown): string {
    const amount = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(amount) && value !== null ? `${amount.toFixed(2)}%` : 'Unknown'
  }

  private safeUrl(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null
    try {
      const url = new URL(value.trim())
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
    } catch {
      return null
    }
  }
}
