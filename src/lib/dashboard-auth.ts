import { createHmac, timingSafeEqual } from 'crypto'
import type { Express, Request, RequestHandler, Response } from 'express'

type SessionPayload = {
  u: string
  exp: number
}

const SESSION_COOKIE_NAME = 'foilops_dashboard_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

export class DashboardAuth {
  private readonly username: string
  private readonly password?: string
  private readonly secret?: string
  private readonly secureCookies: boolean

  constructor() {
    this.username = process.env.DASHBOARD_USERNAME?.trim() || 'admin'
    this.password = process.env.DASHBOARD_PASSWORD?.trim() || undefined
    this.secret = process.env.DASHBOARD_SESSION_SECRET?.trim() || this.password
    const appUrl = process.env.APP_URL?.trim() || ''
    this.secureCookies = appUrl.startsWith('https://') || process.env.ENVIRONMENT === 'production'
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
        res.status(503).send('Dashboard login is disabled until DASHBOARD_PASSWORD is configured.')
        return
      }

      const username = this.getFormValue(req.body?.username)
      const password = this.getFormValue(req.body?.password)
      const nextTarget = this.getSafeNextTarget(req, req.body?.next)

      if (!this.matchesCredential(username, this.username) || !this.matchesCredential(password, this.password)) {
        res.redirect(302, this.buildLoginRedirect(nextTarget, 'invalid_credentials'))
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
    if (!this.isEnabled() || this.isAuthenticated(req)) {
      next()
      return
    }

    res.redirect(302, this.buildLoginRedirect(req.originalUrl || req.url))
  }

  requireApiAuth: RequestHandler = (req, res, next) => {
    if (!this.isEnabled() || this.isAuthenticated(req)) {
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
      return true
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

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>FoilOps Login</title>
    <style>
      :root {
        --bg: #0a0e27;
        --ink: #ffffff;
        --muted: #a0a8c0;
        --panel: rgba(15, 20, 45, 0.7);
        --line: rgba(255, 45, 45, 0.2);
        --accent: #ff2d2d;
        --accent-2: #ff2d2d;
        --danger: #ff2d2d;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        color: var(--ink);
        background: linear-gradient(135deg, #0a0e27 0%, #0f1440 50%, #0a0e27 100%);
        font-family: "Avenir Next", "Trebuchet MS", sans-serif;
      }
      .shell {
        width: min(980px, 100%);
        display: grid;
        grid-template-columns: minmax(280px, 1.1fr) minmax(320px, 0.9fr);
        gap: 18px;
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 24px;
        padding: 28px;
        box-shadow: 0 24px 70px rgba(49, 35, 21, 0.12);
        backdrop-filter: blur(10px);
      }
      .headline {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .kicker {
        font-size: 0.78rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--accent);
      }
      h1 {
        margin: 10px 0 12px;
        font-size: clamp(2rem, 5vw, 3.6rem);
        line-height: 0.95;
      }
      .lead {
        margin: 0;
        color: var(--muted);
        max-width: 34rem;
        line-height: 1.6;
      }
      .grid {
        margin-top: 28px;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .mini {
        padding: 14px;
        border-radius: 16px;
        background: rgba(255,255,255,0.55);
        border: 1px solid var(--line);
      }
      .mini strong {
        display: block;
        margin-bottom: 6px;
      }
      form {
        display: grid;
        gap: 14px;
      }
      .notice {
        border-radius: 14px;
        padding: 12px 14px;
        background: rgba(255, 45, 45, 0.12);
        border: 1px solid rgba(255, 45, 45, 0.2);
        color: var(--ink);
        font-size: 0.95rem;
      }
      .notice.warning {
        background: rgba(255, 45, 45, 0.12);
        border-color: rgba(255, 45, 45, 0.2);
      }
      .notice.error {
        background: rgba(255, 45, 45, 0.15);
        border-color: rgba(255, 45, 45, 0.3);
        color: #ff7070;
      }
      label {
        display: block;
        font-size: 0.92rem;
        font-weight: 600;
        margin-bottom: 6px;
      }
      input {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 14px 15px;
        font-size: 1rem;
        background: rgba(255,255,255,0.88);
      }
      button {
        border: 0;
        border-radius: 999px;
        background: linear-gradient(135deg, var(--accent), #134b64);
        color: #fff;
        padding: 14px 18px;
        font-size: 1rem;
        font-weight: 700;
        cursor: pointer;
      }
      button:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      .subtle {
        margin: 0;
        color: var(--muted);
        font-size: 0.9rem;
      }
      @media (max-width: 860px) {
        .shell { grid-template-columns: 1fr; }
        .grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="panel headline">
        <div>
          <div class="kicker">FoilOps Control Surface</div>
          <h1>Dashboard access is now gated.</h1>
          <p class="lead">Trading operations, scam intelligence, graph views, and export endpoints now share a single login boundary. Sign in before opening any dashboard route.</p>
        </div>
        <div class="grid">
          <article class="mini"><strong>Protected</strong>Trading ops, scam intelligence, graph view, and dashboard JSON exports.</article>
          <article class="mini"><strong>Session</strong>Signed HTTP-only cookie with a seven day expiry window.</article>
          <article class="mini"><strong>Username</strong>${this.username}</article>
          <article class="mini"><strong>Config</strong>Use DASHBOARD_USERNAME, DASHBOARD_PASSWORD, and optionally DASHBOARD_SESSION_SECRET.</article>
        </div>
      </section>
      <section class="panel">
        ${alertMarkup}
        <form method="post" action="${formAction}">
          <input type="hidden" name="next" value="${options.nextTarget || ''}" />
          <div>
            <label for="username">Username</label>
            <input id="username" name="username" type="text" autocomplete="username" value="${this.username}" ${options.showAuthDisabled ? 'disabled' : ''} required />
          </div>
          <div>
            <label for="password">Password</label>
            <input id="password" name="password" type="password" autocomplete="current-password" ${options.showAuthDisabled ? 'disabled' : ''} required />
          </div>
          <button type="submit" ${options.showAuthDisabled ? 'disabled' : ''}>Sign in</button>
          <p class="subtle">Unauthenticated API requests receive HTTP 401. Browser requests redirect here automatically.</p>
        </form>
      </section>
    </main>
  </body>
</html>`
  }
}
