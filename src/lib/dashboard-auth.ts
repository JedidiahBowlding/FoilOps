import { createHmac, timingSafeEqual, randomBytes } from 'crypto'
import type { Express, Request, RequestHandler, Response } from 'express'
import { renderFuturisticPage } from './site-theme'

type SessionPayload = {
  u: string
  exp: number
}

type TwoFASession = {
  username: string
  createdAt: number
  expiresAt: number
}

const SESSION_COOKIE_NAME = 'foilops_dashboard_session'
const TWOFA_SESSION_COOKIE_NAME = 'foilops_dashboard_twofa_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7
const TWOFA_SESSION_MAX_AGE_SECONDS = 5 * 60
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_LOCKOUT_MS = 30 * 60 * 1000
const DEFAULT_MAX_LOGIN_ATTEMPTS = 8
const TOTP_WINDOW = 1

type LoginAttemptState = {
  attempts: number
  windowStartedAt: number
  lockedUntil?: number
}

export class DashboardAuth {
  private readonly username: string
  private readonly password?: string
  private readonly secret?: string
  private readonly twoFASecret?: string
  private readonly twoFAEnabled: boolean
  private readonly secureCookies: boolean
  private readonly failClosedAuth: boolean
  private readonly maxLoginAttempts: number
  private readonly loginAttempts = new Map<string, LoginAttemptState>()
  private readonly twoFASessions = new Map<string, TwoFASession>()

