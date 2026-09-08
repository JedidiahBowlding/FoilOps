import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { rateLimit, requireSameOrigin } from '../src/lib/http-security'

describe('HTTP security middleware', () => {
  it('rejects cross-site state-changing requests', async () => {
    const app = express()
    app.use(requireSameOrigin())
    app.post('/action', (_req, res) => res.sendStatus(204))
    await request(app).post('/action').set('Origin', 'https://evil.example').set('Host', 'foilops.com').expect(403)
    await request(app).post('/action').set('Origin', 'https://foilops.com').set('Host', 'foilops.com').expect(204)
  })

  it('limits repeated requests', async () => {
    const app = express()
    app.use(rateLimit({ windowMs: 60_000, max: 1, label: 'test' }))
    app.get('/', (_req, res) => res.sendStatus(204))
    await request(app).get('/').expect(204)
    await request(app).get('/').expect(429)
  })
})
