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

      let responseText

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
          // This will be handled by the trading command
          this.bot.sendMessage(chatId, 'Send: <code>/trading_status</code>', { parse_mode: 'HTML' })
          break
        case 'trading_balance':
          this.bot.sendMessage(chatId, 'Send: <code>/trading_balance</code>', { parse_mode: 'HTML' })
          break
        case 'trading_trades':
          this.bot.sendMessage(chatId, 'Send: <code>/trading_trades</code>', { parse_mode: 'HTML' })
          break
        case 'trading_enable':
          this.bot.sendMessage(chatId, 'Send: <code>/trading_enable</code>', { parse_mode: 'HTML' })
          break
        case 'trading_disable':
          this.bot.sendMessage(chatId, 'Send: <code>/trading_disable</code>', { parse_mode: 'HTML' })
          break
        case 'trading_pause':
          this.bot.sendMessage(chatId, 'Send: <code>/trading_pause</code>', { parse_mode: 'HTML' })
          break
        case 'trading_resume':
          this.bot.sendMessage(chatId, 'Send: <code>/trading_resume</code>', { parse_mode: 'HTML' })
          break
        case 'trading_config':
          this.bot.sendMessage(chatId, 'Send: <code>/trading_slippage</code> or <code>/trading_target</code>', {
            parse_mode: 'HTML',
          })
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
