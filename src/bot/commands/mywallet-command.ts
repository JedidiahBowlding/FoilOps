import TelegramBot, { InlineKeyboardMarkup } from 'node-telegram-bot-api'
import axios from 'axios'
import { PrismaUserRepository } from '../../repositories/prisma/user'
import { SUB_MENU } from '../../config/bot-menus'
import { WalletMessages } from '../messages/wallet-messages'
import { PersonalTradingWalletSummary } from '../../types/prisma-types'
import { getTradingBotBaseUrl } from '../../lib/web-control-utils'

export class MyWalletCommand {
  private prismaUserRepository: PrismaUserRepository
  private walletMessages: WalletMessages
  private readonly tradingBotUrl: string

  constructor(private bot: TelegramBot) {
    this.prismaUserRepository = new PrismaUserRepository()
    this.walletMessages = new WalletMessages()
    this.tradingBotUrl = getTradingBotBaseUrl()

    this.bot = bot
  }

  public registerSlashHandler() {
    this.bot.onText(/^\/my_wallet(?:@\w+)?$/i, async (msg) => {
      await this.myWalletCommandHandler(msg, false)
    })

    this.bot.onText(/^\/new_wallet(?:@\w+)?$/i, async (msg) => {
      await this.createWalletHandler(msg, false)
    })

    this.bot.onText(/^\/wallets(?:@\w+)?$/i, async (msg) => {
      await this.myWalletCommandHandler(msg, false)
    })

    this.bot.onText(/^\/use_wallet(?:@\w+)?\s+(.+)$/i, async (msg, match) => {
      const selection = match?.[1]?.trim() || ''
      await this.useWalletSlashHandler(msg, selection)
    })

    this.bot.onText(/^\/activate_wallet(?:@\w+)?\s+(.+?)(?:\s+([0-9]*\.?[0-9]+))?$/i, async (msg, match) => {
      const selection = match?.[1]?.trim() || ''
      const parsedWeight = Number(match?.[2] || '')
      const weight = Number.isFinite(parsedWeight) ? parsedWeight : undefined
      await this.activateWalletSlashHandler(msg, selection, weight)
    })

    this.bot.onText(/^\/deactivate_wallet(?:@\w+)?\s+(.+)$/i, async (msg, match) => {
      const selection = match?.[1]?.trim() || ''
      await this.deactivateWalletSlashHandler(msg, selection)
    })

    this.bot.onText(/^\/wallet_weight(?:@\w+)?\s+(.+?)\s+([0-9]*\.?[0-9]+)$/i, async (msg, match) => {
      const selection = match?.[1]?.trim() || ''
      const parsedWeight = Number(match?.[2] || '')
      await this.setWalletWeightSlashHandler(msg, selection, parsedWeight)
    })
  }

  public async myWalletCommandHandler(msg: TelegramBot.Message, isButton = true) {
    const userId = msg.chat.id.toString()
    const userPersonalWallet = await this.prismaUserRepository.getPersonalWallet(userId)
    const wallets = await this.prismaUserRepository.listPersonalTradingWallets(userId)

    if (!userPersonalWallet || wallets.length === 0) {
      return
    }

    const messageText = await this.walletMessages.sendMyWalletMessage(userPersonalWallet, wallets)

    const payload = {
      reply_markup: this.buildWalletMenu(wallets),
      parse_mode: 'HTML' as const,
    }

    const sendMessage = isButton
      ? this.bot.editMessageText(messageText, {
          chat_id: msg.chat.id,
          message_id: msg.message_id,
          ...payload,
        })
      : this.bot.sendMessage(msg.chat.id, messageText, payload)

    return sendMessage
  }

  public async createWalletHandler(msg: TelegramBot.Message, isButton = true) {
    const userId = String(msg.chat.id)
    const createdWallet = await this.prismaUserRepository.createPersonalTradingWallet(userId)

    if (!createdWallet) {
      return
    }

    if (createdWallet.isActive) {
      await this.syncExecutionWallet(createdWallet.privateKey)
    }

    return this.myWalletCommandHandler(msg, isButton)
  }

  public async activateWalletHandler(msg: TelegramBot.Message, walletId: string) {
    const userId = String(msg.chat.id)
    const activatedWallet = await this.prismaUserRepository.setActivePersonalTradingWallet(userId, walletId)

    if (!activatedWallet) {
      return this.bot.editMessageText('Could not switch FoilOps wallet. The selected wallet was not found.', {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        reply_markup: SUB_MENU,
      })
    }

    await this.syncExecutionWallet(activatedWallet.privateKey)

    return this.myWalletCommandHandler(msg)
  }

  public async showPrivateKeyHandler(msg: TelegramBot.Message) {
    const allowPrivateKeyExport = process.env.ALLOW_PRIVATE_KEY_EXPORT === 'true'

    if (!allowPrivateKeyExport) {
      this.bot.editMessageText('Private key export is disabled for security in this environment.', {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        reply_markup: SUB_MENU,
      })
      return
    }

    const userId = String(msg.chat.id)

    const userPrivKey = await this.prismaUserRepository.showUserPrivateKey(userId)

    const messageText = `
Your private key (do not share with anyone!!!)

(Click to copy)
<code>${userPrivKey ? userPrivKey : ''}</code>
`

    this.bot.editMessageText(messageText, {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      reply_markup: SUB_MENU,
      parse_mode: 'HTML',
    })
  }

