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

  private buildDirectoryChunks(): string[] {
    const full = CommandsDirectory.getFullCommandDirectory()
    const separator = '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n'
    const sections = full.split(separator)
    const chunks: string[] = []
    let current = ''

    for (let i = 0; i < sections.length; i += 1) {
      const part = i === 0 ? sections[i] : `${separator}${sections[i]}`
      if ((current + part).length > 3500) {
        if (current.length > 0) {
          chunks.push(current)
          current = part
        } else {
          chunks.push(part)
          current = ''
        }
      } else {
        current += part
      }
    }

    if (current.length > 0) {
      chunks.push(current)
    }

    return chunks
  }

  private async sendCommandDirectory(chatId: number) {
    const chunks = this.buildDirectoryChunks()
    for (const chunk of chunks) {
      await this.bot.sendMessage(chatId, chunk, {
        parse_mode: 'HTML',
      })
    }
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
        setTimeout(async () => {
          await this.sendCommandDirectory(chatId)
        }, 500)
      }

      // Create new user
      if (!user) {
        await this.prismaUserRepository.create({ firstName, id: userId, lastName, username })
      }
    })
  }
}
