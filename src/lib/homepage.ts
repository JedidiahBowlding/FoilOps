import { BOT_USERNAME } from '../constants/foilops'
import { renderFuturisticPage } from './site-theme'

export function renderHomepageHtml(): string {
  return renderFuturisticPage({
    title: 'FoilOps | Wallet Intelligence and Trading Control',
    activeNav: 'home',
    headerActionsHtml: `
      <a class="fx-button secondary" href="https://t.me/${BOT_USERNAME}" target="_blank" rel="noopener noreferrer">Open Telegram Bot</a>
      <a class="fx-button primary" href="/login">Operator Login</a>
    `,
    heroHtml: `
      <section class="fx-hero-grid">
        <article class="panel">
          <p class="fx-eyebrow">Real-time monitoring and operator control</p>
          <h1>FoilOps maps wallets before the market catches up.</h1>
          <p class="fx-lead">FoilOps is a Telegram-first intelligence layer for monitoring wallets, investigating suspicious launches, tracing fund flows, and supervising guarded copy-trade execution. It connects live Solana collection, rule-based risk context, operator review, and controlled downstream trading into a single console.</p>
          <div class="cta-row">
            <a class="fx-button primary" href="/login">Enter Console</a>
            <a class="fx-button secondary" href="/dashboard/trading-ops">Open Trading Ops</a>
          </div>
          <div class="micro-grid" style="margin-top:18px">
            <article class="mini"><strong>Live wallet telemetry</strong>Tracks smart-wallet entries, exits, token activity, and direct value transfers across Solana venues.</article>
            <article class="mini"><strong>Scam and dev intel</strong>Links risky launches, developer wallets, suspicious clusters, and historical token behavior into reusable case history.</article>
            <article class="mini"><strong>Guarded execution</strong>Applies risk gates, deduplication, HMAC auth, staged sizing, and emergency stop controls before execution passes downstream.</article>
          </div>
        </article>
        <aside class="panel" style="display:grid;gap:14px;align-content:start">
          <img src="/showcase/FoilOps_banner.jpeg" alt="FoilOps banner" style="width:100%;display:block;border-radius:18px;border:1px solid rgba(129,196,255,.18)" />
          <div class="mini">
            <p class="fx-eyebrow">Protected surfaces</p>
            <h2>Dashboards are operator tools, not brochure pages.</h2>
            <p>The authenticated area exposes live watchlists, receiver state, launch intelligence, graph-linked wallet clusters, retry queues, decision feeds, and investigation output. The public site should feel like the front airlock to that system.</p>
          </div>
        </aside>
      </section>
    `,
    contentHtml: `
      <section class="fx-stats">
        <article class="card"><p class="eyebrow">Planes</p><div class="big">3</div><p>Telegram workflow, intelligence dashboards, and guarded execution receiver.</p></article>
        <article class="card"><p class="eyebrow">Operator Views</p><div class="big">4</div><p>Trading ops, scam intelligence, graph analysis, and FoilOps launch intelligence.</p></article>
        <article class="card"><p class="eyebrow">Core Functions</p><div class="big">7</div><p>Track, classify, trace, investigate, cluster, score, and control.</p></article>
        <article class="card"><p class="eyebrow">Safety Model</p><div class="big">Layered</div><p>Risk score limits, sizing controls, dead-letter handling, and kill-switch operations.</p></article>
      </section>

      <section class="grid">
        <article class="panel">
          <p class="fx-eyebrow">Operating sequence</p>
          <h2>From raw chain activity to supervised action</h2>
          <div class="steps">
            <article class="step"><div class="step-number">1</div><h3>Collect</h3><p>Normalize live wallet activity from launches, swaps, transfers, and route-level metadata.</p></article>
            <article class="step"><div class="step-number">2</div><h3>Enrich</h3><p>Attach market context, platform identity, token intelligence, and risk attributes.</p></article>
            <article class="step"><div class="step-number">3</div><h3>Investigate</h3><p>Trace flows hop-by-hop, connect suspicious wallets, and resolve likely developer ownership.</p></article>
            <article class="step"><div class="step-number">4</div><h3>Control</h3><p>Review decisions in protected dashboards and only allow guarded execution when the operator intends it.</p></article>
          </div>
        </article>

        <article class="panel">
          <p class="fx-eyebrow">Console map</p>
          <h2>What sits behind the login boundary</h2>
          <div class="timeline-grid">
            <article class="timeline"><h3>Trading Ops</h3><p>Receiver health, profiles, source wallets, dead letters, decision feed, and live configuration.</p></article>
            <article class="timeline"><h3>Scam Intelligence</h3><p>Flagged wallets, suspicious launch history, fund-flow traces, and token investigations.</p></article>
            <article class="timeline"><h3>Graph View</h3><p>Relationship analysis for wallets, trace paths, and analyst-side drill down.</p></article>
            <article class="timeline"><h3>FoilOps Intelligence</h3><p>Early wallet scoring, high-risk launch surfacing, token risk views, and cluster summaries.</p></article>
          </div>
        </article>
      </section>

      <section class="cards">
        <article class="card"><img src="/showcase/FoilOps_Start_Menu.jpeg" alt="Telegram interface" style="width:100%;display:block;height:190px;object-fit:cover;border-radius:18px;border:1px solid rgba(129,196,255,.16)" /><h3>Telegram-first workflow</h3><p>Operators can manage wallets and trigger actions in chat, then validate deeper system state from the protected web console.</p></article>
        <article class="card"><img src="/showcase/FoilOps_Menu_Commands.jpeg" alt="Command surfaces" style="width:100%;display:block;height:190px;object-fit:cover;border-radius:18px;border:1px solid rgba(129,196,255,.16)" /><h3>Persistent intelligence</h3><p>Scam findings, related launches, suspicious flow traces, and token investigations survive across sessions instead of disappearing into logs.</p></article>
        <article class="card"><img src="/showcase/FoilOps_Menu_Buttons.jpeg" alt="Flow tracing" style="width:100%;display:block;height:190px;object-fit:cover;border-radius:18px;border:1px solid rgba(129,196,255,.16)" /><h3>Tracing and graphing</h3><p>Follow money movement across hops, identify likely custody or exchange exits, and pivot straight into graph analysis.</p></article>
        <article class="card"><img src="/showcase/FoilOps_banner.jpeg" alt="FoilOps banner" style="width:100%;display:block;height:190px;object-fit:cover;border-radius:18px;border:1px solid rgba(129,196,255,.16)" /><h3>Execution with brakes</h3><p>When enabled, signals move into a guarded Rust receiver protected by auth, replay protection, sizing rules, and emergency stop controls.</p></article>
      </section>

      <section class="panel footer-cta">
        <div>
          <p class="fx-eyebrow">Operator access</p>
          <h2>Enter the FoilOps command surface.</h2>
          <p>If you are managing wallets through Telegram, the dashboards give you the deeper supervisory layer: live receiver state, intelligence history, graph context, and launch-scoring visibility.</p>
        </div>
        <div class="cta-row">
          <a class="fx-button primary" href="/login">Login</a>
          <a class="fx-button secondary" href="/dashboard/foilops">View FoilOps Intelligence</a>
        </div>
      </section>
    `,
  })
}
