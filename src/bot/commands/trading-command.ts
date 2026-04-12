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

  private resolveAppUrl(): string {
    return (process.env.APP_URL?.trim() || `http://127.0.0.1:${process.env.PORT || '3005'}`).replace(/\/$/, '')
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
      🧪 <b>Execution:</b> ${status.executionMode || 'paper'}
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
            `Execution mode: <b>${s.executionMode ?? 'paper'}</b>`,
            `Max risk score: <b>${s.maxRiskScore ?? 'n/a'}</b>`,
            `Min alert quality: <b>${s.minAlertQualityScore ?? 'n/a'}</b>`,
            `Min trace alerts: <b>${s.minTraceAlerts ?? 'n/a'}</b>`,
            `Min liquidity USD: <b>${s.minLiquidityUsd ?? 'n/a'}</b>`,
            `Max position size: <b>${s.maxPositionSizeSol ?? 'n/a'} SOL</b>`,
            `Max concurrent trades: <b>${s.maxConcurrentTrades ?? 'n/a'}</b>`,
            `Source wallets: <b>${s.sourceWalletWatchlistCount ?? 0}</b> watchlisted / <b>${s.sourceWalletCapsCount ?? 0}</b> capped / <b>${s.sourceWalletProfileCount ?? 0}</b> profiled`,
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
          const safetyTag =
            decision.safetyPass === true
              ? '✅ safety-pass'
              : decision.safetyPass === false
                ? '❌ safety-fail'
                : '➖ safety-n/a'
          lines.push(
            `• <b>${decision.status || 'unknown'}</b> | ${decision.signalType || 'unknown'} | risk ${decision.riskScore ?? 'n/a'}`,
          )
          lines.push(`  ${safetyTag} | action: ${decision.actionHint || 'n/a'} | token: ${decision.tokenMint || 'n/a'}`)
          lines.push(`  id: <code>${decision.signalId || 'unknown'}</code>`)
          if (Array.isArray(decision.safetyReasons) && decision.safetyReasons.length > 0) {
            lines.push(`  safety: ${decision.safetyReasons.slice(0, 2).join(', ')}`)
          }
          if (decision.reason) {
            lines.push(`  reason: ${String(decision.reason).slice(0, 120)}`)
          }
          lines.push('')
        }

        await this.bot.sendMessage(chatId, lines.join('\n'), {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '⏸️ Pause', callback_data: 'trading_pause' },
                { text: '⚠️ Tighten Risk', callback_data: 'trading_tighten_risk' },
                { text: '🛑 Kill', callback_data: 'trading_kill' },
              ],
            ],
          },
        })
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
        const response = await axios.post(`${this.tradingBotUrl}/trading/tighten-risk`)
        this.bot.sendMessage(chatId, `✅ ${response.data?.message || 'Risk tightened'}`)
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

    this.bot.onText(/\/trading_execution_mode(?:\s+(paper|live))?/i, async (msg, match) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)
      const mode = match?.[1]?.toLowerCase()

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      try {
        if (!mode) {
          const response = await axios.get(`${this.tradingBotUrl}/trading/execution-mode`)
          return this.bot.sendMessage(chatId, `🧪 Execution mode: <b>${response.data?.mode || 'paper'}</b>`, {
            parse_mode: 'HTML',
          })
        }

        const response = await axios.post(`${this.tradingBotUrl}/trading/execution-mode`, { mode })
        this.bot.sendMessage(chatId, `✅ ${response.data?.message || 'Execution mode updated'}`)
      } catch (error) {
        console.error('Trading execution mode error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to manage execution mode')
      }
    })

    this.bot.onText(/\/trading_sources/, async (msg) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      try {
        const response = await axios.get(`${this.tradingBotUrl}/trading/source-wallets`)
        const watchlist = Array.isArray(response.data?.watchlist) ? response.data.watchlist : []
        const caps = response.data?.caps && typeof response.data.caps === 'object' ? response.data.caps : {}
        const profiles =
          response.data?.profiles && typeof response.data.profiles === 'object' ? response.data.profiles : {}

        const lines = ['👀 <b>Source Wallet Controls</b>', '']
        lines.push(`Watchlist count: <b>${watchlist.length}</b>`)
        if (watchlist.length > 0) {
          for (const wallet of watchlist.slice(0, 12)) {
            const cap = caps[wallet]
            const profile = profiles[wallet]
            lines.push(
              `• <code>${wallet}</code>${cap ? ` | cap ${cap} SOL` : ''}${profile?.preset ? ` | ${profile.preset}` : ''}${profile?.enabled === false ? ' | blocked' : ''}`,
            )
          }
        } else {
          lines.push('No source wallets configured yet.')
        }

        lines.push('')
        lines.push('Commands:')
        lines.push('/trading_source_add <wallet>')
        lines.push('/trading_source_remove <wallet>')
        lines.push('/trading_source_cap <wallet> <sol>')
        lines.push('/trading_source_uncap <wallet>')
        lines.push('/trading_source_profile <wallet> <shadow|scalp|swing|defensive|blocked> [notes]')

        this.bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML' })
      } catch (error) {
        console.error('Trading sources error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to fetch source wallet controls')
      }
    })

    this.bot.onText(/\/trading_source_add(?:\s+([1-9A-HJ-NP-Za-km-z]{32,44}))?/, async (msg, match) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)
      const wallet = match?.[1]

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      if (!wallet) {
        return this.bot.sendMessage(chatId, 'Usage: /trading_source_add <wallet>')
      }

      try {
        const response = await axios.post(`${this.tradingBotUrl}/trading/source-wallets`, { action: 'add', wallet })
        this.bot.sendMessage(chatId, `✅ ${response.data?.message || 'Source wallet added'}`)
      } catch (error) {
        console.error('Trading source add error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to add source wallet')
      }
    })

    this.bot.onText(/\/trading_source_remove(?:\s+([1-9A-HJ-NP-Za-km-z]{32,44}))?/, async (msg, match) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)
      const wallet = match?.[1]

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      if (!wallet) {
        return this.bot.sendMessage(chatId, 'Usage: /trading_source_remove <wallet>')
      }

      try {
        const response = await axios.post(`${this.tradingBotUrl}/trading/source-wallets`, { action: 'remove', wallet })
        this.bot.sendMessage(chatId, `✅ ${response.data?.message || 'Source wallet removed'}`)
      } catch (error) {
        console.error('Trading source remove error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to remove source wallet')
      }
    })

    this.bot.onText(
      /\/trading_source_cap(?:\s+([1-9A-HJ-NP-Za-km-z]{32,44}))?(?:\s+(\d+(?:\.\d+)?))?/,
      async (msg, match) => {
        const chatId = msg.chat.id
        const userId = String(msg.from?.id)
        const wallet = match?.[1]
        const cap = match?.[2] ? Number(match[2]) : NaN

        if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
          return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
        }

        if (!wallet || !Number.isFinite(cap) || cap <= 0) {
          return this.bot.sendMessage(chatId, 'Usage: /trading_source_cap <wallet> <sol>')
        }

        try {
          const response = await axios.post(`${this.tradingBotUrl}/trading/source-wallets`, {
            action: 'cap',
            wallet,
            max_position_size_sol: cap,
          })
          this.bot.sendMessage(chatId, `✅ ${response.data?.message || 'Source wallet cap updated'}`)
        } catch (error) {
          console.error('Trading source cap error:', error)
          this.bot.sendMessage(chatId, '❌ Failed to set source wallet cap')
        }
      },
    )

    this.bot.onText(/\/trading_source_uncap(?:\s+([1-9A-HJ-NP-Za-km-z]{32,44}))?/, async (msg, match) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)
      const wallet = match?.[1]

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      if (!wallet) {
        return this.bot.sendMessage(chatId, 'Usage: /trading_source_uncap <wallet>')
      }

      try {
        const response = await axios.post(`${this.tradingBotUrl}/trading/source-wallets`, { action: 'uncap', wallet })
        this.bot.sendMessage(chatId, `✅ ${response.data?.message || 'Source wallet cap removed'}`)
      } catch (error) {
        console.error('Trading source uncap error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to remove source wallet cap')
      }
    })

    this.bot.onText(
      /\/trading_source_profile(?:\s+([1-9A-HJ-NP-Za-km-z]{32,44}))?(?:\s+(shadow|scalp|swing|defensive|blocked))?(?:\s+(.+))?/i,
      async (msg, match) => {
        const chatId = msg.chat.id
        const userId = String(msg.from?.id)
        const wallet = match?.[1]
        const preset = match?.[2]?.toLowerCase()
        const notes = match?.[3]?.trim()

        if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
          return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
        }

        if (!wallet || !preset) {
          return this.bot.sendMessage(
            chatId,
            'Usage: /trading_source_profile <wallet> <shadow|scalp|swing|defensive|blocked> [notes]',
          )
        }

        try {
          const response = await axios.post(`${this.tradingBotUrl}/trading/source-wallets`, {
            action: 'profile',
            wallet,
            preset,
            notes,
          })
          this.bot.sendMessage(chatId, `✅ ${response.data?.message || 'Source wallet profile updated'}`)
        } catch (error) {
          console.error('Trading source profile error:', error)
          this.bot.sendMessage(chatId, '❌ Failed to update source wallet profile')
        }
      },
    )

    this.bot.onText(/\/trading_alert_quality(?:\s+(\d+(?:\.\d+)?))?(?:\s+(\d+))?/, async (msg, match) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)
      const minScore = match?.[1] ? Number(match[1]) : undefined
      const minTraceAlerts = match?.[2] ? Number(match[2]) : undefined

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      try {
        if (minScore === undefined && minTraceAlerts === undefined) {
          const response = await axios.get(`${this.tradingBotUrl}/trading/alert-quality`)
          return this.bot.sendMessage(
            chatId,
            [
              '🎚️ <b>Alert Quality Controls</b>',
              `Min alert quality score: <b>${response.data?.minAlertQualityScore ?? 0}</b>`,
              `Min trace alerts: <b>${response.data?.minTraceAlerts ?? 0}</b>`,
              '',
              'Usage: /trading_alert_quality <min_score_0_100> <min_trace_alerts>',
            ].join('\n'),
            { parse_mode: 'HTML' },
          )
        }

        const payload: Record<string, number> = {}
        if (minScore !== undefined && Number.isFinite(minScore)) {
          payload.min_alert_quality_score = minScore
        }
        if (minTraceAlerts !== undefined && Number.isFinite(minTraceAlerts)) {
          payload.min_trace_alerts = minTraceAlerts
        }

        const response = await axios.post(`${this.tradingBotUrl}/trading/alert-quality`, payload)
        this.bot.sendMessage(chatId, `✅ ${response.data?.message || 'Alert quality updated'}`)
      } catch (error) {
        console.error('Trading alert quality error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to manage alert quality controls')
      }
    })

    this.bot.onText(/\/trading_metrics/, async (msg) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      try {
        const response = await axios.get(`${this.tradingBotUrl}/trading/metrics`)
        const metrics = response.data?.metrics || {}

        await this.bot.sendMessage(
          chatId,
          [
            '📉 <b>Trading Ops Metrics</b>',
            `Execution mode: <b>${response.data?.executionMode || 'paper'}</b>`,
            `Received: <b>${metrics.receivedTotal ?? 0}</b> | Accepted: <b>${metrics.acceptedTotal ?? 0}</b>`,
            `Executed: <b>${metrics.executedTotal ?? 0}</b> | Blocked: <b>${metrics.blockedTotal ?? 0}</b>`,
            `Failed: <b>${metrics.failedTotal ?? 0}</b> | Rejected: <b>${metrics.rejectedTotal ?? 0}</b>`,
            `Duplicate: <b>${metrics.duplicateTotal ?? 0}</b> | Retried: <b>${metrics.retriedTotal ?? 0}</b>`,
            `Dead letters: <b>${response.data?.deadLetterCount ?? metrics.deadLetterTotal ?? 0}</b>`,
          ].join('\n'),
          { parse_mode: 'HTML' },
        )
      } catch (error) {
        console.error('Trading metrics error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to fetch trading metrics')
      }
    })

    this.bot.onText(/\/trading_journal/, async (msg) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      try {
        const response = await axios.get(`${this.tradingBotUrl}/trading/journal`)
        const entries = Array.isArray(response.data?.entries) ? response.data.entries : []

        if (entries.length === 0) {
          return this.bot.sendMessage(chatId, '📒 No trade journal entries yet.')
        }

        const lines = ['📒 <b>Trade Journal</b>', '']
        for (const entry of entries.slice(0, 10)) {
          lines.push(
            `• <b>${entry.status || 'unknown'}</b> ${entry.action || 'n/a'} ${entry.amountSol ?? 0} SOL ${entry.tokenMint || 'n/a'}`,
          )
          lines.push(
            `  source: ${entry.sourceWallet || 'n/a'}${entry.profilePreset ? ` | profile: ${entry.profilePreset}` : ''}`,
          )
          lines.push(`  reason: ${String(entry.reason || '').slice(0, 120)}`)
          lines.push('')
        }

        this.bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML' })
      } catch (error) {
        console.error('Trading journal error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to fetch trade journal')
      }
    })

    this.bot.onText(/\/trading_failures/, async (msg) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      try {
        const response = await axios.get(`${this.tradingBotUrl}/trading/dead-letters`)
        const entries = Array.isArray(response.data?.entries) ? response.data.entries : []

        if (entries.length === 0) {
          return this.bot.sendMessage(chatId, '🚨 No failed signals queued.')
        }

        const lines = ['🚨 <b>Failed Signal Queue</b>', '']
        for (const entry of entries.slice(0, 10)) {
          lines.push(
            `• <b>${entry.status || 'failed'}</b> ${entry.signalType || 'unknown'} | token ${entry.tokenMint || 'n/a'}`,
          )
          lines.push(`  id: <code>${entry.signalId || 'unknown'}</code> | retries: ${entry.retryCount ?? 0}`)
          lines.push(`  source: ${entry.sourceWallet || 'n/a'}`)
          lines.push(`  reason: ${String(entry.reason || '').slice(0, 120)}`)
          lines.push('')
        }
        lines.push('Retry with: /trading_retry_failed <signal_id> or /trading_retry_failed all')

        this.bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML' })
      } catch (error) {
        console.error('Trading failures error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to fetch failed-signal queue')
      }
    })

    this.bot.onText(/\/trading_retry_failed(?:\s+([a-zA-Z0-9-]+))?/, async (msg, match) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)
      const signalId = match?.[1]

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      try {
        const payload = signalId && signalId.toLowerCase() !== 'all' ? { signal_id: signalId, limit: 1 } : { limit: 10 }
        const response = await axios.post(`${this.tradingBotUrl}/trading/retry-failed`, payload)
        const retried = Array.isArray(response.data?.retried) ? response.data.retried : []
        const lines = [response.data?.message || 'Retry request submitted.']
        for (const item of retried.slice(0, 10)) {
          lines.push(
            `• <code>${item.signalId || 'unknown'}</code> -> ${item.status || 'unknown'} ${item.reason ? `| ${String(item.reason).slice(0, 80)}` : ''}`,
          )
        }
        this.bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML' })
      } catch (error) {
        console.error('Trading retry failed error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to retry queued signals')
      }
    })

    this.bot.onText(/\/trading_dashboard/, async (msg) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      const appUrl = this.resolveAppUrl()
      this.bot.sendMessage(
        chatId,
        [
          '🌐 <b>Trading Ops Links</b>',
          `${appUrl}/dashboard/trading-ops`,
          `${appUrl}/api/trading-ops`,
          `${appUrl}/api/trading-ops/export?format=json`,
          `${appUrl}/api/trading-ops/export?format=csv`,
        ].join('\n'),
        { parse_mode: 'HTML' },
      )
    })

    // Phase 3: Audit logs and gate metrics
    this.bot.onText(/\/trading_audit_logs/, async (msg) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      try {
        const response = await axios.get(`${this.tradingBotUrl}/trading/audit-logs`, {
          timeout: TradingCommand.REQUEST_TIMEOUT_MS,
        })
        const { entries, summary, total_entries } = response.data

        const summaryLines = Object.entries(summary)
          .map(([event_type, count]: [string, any]) => `• <b>${event_type}</b>: ${count}`)
          .join('\n')

        const recentEntries = entries
          .slice(0, 10)
          .map(
            (entry: any) =>
              `<b>${entry.event_type}</b> [${entry.gate_name || 'n/a'}]\n` +
              `  Signal: ${entry.signal_id.substring(0, 8)}...\n` +
              `  Reason: ${entry.reason}`,
          )
          .join('\n\n')

        const message = `
📋 <b>Phase 3 Audit Logs</b>

<b>Event Summary:</b>
${summaryLines}

<b>Total Entries:</b> ${total_entries}

<b>Recent Events:</b>
${recentEntries}
        `.trim()

        this.bot.sendMessage(chatId, message, { parse_mode: 'HTML' })
      } catch (error) {
        console.error('Audit logs error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to retrieve audit logs')
      }
    })

    // Phase 3: Gate metrics
    this.bot.onText(/\/trading_gate_metrics/, async (msg) => {
      const chatId = msg.chat.id
      const userId = String(msg.from?.id)

      if (!userId || !BotMiddleware.isUserBotAdmin(userId)) {
        return this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      }

      try {
        const response = await axios.get(`${this.tradingBotUrl}/trading/metrics`, {
          timeout: TradingCommand.REQUEST_TIMEOUT_MS,
        })
        const metrics = response.data?.metrics || {}
        const receivedTotal = Number(metrics.receivedTotal || 0)
        const acceptedTotal = Number(metrics.acceptedTotal || 0)

        const gateMetrics = [
          ['risk_score_exceeded', metrics.gateRiskScoreExceeded || 0],
          ['alert_quality_low', metrics.gateAlertQualityLow || 0],
          ['trace_alerts_low', metrics.gateTraceAlertsLow || 0],
          ['token_denylist', metrics.gateTokenDenylist || 0],
          ['token_not_allowlisted', metrics.gateTokenNotAllowlisted || 0],
          ['source_wallet_profile_blocked', metrics.gateSourceWalletProfileBlocked || 0],
          ['source_wallet_action_blocked', metrics.gateSourceWalletActionBlocked || 0],
          ['source_wallet_profile_cap_exceeded', metrics.gateSourceWalletProfileCapExceeded || 0],
          ['source_wallet_cap_exceeded', metrics.gateSourceWalletCapExceeded || 0],
          ['max_concurrent_positions', metrics.gateMaxConcurrentPositions || 0],
        ]

        const gateLines = gateMetrics
          .filter(([_, count]) => count > 0)
          .map(([gate, count]) => `🚫 <b>${gate}</b>: ${count} rejections`)
          .join('\n')

        const message = `
🔐 <b>Phase 3 Gate Metrics</b>

<b>Gate Rejections:</b>
${gateLines || 'No gate rejections'}

<b>Overall Stats:</b>
✅ Accepted: ${metrics.acceptedTotal || 0}
🎯 Executed: ${metrics.executedTotal || 0}
🚨 Blocked: ${metrics.blockedTotal || 0}
❌ Failed: ${metrics.failedTotal || 0}
⚠️ Rejected: ${metrics.rejectedTotal || 0}
🔄 Duplicates: ${metrics.duplicateTotal || 0}

<b>Receiver Health:</b>
📩 Total Received: ${receivedTotal}
📊 Acceptance Rate: ${receivedTotal > 0 ? ((acceptedTotal / receivedTotal) * 100).toFixed(1) : 0}%
        `.trim()

        this.bot.sendMessage(chatId, message, { parse_mode: 'HTML' })
      } catch (error) {
        console.error('Gate metrics error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to retrieve gate metrics')
      }
    })
  }
}
