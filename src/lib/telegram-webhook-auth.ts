import { timingSafeEqual } from 'crypto'
import type { RequestHandler } from 'express'

const TELEGRAM_SECRET_HEADER = 'x-telegram-bot-api-secret-token'

function matchesSecret(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received)
  const expectedBuffer = Buffer.from(expected)
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer)
}

export function requireTelegramWebhookSecret(): RequestHandler {
  return (req, res, next) => {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET?.trim()
    const production = process.env.ENVIRONMENT === 'production'

    if (!expected) {
      if (production) {
        res.status(503).json({ message: 'Telegram webhook secret is required in production' })
        return
      }

      next()
      return
    }

    const received = req.get(TELEGRAM_SECRET_HEADER) || ''
    if (!matchesSecret(received, expected)) {
      res.status(401).json({ message: 'Invalid Telegram webhook secret' })
      return
    }

    next()
  }
}
