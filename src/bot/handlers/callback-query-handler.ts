import TelegramBot, { InlineKeyboardMarkup } from 'node-telegram-bot-api'
import { AddCommand } from '../commands/add-command'
import { START_MENU, SUB_MENU, SCAM_INTEL_MENU, TRADING_MENU } from '../../config/bot-menus'
import { ManageCommand } from '../commands/manage-command'
import { DeleteCommand } from '../commands/delete-command'
import {
  adminExpectingBannedWallet,
  userExpectingDonation,
  userExpectingGroupId,
  userExpectingWalletAddress,
} from '../../constants/flags'
import { MyWalletCommand } from '../commands/mywallet-command'
import { GeneralMessages } from '../messages/general-messages'
import { UpgradePlanCommand } from '../commands/upgrade-plan-command'
import { UpgradePlanHandler } from './upgrade-plan-handler'
import { DonateCommand } from '../commands/donate-command'
import { DonateHandler } from './donate-handler'
import { SettingsCommand } from '../commands/settings-command'
import { UpdateBotStatusHandler } from './update-bot-status-handler'
import { PromotionHandler } from './promotion-handler'
import { GET_50_WALLETS_PROMOTION } from '../../constants/promotions'
import { PrismaUserRepository } from '../../repositories/prisma/user'
import { GroupsCommand } from '../commands/groups-command'
import { HelpCommand } from '../commands/help-command'
import { BotMiddleware } from '../../config/bot-middleware'
import { PrismaScamWalletRepository } from '../../repositories/prisma/scam-wallet'
import { WalletClusterService } from '../../lib/wallet-cluster'
import { AiAnalyzer } from '../../lib/ai-analyzer'
import axios from 'axios'
import { PrismaWalletRepository } from '../../repositories/prisma/wallet'
import { TrackWallets } from '../../lib/track-wallets'
import { getTradingBotBaseUrl } from '../../lib/web-control-utils'

export class CallbackQueryHandler {
  private addCommand: AddCommand
  private manageCommand: ManageCommand
  private deleteCommand: DeleteCommand
  private myWalletCommand: MyWalletCommand
  private upgradePlanCommand: UpgradePlanCommand
  private donateCommand: DonateCommand
  private settingsCommand: SettingsCommand
  private groupsCommand: GroupsCommand
  private helpCommand: HelpCommand

  private updateBotStatusHandler: UpdateBotStatusHandler

  private prismaUserRepository: PrismaUserRepository
  private scamWalletRepository: PrismaScamWalletRepository
  private walletClusterService: WalletClusterService
  private aiAnalyzer: AiAnalyzer
  private prismaWalletRepository: PrismaWalletRepository
  private trackWallets: TrackWallets

  private upgradePlanHandler: UpgradePlanHandler
  private donateHandler: DonateHandler
  private promotionHandler: PromotionHandler
  constructor(private bot: TelegramBot) {
    this.bot = bot

    this.addCommand = new AddCommand(this.bot)
    this.manageCommand = new ManageCommand(this.bot)
    this.deleteCommand = new DeleteCommand(this.bot)
    this.myWalletCommand = new MyWalletCommand(this.bot)
    this.upgradePlanCommand = new UpgradePlanCommand(this.bot)
    this.donateCommand = new DonateCommand(this.bot)
    this.settingsCommand = new SettingsCommand(this.bot)
    this.groupsCommand = new GroupsCommand(this.bot)
    this.helpCommand = new HelpCommand(this.bot)

    this.updateBotStatusHandler = new UpdateBotStatusHandler(this.bot)

    this.prismaUserRepository = new PrismaUserRepository()
    this.scamWalletRepository = new PrismaScamWalletRepository()
    this.walletClusterService = new WalletClusterService()
    this.aiAnalyzer = new AiAnalyzer()

    this.upgradePlanHandler = new UpgradePlanHandler(this.bot)
    this.donateHandler = new DonateHandler(this.bot)
    this.promotionHandler = new PromotionHandler(this.bot)
    this.prismaWalletRepository = new PrismaWalletRepository()
    this.trackWallets = new TrackWallets()

    this.myWalletCommand.registerSlashHandler()
    this.donateCommand.registerSlashHandler()
    this.settingsCommand.registerSlashHandler()
    this.groupsCommand.groupsSlashCommandHandler()
  }