  constructor() {
    this.username = process.env.DASHBOARD_USERNAME?.trim() || 'admin'
    this.password = process.env.DASHBOARD_PASSWORD?.trim() || undefined
    this.secret = process.env.DASHBOARD_SESSION_SECRET?.trim() || this.password
    this.twoFASecret = process.env.DASHBOARD_2FA_SECRET?.trim() || undefined
    this.twoFAEnabled = this.twoFASecret ? true : false
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
      const showInvalidTwoFA = req.query.error === 'invalid_2fa'
      const showAuthDisabled = !this.isEnabled()
      const nextTarget = this.getSafeNextTarget(req)

      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.status(showAuthDisabled ? 503 : 200).send(
        this.renderLoginPage({
          nextTarget,
          showInvalidCredentials,
          showAuthDisabled,
          showInvalidTwoFA,
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

      // If 2FA is enabled, redirect to 2FA verification
      if (this.twoFAEnabled) {
        const twoFASessionId = randomBytes(32).toString('hex')
        this.twoFASessions.set(twoFASessionId, {
          username: this.username,
          createdAt: Date.now(),
          expiresAt: Date.now() + TWOFA_SESSION_MAX_AGE_SECONDS * 1000,
        })

        res.setHeader(
          'Set-Cookie',
          this.serializeCookie(TWOFA_SESSION_COOKIE_NAME, twoFASessionId, {
            httpOnly: true,
            maxAge: TWOFA_SESSION_MAX_AGE_SECONDS,
            path: '/',
            sameSite: 'Lax',
            secure: this.secureCookies,
          }),
        )

        res.redirect(302, this.buildTwoFARedirect(nextTarget))
        return
      }

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

    app.get('/verify-2fa', (req, res) => {
      if (this.isAuthenticated(req)) {
        res.redirect(302, this.getSafeNextTarget(req) || '/dashboard/trading-ops')
        return
      }

      const twoFASessionId = this.getTwoFASessionFromCookie(req)
      if (!twoFASessionId || !this.isTwoFASessionValid(twoFASessionId)) {
        res.redirect(302, '/login')
        return
      }

      const showInvalidCode = req.query.error === 'invalid_2fa'
      const nextTarget = this.getSafeNextTarget(req)

      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).send(
        this.renderTwoFAPage({
          nextTarget,
          showInvalidCode,
        }),
      )
    })

    app.post('/verify-2fa', (req, res) => {
      const twoFASessionId = this.getTwoFASessionFromCookie(req)
      if (!twoFASessionId || !this.isTwoFASessionValid(twoFASessionId)) {
        res.redirect(302, '/login')
        return
      }

      const code = this.getFormValue(req.body?.code)
      const nextTarget = this.getSafeNextTarget(req, req.body?.next)

      if (!this.verify2FACode(code)) {
        res.redirect(302, this.buildTwoFARedirect(nextTarget, 'invalid_2fa'))
        return
      }

      // Clear 2FA session
      this.twoFASessions.delete(twoFASessionId)
      res.setHeader(
        'Set-Cookie',
        this.serializeCookie(TWOFA_SESSION_COOKIE_NAME, '', {
          httpOnly: true,
          maxAge: 0,
          path: '/',
          sameSite: 'Lax',
          secure: this.secureCookies,
        }),
      )

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

  private buildTwoFARedirect(nextTarget?: string, error?: 'invalid_2fa'): string {
    const params = new URLSearchParams()
    if (nextTarget) {
      params.set('next', nextTarget)
    }
    if (error) {
      params.set('error', error)
    }

    const queryString = params.toString()
    return queryString ? `/verify-2fa?${queryString}` : '/verify-2fa'
  }

  private getTwoFASessionFromCookie(req: Request): string | null {
    const cookies = this.parseCookies(req.headers.cookie)
    return cookies[TWOFA_SESSION_COOKIE_NAME] || null
  }

  private isTwoFASessionValid(sessionId: string): boolean {
    const session = this.twoFASessions.get(sessionId)
    if (!session) {
      return false
    }
    if (session.expiresAt < Date.now()) {
      this.twoFASessions.delete(sessionId)
      return false
    }
    return true
  }

  private verify2FACode(code: string): boolean {
    if (!this.twoFASecret || code.length !== 6 || !/^\d+$/.test(code)) {
      return false
    }

    return this.verifyTOTP(code, this.twoFASecret)
  }

  private verifyTOTP(code: string, secret: string): boolean {
    // Decode the base32 secret into a buffer
    const buffer = this.base32Decode(secret)
    if (!buffer) {
      return false
    }

    const now = Math.floor(Date.now() / 1000)
    const timeCounter = Math.floor(now / 30)

    // Check current time window and adjacent windows for clock skew tolerance
    for (let i = -TOTP_WINDOW; i <= TOTP_WINDOW; i++) {
      const counter = timeCounter + i
      const hmac = createHmac('sha1', buffer)
      const counterBuffer = Buffer.alloc(8)
      counterBuffer.writeBigInt64BE(BigInt(counter), 0)
      hmac.update(counterBuffer)
      const digest = hmac.digest()

      const offset = digest[digest.length - 1] & 0x0f
      const value =
        (((digest[offset] & 0x7f) << 24) |
          ((digest[offset + 1] & 0xff) << 16) |
          ((digest[offset + 2] & 0xff) << 8) |
          (digest[offset + 3] & 0xff)) %
        1000000

      const otpCode = String(value).padStart(6, '0')
      if (otpCode === code) {
        return true
      }
    }

    return false
  }

  private base32Decode(input: string): Buffer | null {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    const cleaned = input.toUpperCase().replace(/=+$/, '')

    let bits = 0
    let value = 0
    const output: number[] = []

    for (let i = 0; i < cleaned.length; i++) {
      const index = alphabet.indexOf(cleaned[i])
      if (index === -1) {
        return null
      }

      value = (value << 5) | index
      bits += 5

      if (bits >= 8) {
        bits -= 8
        output.push((value >> bits) & 0xff)
      }
    }

    return Buffer.from(output)
  }

  private renderLoginPage(options: {
    nextTarget?: string
    showInvalidCredentials: boolean
    showAuthDisabled: boolean
    showInvalidTwoFA: boolean
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

          </article>
          <article class="panel login-panel">
            ${alertMarkup}
            <form method="post" action="${formAction}">
              <input type="hidden" name="next" value="${options.nextTarget || ''}" />
              <label for="username">Username
                <input id="username" name="username" type="text" autocomplete="username" ${options.showAuthDisabled ? 'disabled' : ''} required />
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

  private renderTwoFAPage(options: { nextTarget?: string; showInvalidCode: boolean }): string {
    const alertMarkup = options.showInvalidCode
      ? '<div class="notice error">Invalid or expired 2FA code. Please try again.</div>'
      : '<div class="notice">Enter the 6-digit code from your authenticator app.</div>'

    return renderFuturisticPage({
      title: 'FoilOps - Verify 2FA',
      activeNav: 'home',
      headerActionsHtml: '<a class="fx-button secondary" href="/login">Back to Login</a>',
      extraStyles: `
        .twofa-shell { display:grid; grid-template-columns:1fr; max-width:400px; margin:0 auto; gap:18px; }
        .twofa-panel form { display:grid; gap:14px; }
        .code-input { font-family:monospace; font-size:24px; letter-spacing:8px; text-align:center; }
      `,
      contentHtml: `
        <section class="twofa-shell">
          <article class="panel twofa-panel">
            <p class="fx-eyebrow">Two-Factor Authentication</p>
            <h1>Verify your identity</h1>
            <p class="fx-lead">Check your authenticator app for the 6-digit verification code.</p>
            ${alertMarkup}
            <form method="post" action="/verify-2fa">
              <input type="hidden" name="next" value="${options.nextTarget || ''}" />
              <label for="code">Verification Code
                <input id="code" name="code" type="text" class="code-input" autocomplete="off" pattern="[0-9]{6}" maxlength="6" required />
              </label>
              <button class="fx-button primary" type="submit">Verify</button>
              <p class="subtle">Code expires in 5 minutes. Only digits allowed.</p>
            </form>
          </article>
        </section>
      `,
    })
  }
}
