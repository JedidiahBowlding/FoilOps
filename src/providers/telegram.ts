import TelegramBot from 'node-telegram-bot-api'
import dotenv from 'dotenv'
import { SecretRedaction } from '../lib/secret-redaction'

dotenv.config()

const BOT_TOKEN = process.env.BOT_TOKEN
const TEST_BOT_TOKEN = process.env.TEST_BOT_TOKEN
const APP_URL = process.env.APP_URL
const ENVIRONMENT = process.env.ENVIRONMENT as 'development' | 'production'

const WEBHOOK_URL = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${APP_URL}/webhook/telegram`
const REDACTED_WEBHOOK_URL = SecretRedaction.redactUrl(WEBHOOK_URL)

export const bot = (() => {
  if (ENVIRONMENT === 'production') {
    const instance = new TelegramBot(BOT_TOKEN ?? '')
    instance
      .setWebHook(WEBHOOK_URL)
      .then(() => {
        console.log(`Webhook configured successfully: ${REDACTED_WEBHOOK_URL}`)
      })
      .catch((error) => {
        console.error('Error setting webhook:', SecretRedaction.safeError(error))
      })

    return instance
  } else {
    return new TelegramBot(BOT_TOKEN ?? '', { polling: true })
  }
})()
