export type SiteNavKey = 'home' | 'trading' | 'scam' | 'graph' | 'foilops'

type SiteNavLink = {
  key: SiteNavKey
  href: string
  label: string
}

type RenderFuturisticPageOptions = {
  title: string
  activeNav?: SiteNavKey
  heroHtml?: string
  contentHtml: string
  headerActionsHtml?: string
  extraStyles?: string
  scriptHtml?: string
  bodyClassName?: string
}

const NAV_LINKS: SiteNavLink[] = [
  { key: 'home', href: '/', label: 'Overview' },
  { key: 'trading', href: '/dashboard/trading-ops', label: 'Trading Ops' },
  { key: 'scam', href: '/dashboard/scam-wallets', label: 'Scam Intel' },
  { key: 'graph', href: '/graph', label: 'Graph' },
  { key: 'foilops', href: '/dashboard/foilops', label: 'FoilOps' },
]

function renderNav(activeNav?: SiteNavKey): string {
  return NAV_LINKS.map((link) => {
    const activeClass = link.key === activeNav ? ' active' : ''
    return `<a class="fx-nav-link${activeClass}" href="${link.href}">${link.label}</a>`
  }).join('')
}

function renderActions(actions?: string): string {
  return actions ? `<div class="fx-header-actions">${actions}</div>` : ''
}

