import TelegramBot from 'node-telegram-bot-api'
import { BotMiddleware } from '../../config/bot-middleware'
import axios from 'axios'

export class TradingCommand {
  private tradingBotUrl: string

  constructor(private bot: TelegramBot) {
    this.bot = bot
    this.tradingBotUrl = process.env.TRADING_BOT_URL || 'http://localhost:8787'
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
        console.error('Trading status error:', error)
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
        await axios.post(`${this.tradingBotUrl}/trading/enable`)
        this.bot.sendMessage(chatId, '✅ Trading bot enabled')
      } catch (error) {
        console.error('Trading enable error:', error)
        this.bot.sendMessage(chatId, '❌ Failed to enable trading')
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
  }
}
