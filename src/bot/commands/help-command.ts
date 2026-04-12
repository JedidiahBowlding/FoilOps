import TelegramBot from 'node-telegram-bot-api'
import { HelpMessages } from '../messages/help-messages'
import { CommandsDirectory } from '../messages/commands-directory'
import { SUB_MENU } from '../../config/bot-menus'

export class HelpCommand {
  constructor(private bot: TelegramBot) {
    this.bot = bot
    this.setupHelpCommands()
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

  private async sendCommandDirectory(chatId: number, firstChunkAsEdit?: { messageId: number }) {
    const chunks = this.buildDirectoryChunks()

    if (chunks.length === 0) {
      return
    }

    if (firstChunkAsEdit) {
      await this.bot.editMessageText(chunks[0], {
        chat_id: chatId,
        message_id: firstChunkAsEdit.messageId,
        parse_mode: 'HTML',
        reply_markup: SUB_MENU,
      })

      for (let i = 1; i < chunks.length; i += 1) {
        await this.bot.sendMessage(chatId, chunks[i], {
          parse_mode: 'HTML',
        })
      }
      return
    }

    for (let i = 0; i < chunks.length; i += 1) {
      await this.bot.sendMessage(chatId, chunks[i], {
        parse_mode: 'HTML',
      })
    }
  }

  private setupHelpCommands() {
    // Main /help command - shows full command directory
    this.bot.onText(/^\/help(?:@\w+)?$/i, async (msg) => {
      await this.sendCommandDirectory(msg.chat.id)
    })
  }

  public helpButtonHandler(message: TelegramBot.Message) {
    void this.sendCommandDirectory(message.chat.id, { messageId: message.message_id })
  }

  public groupHelpCommandHandler() {
    this.bot.onText(/\/help_group/, async (msg) => {
      this.bot.sendMessage(msg.chat.id, HelpMessages.groupsHelp, {
        parse_mode: 'HTML',
        reply_markup: SUB_MENU,
      })
    })
  }

  public notifyHelpCommandHander() {
    this.bot.onText(/\/help_notify/, async (msg) => {
      this.bot.sendMessage(msg.chat.id, HelpMessages.notifyHelp, {
        parse_mode: 'HTML',
        reply_markup: SUB_MENU,
      })
    })
  }
}
