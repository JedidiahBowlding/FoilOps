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
        --fx-bg-0: #080508;
        --fx-bg-1: #110608;
        --fx-bg-2: #180a0a;
        --fx-panel: rgba(20, 5, 7, 0.78);
        --fx-panel-strong: rgba(14, 4, 5, 0.92);
        --fx-panel-soft: rgba(26, 8, 10, 0.72);
        --fx-line: rgba(255, 40, 60, 0.16);
        --fx-line-strong: rgba(255, 50, 70, 0.34);
        --fx-ink: #f8eded;
        --fx-muted: #b89898;
        --fx-primary: #ff2233;
        --fx-secondary: #cc0820;
        --fx-acid: #ff7744;
        --fx-danger: #ff4060;
        --fx-warning: #ffbc68;
        --fx-shadow: 0 24px 80px rgba(24, 3, 5, 0.52);
      }

      * { box-sizing: border-box; }

      html { min-height: 100%; }

      body {
        margin: 0;
        min-height: 100vh;
        color: var(--fx-ink);
        font-family: "Space Grotesk", "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at 14% 8%, rgba(255, 30, 50, 0.16), transparent 30%),
          radial-gradient(circle at 88% 18%, rgba(255, 119, 68, 0.1), transparent 34%),
          linear-gradient(180deg, var(--fx-bg-0) 0%, var(--fx-bg-1) 56%, var(--fx-bg-2) 100%);
        background-attachment: fixed;
      }

      body::before {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
        background-size: 44px 44px;
        mask-image: radial-gradient(circle at 45% 20%, black, transparent 72%);
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
        max-width: 1280px;
        margin: 0 auto;
        padding: 18px 20px 36px;
      }

      .fx-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 20px;
        margin-bottom: 20px;
        padding: 12px 16px;
        border: 1px solid var(--fx-line);
        border-radius: 12px;
        background: rgba(20, 6, 8, 0.9);
        position: sticky;
        top: 10px;
        z-index: 100;
        box-shadow: 0 12px 36px rgba(8, 2, 3, 0.34);
        backdrop-filter: blur(18px);
      }

      .fx-brand {
        display: flex;
        align-items: center;
        gap: 14px;
        min-width: 0;
      }

      .fx-brand-mark {
        width: 36px;
        height: 36px;
        display: grid;
        place-items: center;
        border-radius: 10px;
        border: 1px solid rgba(255, 30, 50, 0.28);
        background: linear-gradient(145deg, rgba(255, 30, 50, 0.18), rgba(180, 0, 20, 0.12));
        color: var(--fx-primary);
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.18em;
        box-shadow: inset 0 0 18px rgba(255, 30, 50, 0.1);
      }

      .fx-brand-copy {
        min-width: 0;
      }

      .fx-brand-kicker {
        margin: 0;
        color: var(--fx-primary);
        font-size: 0.64rem;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      .fx-brand-title {
        margin: 4px 0 0;
        color: var(--fx-ink);
        font-size: 0.88rem;
        font-weight: 800;
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
        padding: 8px 11px;
        border-radius: 7px;
        text-decoration: none;
        color: var(--fx-muted);
        border: 1px solid rgba(255, 40, 60, 0.08);
        background: transparent;
        transition: 160ms ease;
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .fx-nav-link:hover,
      .fx-nav-link.active {
        color: var(--fx-ink);
        border-color: rgba(255, 40, 60, 0.24);
        background: rgba(255, 34, 51, 0.11);
        box-shadow: none;
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
        gap: 16px;
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
        border-radius: 12px;
        background: rgba(20, 6, 8, 0.86);
        box-shadow: 0 10px 28px rgba(8, 2, 3, 0.28);
        backdrop-filter: blur(10px);
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
        background: linear-gradient(120deg, rgba(255, 30, 50, 0.06), transparent 36%, transparent 62%, rgba(180, 0, 20, 0.06));
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
        padding: 16px;
      }

      .table-card,
      .wallet-popup {
        padding: 12px;
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
        font-size: clamp(1.8rem, 4.8vw, 3.4rem);
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
        background: linear-gradient(180deg, rgba(20, 7, 9, 0.9), rgba(16, 5, 7, 0.72));
      }

      .timeline-grid,
      .intel-grid {
        grid-template-columns: 1fr;
      }

      .section {
        display: grid;
        gap: 12px;
        border: 1px solid var(--fx-line);
        border-radius: 12px;
        background: rgba(20, 6, 8, 0.86);
        box-shadow: 0 10px 28px rgba(8, 2, 3, 0.28);
        overflow: hidden;
      }

      .section > * {
        padding-inline: 14px;
      }

      .section > :last-child {
        padding-bottom: 14px;
      }

      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: end;
        gap: 14px;
        flex-wrap: wrap;
        padding-top: 12px;
        padding-bottom: 12px;
        border-bottom: 1px solid rgba(255, 40, 60, 0.16);
        background: rgba(12, 4, 6, 0.62);
      }

      .section-header-copy {
        display: grid;
        gap: 6px;
      }

      .section-subtitle {
        margin: 0;
        max-width: 78ch;
      }

      .signal-strip,
      .table-meta {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      .signal-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-radius: 999px;
        border: 1px solid rgba(255, 40, 60, 0.18);
        background: rgba(14, 5, 7, 0.84);
        color: var(--fx-ink);
        font-size: 0.82rem;
      }

      .signal-pill strong {
        color: var(--fx-primary);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        font-size: 0.7rem;
      }

      .summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
      }

      .summary-tile {
        padding: 14px 16px;
        border-radius: 18px;
        border: 1px solid rgba(255, 40, 60, 0.12);
        background: linear-gradient(180deg, rgba(18, 5, 8, 0.84), rgba(14, 4, 5, 0.68));
      }

      .summary-tile-label {
        margin: 0 0 6px;
        color: var(--fx-muted);
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      .summary-tile-value {
        color: var(--fx-ink);
        font-size: 1.15rem;
        line-height: 1.25;
      }

      .summary-tile-copy {
        margin: 8px 0 0;
        color: var(--fx-muted);
        font-size: 0.86rem;
        line-height: 1.5;
      }

      .empty-state {
        padding: 18px;
        border-radius: 18px;
        border: 1px dashed rgba(255, 40, 60, 0.22);
        background: rgba(14, 4, 5, 0.52);
      }

      .empty-state strong {
        display: block;
        margin-bottom: 6px;
        color: var(--fx-ink);
      }

      .big {
        font-size: clamp(1.7rem, 3vw, 2.6rem);
        color: var(--fx-ink);
        margin: 8px 0 6px;
        text-shadow: 0 0 24px rgba(255, 30, 50, 0.20);
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
        background: rgba(255, 30, 50, 0.12);
        border: 1px solid rgba(255, 30, 50, 0.18);
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
        background: linear-gradient(180deg, rgba(28, 8, 10, 0.88), rgba(18, 5, 7, 0.88));
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.02);
      }

      .fx-button.primary,
      .button,
      .button-row button.primary,
      .control-form button,
      .actions .primary {
        border-color: rgba(255, 30, 50, 0.30);
        background: linear-gradient(135deg, rgba(255, 30, 50, 0.32), rgba(180, 0, 20, 0.24));
        box-shadow: 0 0 32px rgba(255, 30, 50, 0.18);
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
        box-shadow: 0 0 30px rgba(255, 30, 50, 0.18);
      }

      input,
      select,
      textarea,
      .wallet-chip,
      .analysis-panel,
      svg {
        width: 100%;
        border: 1px solid rgba(255, 40, 60, 0.18);
        border-radius: 16px;
        background: rgba(12, 4, 5, 0.88);
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
        box-shadow: 0 0 0 3px rgba(255, 30, 50, 0.1);
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
        padding: 10px 8px;
        border-bottom: 1px solid rgba(255, 40, 60, 0.1);
        vertical-align: top;
      }

      tbody tr:nth-child(even) {
        background: rgba(255, 255, 255, 0.015);
      }

      tbody tr:hover {
        background: rgba(255, 30, 50, 0.06);
      }

      th {
        color: var(--fx-muted);
        font-size: 0.66rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        background: rgba(14, 4, 6, 0.95);
        position: sticky;
        top: 0;
        z-index: 1;
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
        border: 1px solid rgba(255, 40, 60, 0.14);
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
        border: 1px solid rgba(255, 40, 60, 0.14);
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
        background: linear-gradient(90deg, transparent, rgba(255, 40, 60, 0.18), transparent);
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
