import { createHmac, timingSafeEqual } from 'crypto'
import type { Express, Request, RequestHandler, Response } from 'express'
import { renderFuturisticPage } from './site-theme'

type SessionPayload = {
  u: string
  exp: number
}

const SESSION_COOKIE_NAME = 'foilops_dashboard_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_LOCKOUT_MS = 30 * 60 * 1000
const DEFAULT_MAX_LOGIN_ATTEMPTS = 8

type LoginAttemptState = {
  attempts: number
  windowStartedAt: number
  lockedUntil?: number
}

export class DashboardAuth {
  private readonly username: string
  private readonly password?: string
  private readonly secret?: string
  private readonly secureCookies: boolean
  private readonly failClosedAuth: boolean
  private readonly maxLoginAttempts: number
  private readonly loginAttempts = new Map<string, LoginAttemptState>()

  constructor() {
    this.username = process.env.DASHBOARD_USERNAME?.trim() || 'admin'
    this.password = process.env.DASHBOARD_PASSWORD?.trim() || undefined
    this.secret = process.env.DASHBOARD_SESSION_SECRET?.trim() || this.password
    const appUrl = process.env.APP_URL?.trim() || ''
    this.secureCookies = appUrl.startsWith('https://') || process.env.ENVIRONMENT === 'production'
    this.failClosedAuth =
      process.env.REQUIRE_DASHBOARD_AUTH?.trim().toLowerCase() !== 'false' || process.env.ENVIRONMENT === 'production'
    this.maxLoginAttempts = Number(process.env.DASHBOARD_MAX_LOGIN_ATTEMPTS) || DEFAULT_MAX_LOGIN_ATTEMPTS
  }

  registerRoutes(app: Express): void {
    app.get('/login', (req, res) => {
      if (this.isAuthenticated(req)) {
        res.redirect(302, this.getSafeNextTarget(req) || '/dashboard/trading-ops')
        return
      }

      const showInvalidCredentials = req.query.error === 'invalid_credentials'
      const showAuthDisabled = !this.isEnabled()
      const nextTarget = this.getSafeNextTarget(req)

      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.status(showAuthDisabled ? 503 : 200).send(
        this.renderLoginPage({
          nextTarget,
          showInvalidCredentials,
          showAuthDisabled,
        }),
      )
    })

    app.post('/login', (req, res) => {
      if (!this.isEnabled()) {
        const message = this.failClosedAuth
          ? 'Dashboard auth is required but not configured. Set DASHBOARD_PASSWORD and DASHBOARD_SESSION_SECRET.'
          : 'Dashboard login is disabled until DASHBOARD_PASSWORD is configured.'
        res.status(503).send(message)
        return
      }

      const clientKey = this.getClientKey(req)
      if (this.isRateLimited(clientKey)) {
        res.status(429).send('Too many login attempts. Please wait before trying again.')
        return
      }

      const username = this.getFormValue(req.body?.username)
      const password = this.getFormValue(req.body?.password)
      const nextTarget = this.getSafeNextTarget(req, req.body?.next)

      if (!this.matchesCredential(username, this.username) || !this.matchesCredential(password, this.password)) {
        this.recordFailedAttempt(clientKey)
        res.redirect(302, this.buildLoginRedirect(nextTarget, 'invalid_credentials'))
        return
      }

      this.clearFailedAttempts(clientKey)

      res.setHeader(
        'Set-Cookie',
        this.serializeCookie(SESSION_COOKIE_NAME, this.createSessionCookieValue(), {
          httpOnly: true,
          maxAge: SESSION_MAX_AGE_SECONDS,
          path: '/',
          sameSite: 'Lax',
          secure: this.secureCookies,
        }),
      )
      res.redirect(302, nextTarget || '/dashboard/trading-ops')
    })

    app.get('/logout', (_req, res) => {
      res.setHeader(
        'Set-Cookie',
        this.serializeCookie(SESSION_COOKIE_NAME, '', {
          httpOnly: true,
          maxAge: 0,
          path: '/',
          sameSite: 'Lax',
          secure: this.secureCookies,
        }),
      )
      res.redirect(302, '/login')
    })

    app.post('/logout', (_req, res) => {
      res.setHeader(
        'Set-Cookie',
        this.serializeCookie(SESSION_COOKIE_NAME, '', {
          httpOnly: true,
          maxAge: 0,
          path: '/',
          sameSite: 'Lax',
          secure: this.secureCookies,
        }),
      )
      res.redirect(302, '/login')
    })
  }

