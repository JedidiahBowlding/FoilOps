import { renderFuturisticPage } from './site-theme'

export type ExecutionWalletRow = {
  id: string
  name: string
  publicKey: string
  isActive: boolean
  allocationWeight: number
}

function truncate(s: string, head = 6, tail = 4): string {
  if (s.length <= head + tail + 3) return s
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}

function renderWalletTable(wallets: ExecutionWalletRow[]): string {
  if (wallets.length === 0) {
    return `<p class="fx-lead" style="color:var(--fx-muted)">No execution wallets found. Generate one via the Telegram <code>/mywallet</code> command.</p>`
  }

  const rows = wallets
    .map((w) => {
      const statusBadge = w.isActive
        ? `<span class="badge active">Active</span>`
        : `<span class="badge inactive">Inactive</span>`

      const toggleBtn = w.isActive
        ? `<button class="fx-button danger sm" onclick="walletAction('deactivate','${w.id}')">Deactivate</button>`
        : `<button class="fx-button sm" onclick="walletAction('activate','${w.id}')">Activate</button>`

      return `
      <tr data-wallet-id="${w.id}">
        <td title="${w.publicKey}">${w.name || truncate(w.publicKey)}</td>
        <td style="font-family:monospace;font-size:0.82em">${truncate(w.publicKey)}</td>
        <td>${statusBadge}</td>
        <td>
          <input
            class="weight-input"
            type="number"
            min="0.01"
            max="1000"
            step="0.01"
            value="${w.allocationWeight.toFixed(2)}"
            data-wallet-id="${w.id}"
            style="width:80px;background:var(--fx-bg-2);color:var(--fx-text);border:1px solid var(--fx-border);border-radius:4px;padding:2px 6px"
          />
          <button class="fx-button sm secondary" onclick="setWeight('${w.id}')">Set</button>
        </td>
        <td>${toggleBtn}</td>
      </tr>`
    })
    .join('')

  return `
    <table class="fx-table" id="wallets-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Public Key</th>
          <th>Status</th>
          <th>Weight</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`
}

export function renderExecutionWalletsDashboard(wallets: ExecutionWalletRow[]): string {
  const activeCount = wallets.filter((w) => w.isActive).length
  const totalWeight = wallets.filter((w) => w.isActive).reduce((sum, w) => sum + w.allocationWeight, 0)

  return renderFuturisticPage({
    title: 'FoilOps — Execution Wallets',
    activeNav: 'wallets',
    headerActionsHtml: `
      <form method="post" action="/logout"><button class="fx-button" type="submit">Logout</button></form>
    `,
    heroHtml: `
      <section class="hero">
        <div>
          <p class="fx-eyebrow">Multi-active wallet management</p>
          <h1>Execution Wallets</h1>
          <p class="fx-lead">Toggle which wallets participate in trade execution and set relative allocation weights. Signals are distributed across active wallets using deterministic weighted selection.</p>
        </div>
        <div class="card" style="min-width:240px">
          <p class="eyebrow">Active wallets</p>
          <div class="big">${activeCount} / ${wallets.length}</div>
          <p>Total active weight: ${totalWeight.toFixed(2)}</p>
        </div>
      </section>
    `,
    extraStyles: `
      .badge { display:inline-block; padding:2px 8px; border-radius:12px; font-size:0.78em; font-weight:600; }
      .badge.active { background:#1a3a1a; color:#4ade80; border:1px solid #4ade80; }
      .badge.inactive { background:#2a1a1a; color:#f87171; border:1px solid #f87171; }
      .fx-button.danger { background:#7f1d1d; color:#fca5a5; border-color:#b91c1c; }
      .fx-button.danger:hover { background:#991b1b; }
      .fx-button.sm { padding:3px 10px; font-size:0.82em; }
      #status-banner { margin-bottom:1rem; padding:10px 16px; border-radius:6px; font-size:0.9em; display:none; }
      #status-banner.success { background:#14532d; color:#86efac; border:1px solid #16a34a; display:block; }
      #status-banner.error { background:#7f1d1d; color:#fca5a5; border:1px solid #b91c1c; display:block; }
    `,
    contentHtml: `
      <section class="section">
        <div class="section-header">
          <div class="section-header-copy">
            <h2>Wallet Roster</h2>
            <p class="section-subtitle">Wallets are selected per-signal using a deterministic hash weighted by allocation weight. Only active wallets are eligible for execution.</p>
          </div>
          <button class="fx-button secondary" onclick="reloadTable()">↻ Refresh</button>
        </div>
        <div id="status-banner"></div>
        ${renderWalletTable(wallets)}
      </section>
    `,
    scriptHtml: `
      <script>
        function showBanner(msg, type) {
          const b = document.getElementById('status-banner');
          b.textContent = msg;
          b.className = type;
          clearTimeout(b._t);
          b._t = setTimeout(() => { b.className = ''; b.style.display = 'none'; }, 5000);
        }

        async function walletAction(action, walletId) {
          try {
            const res = await fetch('/api/control/personal-wallets', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action, walletId })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || res.statusText);
            showBanner(data.message || 'Done.', 'success');
            reloadTable();
          } catch (e) {
            showBanner(e.message, 'error');
          }
        }

        async function setWeight(walletId) {
          const input = document.querySelector('.weight-input[data-wallet-id="' + walletId + '"]');
          const weight = parseFloat(input?.value);
          if (!isFinite(weight) || weight < 0.01) {
            showBanner('Weight must be a number >= 0.01', 'error');
            return;
          }
          try {
            const res = await fetch('/api/control/personal-wallets', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'set_weight', walletId, weight })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || res.statusText);
            showBanner(data.message || 'Weight updated.', 'success');
          } catch (e) {
            showBanner(e.message, 'error');
          }
        }

        async function reloadTable() {
          try {
            const res = await fetch('/api/control/personal-wallets');
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || res.statusText);
            location.reload();
          } catch (e) {
            showBanner(e.message, 'error');
          }
        }
      </script>
    `,
  })
}