export function renderFuturisticPage(options: RenderFuturisticPageOptions): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${options.title}</title>
    <style>
      :root {
        color-scheme: dark;
        --fx-bg-0: #050816;
        --fx-bg-1: #0b1231;
        --fx-bg-2: #0f1b44;
        --fx-panel: rgba(10, 17, 42, 0.78);
        --fx-panel-strong: rgba(9, 15, 36, 0.92);
        --fx-panel-soft: rgba(18, 27, 58, 0.72);
        --fx-line: rgba(129, 196, 255, 0.16);
        --fx-line-strong: rgba(96, 222, 255, 0.34);
        --fx-ink: #edf4ff;
        --fx-muted: #91a5d2;
        --fx-primary: #67f0ff;
        --fx-secondary: #7c72ff;
        --fx-acid: #4cffc1;
        --fx-danger: #ff5a7a;
        --fx-warning: #ffbc68;
        --fx-shadow: 0 24px 80px rgba(2, 8, 24, 0.48);
      }

      * { box-sizing: border-box; }

      html { min-height: 100%; }

      body {
        margin: 0;
        min-height: 100vh;
        color: var(--fx-ink);
        font-family: "Space Grotesk", "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at 15% 20%, rgba(76, 255, 193, 0.14), transparent 26%),
          radial-gradient(circle at 82% 16%, rgba(124, 114, 255, 0.18), transparent 28%),
          radial-gradient(circle at 55% 78%, rgba(103, 240, 255, 0.11), transparent 24%),
          linear-gradient(140deg, var(--fx-bg-0) 0%, var(--fx-bg-1) 44%, var(--fx-bg-2) 100%);
        background-attachment: fixed;
      }

      body::before {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        background-image:
          linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
        background-size: 40px 40px;
        mask-image: radial-gradient(circle at center, black, transparent 78%);
      }

      a { color: inherit; }

      button,
      input,
      select,
      textarea {
        font: inherit;
      }

      button {
        cursor: pointer;
      }

      .fx-shell {
        max-width: 1440px;
        margin: 0 auto;
        padding: 22px;
      }

      .fx-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 20px;
        margin-bottom: 26px;
        padding: 14px 18px;
        border: 1px solid var(--fx-line);
        border-radius: 24px;
        background: linear-gradient(180deg, rgba(8, 13, 31, 0.9), rgba(8, 14, 31, 0.62));
        box-shadow: var(--fx-shadow);
        backdrop-filter: blur(18px);
      }

      .fx-brand {
        display: flex;
        align-items: center;
        gap: 14px;
        min-width: 0;
      }

      .fx-brand-mark {
        width: 42px;
        height: 42px;
        display: grid;
        place-items: center;
        border-radius: 14px;
        border: 1px solid rgba(103, 240, 255, 0.28);
        background: linear-gradient(145deg, rgba(103, 240, 255, 0.22), rgba(124, 114, 255, 0.14));
        color: var(--fx-primary);
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.18em;
        box-shadow: inset 0 0 28px rgba(103, 240, 255, 0.08), 0 0 28px rgba(103, 240, 255, 0.08);
      }

      .fx-brand-copy {
        min-width: 0;
      }

      .fx-brand-kicker {
        margin: 0;
        color: var(--fx-primary);
        font-size: 0.7rem;
        letter-spacing: 0.2em;
        text-transform: uppercase;
      }

      .fx-brand-title {
        margin: 4px 0 0;
        color: var(--fx-ink);
        font-size: 1rem;
        font-weight: 700;
        letter-spacing: 0.04em;
      }

      .fx-nav {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        flex: 1;
        flex-wrap: wrap;
      }

      .fx-nav-link {
        padding: 10px 14px;
        border-radius: 999px;
        text-decoration: none;
        color: var(--fx-muted);
        border: 1px solid transparent;
        background: transparent;
        transition: 160ms ease;
      }

      .fx-nav-link:hover,
      .fx-nav-link.active {
        color: var(--fx-ink);
        border-color: var(--fx-line-strong);
        background: linear-gradient(180deg, rgba(103, 240, 255, 0.12), rgba(124, 114, 255, 0.08));
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.02), 0 0 22px rgba(103, 240, 255, 0.08);
      }

      .fx-header-actions,
      .actions,
      .nav-actions,
      .cta-row,
      .button-row,
      .wallet-popup-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      .fx-main {
        display: grid;
        gap: 22px;
      }

      .fx-hero,
      .hero,
      .page-header,
      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        gap: 18px;
        flex-wrap: wrap;
      }

      .fx-hero-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
        gap: 20px;
      }

      .fx-card,
      .fx-panel,
      .panel,
      .card,
      .mini-card,
      .table-card,
      .control-shell,
      .control-card,
      .tracked-wallet-item,
      .wallet-popup,
      .timeline,
      .intel,
      .step,
      .mini {
        position: relative;
        border: 1px solid var(--fx-line);
        border-radius: 24px;
        background: linear-gradient(180deg, rgba(12, 19, 44, 0.84), rgba(8, 14, 33, 0.7));
        box-shadow: var(--fx-shadow);
        backdrop-filter: blur(18px);
        overflow: hidden;
      }

      .fx-card::before,
      .fx-panel::before,
      .panel::before,
      .card::before,
      .mini-card::before,
      .table-card::before,
      .control-shell::before,
      .control-card::before,
      .tracked-wallet-item::before,
      .wallet-popup::before,
      .timeline::before,
      .intel::before,
      .step::before,
      .mini::before {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: linear-gradient(120deg, rgba(103, 240, 255, 0.08), transparent 36%, transparent 62%, rgba(124, 114, 255, 0.08));
      }

      .fx-card,
      .panel,
      .card,
      .mini-card,
      .control-shell,
      .control-card,
      .timeline,
      .intel,
      .step,
      .mini {
        padding: 20px;
      }

      .table-card,
      .wallet-popup {
        padding: 14px;
      }

      .fx-eyebrow,
      .eyebrow,
      .kicker,
      .brand-mark,
      .section-kicker {
        margin: 0 0 10px;
        color: var(--fx-primary);
        font-size: 0.74rem;
        font-weight: 700;
        letter-spacing: 0.2em;
        text-transform: uppercase;
      }

      h1,
      .fx-title,
      .page-title {
        margin: 0;
        line-height: 0.95;
        font-size: clamp(2.3rem, 6vw, 5rem);
      }

      h2 {
        margin: 0 0 10px;
        font-size: clamp(1.1rem, 2.6vw, 1.8rem);
      }

      h3 {
        margin: 0 0 8px;
        font-size: 1rem;
      }

      p,
      li,
      td,
      .lead,
      .page-subtitle,
      .meta,
      .subtle,
      .section-copy {
        color: var(--fx-muted);
        line-height: 1.7;
      }

      .fx-lead {
        max-width: 72ch;
        font-size: 1rem;
      }

      .fx-stats,
      .stats,
      .profiles,
      .grid,
      .cards,
      .steps,
      .timeline-grid,
      .intel-grid,
      .control-grid,
      .wallet-list,
      .micro-grid,
      .help-grid,
      .quick-nav {
        display: grid;
        gap: 16px;
      }

      .fx-stats,
      .stats {
        grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      }

      .grid,
      .cards,
      .steps,
      .control-grid,
      .profiles,
      .wallet-list,
      .micro-grid,
      .help-grid {
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      }

      .quick-nav {
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        margin-top: 14px;
      }

      .help-card {
        border: 1px solid var(--fx-line);
        border-radius: 18px;
        padding: 14px;
        background: linear-gradient(180deg, rgba(14, 23, 50, 0.9), rgba(10, 18, 42, 0.72));
      }

      .timeline-grid,
      .intel-grid {
        grid-template-columns: 1fr;
      }

      .big {
        font-size: clamp(1.7rem, 3vw, 2.6rem);
        color: var(--fx-ink);
        margin: 8px 0 6px;
        text-shadow: 0 0 24px rgba(103, 240, 255, 0.16);
      }

      .pill,
      .risk,
      .badge,
      .tag,
      .step-number {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 11px;
        border-radius: 999px;
        background: rgba(103, 240, 255, 0.12);
        border: 1px solid rgba(103, 240, 255, 0.18);
        color: var(--fx-primary);
        font-size: 0.74rem;
        font-weight: 700;
        letter-spacing: 0.06em;
      }

      .risk {
        background: rgba(255, 90, 122, 0.1);
        border-color: rgba(255, 90, 122, 0.24);
        color: #ff9cb0;
      }

      .step-number {
        width: 40px;
        height: 40px;
        justify-content: center;
        padding: 0;
      }

      .fx-button,
      .button,
      .button-secondary,
      .actions a,
      .actions button,
      .logout-button,
      .wallet-popup-actions a,
      .wallet-popup-actions button,
      .button-row button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 44px;
        padding: 12px 16px;
        border-radius: 999px;
        text-decoration: none;
        color: var(--fx-ink);
        border: 1px solid var(--fx-line);
        background: linear-gradient(180deg, rgba(25, 38, 78, 0.88), rgba(11, 18, 45, 0.88));
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.02);
      }

      .fx-button.primary,
      .button,
      .button-row button.primary,
      .control-form button,
      .actions .primary {
        border-color: rgba(103, 240, 255, 0.18);
        background: linear-gradient(135deg, rgba(103, 240, 255, 0.26), rgba(124, 114, 255, 0.24));
        box-shadow: 0 0 32px rgba(103, 240, 255, 0.12);
      }

      .fx-button.secondary,
      .button-secondary {
        background: rgba(255, 255, 255, 0.03);
      }

      .fx-button.danger,
      .button-row button.danger {
        background: linear-gradient(135deg, rgba(255, 90, 122, 0.28), rgba(124, 114, 255, 0.12));
        border-color: rgba(255, 90, 122, 0.28);
      }

      .fx-button:hover,
      .button:hover,
      .button-secondary:hover,
      .actions a:hover,
      .actions button:hover,
      .logout-button:hover,
      .wallet-popup-actions a:hover,
      .wallet-popup-actions button:hover,
      .button-row button:hover {
        transform: translateY(-1px);
        box-shadow: 0 0 30px rgba(103, 240, 255, 0.12);
      }

      input,
      select,
      textarea,
      .wallet-chip,
      .analysis-panel,
      svg {
        width: 100%;
        border: 1px solid rgba(129, 196, 255, 0.18);
        border-radius: 16px;
        background: rgba(5, 10, 26, 0.88);
        color: var(--fx-ink);
      }

      input,
      select,
      textarea {
        padding: 13px 14px;
        outline: none;
      }

      input:focus,
      select:focus,
      textarea:focus {
        border-color: var(--fx-line-strong);
        box-shadow: 0 0 0 3px rgba(103, 240, 255, 0.1);
      }

      textarea {
        min-height: 110px;
        resize: vertical;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th,
      td {
        text-align: left;
        padding: 12px 10px;
        border-bottom: 1px solid rgba(129, 196, 255, 0.1);
        vertical-align: top;
      }

      tbody tr:nth-child(even) {
        background: rgba(255, 255, 255, 0.015);
      }

      tbody tr:hover {
        background: rgba(103, 240, 255, 0.06);
      }

      th {
        color: var(--fx-muted);
        font-size: 0.76rem;
        text-transform: uppercase;
        letter-spacing: 0.12em;
      }

      .control-form,
      form.control-form {
        display: grid;
        gap: 12px;
      }

      label {
        display: grid;
        gap: 8px;
        color: var(--fx-muted);
        font-size: 0.88rem;
      }

      .control-status,
      .control-result,
      .notice {
        padding: 14px 16px;
        border-radius: 18px;
        border: 1px solid rgba(129, 196, 255, 0.14);
        background: rgba(255, 255, 255, 0.03);
        color: var(--fx-muted);
      }

      .control-status.error,
      .notice.error {
        border-color: rgba(255, 90, 122, 0.24);
        color: #ffacbe;
        background: rgba(255, 90, 122, 0.08);
      }

      .control-status.success,
      .notice.success {
        border-color: rgba(76, 255, 193, 0.24);
        color: #baffea;
        background: rgba(76, 255, 193, 0.08);
      }

      .control-status.warning,
      .notice.warning {
        border-color: rgba(255, 188, 104, 0.24);
        color: #ffd9a3;
        background: rgba(255, 188, 104, 0.08);
      }

      .trend-toolbar {
        align-items: end;
      }

      .chart-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 8px 0 10px;
        min-height: 30px;
      }

      .legend-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid rgba(129, 196, 255, 0.14);
        background: rgba(255, 255, 255, 0.03);
        color: var(--fx-muted);
        font-size: 0.78rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .legend-chip.muted {
        opacity: 0.75;
      }

      .legend-swatch {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        box-shadow: 0 0 12px currentColor;
        flex: 0 0 auto;
      }

      .mono,
      .wallet-chip,
      .wallet-popup-value,
      .wallet-popup-analysis,
      .analysis-panel,
      .token,
      .addr {
        font-family: "IBM Plex Mono", "SFMono-Regular", Menlo, Monaco, Consolas, monospace;
      }

      .wallet-popup,
      .wallet-popup.active {
        color: var(--fx-ink);
      }

      .wallet-popup-value,
      .wallet-popup-analysis,
      .analysis-panel {
        padding: 10px;
        max-height: 220px;
        overflow: auto;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .wallet-chip,
      .tracked-wallet-item,
      .tracked-wallet-meta strong,
      .tracked-wallet-meta span {
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      .footer-cta {
        display: flex;
        justify-content: space-between;
        gap: 20px;
        align-items: center;
      }

      .fx-divider {
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(129, 196, 255, 0.18), transparent);
      }

      @media (max-width: 1080px) {
        .fx-header,
        .fx-hero,
        .hero,
        .page-header,
        .topbar,
        .footer-cta {
          flex-direction: column;
          align-items: flex-start;
        }

        .fx-hero-grid {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 720px) {
        .fx-shell {
          padding: 14px;
        }

        .fx-header {
          padding: 14px;
        }

        h1,
        .fx-title,
        .page-title {
          font-size: clamp(2rem, 12vw, 3.2rem);
        }

        .grid,
        .cards,
        .steps,
        .control-grid,
        .profiles,
        .wallet-list,
        .micro-grid,
        .stats,
        .fx-stats {
          grid-template-columns: 1fr;
        }
      }

      ${options.extraStyles || ''}
    </style>
  </head>
  <body class="${options.bodyClassName || ''}">
    <div class="fx-shell">
      <header class="fx-header">
        <div class="fx-brand">
          <a class="fx-brand-mark" href="/">FX</a>
          <div class="fx-brand-copy">
            <p class="fx-brand-kicker">FoilOps</p>
            <p class="fx-brand-title">Wallet Intelligence Console</p>
          </div>
        </div>
        <nav class="fx-nav">${renderNav(options.activeNav)}</nav>
        ${renderActions(options.headerActionsHtml)}
      </header>
      <main class="fx-main">
        ${options.heroHtml || ''}
        ${options.contentHtml}
      </main>
    </div>
    ${options.scriptHtml || ''}
  </body>
</html>`
}
