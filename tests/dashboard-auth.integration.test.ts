import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DashboardAuth } from '../src/lib/dashboard-auth'

const originalEnv = {
  DASHBOARD_USERNAME: process.env.DASHBOARD_USERNAME,
  DASHBOARD_PASSWORD: process.env.DASHBOARD_PASSWORD,
  DASHBOARD_SESSION_SECRET: process.env.DASHBOARD_SESSION_SECRET,
  APP_URL: process.env.APP_URL,
  ENVIRONMENT: process.env.ENVIRONMENT,
}

describe('dashboard auth integration', () => {
  beforeEach(() => {
    process.env.DASHBOARD_USERNAME = 'owner'
    process.env.DASHBOARD_PASSWORD = 's3cret-pass'
    process.env.DASHBOARD_SESSION_SECRET = 'unit-test-secret'
    process.env.APP_URL = 'https://foilops.com'
    process.env.ENVIRONMENT = 'production'
  })

  afterEach(() => {
    process.env.DASHBOARD_USERNAME = originalEnv.DASHBOARD_USERNAME
    process.env.DASHBOARD_PASSWORD = originalEnv.DASHBOARD_PASSWORD
    process.env.DASHBOARD_SESSION_SECRET = originalEnv.DASHBOARD_SESSION_SECRET
    process.env.APP_URL = originalEnv.APP_URL
    process.env.ENVIRONMENT = originalEnv.ENVIRONMENT
  })

  it('redirects unauthenticated browser access to login and preserves the target path', async () => {
    const app = express()
    app.use(express.urlencoded({ extended: false }))

    const auth = new DashboardAuth()
    auth.registerRoutes(app)
    app.get('/dashboard/trading-ops', auth.requirePageAuth, (_req, res) => {
      res.status(200).send('ok')
    })

    const response = await request(app).get('/dashboard/trading-ops')

    expect(response.status).toBe(302)
    expect(response.headers.location).toBe('/login?next=%2Fdashboard%2Ftrading-ops')
  })

  it('authenticates valid credentials and allows follow-up access with the issued session cookie', async () => {
    const app = express()
    app.use(express.urlencoded({ extended: false }))

    const auth = new DashboardAuth()
    auth.registerRoutes(app)
    app.get('/dashboard/trading-ops', auth.requirePageAuth, (_req, res) => {
      res.status(200).send('protected dashboard')
    })
    app.get('/api/trading-ops', auth.requireApiAuth, (_req, res) => {
      res.status(200).json({ ok: true })
    })

    const loginResponse = await request(app)
      .post('/login')
      .type('form')
      .send({ username: 'owner', password: 's3cret-pass', next: '/dashboard/trading-ops' })

    expect(loginResponse.status).toBe(302)
    expect(loginResponse.headers.location).toBe('/dashboard/trading-ops')

    const setCookieHeader = loginResponse.headers['set-cookie']
    expect(Array.isArray(setCookieHeader)).toBe(true)
    expect(setCookieHeader[0]).toContain('foilops_dashboard_session=')

    const cookie = setCookieHeader[0].split(';')[0]
    const dashboardResponse = await request(app).get('/dashboard/trading-ops').set('Cookie', cookie)
    const apiResponse = await request(app).get('/api/trading-ops').set('Cookie', cookie)

    expect(dashboardResponse.status).toBe(200)
    expect(dashboardResponse.text).toBe('protected dashboard')
    expect(apiResponse.status).toBe(200)
    expect(apiResponse.body).toEqual({ ok: true })
  })
})
