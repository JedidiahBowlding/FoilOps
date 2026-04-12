import TelegramBot from 'node-telegram-bot-api'
import { BotMiddleware } from '../../config/bot-middleware'
import axios from 'axios'

export class TradingCommand {
  private tradingBotUrl: string
  private static readonly REQUEST_TIMEOUT_MS = 10_000

  constructor(private bot: TelegramBot) {
    this.bot = bot
    this.tradingBotUrl = this.resolveTradingBotUrl()
  }

  private resolveTradingBotUrl(): string {
    const explicitUrl = process.env.TRADING_BOT_URL?.trim()
    if (explicitUrl) {
      return explicitUrl.replace(/\/$/, '')
    }

    const bind = process.env.SIGNAL_RECEIVER_BIND?.trim()
    if (bind) {
      if (bind.startsWith('http://') || bind.startsWith('https://')) {
        return bind.replace(/\/$/, '')
      }

      // A server bind like 0.0.0.0 is not directly connectable from a client.
      const hostPort = bind.replace(/^0\.0\.0\.0:/, '127.0.0.1:').replace(/^\[::\]:/, '127.0.0.1:')
      return `http://${hostPort}`
    }

    return 'http://127.0.0.1:8787'
  }

  public start() {
    this.setupTradingCommands()
  }

  private setupTradingCommands() {
    // Trading status commands
    this.bot.onText(/\/trading_status/, async (msg) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      try {
        const response = await axios.get(`${this.tradingBotUrl}/trading/status`)
        const status = response.data

        const message = `
🤖 <b>Trading Bot Status</b>

📊 <b>Status:</b> ${status.enabled ? '✅ Enabled' : '❌ Disabled'}
⏸️ <b>Paused:</b> ${status.paused ? 'Yes' : 'No'}
🎯 <b>Mode:</b> ${status.mode}
👛 <b>Target Wallet:</b> ${status.targetWallet ? `${status.targetWallet.substring(0, 8)}...` : 'Not set'}
🛡️ <b>MEV Service:</b> ${status.mevService}
📈 <b>Slippage:</b> ${status.slippage}%
        `.trim()

        this.bot.sendMessage(chatId, message, { parse_mode: 'HTML' })
      } catch (error) {
        if (axios.isAxiosError(error)) {
          console.error('Trading status error:', {
            message: error.message,
            url: `${this.tradingBotUrl}/trading/status`,
            code: error.code,
            status: error.response?.status,
            data: error.response?.data,
          })
        } else {
          console.error('Trading status error:', error)
        }
        this.bot.sendMessage(chatId, '❌ Failed to get trading status')
      }
    })