  requirePageAuth: RequestHandler = (req, res, next) => {
    if (!this.isEnabled()) {
      if (!this.failClosedAuth) {
        next()
        return
      }
      res.status(503).send('Dashboard authentication is required but not configured.')
      return
    }

    if (this.isAuthenticated(req)) {
      next()
      return
    }

    res.redirect(302, this.buildLoginRedirect(req.originalUrl || req.url))
  }

  requireApiAuth: RequestHandler = (req, res, next) => {
    if (!this.isEnabled()) {
      if (!this.failClosedAuth) {
        next()
        return
      }
      res.status(503).json({ message: 'Dashboard authentication is required but not configured' })
      return
    }

    if (this.isAuthenticated(req)) {
      next()
      return
    }

    res.status(401).json({ message: 'Dashboard authentication required' })
  }

  private isEnabled(): boolean {
    return Boolean(this.password && this.secret)
  }

  private isAuthenticated(req: Request): boolean {
    if (!this.isEnabled()) {
      return !this.failClosedAuth
    }

    const cookies = this.parseCookies(req.headers.cookie)
    const sessionCookie = cookies[SESSION_COOKIE_NAME]
    if (!sessionCookie) {
      return false
    }

    const [payload, signature] = sessionCookie.split('.')
    if (!payload || !signature) {
      return false
    }

    const expectedSignature = this.sign(payload)
    if (!this.matchesCredential(signature, expectedSignature)) {
      return false
    }

    try {
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionPayload
      return decoded.u === this.username && decoded.exp > Math.floor(Date.now() / 1000)
    } catch {
      return false
    }
  }