  public call() {
    this.bot.on('callback_query', async (callbackQuery) => {
      const message = callbackQuery.message
      const chatId = message?.chat.id
      const data = callbackQuery.data

      const userId = message?.chat.id.toString()

      if (!chatId || !userId) {
        return
      }

      await this.acknowledgeCallbackQuery(callbackQuery.id, data)

      let responseText

      // Track wallet from investigation
      if (data?.startsWith('tw:')) {
        if (!BotMiddleware.isUserBotAdmin(userId)) return
        const addr = data.slice(3).trim()
        if (!addr) return
        try {
          const existing = await this.prismaWalletRepository.getUserWalletById(userId, addr)
          if (existing) {
            await this.bot.sendMessage(chatId, `\u{1F640} Already tracking <code>${addr}</code>`, {
              parse_mode: 'HTML',
              reply_markup: SUB_MENU,
            })
            return
          }
          const created = await this.prismaWalletRepository.create(userId, addr, 'Main wallet from investigation')
          if (created?.id) {
            await this.trackWallets.setupWalletWatcher({ event: 'create', walletId: created.id })
          }
          await this.bot.sendMessage(chatId, `\u2705 Now tracking <code>${addr}</code>`, {
            parse_mode: 'HTML',
            reply_markup: SUB_MENU,
          })
        } catch (err) {
          console.error('CALLBACK_TW_ERROR', err)
          await this.bot.sendMessage(chatId, '\u274C Failed to add wallet. Try /add manually.', {
            reply_markup: SUB_MENU,
          })
        }
        return
      }

      // Add wallet as copy-trade source
      if (data?.startsWith('ct:')) {
        if (!BotMiddleware.isUserBotAdmin(userId)) return
        const addr = data.slice(3).trim()
        if (!addr) return
        try {
          const tradingBotUrl = getTradingBotBaseUrl()
          await axios.post(
            `${tradingBotUrl}/trading/source-wallets`,
            { action: 'add', wallet: addr },
            { timeout: 8_000 },
          )
          await this.bot.sendMessage(
            chatId,
            `\u2705 <code>${addr}</code> added as copy-trade source.\\n\\nRun /trading_enable to start trading.`,
            { parse_mode: 'HTML', reply_markup: SUB_MENU },
          )
        } catch (err) {
          console.error('CALLBACK_CT_ERROR', err)
          await this.bot.sendMessage(
            chatId,
            `\u274C Could not reach trading bot. Use:\\n<code>/trading_source_add ${addr}</code>`,
            { parse_mode: 'HTML', reply_markup: SUB_MENU },
          )
        }
        return
      }

      // handle donations
      if (data?.startsWith('donate_action')) {
        const donationAmount = data.split('_')[2]
        console.log(`User wants to donate ${donationAmount} SOL`)
        await this.donateHandler.makeDonation(message, Number(donationAmount))
        return
      }

      if (data?.startsWith('ga:') || data?.startsWith('gn:') || data?.startsWith('gt:') || data?.startsWith('gw:')) {
        if (!BotMiddleware.isUserBotAdmin(userId)) return

        const wallet = data.slice(3).trim()
        if (!wallet) return

        if (data.startsWith('ga:')) {
          const analysis = await this.aiAnalyzer.analyzeWallet(wallet)
          await this.bot.sendMessage(chatId, `<pre>${analysis}</pre>`, {
            parse_mode: 'HTML',
            reply_markup: SUB_MENU,
          })
          return
        }

        const graphData = await this.getGraphData(wallet)

        if (data.startsWith('gn:')) {
          const neighbors = graphData.edges.filter((edge) => edge.from === wallet || edge.to === wallet).slice(0, 12)
          if (neighbors.length === 0) {
            await this.bot.sendMessage(chatId, 'No graph neighbors found yet for this wallet.', {
              reply_markup: SUB_MENU,
            })
            return
          }

          const lines = ['🧭 <b>Graph Neighbors</b>', `Wallet: <code>${wallet}</code>`, '']
          for (const edge of neighbors) {
            const other = edge.from === wallet ? edge.to : edge.from
            lines.push(`• <code>${other}</code>`)
            lines.push(`  ${edge.label} | hop ${edge.hop}`)
            lines.push(`  <a href="https://solscan.io/tx/${edge.signature}">Tx</a>`)
          }

          await this.bot.sendMessage(chatId, lines.join('\n'), {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: SUB_MENU,
          })
          return
        }

        if (data.startsWith('gt:')) {
          const lines = ['🗺️ <b>Graph Trace</b>', `Wallet: <code>${wallet}</code>`, '']
          for (const edge of graphData.edges.slice(0, 20)) {
            lines.push(`• <code>${edge.from}</code> → <code>${edge.to}</code>`)
            lines.push(`  ${edge.label} | hop ${edge.hop}`)
          }
          await this.bot.sendMessage(chatId, lines.join('\n'), {
            parse_mode: 'HTML',
            reply_markup: SUB_MENU,
          })
          return
        }

        if (data.startsWith('gw:')) {
          const lines = [
            '🕸️ <b>Graph Wallet Summary</b>',
            `Wallet: <code>${wallet}</code>`,
            `Nodes: <b>${graphData.nodes.length}</b>`,
            `Edges: <b>${graphData.edges.length}</b>`,
            `Cluster score: <b>${graphData.cluster?.score ?? 'n/a'}</b>`,
            `Cluster risk: <b>${graphData.cluster?.riskScore ?? 'n/a'}</b>`,
          ]

          await this.bot.sendMessage(chatId, lines.join('\n'), {
            parse_mode: 'HTML',
            reply_markup: SUB_MENU,
          })
          return
        }
      }

      switch (data) {
        case 'add':
          this.addCommand.addButtonHandler(message)
          break
        case 'manage':
          await this.manageCommand.manageButtonHandler(message)
          break
        case 'delete':
          this.deleteCommand.deleteButtonHandler(message)
          break
        case 'settings':
          this.settingsCommand.settingsCommandHandler(message)
          break
        case 'pause-resume-bot':
          await this.updateBotStatusHandler.pauseResumeBot(message)
          break
        case 'upgrade':
          this.upgradePlanCommand.upgradePlanButtonHandler(message)
          break
        case 'upgrade_hobby':
          await this.upgradePlanHandler.upgradePlan(message, 'HOBBY')
          break
        case 'upgrade_pro':
          await this.upgradePlanHandler.upgradePlan(message, 'PRO')
          break
        case 'upgrade_whale':
          await this.upgradePlanHandler.upgradePlan(message, 'WHALE')
          break
        case 'donate':
          await this.donateCommand.donateCommandHandler(message)
          break
        case 'groups':
          await this.groupsCommand.groupsButtonHandler(message)
          break
        case 'delete_group':
          await this.groupsCommand.deleteGroupButtonHandler(message)
          break
        case 'help':
          this.helpCommand.helpButtonHandler(message)
          break
        case 'scam_intel':
          this.bot.editMessageText(
            [
              '🚨 <b>Scam Intelligence</b>',
              '',
              '🚩 <b>Flag Wallet</b> — reply with: <code>/flag_wallet &lt;address&gt; [reason]</code>',
              '🗺️ <b>Flow Map</b> — reply with: <code>/flow_map &lt;address&gt;</code>',
              '🔬 <b>Trace Token</b> — reply with: <code>/trace_token &lt;token_mint&gt;</code>',
              '📡 <b>Scam Feed</b> — reply with: <code>/scam_feed</code>',
              '',
              'Or use the buttons below to be prompted automatically.',
            ].join('\n'),
            {
              chat_id: chatId,
              message_id: message.message_id,
              parse_mode: 'HTML',
              reply_markup: SCAM_INTEL_MENU,
            },
          )
          break
        case 'scam_flag_prompt':
          this.bot.editMessageText(
            '🚩 <b>Flag a Wallet</b>\n\nSend the command:\n<code>/flag_wallet &lt;wallet_address&gt; [optional reason]</code>',
            { chat_id: chatId, message_id: message.message_id, parse_mode: 'HTML', reply_markup: SCAM_INTEL_MENU },
          )
          break
        case 'scam_flowmap_prompt':
          this.bot.editMessageText(
            '🗺️ <b>Flow Map</b>\n\nSend the command:\n<code>/flow_map &lt;wallet_address&gt;</code>',
            { chat_id: chatId, message_id: message.message_id, parse_mode: 'HTML', reply_markup: SCAM_INTEL_MENU },
          )
          break
        case 'scam_trace_prompt':
          this.bot.editMessageText(
            '🔬 <b>Trace Token</b>\n\nSend the command:\n<code>/trace_token &lt;token_mint_address&gt;</code>',
            { chat_id: chatId, message_id: message.message_id, parse_mode: 'HTML', reply_markup: SCAM_INTEL_MENU },
          )
          break
        case 'scam_feed':
          this.bot.editMessageText(
            '📡 <b>Scam Feed</b>\n\nSend the command:\n<code>/scam_feed [limit]</code>\n\nExample: <code>/scam_feed 10</code>',
            { chat_id: chatId, message_id: message.message_id, parse_mode: 'HTML', reply_markup: SCAM_INTEL_MENU },
          )
          break
        case 'track_dev':
          this.bot.sendMessage(
            chatId,
            'Use: <code>/trace_token &lt;token_mint&gt;</code> to track developer intelligence',
            {
              parse_mode: 'HTML',
            },
          )
          break
        case 'view_flow':
          this.bot.sendMessage(chatId, 'Use: <code>/flow_map &lt;wallet_address&gt;</code> to inspect fund flows', {
            parse_mode: 'HTML',
          })
          break
        case 'view_cluster':
          this.bot.sendMessage(chatId, 'Use: <code>/cluster &lt;wallet_address&gt;</code> to inspect linked clusters', {
            parse_mode: 'HTML',
          })
          break
        case 'trading':
          this.bot.editMessageText(
            [
              '📈 <b>Trading Bot Control</b>',
              '',
              '📊 <b>Status</b> — Check bot status and configuration',
              '💰 <b>Balance</b> — View trading wallet balance',
              '📈 <b>Recent Trades</b> — View latest trading activity',
              '▶️ <b>Enable/Disable</b> — Control bot trading state',
              '⏸️ <b>Pause/Resume</b> — Temporary trading control',
              '⚙️ <b>Config</b> — View and modify settings',
              '',
              'Use the buttons below or send commands directly.',
            ].join('\n'),
            {
              chat_id: chatId,
              message_id: message.message_id,
              parse_mode: 'HTML',
              reply_markup: TRADING_MENU,
            },
          )
          break
        case 'trading_status':
        case 'trading_balance':
        case 'trading_safety':
        case 'trading_decisions':
        case 'trading_trades':
        case 'trading_enable':
        case 'trading_disable':
        case 'trading_pause':
        case 'trading_resume':
        case 'trading_tighten_risk':
        case 'trading_kill':
        case 'trading_sources':
        case 'trading_alert_quality':
        case 'trading_execution_mode':
        case 'trading_journal':
        case 'trading_metrics':
        case 'trading_failures':
        case 'trading_dashboard':
        case 'trading_audit_logs':
        case 'trading_gate_metrics':
        case 'trading_config':
          await this.handleTradingMenuAction(chatId, userId, data)
          break
        case 'my_wallet':
          this.myWalletCommand.myWalletCommandHandler(message)
          break
        case 'show_private_key':
          this.myWalletCommand.showPrivateKeyHandler(message)
          break
        case 'buy_promotion':
          this.promotionHandler.buyPromotion(message, GET_50_WALLETS_PROMOTION.price, GET_50_WALLETS_PROMOTION.type)
          break
        case 'back_to_main_menu':
          const user = await this.prismaUserRepository.getById(userId)
          const messageText = GeneralMessages.startMessage(user)

          // reset any flags
          userExpectingWalletAddress[chatId] = false
          userExpectingDonation[chatId] = false
          userExpectingGroupId[chatId] = false

          adminExpectingBannedWallet[chatId] = false

          this.bot.editMessageText(messageText, {
            chat_id: chatId,
            message_id: message.message_id,
            reply_markup: START_MENU,
            parse_mode: 'HTML',
          })
          break
        default:
          responseText = 'Unknown command.'
      }

      // this.bot.sendMessage(chatId, responseText);
    })
  }

