import express from 'express'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { requireTelegramWebhookSecret } from '../src/lib/telegram-webhook-auth'

const originalEnvironment = process.env.ENVIRONMENT
const originalSecret = process.env.TELEGRAM_WEBHOOK_SECRET

afterEach(() => {
  process.env.ENVIRONMENT = originalEnvironment
  process.env.TELEGRAM_WEBHOOK_SECRET = originalSecret
})

function createApp() {
  const app = express()
  app.post('/webhook/telegram', requireTelegramWebhookSecret(), (_req, res) => res.sendStatus(200))
  return app
}

describe('Telegram webhook authentication', () => {
  it('accepts the configured Telegram secret header', async () => {
    process.env.ENVIRONMENT = 'production'
    process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret'

    const response = await request(createApp())
      .post('/webhook/telegram')
      .set('X-Telegram-Bot-Api-Secret-Token', 'test-webhook-secret')

    expect(response.status).toBe(200)
  })

  it('rejects an invalid Telegram secret header', async () => {
    process.env.ENVIRONMENT = 'production'
    process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret'

    const response = await request(createApp())
      .post('/webhook/telegram')
      .set('X-Telegram-Bot-Api-Secret-Token', 'wrong-secret')

    expect(response.status).toBe(401)
  })

  it('fails closed when production has no configured secret', async () => {
    process.env.ENVIRONMENT = 'production'
    delete process.env.TELEGRAM_WEBHOOK_SECRET

    const response = await request(createApp()).post('/webhook/telegram')

    expect(response.status).toBe(503)
  })
})