    // Balance command
    this.bot.onText(/\/trading_balance/, async (msg) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      try {
        const response = await axios.get(`${this.tradingBotUrl}/trading/balance`)
        const balance = response.data

        const message = `
💰 <b>Trading Wallet Balance</b>

💎 <b>SOL:</b> ${balance.solBalance.toFixed(4)} SOL
💵 <b>USDC:</b> $${balance.usdcBalance.toFixed(2)}
🪙 <b>Tokens:</b> ${balance.tokenCount}
💵 <b>Total Value:</b> $${balance.totalValueUsd.toFixed(2)}
        `.trim()

        this.bot.sendMessage(chatId, message, { parse_mode: 'HTML' })
      } catch (error) {
        console.error('Trading balance error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to get balance')
      }
    })

    // Recent trades command
    this.bot.onText(/\/trading_trades/, async (msg) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      try {
        const response = await axios.get(`${this.tradingBotUrl}/trading/trades`)
        const trades = response.data

        if (trades.length === 0) {
          return this.bot.sendMessage(chatId, '📊 No recent trades found')
        }

        const tradeMessages = trades
          .slice(0, 5)
          .map(
            (trade: any) =>
              `• ${trade.direction.toUpperCase()} ${trade.amount} ${trade.tokenMint.substring(0, 8)}... (${trade.status})`,
          )
          .join('\n')

        const message = `
📊 <b>Recent Trades</b>

${tradeMessages}
        `.trim()

        this.bot.sendMessage(chatId, message, { parse_mode: 'HTML' })
      } catch (error) {
        console.error('Trading trades error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to get trades')
      }
    })

    // Trading control commands
    this.bot.onText(/\/trading_enable/, async (msg) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      try {
        const response = await axios.post(
          `${this.tradingBotUrl}/trading/enable`,
          {},
          { timeout: TradingCommand.REQUEST_TIMEOUT_MS },
        )

        const status = response.data?.status
        const message = response.data?.message

        if (status === 'enabled') {
          this.bot.sendMessage(chatId, `✅ Trading bot enabled${message ? `\n${message}` : ''}`)
          return
        }

        this.bot.sendMessage(chatId, `⚠️ Trading enable returned unexpected response${message ? `\n${message}` : ''}`)
      } catch (error) {
        if (axios.isAxiosError(error)) {
          const status = error.response?.status
          const detail =
            (typeof error.response?.data === 'string' && error.response.data) ||
            error.response?.data?.message ||
            error.response?.data?.error ||
            error.message

          console.error('Trading enable error:', {
            message: error.message,
            url: `${this.tradingBotUrl}/trading/enable`,
            code: error.code,
            status,
            data: error.response?.data,
          })

          this.bot.sendMessage(
            chatId,
            `❌ Failed to enable trading\nStatus: ${status ?? 'n/a'}\nDetail: ${detail || 'unknown error'}`,
          )
          return
        }

        console.error('Trading enable error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to enable trading\nDetail: unknown error')
      }
    })

    this.bot.onText(/\/trading_disable/, async (msg) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      try {
        await axios.post(`${this.tradingBotUrl}/trading/disable`)
        this.bot.sendMessage(chatId, '⛔ Trading bot disabled')
      } catch (error) {
        console.error('Trading disable error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to disable trading')
      }
    })

    this.bot.onText(/\/trading_pause/, async (msg) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      try {
        await axios.post(`${this.tradingBotUrl}/trading/pause`)
        this.bot.sendMessage(chatId, '⏸️ Trading paused')
      } catch (error) {
        console.error('Trading pause error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to pause trading')
      }
    })

    this.bot.onText(/\/trading_resume/, async (msg) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      try {
        await axios.post(`${this.tradingBotUrl}/trading/resume`)
        this.bot.sendMessage(chatId, '▶️ Trading resumed')
      } catch (error) {
        console.error('Trading resume error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to resume trading')
      }
    })

    // Configuration commands
    this.bot.onText(/\/trading_slippage(?:\s+(\d+(?:\.\d+)?))?/, async (msg, match) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)
      const slippage = match?.[1]

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      try {
        if (slippage) {
          // Set slippage
          await axios.post(`${this.tradingBotUrl}/trading/slippage`, { slippage: parseFloat(slippage) })
          this.bot.sendMessage(chatId, `✅ Slippage set to ${slippage}%`)
        } else {
          // Get slippage
          const response = await axios.get(`${this.tradingBotUrl}/trading/slippage`)
          this.bot.sendMessage(chatId, `📈 Current slippage: ${response.data.slippage}%`)
        }
      } catch (error) {
        console.error('Trading slippage error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to manage slippage')
      }
    })

    this.bot.onText(/\/trading_target(?:\s+([1-9A-HJ-NP-Za-km-z]{32,44}))?/, async (msg, match) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)
      const targetWallet = match?.[1]

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      try {
        if (targetWallet) {
          // Set target wallet
          await axios.post(`${this.tradingBotUrl}/trading/target`, { target_wallet: targetWallet })
          this.bot.sendMessage(chatId, `✅ Target wallet set to ${targetWallet.substring(0, 8)}...`)
        } else {
          // Get target wallet
          const response = await axios.get(`${this.tradingBotUrl}/trading/target`)
          const wallet = response.data.target_wallet
          this.bot.sendMessage(chatId, `🎯 Target wallet: ${wallet ? wallet.substring(0, 8) + '...' : 'Not set'}`)
        }
      } catch (error) {
        console.error('Trading target error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to manage target wallet')
      }
    })

    this.bot.onText(/\/trading_safety/, async (msg) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      try {
        const response = await axios.get(`${this.tradingBotUrl}/trading/safety`)
        const s = response.data

        await this.bot.sendMessage(
          chatId,
          [
            '🛡️ <b>Trading Safety Summary</b>',
            `Max risk score: <b>${s.maxRiskScore ?? 'n/a'}</b>`,
            `Min liquidity USD: <b>${s.minLiquidityUsd ?? 'n/a'}</b>`,
            `Max position size: <b>${s.maxPositionSizeSol ?? 'n/a'} SOL</b>`,
            `Max concurrent trades: <b>${s.maxConcurrentTrades ?? 'n/a'}</b>`,
            `Buy amount: <b>${s.buyAmountSol ?? 'n/a'} SOL</b>`,
            `Slippage: <b>${s.slippage ?? 'n/a'}%</b>`,
            `Enabled: <b>${s.enabled ? 'Yes' : 'No'}</b> | Paused: <b>${s.paused ? 'Yes' : 'No'}</b>`,
          ].join('\n'),
          {
            parse_mode: 'HTML',
          },
        )
      } catch (error) {
        console.error('Trading safety error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to fetch safety summary')
      }
    })

    this.bot.onText(/\/trading_decisions/, async (msg) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      try {
        const response = await axios.get(`${this.tradingBotUrl}/trading/decisions`)
        const decisions = Array.isArray(response.data?.decisions) ? response.data.decisions : []

        if (decisions.length === 0) {
          return this.bot.sendMessage(chatId, 'No recent signal decisions yet.')
        }

        const lines = ['🧠 <b>Recent Signal Decisions</b>', '']
        for (const decision of decisions.slice(0, 12)) {
          lines.push(
            `• <b>${decision.status || 'unknown'}</b> | ${decision.signalType || 'unknown'} | risk ${decision.riskScore ?? 'n/a'}`,
          )
          lines.push(`  action: ${decision.actionHint || 'n/a'} | token: ${decision.tokenMint || 'n/a'}`)
          lines.push(`  id: <code>${decision.signalId || 'unknown'}</code>`)
          if (decision.reason) {
            lines.push(`  reason: ${String(decision.reason).slice(0, 120)}`)
          }
          lines.push('')
        }

        await this.bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML' })
      } catch (error) {
        console.error('Trading decisions error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to fetch decision cards')
      }
    })

    this.bot.onText(/\/trading_profile(?:\s+(conservative|balanced|aggressive))?/i, async (msg, match) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)
      const profile = match?.[1]?.toLowerCase()

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      if (!profile) {
        return this.bot.sendMessage(chatId, 'Usage: /trading_profile conservative|balanced|aggressive')
      }

      try {
        const response = await axios.post(`${this.tradingBotUrl}/trading/profile`, { profile })
        this.bot.sendMessage(chatId, `✅ ${response.data?.message || 'Profile updated'}`)
      } catch (error) {
        console.error('Trading profile error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to update trading profile')
      }
    })

    this.bot.onText(/\/trading_mode(?:\s+(copy_trade|signal_based|manual|conservative))?/i, async (msg, match) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)
      const mode = match?.[1]?.toLowerCase()

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      if (!mode) {
        return this.bot.sendMessage(chatId, 'Usage: /trading_mode copy_trade|signal_based|manual|conservative')
      }

      try {
        const response = await axios.post(`${this.tradingBotUrl}/trading/mode`, { mode })
        this.bot.sendMessage(chatId, `✅ ${response.data?.message || 'Mode updated'}`)
      } catch (error) {
        console.error('Trading mode error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to update trading mode')
      }
    })

    this.bot.onText(/\/trading_size(?:\s+(\d+(?:\.\d+)?))?/, async (msg, match) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)
      const amount = match?.[1] ? Number(match[1]) : NaN

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        return this.bot.sendMessage(chatId, 'Usage: /trading_size <buy_amount_sol>')
      }

      try {
        const response = await axios.post(`${this.tradingBotUrl}/trading/size`, { buy_amount_sol: amount })
        this.bot.sendMessage(chatId, `✅ ${response.data?.message || 'Size updated'}`)
      } catch (error) {
        console.error('Trading size error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to update trade size')
      }
    })

    this.bot.onText(/\/trading_tighten_risk/, async (msg) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      try {
        const safety = await axios.get(`${this.tradingBotUrl}/trading/safety`)
        const current = Number(safety.data?.maxRiskScore || 75)
        const next = Math.max(25, current - 10)
        const response = await axios.post(`${this.tradingBotUrl}/trading/risk`, { max_risk_score: next })
        this.bot.sendMessage(chatId, `✅ ${response.data?.message || `Risk tightened to ${next}`}`)
      } catch (error) {
        console.error('Trading tighten risk error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to tighten risk controls')
      }
    })

    this.bot.onText(/\/trading_kill/, async (msg) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      try {
        const response = await axios.post(`${this.tradingBotUrl}/trading/kill-switch`)
        this.bot.sendMessage(chatId, `🛑 ${response.data?.message || 'Kill switch activated'}`)
      } catch (error) {
        console.error('Trading kill switch error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to activate kill switch')
      }
    })
  }
}