  private resolveAppUrl(): string {
    return (process.env.APP_URL?.trim() || `http://127.0.0.1:${process.env.PORT || '3005'}`).replace(/\/$/, '')
  }

  private async acknowledgeCallbackQuery(callbackId: string, action?: string) {
    const text = this.getCallbackLoadingText(action)
    try {
      await this.bot.answerCallbackQuery(callbackId, {
        text,
        show_alert: false,
        cache_time: 1,
      })
    } catch (error) {
      // Ignore callback ack race/timeout issues so button actions can continue normally.
      console.error('CALLBACK_ACK_ERROR', { action, error })
    }
  }

  private getCallbackLoadingText(action?: string): string {
    if (!action) return 'Working...'
    if (action.startsWith('trading_')) return 'Processing trading action...'
    if (action.startsWith('scam_')) return 'Loading scam intelligence...'
    if (action.startsWith('donate_action')) return 'Processing donation...'
    if (action.startsWith('ga:') || action.startsWith('gn:') || action.startsWith('gt:') || action.startsWith('gw:')) {
      return 'Analyzing wallet graph...'
    }
    if (action.startsWith('tw:') || action.startsWith('ct:')) return 'Applying wallet action...'

    switch (action) {
      case 'add':
      case 'delete':
      case 'manage':
      case 'groups':
      case 'delete_group':
        return 'Updating menu...'
      case 'settings':
      case 'trading':
        return 'Opening controls...'
      case 'upgrade':
      case 'upgrade_hobby':
      case 'upgrade_pro':
      case 'upgrade_whale':
        return 'Loading upgrade options...'
      case 'back_to_main_menu':
        return 'Returning to main menu...'
      default:
        return 'Working...'
    }
  }