  private createSessionCookieValue(): string {
    const payload = Buffer.from(
      JSON.stringify({
        u: this.username,
        exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
      } satisfies SessionPayload),
      'utf8',
    ).toString('base64url')

    return `${payload}.${this.sign(payload)}`
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret || '')
      .update(payload)
      .digest('hex')
  }

  private parseCookies(cookieHeader?: string): Record<string, string> {
    if (!cookieHeader) {
      return {}
    }

    return cookieHeader.split(';').reduce<Record<string, string>>((cookies, chunk) => {
      const separatorIndex = chunk.indexOf('=')
      if (separatorIndex === -1) {
        return cookies
      }

      const key = chunk.slice(0, separatorIndex).trim()
      const value = chunk.slice(separatorIndex + 1).trim()
      cookies[key] = decodeURIComponent(value)
      return cookies
    }, {})
  }

  private serializeCookie(
    name: string,
    value: string,
    options: {
      httpOnly?: boolean
      maxAge?: number
      path?: string
      sameSite?: 'Lax' | 'Strict' | 'None'
      secure?: boolean
    },
  ): string {
    const parts = [`${name}=${encodeURIComponent(value)}`]

    if (typeof options.maxAge === 'number') {
      parts.push(`Max-Age=${options.maxAge}`)
      parts.push(`Expires=${new Date(Date.now() + options.maxAge * 1000).toUTCString()}`)
    }
    if (options.path) {
      parts.push(`Path=${options.path}`)
    }
    if (options.httpOnly) {
      parts.push('HttpOnly')
    }
    if (options.sameSite) {
      parts.push(`SameSite=${options.sameSite}`)
    }
    if (options.secure) {
      parts.push('Secure')
    }

    return parts.join('; ')
  }

  private matchesCredential(candidate: string | undefined, expected: string | undefined): boolean {
    if (!candidate || !expected) {
      return false
    }

    const candidateBuffer = Buffer.from(candidate)
    const expectedBuffer = Buffer.from(expected)
    if (candidateBuffer.length !== expectedBuffer.length) {
      return false
    }

    return timingSafeEqual(candidateBuffer, expectedBuffer)
  }

  private getFormValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
  }

  private getClientKey(req: Request): string {
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0].trim()
    }
    if (Array.isArray(forwarded) && forwarded.length > 0) {
      return String(forwarded[0]).trim()
    }
    return req.ip || req.socket.remoteAddress || 'unknown'
  }

  private isRateLimited(clientKey: string): boolean {
    const now = Date.now()
    const state = this.loginAttempts.get(clientKey)
    if (!state) {
      return false
    }
    if (state.lockedUntil && state.lockedUntil > now) {
      return true
    }
    if (state.windowStartedAt + LOGIN_WINDOW_MS <= now) {
      this.loginAttempts.delete(clientKey)
      return false
    }
    return false
  }

  private recordFailedAttempt(clientKey: string): void {
    const now = Date.now()
    const existing = this.loginAttempts.get(clientKey)
    if (!existing || existing.windowStartedAt + LOGIN_WINDOW_MS <= now) {
      this.loginAttempts.set(clientKey, {
        attempts: 1,
        windowStartedAt: now,
      })
      return
    }

    existing.attempts += 1
    if (existing.attempts >= this.maxLoginAttempts) {
      existing.lockedUntil = now + LOGIN_LOCKOUT_MS
    }
    this.loginAttempts.set(clientKey, existing)
  }

  private clearFailedAttempts(clientKey: string): void {
    this.loginAttempts.delete(clientKey)
  }

  private buildLoginRedirect(nextTarget?: string, error?: 'invalid_credentials'): string {
    const params = new URLSearchParams()
    if (nextTarget) {
      params.set('next', nextTarget)
    }
    if (error) {
      params.set('error', error)
    }

    const queryString = params.toString()
    return queryString ? `/login?${queryString}` : '/login'
  }

  private getSafeNextTarget(req: Request, explicitValue?: unknown): string | undefined {
    const rawValue =
      typeof explicitValue === 'string'
        ? explicitValue
        : typeof req.query.next === 'string'
          ? req.query.next
          : undefined

    if (!rawValue || !rawValue.startsWith('/') || rawValue.startsWith('//') || rawValue.startsWith('/login')) {
      return undefined
    }

    return rawValue
  }

  private renderLoginPage(options: {
    nextTarget?: string
    showInvalidCredentials: boolean
    showAuthDisabled: boolean
  }): string {
    const alertMarkup = options.showAuthDisabled
      ? '<div class="notice warning">Dashboard auth is not active yet. Set DASHBOARD_PASSWORD to require login.</div>'
      : options.showInvalidCredentials
        ? '<div class="notice error">Invalid username or password.</div>'
        : '<div class="notice">Sign in to access FoilOps dashboards and monitoring APIs.</div>'

    const formAction = options.showAuthDisabled ? '#' : '/login'

    return renderFuturisticPage({
      title: 'FoilOps Login',
      activeNav: 'home',
      headerActionsHtml: '<a class="fx-button secondary" href="/">Back to Overview</a>',
      extraStyles: `
        .login-shell { display:grid; grid-template-columns:minmax(300px,1.1fr) minmax(320px,.9fr); gap:18px; }
        .login-panel { min-height: 100%; }
        .login-grid { margin-top: 24px; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
        .login-panel form { display:grid; gap:14px; }
        @media (max-width: 920px) { .login-shell { grid-template-columns:1fr; } .login-grid { grid-template-columns:1fr; } }
      `,
      contentHtml: `
        <section class="login-shell">
          <article class="panel login-panel">
            <p class="fx-eyebrow">FoilOps Control Surface</p>
            <h1>Authenticate before touching live operator systems.</h1>
            <p class="fx-lead">Trading operations, scam intelligence, graph views, and protected APIs now share one signed session boundary. This is the gate in front of the live wallet intelligence stack.</p>
            <div class="login-grid">
              <article class="mini"><strong>Protected</strong>Trading ops, scam intelligence, graph view, FoilOps launch intelligence, and dashboard exports.</article>
              <article class="mini"><strong>Session</strong>HTTP-only signed cookie with a seven day expiry window.</article>
              <article class="mini"><strong>Username</strong>${this.username}</article>
              <article class="mini"><strong>Config</strong>DASHBOARD_USERNAME, DASHBOARD_PASSWORD, and optional DASHBOARD_SESSION_SECRET.</article>
            </div>
          </article>
          <article class="panel login-panel">
            ${alertMarkup}
            <form method="post" action="${formAction}">
              <input type="hidden" name="next" value="${options.nextTarget || ''}" />
              <label for="username">Username
                <input id="username" name="username" type="text" autocomplete="username" value="${this.username}" ${options.showAuthDisabled ? 'disabled' : ''} required />
              </label>
              <label for="password">Password
                <input id="password" name="password" type="password" autocomplete="current-password" ${options.showAuthDisabled ? 'disabled' : ''} required />
              </label>
              <button class="fx-button primary" type="submit" ${options.showAuthDisabled ? 'disabled' : ''}>Sign in</button>
              <p class="subtle">Unauthenticated API requests receive HTTP 401. Browser requests redirect here automatically.</p>
            </form>
          </article>
        </section>
      `,
    })
  }
}