  private async useWalletSlashHandler(msg: TelegramBot.Message, selection: string) {
    const userId = String(msg.chat.id)
    const wallets = await this.prismaUserRepository.listPersonalTradingWallets(userId)
    if (wallets.length === 0) {
      return
    }

    const index = Number(selection)
    const selectedWallet = Number.isInteger(index)
      ? wallets[index - 1]
      : wallets.find((wallet) => wallet.id === selection || wallet.publicKey === selection)

    if (!selectedWallet) {
      return this.bot.sendMessage(
        msg.chat.id,
        'Unknown wallet selection. Use /wallets to list wallets, then /use_wallet <number>.',
        { parse_mode: 'HTML' },
      )
    }

    await this.prismaUserRepository.setActivePersonalTradingWallet(userId, selectedWallet.id)

    const activeWallet = await this.prismaUserRepository.getPersonalWallet(userId)
    if (activeWallet?.personalWalletPrivKey) {
      await this.syncExecutionWallet(activeWallet.personalWalletPrivKey)
    }

    return this.myWalletCommandHandler(msg, false)
  }

  private async activateWalletSlashHandler(msg: TelegramBot.Message, selection: string, weight?: number) {
    const userId = String(msg.chat.id)
    const wallets = await this.prismaUserRepository.listPersonalTradingWallets(userId)
    if (wallets.length === 0) {
      return
    }

    const selectedWallet = this.resolveWalletSelection(wallets, selection)
    if (!selectedWallet) {
      return this.bot.sendMessage(
        msg.chat.id,
        'Unknown wallet selection. Use /wallets to list wallets, then /activate_wallet <number> [weight].',
        { parse_mode: 'HTML' },
      )
    }

    try {
      await this.prismaUserRepository.enablePersonalTradingWalletExecution(userId, selectedWallet.id, weight)
      return this.myWalletCommandHandler(msg, false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR'
      if (message.startsWith('MAX_ACTIVE_WALLETS_REACHED:')) {
        const max = message.split(':')[1] || '3'
        return this.bot.sendMessage(msg.chat.id, `Cannot activate more wallets. Max active wallets is ${max}.`, {
          parse_mode: 'HTML',
        })
      }

      return this.bot.sendMessage(msg.chat.id, 'Could not activate wallet for execution.', {
        parse_mode: 'HTML',
      })
    }
  }

  private async deactivateWalletSlashHandler(msg: TelegramBot.Message, selection: string) {
    const userId = String(msg.chat.id)
    const wallets = await this.prismaUserRepository.listPersonalTradingWallets(userId)
    if (wallets.length === 0) {
      return
    }

    const selectedWallet = this.resolveWalletSelection(wallets, selection)
    if (!selectedWallet) {
      return this.bot.sendMessage(
        msg.chat.id,
        'Unknown wallet selection. Use /wallets to list wallets, then /deactivate_wallet <number>.',
        { parse_mode: 'HTML' },
      )
    }

    try {
      await this.prismaUserRepository.disablePersonalTradingWalletExecution(userId, selectedWallet.id)
      return this.myWalletCommandHandler(msg, false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR'
      if (message === 'CANNOT_DISABLE_LAST_ACTIVE_WALLET') {
        return this.bot.sendMessage(msg.chat.id, 'At least one execution wallet must stay active.', {
          parse_mode: 'HTML',
        })
      }

      return this.bot.sendMessage(msg.chat.id, 'Could not deactivate wallet.', {
        parse_mode: 'HTML',
      })
    }
  }

  private async setWalletWeightSlashHandler(msg: TelegramBot.Message, selection: string, weight: number) {
    if (!Number.isFinite(weight) || weight <= 0) {
      return this.bot.sendMessage(msg.chat.id, 'Weight must be a positive number.', {
        parse_mode: 'HTML',
      })
    }

    const userId = String(msg.chat.id)
    const wallets = await this.prismaUserRepository.listPersonalTradingWallets(userId)
    if (wallets.length === 0) {
      return
    }

    const selectedWallet = this.resolveWalletSelection(wallets, selection)
    if (!selectedWallet) {
      return this.bot.sendMessage(
        msg.chat.id,
        'Unknown wallet selection. Use /wallets to list wallets, then /wallet_weight <number> <weight>.',
        { parse_mode: 'HTML' },
      )
    }

    await this.prismaUserRepository.updatePersonalTradingWalletAllocationWeight(userId, selectedWallet.id, weight)
    return this.myWalletCommandHandler(msg, false)
  }

  private async syncExecutionWallet(privateKey: string) {
    try {
      await axios.post(`${this.tradingBotUrl}/trading/execution-wallet`, {
        private_key: privateKey,
      })
    } catch (error) {
      console.error('Failed to sync active FoilOps wallet with trading bot execution wallet', error)
    }
  }

  private resolveWalletSelection(wallets: PersonalTradingWalletSummary[], selection: string) {
    const index = Number(selection)
    if (Number.isInteger(index)) {
      return wallets[index - 1]
    }

    return wallets.find((wallet) => wallet.id === selection || wallet.publicKey === selection)
  }

  private buildWalletMenu(wallets: PersonalTradingWalletSummary[]): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [{ text: '➕ Create New Wallet', callback_data: 'personal_wallet_create' }],
        ...wallets.map((wallet, index) => [
          {
            text: `${wallet.isActive ? '✅' : '👛'} ${index + 1}. ${wallet.name}`,
            callback_data: `personal_wallet_activate:${wallet.id}`,
          },
        ]),
        [{ text: '🔑 Show Active Private Key', callback_data: 'show_private_key' }],
        [{ text: '🔙 Back', callback_data: 'back_to_main_menu' }],
      ],
    }
  }
}
