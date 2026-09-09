export type SiteNavKey = 'home' | 'discovery' | 'trading' | 'scam' | 'graph' | 'foilops' | 'wallets'

type SiteNavLink = {
  key: SiteNavKey
  href: string
  label: string
}

type RenderFuturisticPageOptions = {
  title: string
  description?: string
  canonicalPath?: string
  indexable?: boolean
  activeNav?: SiteNavKey
  heroHtml?: string
  contentHtml: string
  headerActionsHtml?: string
  extraStyles?: string
  scriptHtml?: string
  bodyClassName?: string
}

const NAV_LINKS: SiteNavLink[] = [
  { key: 'discovery', href: '/dashboard/discovery', label: 'Discovery' },
  { key: 'home', href: '/dashboard/research', label: 'Research' },
  { key: 'trading', href: '/dashboard/execution', label: 'Trade' },
  { key: 'foilops', href: '/dashboard/foilops', label: 'Intelligence' },
  { key: 'wallets', href: '/dashboard/execution-wallets', label: 'Wallets' },
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
  const description = options.description || 'FoilOps is an institutional crypto intelligence and guarded execution platform for wallet monitoring, token research, and on-chain risk analysis.'
  const canonicalUrl = options.canonicalPath ? `https://foilops.com${options.canonicalPath}` : ''
  const robots = options.indexable ? 'index, follow, max-image-preview:large' : 'noindex, nofollow, noarchive'
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${options.title}</title>
    <meta name="description" content="${description}" />
    <meta name="robots" content="${robots}" />
    <meta name="theme-color" content="#030611" />
    ${canonicalUrl ? `<link rel="canonical" href="${canonicalUrl}" />` : ''}
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="/site.webmanifest" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="FOILOPS" />
    <meta property="og:title" content="${options.title}" />
    <meta property="og:description" content="${description}" />
    ${canonicalUrl ? `<meta property="og:url" content="${canonicalUrl}" />` : ''}
    <meta property="og:image" content="https://foilops.com/showcase/FoilOps_banner_v2.webp" />
    <meta property="og:image:alt" content="FOILOPS crypto intelligence and trading control platform" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${options.title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="https://foilops.com/showcase/FoilOps_banner_v2.webp" />
    ${options.indexable ? '<script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"FOILOPS","url":"https://foilops.com/","applicationCategory":"FinanceApplication","operatingSystem":"Web","description":"Crypto wallet intelligence, token research, and guarded execution platform."}</script>' : ''}
    <style>
      :root {
        color-scheme: dark;
        --fx-bg-0: #030611;
        --fx-bg-1: #07101f;
        --fx-bg-2: #0b1629;
        --fx-panel: #0b1220;
        --fx-panel-strong: #101827;
        --fx-panel-soft: rgba(10, 23, 43, 0.62);
        --fx-line: rgba(103, 232, 249, 0.14);
        --fx-line-strong: rgba(103, 232, 249, 0.36);
        --fx-ink: #effaff;
        --fx-muted: #8fa8bd;
        --fx-primary: #67e8f9;
        --fx-secondary: #8b5cf6;
        --fx-acid: #a3ff12;
        --fx-danger: #fb7185;
        --fx-warning: #fbbf24;
        --fx-success: #34d399;
        --fx-shadow: 0 10px 30px rgba(0, 0, 0, 0.22);
      }

      * { box-sizing: border-box; }

      html { min-height: 100%; }

      body {
        margin: 0;
        min-height: 100vh;
        color: var(--fx-ink);
        font-family: "Space Grotesk", "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at 14% -10%, rgba(34,211,238,.15), transparent 30rem),
          radial-gradient(circle at 90% 8%, rgba(139,92,246,.14), transparent 34rem),
          linear-gradient(180deg, var(--fx-bg-0), #050b17 46%, #030611);
        background-attachment: fixed;
        overflow-x: hidden;
      }

      body::before {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        opacity: .22;
        background-image:
          linear-gradient(rgba(103,232,249,.055) 1px, transparent 1px),
          linear-gradient(90deg, rgba(103,232,249,.055) 1px, transparent 1px);
        background-size: 44px 44px;
        mask-image: linear-gradient(to bottom, black, transparent 78%);
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

      :focus-visible {
        outline: 2px solid var(--fx-primary);
        outline-offset: 3px;
      }

      .fx-skip-link {
        position: fixed;
        top: 8px;
        left: 12px;
        z-index: 999;
        padding: 10px 14px;
        border-radius: 999px;
        background: var(--fx-ink);
        color: var(--fx-bg-0);
        transform: translateY(-150%);
      }

      .fx-skip-link:focus { transform: translateY(0); }

      .fx-shell {
        max-width: 1600px;
        margin: 0 auto;
        padding: 20px 24px 42px;
      }

      .fx-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 20px;
        margin-bottom: 0;
        padding: 0.75rem max(18px, calc((100vw - 1440px) / 2 + 24px));
        border-bottom: 1px solid var(--fx-line);
        border-radius: 0;
        background: rgba(3, 8, 20, 0.76);
        position: sticky;
        top: 0;
        z-index: 100;
        box-shadow: 0 10px 40px rgba(0,0,0,.22);
        backdrop-filter: blur(18px) saturate(140%);
      }

      .fx-menu-toggle,
      .fx-menu-backdrop { display: none; }

      .fx-menu-toggle {
        border: 1px solid var(--fx-line-strong);
        color: var(--fx-ink);
        background: rgba(7, 16, 31, .9);
        box-shadow: 0 14px 42px rgba(0,0,0,.38), 0 0 24px rgba(103,232,249,.12);
        backdrop-filter: blur(18px) saturate(140%);
      }

      .fx-menu-icon,
      .fx-menu-icon::before,
      .fx-menu-icon::after {
        display: block;
        width: 20px;
        height: 2px;
        border-radius: 8px;
        background: currentColor;
        transition: transform 180ms ease, opacity 180ms ease;
      }

      .fx-menu-icon { position: relative; }
      .fx-menu-icon::before,
      .fx-menu-icon::after { content: ""; position: absolute; left: 0; }
      .fx-menu-icon::before { transform: translateY(-6px); }
      .fx-menu-icon::after { transform: translateY(6px); }

      .fx-header-left {
        display: inline-flex;
        align-items: center;
      }

      .fx-logo {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        text-decoration: none;
        color: var(--fx-ink);
        font-weight: 800;
        letter-spacing: 0.06em;
        font-size: 1.05rem;
        text-shadow: 0 0 22px rgba(103,232,249,.7);
      }

      .fx-logo img {
        width: 34px;
        height: 34px;
        display: block;
        border-radius: 9px;
        box-shadow: 0 0 22px rgba(103,232,249,.18);
      }

      .fx-logo-word { display:inline-flex; letter-spacing:.06em; }
      .fx-logo-foil { color:#f7fbff; }
      .fx-logo-ops { color:var(--fx-primary); }

      .fx-nav {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        flex: 1;
        flex-wrap: wrap;
      }

      .fx-nav-link {
        padding: 8px 11px;
        border-radius: 999px;
        text-decoration: none;
        color: var(--fx-muted);
        border: 1px solid transparent;
        background: transparent;
        transition: 160ms ease;
        font-size: 0.8rem;
        letter-spacing: 0.01em;
      }

      .fx-nav-link:hover,
      .fx-nav-link.active {
        color: var(--fx-ink);
        border-color: var(--fx-line);
        background: linear-gradient(135deg, rgba(103,232,249,.12), rgba(139,92,246,.1));
        box-shadow: inset 0 0 18px rgba(103,232,249,.04);
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
        margin-top: 24px;
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
        background: linear-gradient(180deg, rgba(15,24,39,.96), rgba(9,16,28,.96));
        box-shadow: var(--fx-shadow);
        backdrop-filter: blur(14px) saturate(130%);
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
        inset: 0 0 auto;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(103,232,249,.58), rgba(139,92,246,.45), transparent);
        pointer-events: none;
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
        padding: clamp(18px, 2.4vw, 28px);
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
        font-size: clamp(2.15rem, 5vw, 4.8rem);
        letter-spacing: -.045em;
        background: linear-gradient(110deg, #ffffff 12%, #baf7ff 52%, #b7a7ff 96%);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
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
        border-radius: 22px;
        background: linear-gradient(145deg, rgba(12,26,48,.8), rgba(5,13,27,.72));
        box-shadow: var(--fx-shadow);
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
        border-bottom: 1px solid var(--fx-line);
        background: rgba(5, 13, 27, 0.58);
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
        border-radius: 9px;
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
        text-shadow: 0 0 28px rgba(103, 232, 249, 0.2);
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
        background: rgba(103, 232, 249, 0.1);
        border: 1px solid rgba(103, 232, 249, 0.2);
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
        background: linear-gradient(180deg, rgba(17, 34, 57, 0.9), rgba(8, 19, 37, 0.9));
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.02);
      }

      .fx-button.primary,
      .button,
      .button-row button.primary,
      .control-form button,
      .actions .primary {
        border-color: rgba(103, 232, 249, 0.36);
        background: linear-gradient(135deg, rgba(14,165,233,.3), rgba(124,58,237,.3));
        box-shadow: 0 0 34px rgba(34,211,238,.13);
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
        box-shadow: 0 0 34px rgba(34, 211, 238, 0.18);
      }

      input,
      select,
      textarea,
      .wallet-chip,
      .analysis-panel,
      svg {
        width: 100%;
        border: 1px solid rgba(103, 232, 249, 0.18);
        border-radius: 16px;
        background: rgba(3, 10, 23, 0.88);
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

      .viz-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
      }

      .viz-card {
        min-height: 260px;
        display: grid;
        align-content: start;
        gap: 16px;
      }

      .viz-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }

      .viz-title { margin: 0; font-size: 1rem; }
      .viz-caption { margin: 3px 0 0; font-size: .82rem; }

      .donut-wrap {
        display: grid;
        grid-template-columns: minmax(130px, 170px) 1fr;
        align-items: center;
        gap: 24px;
      }

      .donut {
        width: min(44vw, 170px);
        aspect-ratio: 1;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: conic-gradient(var(--fx-primary) 0 var(--p1, 35%), var(--fx-secondary) var(--p1, 35%) var(--p2, 60%), var(--fx-warning) var(--p2, 60%) var(--p3, 75%), var(--fx-danger) var(--p3, 75%) 100%);
        box-shadow: 0 0 45px rgba(34,211,238,.12);
        position: relative;
      }

      .donut::after {
        content: "";
        width: 68%;
        aspect-ratio: 1;
        border-radius: 50%;
        background: #07101f;
        border: 1px solid var(--fx-line);
      }

      .donut-label {
        position: absolute;
        z-index: 1;
        text-align: center;
        font-size: 1.5rem;
        font-weight: 800;
      }

      .donut-label small { display:block; font-size:.62rem; color:var(--fx-muted); text-transform:uppercase; letter-spacing:.12em; }

      .bar-list { display:grid; gap:12px; }
      .bar-row { display:grid; gap:6px; }
      .bar-meta { display:flex; justify-content:space-between; gap:12px; font-size:.78rem; color:var(--fx-muted); }
      .bar-track { height:9px; border-radius:999px; background:rgba(143,168,189,.12); overflow:hidden; }
      .bar-fill { display:block; height:100%; width:var(--value,0%); border-radius:inherit; background:linear-gradient(90deg,var(--fx-primary),var(--fx-secondary)); box-shadow:0 0 18px rgba(103,232,249,.28); }

      .flow-diagram {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 28px;
        align-items: stretch;
      }

      .home-operations {
        display: grid;
        grid-template-columns: 1fr;
        gap: 22px;
      }

      .home-operations .flow-node {
        min-height: 220px;
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
      }

      .home-operations .flow-node p { margin-bottom: 0; }

      .flow-node { position:relative; min-width:0; }
      .flow-node:not(:last-child)::after { content:"→"; position:absolute; right:-22px; top:50%; color:var(--fx-primary); font-size:1.3rem; }

      .sparkline { width:100%; height:90px; border:0; background:transparent; overflow:visible; }
      .sparkline-grid { stroke:rgba(143,168,189,.12); stroke-width:1; }
      .sparkline-area { fill:url(#fxArea); opacity:.42; }
      .sparkline-line { fill:none; stroke:var(--fx-primary); stroke-width:3; stroke-linecap:round; stroke-linejoin:round; filter:drop-shadow(0 0 6px rgba(103,232,249,.55)); }

      /* Institutional component system */
      .ui-status{display:inline-flex;align-items:center;gap:6px;padding:5px 8px;border-radius:7px;font-size:.72rem;font-weight:700;letter-spacing:.02em;background:rgba(148,163,184,.09);color:#b7c4d4}.ui-status--success{color:#62dca0;background:rgba(52,211,153,.10)}.ui-status--warning{color:#f2c35b;background:rgba(251,191,36,.10)}.ui-status--danger{color:#ff8495;background:rgba(251,113,133,.10)}.ui-status--info{color:#78d9e7;background:rgba(103,232,249,.09)}
      .ui-metric{min-width:0;padding:15px;border-top:1px solid rgba(148,163,184,.12);background:rgba(255,255,255,.018)}.ui-metric__head{display:flex;justify-content:space-between;gap:8px;color:#8291a5;font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.ui-metric strong{display:block;margin-top:9px;color:#f4f8fc;font-size:1.3rem;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.ui-metric small{display:block;margin-top:5px;color:#8291a5;line-height:1.4}.ui-metric details{margin-top:8px;color:#718096;font-size:.72rem}.ui-metric--success{border-top-color:#34d399}.ui-metric--warning{border-top-color:#fbbf24}.ui-metric--danger{border-top-color:#fb7185}
      .ui-order-summary{display:flex;justify-content:space-between;gap:20px;padding:20px 0;border-bottom:1px solid rgba(148,163,184,.12)}.ui-order-summary p{margin:0;color:#7f8da1;font-size:.72rem;text-transform:uppercase;letter-spacing:.1em}.ui-order-summary h2{margin:7px 0 11px;font-size:clamp(1.35rem,2.4vw,2rem);letter-spacing:-.025em}.ui-order-summary__meta{display:flex;gap:7px;flex-wrap:wrap}
      .ui-risk-check{display:grid;grid-template-columns:28px 1fr;gap:10px;padding:11px 0;border-bottom:1px solid rgba(148,163,184,.08)}.ui-risk-check>span{display:grid;place-items:center;width:24px;height:24px;border-radius:7px;background:rgba(148,163,184,.08);font-weight:800}.ui-risk-check strong,.ui-risk-check small{display:block}.ui-risk-check small{margin-top:3px;color:#8291a5}.ui-risk-check--passed>span{color:#34d399}.ui-risk-check--warning>span{color:#fbbf24}.ui-risk-check--blocked>span{color:#fb7185}
      .ui-timeline{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));margin:0 0 20px;padding:0;list-style:none}.ui-timeline li{position:relative;display:grid;gap:7px;justify-items:center;text-align:center;color:#65758b;font-size:.68rem}.ui-timeline li:not(:last-child)::after{content:"";position:absolute;top:12px;left:calc(50% + 17px);right:calc(-50% + 17px);height:1px;background:#253247}.ui-timeline span{display:grid;place-items:center;width:25px;height:25px;border-radius:7px;background:#162133;border:1px solid #28364b;z-index:1}.ui-timeline .complete,.ui-timeline .active{color:#d7e2ef}.ui-timeline .complete span{color:#34d399;border-color:rgba(52,211,153,.4)}.ui-timeline .active span{color:#67e8f9;border-color:#67e8f9}
      .ui-drawer{margin-top:12px;border-top:1px solid rgba(148,163,184,.1);padding-top:10px}.ui-drawer summary{cursor:pointer;color:#91a1b5;font-size:.78rem}.ui-confirmation{padding:14px;border-left:3px solid #fbbf24;background:rgba(251,191,36,.055)}.ui-activity{display:grid}.ui-activity__item{display:grid;grid-template-columns:10px 1fr auto;gap:10px;padding:11px 0;border-bottom:1px solid rgba(148,163,184,.08)}.ui-activity__item i{width:7px;height:7px;margin-top:5px;border-radius:50%;background:#64748b}.ui-activity__item strong,.ui-activity__item small{display:block}.ui-activity__item small,.ui-activity__item time{color:#738398;font-size:.72rem}
      .fx-icon-button{display:inline-grid;place-items:center;width:38px;height:38px;padding:0;border:1px solid rgba(148,163,184,.14);border-radius:9px;background:rgba(255,255,255,.025);color:#9dafc3;text-decoration:none;font:700 .78rem/1 ui-monospace,monospace;cursor:pointer}.fx-icon-button:hover{color:#eef6ff;border-color:rgba(103,232,249,.35);background:rgba(103,232,249,.07)}
      .fx-confirm-overlay{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:18px;background:rgba(1,4,12,.76);backdrop-filter:blur(10px);opacity:0;pointer-events:none;transition:opacity .16s ease}.fx-confirm-overlay.open{opacity:1;pointer-events:auto}.fx-confirm-dialog{width:min(100%,500px);padding:24px;border:1px solid rgba(103,232,249,.22);border-radius:12px;background:#0b1220;box-shadow:0 30px 90px rgba(0,0,0,.58),0 0 42px rgba(103,232,249,.07);transform:translateY(10px) scale(.98);transition:transform .16s ease}.fx-confirm-overlay.open .fx-confirm-dialog{transform:none}.fx-confirm-kicker{margin:0 0 8px;color:var(--fx-primary);font-size:.68rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.fx-confirm-dialog h2{margin:0;font-size:1.35rem;letter-spacing:-.02em}.fx-confirm-message{margin:12px 0 20px;color:#9aabc0;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}.fx-confirm-actions{display:flex;justify-content:flex-end;gap:9px}.fx-confirm-actions button{min-width:112px}.fx-confirm-approve.danger{background:var(--fx-danger);border-color:var(--fx-danger);color:#16060a}.fx-confirm-approve.danger:hover{background:#ff91a1}@media(max-width:520px){.fx-confirm-dialog{padding:20px}.fx-confirm-actions{display:grid;grid-template-columns:1fr}.fx-confirm-actions button{width:100%}}

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

        .fx-header {
          padding: 14px 16px;
        }

        .fx-hero-grid {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 720px) {
        body { padding-top: 74px; }

        .fx-menu-toggle {
          display: grid;
          place-items: center;
          position: fixed;
          top: 14px;
          right: 14px;
          z-index: 302;
          width: 52px;
          height: 52px;
          padding: 0;
          border-radius: 17px;
        }

        .fx-menu-backdrop {
          display: block;
          position: fixed;
          inset: 0;
          z-index: 299;
          background: rgba(1, 4, 12, .68);
          backdrop-filter: blur(5px);
          opacity: 0;
          pointer-events: none;
          transition: opacity 180ms ease;
        }

        .fx-header {
          position: fixed;
          inset: 12px 12px auto;
          z-index: 301;
          max-height: calc(100dvh - 24px);
          overflow-y: auto;
          padding: 22px;
          border: 1px solid var(--fx-line-strong);
          border-radius: 24px;
          box-shadow: 0 28px 90px rgba(0,0,0,.55), 0 0 42px rgba(103,232,249,.08);
          opacity: 0;
          transform: translateY(-18px) scale(.97);
          transform-origin: top right;
          pointer-events: none;
          transition: opacity 180ms ease, transform 180ms ease;
          align-items: stretch;
        }

        body.fx-menu-open { overflow: hidden; }
        body.fx-menu-open .fx-header { opacity: 1; transform: none; pointer-events: auto; }
        body.fx-menu-open .fx-menu-backdrop { opacity: 1; pointer-events: auto; }
        body.fx-menu-open .fx-menu-icon { background: transparent; }
        body.fx-menu-open .fx-menu-icon::before { transform: rotate(45deg); }
        body.fx-menu-open .fx-menu-icon::after { transform: rotate(-45deg); }

        .fx-header-left { padding-right: 58px; }
        .fx-logo { font-size: 1.2rem; }
        .fx-nav { display:grid; width:100%; gap:7px; }
        .fx-nav-link { display:flex; justify-content:flex-start; width:100%; padding:13px 15px; min-height:46px; position:relative; z-index:1; pointer-events:auto; touch-action:manipulation; }
        .fx-header-actions { display:grid; width:100%; }
        .fx-header-actions .fx-raw-data { display:none; }
        .fx-header-actions > *,
        .fx-header-actions .fx-button,
        .fx-header-actions button { width:100%; }

        .fx-shell {
          padding: 14px 12px 26px;
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

        .viz-grid,
        .flow-diagram { grid-template-columns: 1fr; }
        .flow-node:not(:last-child)::after { content:"↓"; right:auto; left:50%; top:auto; bottom:-24px; }
        .donut-wrap { grid-template-columns:1fr; justify-items:center; }
        .ui-timeline{grid-template-columns:1fr;gap:8px}.ui-timeline li{grid-template-columns:30px 1fr;justify-items:start;text-align:left;align-items:center}.ui-timeline li:not(:last-child)::after{top:27px;bottom:-8px;left:12px;right:auto;width:1px;height:auto}

        .fx-card,
        .panel,
        .card,
        .section { border-radius:18px; }

        /* Tables scroll horizontally instead of breaking layout */
        table {
          display: block;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }

        /* Hero cards with hardcoded min-width stop forcing overflow */
        .card[style*="min-width"],
        .panel[style*="min-width"] {
          min-width: 0 !important;
          width: 100%;
        }

        /* Section header stacks on narrow screens */
        .section-header {
          flex-direction: column;
          align-items: flex-start;
        }
      }

      @media (max-width: 480px) {
        .fx-nav {
          width: 100%;
          overflow: visible;
          padding: 0;
          margin: 0;
        }

        /* Header actions wrap to a second row and fill available width */
        .fx-header-actions,
        .actions,
        .nav-actions,
        .cta-row {
          flex-wrap: wrap;
          width: 100%;
        }
        .fx-header-actions .fx-button,
        .fx-header-actions a.fx-button,
        .fx-header-actions button {
          flex: 1 1 auto;
          min-width: 0;
        }

        /* Button rows stack vertically so each button is full width */
        .button-row {
          flex-direction: column;
        }
        .button-row button,
        .button-row a {
          width: 100%;
          justify-content: center;
        }

        /* Wallet popup action buttons stack vertically */
        .wallet-popup-actions {
          flex-direction: column;
        }
        .wallet-popup-actions button,
        .wallet-popup-actions a {
          width: 100%;
          justify-content: center;
        }

        /* Larger touch targets */
        .fx-button,
        .button,
        .fx-nav-link {
          min-height: 48px;
        }

        .fx-shell { padding-inline:10px; }
        .fx-main { gap:14px; }
        .fx-card, .panel, .card, .mini-card, .control-shell, .control-card, .timeline, .intel, .step, .mini { padding:16px; }
        th, td { min-width:120px; }
      }

      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { scroll-behavior:auto !important; transition:none !important; animation:none !important; }
      }

      ${options.extraStyles || ''}
    </style>
  </head>
  <body class="${options.bodyClassName || ''}">
    <a class="fx-skip-link" href="#main-content">Skip to main content</a>
    <button class="fx-menu-toggle" type="button" aria-label="Open navigation" aria-controls="site-navigation" aria-expanded="false"><span class="fx-menu-icon" aria-hidden="true"></span></button>
    <div class="fx-menu-backdrop" aria-hidden="true"></div>
    <header class="fx-header" id="site-navigation">
      <div class="fx-header-left"><a class="fx-logo" href="/" aria-label="FOILOPS home"><img src="/favicon.svg" alt="" width="34" height="34" /><span class="fx-logo-word" aria-hidden="true"><span class="fx-logo-foil">FOIL</span><span class="fx-logo-ops">OPS</span></span></a></div>
      <nav class="fx-nav" aria-label="Primary navigation">${renderNav(options.activeNav)}</nav>
      ${renderActions(options.headerActionsHtml)}
    </header>
    <div class="fx-shell">
      <main class="fx-main" id="main-content">
        ${options.heroHtml || ''}
        ${options.contentHtml}
      </main>
    </div>
    <div class="fx-confirm-overlay" id="fx-confirm-overlay" aria-hidden="true" hidden><section class="fx-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="fx-confirm-title" aria-describedby="fx-confirm-message"><p class="fx-confirm-kicker">Operator confirmation</p><h2 id="fx-confirm-title">Confirm action</h2><p class="fx-confirm-message" id="fx-confirm-message"></p><div class="fx-confirm-actions"><button class="fx-button secondary" id="fx-confirm-cancel" type="button">Go back</button><button class="fx-button fx-confirm-approve" id="fx-confirm-approve" type="button">Confirm</button></div></section></div>
    ${options.scriptHtml || ''}
    <script>
      window.foilopsConfirm = ({ title = 'Confirm action', message = '', confirmLabel = 'Confirm', danger = false } = {}) => new Promise((resolve) => {
        const overlay = document.getElementById('fx-confirm-overlay')
        const heading = document.getElementById('fx-confirm-title')
        const copy = document.getElementById('fx-confirm-message')
        const cancel = document.getElementById('fx-confirm-cancel')
        const approve = document.getElementById('fx-confirm-approve')
        if (!overlay || !heading || !copy || !cancel || !approve) return resolve(false)
        heading.textContent = title
        copy.textContent = message
        approve.textContent = confirmLabel
        approve.classList.toggle('danger', danger)
        overlay.hidden = false
        overlay.classList.add('open')
        overlay.setAttribute('aria-hidden', 'false')
        const finish = (result) => { overlay.classList.remove('open'); overlay.hidden = true; overlay.setAttribute('aria-hidden', 'true'); cancel.removeEventListener('click', onCancel); approve.removeEventListener('click', onApprove); overlay.removeEventListener('click', onBackdrop); document.removeEventListener('keydown', onKey); resolve(result) }
        const onCancel = () => finish(false)
        const onApprove = () => finish(true)
        const onBackdrop = (event) => { if (event.target === overlay) finish(false) }
        const onKey = (event) => { if (event.key === 'Escape') finish(false) }
        cancel.addEventListener('click', onCancel)
        approve.addEventListener('click', onApprove)
        overlay.addEventListener('click', onBackdrop)
        document.addEventListener('keydown', onKey)
        requestAnimationFrame(() => cancel.focus())
      })
      ;(() => {
        const toggle = document.querySelector('.fx-menu-toggle')
        const backdrop = document.querySelector('.fx-menu-backdrop')
        const header = document.querySelector('.fx-header')
        if (!toggle || !header) return

        const closeMenu = () => {
          document.body.classList.remove('fx-menu-open')
          toggle.setAttribute('aria-expanded', 'false')
          toggle.setAttribute('aria-label', 'Open navigation')
        }
        const openMenu = () => {
          document.body.classList.add('fx-menu-open')
          toggle.setAttribute('aria-expanded', 'true')
          toggle.setAttribute('aria-label', 'Close navigation')
        }

        toggle.addEventListener('click', () => document.body.classList.contains('fx-menu-open') ? closeMenu() : openMenu())
        backdrop?.addEventListener('click', closeMenu)
        header.addEventListener('click', (event) => {
          const target = event.target
          const link = target instanceof Element ? target.closest('a[href]') : null
          if (link && window.matchMedia('(max-width: 720px)').matches) closeMenu()
        })
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') closeMenu()
        })
        window.addEventListener('resize', () => {
          if (!window.matchMedia('(max-width: 720px)').matches) closeMenu()
        })
      })()
    </script>
  </body>
</html>`
}
