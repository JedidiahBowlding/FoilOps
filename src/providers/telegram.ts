import TelegramBot from 'node-telegram-bot-api'
import dotenv from 'dotenv'
import { SecretRedaction } from '../lib/secret-redaction'
import { TELEGRAM_COMMANDS } from '../config/telegram-commands'

dotenv.config()

const BOT_TOKEN = process.env.BOT_TOKEN
const TEST_BOT_TOKEN = process.env.TEST_BOT_TOKEN
const APP_URL = process.env.APP_URL
const ENVIRONMENT = process.env.ENVIRONMENT as 'development' | 'production'
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET?.trim()

const WEBHOOK_TARGET_URL = APP_URL ? `${APP_URL}/webhook/telegram` : ''
const REDACTED_WEBHOOK_TARGET_URL = SecretRedaction.redactUrl(WEBHOOK_TARGET_URL)

export const bot = (() => {
  if (ENVIRONMENT === 'production') {
    const instance = new TelegramBot(BOT_TOKEN ?? '')
    if (!WEBHOOK_TARGET_URL) {
      console.error('APP_URL is required in production to configure Telegram webhook')
      return instance
    }

    instance
      .setWebHook(WEBHOOK_TARGET_URL, WEBHOOK_SECRET ? { secret_token: WEBHOOK_SECRET } : undefined)
      .then(() => {
        console.log(`Webhook configured successfully: ${REDACTED_WEBHOOK_TARGET_URL}`)
        return instance.setMyCommands(TELEGRAM_COMMANDS)
      })
      .then(() => {
        console.log('Telegram command menu configured successfully')
      })
      .catch((error) => {
        console.error('Error setting webhook:', SecretRedaction.safeError(error))
      })

    return instance
  } else {
    const instance = new TelegramBot(BOT_TOKEN ?? '', { polling: true })
    void instance.setMyCommands(TELEGRAM_COMMANDS)
    return instance
  }
})()
