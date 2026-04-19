import { BOT_USERNAME } from '../constants/foilops'

export function renderHomepageHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>FoilOps | Wallet Intelligence and Trading Control</title>
    <style>
      :root {
        --primary: #ff2d2d;
        --primary-dark: #d41f1f;
        --dark-bg: #0a0e27;
        --card-bg: rgba(15, 20, 45, 0.7);
        --ink: #ffffff;
        --muted: #a0a8c0;
        --line: rgba(255, 45, 45, 0.2);
        --accent: #ff2d2d;
        --shadow: rgba(10, 14, 39, 0.3);
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        color: var(--ink);
        background: linear-gradient(135deg, #0a0e27 0%, #0f1440 50%, #0a0e27 100%);
        font-family: "Avenir Next", "Trebuchet MS", sans-serif;
      }

      a { color: inherit; }

      .page {
        max-width: 1240px;
        margin: 0 auto;
        padding: 28px;
      }

      .nav {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        margin-bottom: 30px;
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 14px;
        min-width: 0;
      }

      .brand-logo {
        height: 52px;
        width: auto;
        border-radius: 14px;
        object-fit: cover;
        border: 1px solid rgba(255, 255, 255, 0.46);
        box-shadow: 0 12px 30px var(--shadow);
      }

      .brand-wordmark {
        height: 44px;
        width: auto;
        border-radius: 10px;
        object-fit: contain;
      }

      .brand-mark {
        font-size: 0.8rem;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--primary);
      }

      .brand-title {
        margin: 4px 0 0;
        font-size: 1.1rem;
        font-weight: 700;
      }

      .nav-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      .button,
      .button-secondary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        text-decoration: none;
        border-radius: 999px;
        padding: 12px 18px;
        font-weight: 700;
        border: 1px solid transparent;
      }

      .button {
        background: linear-gradient(135deg, var(--primary), var(--primary-dark));
        color: #fff;
        box-shadow: 0 14px 34px rgba(255, 45, 45, 0.25);
      }

      .button-secondary {
        background: rgba(255, 255, 255, 0.1);
        color: var(--ink);
        border-color: var(--line);
      }

      .hero {
        display: grid;
        grid-template-columns: minmax(0, 1.25fr) minmax(320px, 0.95fr);
        gap: 22px;
        align-items: stretch;
      }

      .panel {
        background: var(--card-bg);
        border: 1px solid var(--line);
        border-radius: 30px;
        box-shadow: 0 22px 70px var(--shadow);
        backdrop-filter: blur(10px);
      }

      .hero-copy {
        padding: 34px;
      }

      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 0.8rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--primary);
      }

      h1 {
        margin: 16px 0 16px;
        font-size: clamp(2.8rem, 7vw, 5.6rem);
        line-height: 0.92;
        max-width: 12ch;
      }

      .lead {
        margin: 0;
        max-width: 58ch;
        color: var(--muted);
        font-size: 1.04rem;
        line-height: 1.72;
      }

      .cta-row {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 22px;
      }

      .micro-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin-top: 24px;
      }

      .mini {
        background: rgba(255, 45, 45, 0.08);
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 14px;
      }

      .mini strong {
        display: block;
        font-size: 1.1rem;
        margin-bottom: 6px;
      }

      .hero-side {
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .hero-side img {
        width: 100%;
        border-radius: 22px;
        border: 1px solid var(--line);
        object-fit: cover;
        background: rgba(15, 20, 45, 0.5);
      }

      .banner-wrap {
        margin-top: 22px;
        border-radius: 26px;
        overflow: hidden;
        border: 1px solid var(--line);
        box-shadow: 0 18px 50px var(--shadow);
      }

      .banner-wrap img {
        display: block;
        width: 100%;
        height: auto;
      }

      .callout {
        padding: 16px 18px;
        border-radius: 20px;
        background: linear-gradient(135deg, rgba(255, 45, 45, 0.12), rgba(255, 45, 45, 0.08));
        border: 1px solid var(--line);
      }

      .callout h2,
      .section-title {
        margin: 0 0 10px;
        font-size: 1.2rem;
        color: #ffffff;
      }

      .callout p,
      .section-copy,
      .card p,
      .step p,
      .timeline p {
        margin: 0;
        color: var(--muted);
        line-height: 1.66;
      }

      .content-grid {
        display: grid;
        grid-template-columns: 1.05fr 0.95fr;
        gap: 22px;
        margin-top: 22px;
      }

      .stack {
        display: grid;
        gap: 22px;
      }

      .section {
        padding: 28px;
      }

      .cards,
      .steps,
      .timeline-grid,
      .intel-grid {
        display: grid;
        gap: 14px;
      }

      .cards {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .card,
      .step,
      .timeline,
      .intel {
        border: 1px solid var(--line);
        border-radius: 22px;
        background: rgba(15, 20, 45, 0.5);
        padding: 18px;
      }

      .card h3,
      .step h3,
      .timeline h3,
      .intel h3 {
        margin: 0 0 8px;
        font-size: 1rem;
      }

      .steps {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .step-number {
        width: 34px;
        height: 34px;
        display: inline-grid;
        place-items: center;
        border-radius: 999px;
        background: rgba(255, 45, 45, 0.15);
        color: var(--primary);
        font-weight: 700;
        margin-bottom: 10px;
      }

      .timeline-grid,
      .intel-grid {
        grid-template-columns: 1fr;
      }

      .footer-cta {
        margin-top: 22px;
        padding: 26px 28px;
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: center;
      }

      .footer-cta p {
        margin: 0;
        color: var(--muted);
        max-width: 60ch;
        line-height: 1.7;
      }

      @media (max-width: 1024px) {
        .hero,
        .content-grid {
          grid-template-columns: 1fr;
        }

        .cards,
        .steps,
        .micro-grid {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 720px) {
        .page {
          padding: 16px;
        }

        .nav,
        .footer-cta {
          flex-direction: column;
          align-items: flex-start;
        }

        .hero-copy,
        .hero-side,
        .section,
        .footer-cta {
          padding: 22px;
        }

        h1 {
          max-width: none;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <header class="nav">
        <div class="brand">
          <img class="brand-logo" src="/showcase/logo.jpeg" alt="FoilOps logo" />
          <img class="brand-wordmark" src="/showcase/FoilOps_header.jpeg" alt="FoilOps" />
        </div>
        <div class="nav-actions">
          <a class="button-secondary" href="https://t.me/${BOT_USERNAME}" target="_blank" rel="noopener noreferrer">Open Telegram Bot</a>
          <a class="button" href="/login">Login to Dashboard</a>
        </div>
      </header>

      <section class="hero">
        <article class="panel hero-copy">
          <div class="eyebrow">Real-time monitoring and operator control</div>
          <h1>FoilOps watches wallets before traders react.</h1>
          <p class="lead">FoilOps is a wallet intelligence system built around three connected planes: a Telegram-first operator workflow, a live Solana wallet monitoring engine, and a protected HTTP control surface for scam intelligence, graph analysis, and trading operations. It is designed to follow smart wallets, investigate suspicious launches, trace fund flows across hops, and feed normalized signals into a guarded execution receiver when live trading is enabled.</p>
          <div class="cta-row">
            <a class="button" href="/login">Login</a>
            <a class="button-secondary" href="/dashboard/trading-ops">Trading Dashboard</a>
          </div>
          <div class="micro-grid">
            <article class="mini"><strong>Real-time tracking</strong>Monitors Solana wallet activity across Pump.fun, PumpSwap, Jupiter, Raydium, and direct transfer patterns.</article>
            <article class="mini"><strong>Scam intelligence</strong>Flags risky wallets, maps flow traces, investigates developer wallets, and keeps a monitored history.</article>
            <article class="mini"><strong>Execution guardrails</strong>Combines risk gates, dedupe, HMAC auth, staged sizing, and kill-switch controls before orders can pass downstream.</article>
          </div>
        </article>

        <aside class="panel hero-side">
          <img src="/showcase/FoilOps_Start_Menu.jpeg" alt="FoilOps Telegram bot interface" />
          <div class="callout">
            <h2>What the homepage is protecting</h2>
            <p>The dashboards behind login are not brochure pages. They expose live watchlists, decision feeds, dead-letter queues, token investigations, graph-linked wallet clusters, and receiver status for the trading system. Public visitors start here. Operators authenticate before touching any of it.</p>
          </div>
        </aside>
      </section>

      <div class="banner-wrap">
        <img src="/showcase/FoilOps_banner.jpeg" alt="FoilOps — Trace wallets. Track devs. Stop rugs." />
      </div>

      <section class="content-grid">
        <div class="stack">
          <article class="panel section">
            <h2 class="section-title">How the FoilOps system works</h2>
            <p class="section-copy">The platform is built to move from raw on-chain activity to operational decisions without losing context between steps. Wallet events are parsed, enriched, scored, and routed into the specific view or action layer that an operator needs.</p>
            <div class="steps">
              <article class="step">
                <div class="step-number">1</div>
                <h3>Collection</h3>
                <p>FoilOps ingests wallet activity in real time, normalizes events, and recognizes activity patterns across major Solana trading venues and wallet transfers.</p>
              </article>
              <article class="step">
                <div class="step-number">2</div>
                <h3>Classification</h3>
                <p>Parsed events are enriched with token context, market cap snapshots, known platform intelligence, and rule-based or manual risk metadata.</p>
              </article>
              <article class="step">
                <div class="step-number">3</div>
                <h3>Investigation</h3>
                <p>Suspicious wallets and token contracts can be traced hop-by-hop, linked to likely developer wallets, and stored as reusable intelligence for future alerts.</p>
              </article>
              <article class="step">
                <div class="step-number">4</div>
                <h3>Decision and control</h3>
                <p>Operators review dashboards and APIs that expose watchlists, graph views, risk gates, journal entries, dead letters, and execution controls in one place.</p>
              </article>
            </div>
          </article>

          <article class="panel section">
            <h2 class="section-title">Detailed platform capabilities</h2>
            <div class="cards">
              <article class="card">
                <h3>Wallet tracking</h3>
                <p>Track wallet activity in real time, manage tracked wallets from Telegram, and monitor new moves across exchanges, launchpads, routers, and direct transfer paths.</p>
              </article>
              <article class="card">
                <h3>Scam wallet lifecycle</h3>
                <p>Persist flagged wallets, reasons, risk scores, launch history, prior token associations, and event history so investigative context survives across sessions.</p>
              </article>
              <article class="card">
                <h3>Flow tracing</h3>
                <p>Traverse outgoing transactions across multiple hops, classify known counterparties such as bridges, exchanges, custody venues, and mixers, and store trace artifacts for review.</p>
              </article>
              <article class="card">
                <h3>Token investigation</h3>
                <p>Resolve a likely developer wallet from token authority and signer patterns, relate that wallet to prior token history, and initiate future launch monitoring.</p>
              </article>
              <article class="card">
                <h3>Protected dashboards</h3>
                <p>Use the trading ops dashboard for receiver health, watchlist-driven settings, retry queues, and decision feeds, while the scam dashboard surfaces flagged wallet intelligence and investigations.</p>
              </article>
              <article class="card">
                <h3>Signal-controlled trading</h3>
                <p>When enabled, normalized signals feed a guarded Rust receiver with HMAC verification, deduplication, timestamp validation, staged position sizing, and emergency kill-switch support.</p>
              </article>
            </div>
          </article>
        </div>

        <div class="stack">
          <article class="panel section">
            <h2 class="section-title">Operator surfaces behind login</h2>
            <div class="timeline-grid">
              <article class="timeline">
                <h3>Trading Ops Dashboard</h3>
                <p>Receiver mode, enabled state, queue depth, source wallet profiles, recent trade journal entries, dead letters, and decision feed history.</p>
              </article>
              <article class="timeline">
                <h3>Scam Intelligence Dashboard</h3>
                <p>Flagged wallets, risk scoring, prior token links, latest flow traces, suspicious launch history, and token investigation records.</p>
              </article>
              <article class="timeline">
                <h3>Wallet Graph View</h3>
                <p>Visualize flow-linked wallets and cluster relationships, inspect node-level context, and run wallet analysis from the graph surface.</p>
              </article>
            </div>
          </article>

          <article class="panel section">
            <h2 class="section-title">Why access is gated</h2>
            <div class="intel-grid">
              <article class="intel">
                <h3>Live system visibility</h3>
                <p>The control surface includes internal receiver state, trading metrics, retry paths, watchlists, and investigation outputs that should not be exposed anonymously.</p>
              </article>
              <article class="intel">
                <h3>Operational commands</h3>
                <p>FoilOps is built for operator workflows. The public site explains the system; the protected area is where an authenticated operator reviews signals and acts on them.</p>
              </article>
              <article class="intel">
                <h3>Telegram-first workflow</h3>
                <p>Wallet additions, deletions, and day-to-day management are initiated through Telegram, while dashboards exist to inspect, validate, and supervise the live backend state.</p>
              </article>
            </div>
          </article>

          <article class="panel footer-cta">
            <div>
              <h2 class="section-title">Enter the operator console</h2>
              <p>Use the protected login to reach the dashboards. If you are managing wallets from Telegram, the dashboards give you the deeper system view: watchlist state, intelligence history, and guarded trading telemetry.</p>
            </div>
            <a class="button" href="/login">Login to FoilOps</a>
          </article>
        </div>
      </section>
    </main>
  </body>
</html>`
}