  private async handleTradingMenuAction(chatId: number, userId: string, action: string) {
    if (!BotMiddleware.isUserBotAdmin(userId)) {
      await this.bot.sendMessage(chatId, '❌ Access denied. Admin only command.')
      return
    }

    const base = getTradingBotBaseUrl()

    try {
      if (action === 'trading_status') {
        const { data } = await axios.get(`${base}/trading/status`)
        await this.bot.sendMessage(
          chatId,
          [
            '🤖 <b>Trading Bot Status</b>',
            `Status: <b>${data.enabled ? 'Enabled' : 'Disabled'}</b>`,
            `Paused: <b>${data.paused ? 'Yes' : 'No'}</b>`,
            `Mode: <b>${data.mode || 'n/a'}</b>`,
            `Execution: <b>${data.executionMode || 'paper'}</b>`,
            `Slippage: <b>${data.slippage ?? 'n/a'}%</b>`,
          ].join('\n'),
          { parse_mode: 'HTML' },
        )
        return
      }

      if (action === 'trading_balance') {
        const { data } = await axios.get(`${base}/trading/balance`)
        await this.bot.sendMessage(
          chatId,
          [
            '💰 <b>Trading Wallet Balance</b>',
            `SOL: <b>${Number(data.solBalance || 0).toFixed(4)}</b>`,
            `USDC: <b>$${Number(data.usdcBalance || 0).toFixed(2)}</b>`,
            `Tokens: <b>${data.tokenCount ?? 0}</b>`,
            `Total Value: <b>$${Number(data.totalValueUsd || 0).toFixed(2)}</b>`,
          ].join('\n'),
          { parse_mode: 'HTML' },
        )
        return
      }

      if (action === 'trading_safety') {
        const { data } = await axios.get(`${base}/trading/safety`)
        await this.bot.sendMessage(
          chatId,
          [
            '🛡️ <b>Trading Safety Summary</b>',
            `Execution mode: <b>${data.executionMode ?? 'paper'}</b>`,
            `Max risk score: <b>${data.maxRiskScore ?? 'n/a'}</b>`,
            `Min alert quality: <b>${data.minAlertQualityScore ?? 'n/a'}</b>`,
            `Min trace alerts: <b>${data.minTraceAlerts ?? 'n/a'}</b>`,
            `Buy amount: <b>${data.buyAmountSol ?? 'n/a'} SOL</b>`,
            `Slippage: <b>${data.slippage ?? 'n/a'}%</b>`,
          ].join('\n'),
          { parse_mode: 'HTML' },
        )
        return
      }

      if (action === 'trading_decisions') {
        const { data } = await axios.get(`${base}/trading/decisions`)
        const decisions = Array.isArray(data?.decisions) ? data.decisions : []
        if (decisions.length === 0) {
          await this.bot.sendMessage(chatId, 'No recent signal decisions yet.')
          return
        }
        const lines = ['🧠 <b>Recent Signal Decisions</b>', '']
        for (const d of decisions.slice(0, 10)) {
          lines.push(`• <b>${d.status || 'unknown'}</b> | ${d.signalType || 'unknown'} | risk ${d.riskScore ?? 'n/a'}`)
          lines.push(`  id: <code>${d.signalId || 'unknown'}</code>`)
        }
        await this.bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML' })
        return
      }

      if (action === 'trading_trades') {
        const { data } = await axios.get(`${base}/trading/trades`)
        const trades = Array.isArray(data) ? data : []
        if (trades.length === 0) {
          await this.bot.sendMessage(chatId, '📊 No recent trades found')
          return
        }
        const lines = ['📊 <b>Recent Trades</b>', '']
        for (const t of trades.slice(0, 5)) {
          lines.push(
            `• ${String(t.direction || '').toUpperCase()} ${t.amount} ${String(t.tokenMint || '').slice(0, 8)}... (${t.status})`,
          )
        }
        await this.bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML' })
        return
      }

      if (action === 'trading_enable') {
        const { data } = await axios.post(`${base}/trading/enable`, {})
        await this.bot.sendMessage(chatId, `✅ ${data?.message || 'Trading bot enabled'}`)
        return
      }

      if (action === 'trading_disable') {
        await axios.post(`${base}/trading/disable`, {})
        await this.bot.sendMessage(chatId, '⛔ Trading bot disabled')
        return
      }

      if (action === 'trading_pause') {
        await axios.post(`${base}/trading/pause`, {})
        await this.bot.sendMessage(chatId, '⏸️ Trading paused')
        return
      }

      if (action === 'trading_resume') {
        await axios.post(`${base}/trading/resume`, {})
        await this.bot.sendMessage(chatId, '▶️ Trading resumed')
        return
      }

      if (action === 'trading_tighten_risk') {
        const { data } = await axios.post(`${base}/trading/tighten-risk`, {})
        await this.bot.sendMessage(chatId, `✅ ${data?.message || 'Risk tightened'}`)
        return
      }

      if (action === 'trading_kill') {
        const { data } = await axios.post(`${base}/trading/kill-switch`, {})
        await this.bot.sendMessage(chatId, `🛑 ${data?.message || 'Kill switch activated'}`)
        return
      }

      if (action === 'trading_sources') {
        const { data } = await axios.get(`${base}/trading/source-wallets`)
        const watchlist = Array.isArray(data?.watchlist) ? data.watchlist : []
        const lines = ['👀 <b>Source Wallet Controls</b>', '', `Watchlist count: <b>${watchlist.length}</b>`]
        for (const wallet of watchlist.slice(0, 12)) {
          lines.push(`• <code>${wallet}</code>`)
        }
        await this.bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML' })
        return
      }

      if (action === 'trading_alert_quality') {
        const { data } = await axios.get(`${base}/trading/alert-quality`)
        await this.bot.sendMessage(
          chatId,
          [
            '🎚️ <b>Alert Quality Controls</b>',
            `Min alert quality score: <b>${data?.minAlertQualityScore ?? 0}</b>`,
            `Min trace alerts: <b>${data?.minTraceAlerts ?? 0}</b>`,
            '',
            'Use /trading_alert_quality <min_score_0_100> <min_trace_alerts> to update.',
          ].join('\n'),
          { parse_mode: 'HTML' },
        )
        return
      }

      if (action === 'trading_execution_mode') {
        const { data } = await axios.get(`${base}/trading/execution-mode`)
        await this.bot.sendMessage(chatId, `🧪 Execution mode: <b>${data?.mode || 'paper'}</b>`, {
          parse_mode: 'HTML',
        })
        return
      }

      if (action === 'trading_journal') {
        const { data } = await axios.get(`${base}/trading/journal`)
        const entries = Array.isArray(data?.entries) ? data.entries : []
        if (entries.length === 0) {
          await this.bot.sendMessage(chatId, '📒 No trade journal entries yet.')
          return
        }
        const lines = ['📒 <b>Trade Journal</b>', '']
        for (const e of entries.slice(0, 10)) {
          lines.push(
            `• <b>${e.status || 'unknown'}</b> ${e.action || 'n/a'} ${e.amountSol ?? 0} SOL ${e.tokenMint || 'n/a'}`,
          )
        }
        await this.bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML' })
        return
      }

      if (action === 'trading_metrics' || action === 'trading_gate_metrics') {
        const { data } = await axios.get(`${base}/trading/metrics`)
        const metrics = data?.metrics || {}
        const receivedTotal = Number(metrics.receivedTotal || 0)
        const acceptedTotal = Number(metrics.acceptedTotal || 0)

        if (action === 'trading_metrics') {
          await this.bot.sendMessage(
            chatId,
            [
              '📉 <b>Trading Ops Metrics</b>',
              `Execution mode: <b>${data?.executionMode || 'paper'}</b>`,
              `Received: <b>${metrics.receivedTotal ?? 0}</b> | Accepted: <b>${metrics.acceptedTotal ?? 0}</b>`,
              `Executed: <b>${metrics.executedTotal ?? 0}</b> | Blocked: <b>${metrics.blockedTotal ?? 0}</b>`,
              `Failed: <b>${metrics.failedTotal ?? 0}</b> | Rejected: <b>${metrics.rejectedTotal ?? 0}</b>`,
            ].join('\n'),
            { parse_mode: 'HTML' },
          )
          return
        }

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
          .filter(([_, count]) => Number(count) > 0)
          .map(([gate, count]) => `🚫 <b>${gate}</b>: ${count} rejections`)
          .join('\n')

        await this.bot.sendMessage(
          chatId,
          [
            '🔐 <b>Phase 3 Gate Metrics</b>',
            '',
            '<b>Gate Rejections:</b>',
            gateLines || 'No gate rejections',
            '',
            `<b>Acceptance Rate:</b> ${receivedTotal > 0 ? ((acceptedTotal / receivedTotal) * 100).toFixed(1) : 0}%`,
          ].join('\n'),
          { parse_mode: 'HTML' },
        )
        return
      }

      if (action === 'trading_failures') {
        const { data } = await axios.get(`${base}/trading/dead-letters`)
        const entries = Array.isArray(data?.entries) ? data.entries : []
        if (entries.length === 0) {
          await this.bot.sendMessage(chatId, '🚨 No failed signals queued.')
          return
        }
        const lines = ['🚨 <b>Failed Signal Queue</b>', '']
        for (const e of entries.slice(0, 10)) {
          lines.push(`• <b>${e.status || 'failed'}</b> ${e.signalType || 'unknown'} | token ${e.tokenMint || 'n/a'}`)
          lines.push(`  id: <code>${e.signalId || 'unknown'}</code> | retries: ${e.retryCount ?? 0}`)
        }
        lines.push('')
        lines.push('Retry with: /trading_retry_failed <signal_id> or /trading_retry_failed all')
        await this.bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML' })
        return
      }

      if (action === 'trading_dashboard') {
        const appUrl = this.resolveAppUrl()
        await this.bot.sendMessage(
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
        return
      }

      if (action === 'trading_audit_logs') {
        const { data } = await axios.get(`${base}/trading/audit-logs`, { timeout: 10_000 })
        const entries = Array.isArray(data?.entries) ? data.entries : []
        const summary = data?.summary || {}
        const summaryLines = Object.entries(summary)
          .map(([k, v]) => `• <b>${k}</b>: ${v}`)
          .join('\n')
        const entryLines = entries
          .slice(0, 10)
          .map(
            (e: any) =>
              `<b>${e.event_type}</b> [${e.gate_name || 'n/a'}]\n  Signal: ${String(e.signal_id || '').slice(0, 8)}...\n  Reason: ${e.reason}`,
          )
          .join('\n\n')
        await this.bot.sendMessage(
          chatId,
          [
            '📋 <b>Phase 3 Audit Logs</b>',
            '',
            '<b>Event Summary:</b>',
            summaryLines || 'No entries',
            '',
            entryLines || 'No recent events',
          ].join('\n'),
          { parse_mode: 'HTML' },
        )
        return
      }

      if (action === 'trading_config') {
        const [statusRes, configRes] = await Promise.all([
          axios.get(`${base}/trading/status`),
          axios.get(`${base}/trading/config`),
        ])
        const status = statusRes.data || {}
        const config = configRes.data || {}
        await this.bot.sendMessage(
          chatId,
          [
            '⚙️ <b>Trading Config</b>',
            `Mode: <b>${status.mode || config.mode || 'n/a'}</b>`,
            `Execution: <b>${status.executionMode || config.executionMode || 'paper'}</b>`,
            `Profile: <b>${config.profile || 'n/a'}</b>`,
            `Buy amount: <b>${config.buy_amount_sol ?? status.buyAmountSol ?? 'n/a'} SOL</b>`,
            `Slippage: <b>${status.slippage ?? config.slippage ?? 'n/a'}%</b>`,
            `Max risk score: <b>${config.max_risk_score ?? status.maxRiskScore ?? 'n/a'}</b>`,
            '',
            'Update with: /trading_profile, /trading_mode, /trading_size, /trading_slippage, /trading_target',
          ].join('\n'),
          { parse_mode: 'HTML' },
        )
      }
    } catch (error) {
      console.error('TRADING_MENU_ACTION_ERROR', { action, error })
      await this.bot.sendMessage(chatId, `❌ Failed to execute ${action}. Please try again.`)
    }
  }

  private async getGraphData(wallet: string) {
    const latestFlow = await this.scamWalletRepository.getLatestFlowTrace(wallet)
    const cluster = await this.walletClusterService.getLatestCluster(wallet)

    const flowMetadata = latestFlow?.metadata as
      | {
          steps?: Array<{ from: string; to: string; signature: string; amount: string; asset: string; hop: number }>
        }
      | undefined

    const steps = flowMetadata?.steps || []
    const nodeSet = new Set<string>([wallet])
    const edges = steps.map((step) => {
      nodeSet.add(step.from)
      nodeSet.add(step.to)
      return {
        from: step.from,
        to: step.to,
        label: `${step.amount} ${step.asset}`,
        signature: step.signature,
        hop: step.hop,
      }
    })

    const clusterWallets = Array.isArray(cluster?.wallets) ? cluster.wallets : []
    for (const clusterWallet of clusterWallets) {
      nodeSet.add(clusterWallet)
    }

    const nodes = Array.from(nodeSet).map((address) => ({
      id: address,
      label: address,
      inCluster: clusterWallets.includes(address),
    }))

    return {
      wallet,
      nodes,
      edges,
      cluster: cluster
        ? {
            score: cluster.clusterScore,
            riskScore: cluster.riskScore,
            wallets: cluster.wallets,
          }
        : null,
    }
  }
}
