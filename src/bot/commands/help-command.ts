import TelegramBot from 'node-telegram-bot-api'
import { HelpMessages } from '../messages/help-messages'
import { CommandsDirectory } from '../messages/commands-directory'
import { SUB_MENU } from '../../config/bot-menus'

export class HelpCommand {
  constructor(private bot: TelegramBot) {
    this.bot = bot
    this.setupHelpCommands()
  }

  private setupHelpCommands() {
    // Main /help command - shows full command directory
    this.bot.onText(/^\/help$/, async (msg) => {
      this.bot.sendMessage(msg.chat.id, CommandsDirectory.getFullCommandDirectory(), {
        parse_mode: 'HTML',
      })
    })
  }

  public helpButtonHandler(message: TelegramBot.Message) {
    this.bot.editMessageText(CommandsDirectory.getFullCommandDirectory(), {
      chat_id: message.chat.id,
      message_id: message.message_id,
      parse_mode: 'HTML',
      reply_markup: SUB_MENU,
    })
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
