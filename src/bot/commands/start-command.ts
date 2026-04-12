import TelegramBot from 'node-telegram-bot-api'
import { START_MENU } from '../../config/bot-menus'
import { PrismaUserRepository } from '../../repositories/prisma/user'
import { GeneralMessages } from '../messages/general-messages'
import { CommandsDirectory } from '../messages/commands-directory'
import { BotMiddleware } from '../../config/bot-middleware'

export class StartCommand {
  private prismaUserRepository: PrismaUserRepository

  constructor(private bot: TelegramBot) {
    this.bot = bot
    this.prismaUserRepository = new PrismaUserRepository()
  }

  public start() {
    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id
      const firstName = msg.from?.first_name || ''
      const lastName = msg.from?.last_name || ''
      const username = msg.from?.username || ''
      const userId = msg.chat?.id.toString()

      if (!userId) {
        return
      }

      // Find existing user
      const user = await this.prismaUserRepository.getById(userId)

      const messageText = GeneralMessages.startMessage(user)

      if (BotMiddleware.isGroup(chatId)) {
        this.bot.sendMessage(chatId, GeneralMessages.startMessageGroup, { parse_mode: 'HTML' })
      } else {
        // Send main welcome message with menu
        this.bot.sendMessage(chatId, messageText, { reply_markup: START_MENU, parse_mode: 'HTML' })

        // Send comprehensive command directory after a short delay
        setTimeout(() => {
          this.bot.sendMessage(chatId, CommandsDirectory.getFullCommandDirectory(), {
            parse_mode: 'HTML',
          })
        }, 500)
      }

      // Create new user
      if (!user) {
        await this.prismaUserRepository.create({ firstName, id: userId, lastName, username })
      }
    })
  }
}
