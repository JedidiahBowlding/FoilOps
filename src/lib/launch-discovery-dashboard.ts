import { PrismaLaunchCandidateRepository } from '../repositories/prisma/launch-candidate'
import { renderFuturisticPage } from './site-theme'

type Candidate = Awaited<ReturnType<PrismaLaunchCandidateRepository['list']>>[number]

export class LaunchDiscoveryDashboard {
  constructor(private readonly repository: PrismaLaunchCandidateRepository) {}

  async renderHtmlDashboard(): Promise<string> {
    const candidates = await this.repository.list({ limit: 100 })
    const ranked = candidates
      .filter((candidate) => candidate.classification !== 'REJECT')
      .slice(0, 3)
    const rankedIds = new Set(ranked.map((candidate) => candidate.id))
    const displayed = [...ranked, ...candidates.filter((candidate) => !rankedIds.has(candidate.id))].slice(0, 3)
    const robinhoodCandidates = candidates.filter((candidate) => candidate.chain === 'robinhood').slice(0, 3)
    const solanaCount = candidates.filter((candidate) => candidate.chain === 'solana').length
    const robinhoodCount = candidates.filter((candidate) => candidate.chain === 'robinhood').length

    return renderFuturisticPage({
      title: 'FoilOps Launch Discovery',
      activeNav: 'discovery',
      headerActionsHtml: `
        <button class="fx-button" id="poll-launches" type="button">Scan Now</button>
        <button class="fx-button secondary" id="refresh-launches" type="button">Refresh</button>
        <a class="fx-button secondary" href="/api/discovery/candidates?limit=100">JSON</a>
        <form method="post" action="/logout"><button class="fx-button" type="submit">Logout</button></form>
      `,
      heroHtml: `
        <section class="hero">
          <div>
            <p class="fx-eyebrow">Autonomous evidence pipeline</p>
            <h1>Launch Discovery</h1>
            <p class="fx-lead">New token launches ranked by independently collected evidence. A candidate is research—not a buy recommendation.</p>
          </div>
          <article class="card" style="min-width:280px">
            <p class="eyebrow">Current inventory</p>
            <div class="big">${candidates.length}</div>
            <p>${ranked.length} non-rejected · ${solanaCount} Solana · ${robinhoodCount} Robinhood.</p>
          </article>
        </section>
      `,
      contentHtml: `
        <section class="section">
          <div class="section-header">
            <div class="section-header-copy">
              <h2>Top 3 Candidates</h2>
              <p class="section-subtitle">Qualified launches appear first; rejected launches remain visible when fewer than three currently pass the evidence gates.</p>
            </div>
            <div id="scan-status" class="notice">Scores change as holder and liquidity evidence develops.</div>
          </div>
          <div class="discovery-grid">
            ${displayed.map((candidate, index) => this.renderCandidate(candidate, index + 1)).join('') || '<div class="notice">No candidates have been collected yet. Select Scan Now to poll launch sources.</div>'}
          </div>
        </section>
        <section class="section">
          <div class="section-header">
            <div class="section-header-copy">
              <h2>Robinhood Chain</h2>
              <p class="section-subtitle">Latest Robinhood ERC-20 deployments, kept visible independently from the overall ranking.</p>
            </div>
            <a class="fx-button secondary" href="/api/discovery/candidates?chain=robinhood&limit=100">Robinhood JSON</a>
          </div>
          <div class="discovery-grid">
            ${robinhoodCandidates.map((candidate, index) => this.renderCandidate(candidate, index + 1)).join('') || '<div class="notice">No Robinhood contracts collected yet.</div>'}
          </div>
        </section>
      `,
      extraStyles: `
        .discovery-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; }
        .candidate-card { display:flex; flex-direction:column; gap:12px; min-width:0; }
        .candidate-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }
        .candidate-rank { color:var(--fx-warning); font-size:.78rem; letter-spacing:.12em; text-transform:uppercase; }
        .candidate-mint { overflow-wrap:anywhere; color:var(--fx-muted); font-family:monospace; font-size:.78rem; }
        .score-row { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
        .score-box { padding:10px; border:1px solid var(--fx-line); border-radius:12px; background:rgba(255,255,255,.025); }
        .score-box strong { display:block; font-size:1.55rem; }
        .classification { display:inline-flex; padding:5px 9px; border-radius:999px; border:1px solid var(--fx-line-strong); color:var(--fx-warning); font-size:.75rem; }
        .evidence-list { margin:0; padding-left:18px; color:var(--fx-muted); }
        .candidate-meta { display:flex; gap:8px; flex-wrap:wrap; color:var(--fx-muted); font-size:.8rem; }
        @media (max-width:900px) { .discovery-grid { grid-template-columns:1fr; } }
      `,
      scriptHtml: `
        <script>
          const status = document.getElementById('scan-status');
          document.getElementById('refresh-launches').addEventListener('click', () => location.reload());
          document.getElementById('poll-launches').addEventListener('click', async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            status.textContent = 'Scanning configured launch sources…';
            try {
              const response = await fetch('/api/discovery/poll', { method: 'POST' });
              if (!response.ok) throw new Error('Scan failed with HTTP ' + response.status);
              const result = await response.json();
              status.textContent = 'Scan complete: ' + (result.discovered || result.processed || 0) + ' launches processed. Refreshing…';
              location.reload();
            } catch (error) {
              status.textContent = error.message || 'Scan failed';
              button.disabled = false;
            }
          });
        </script>
      `,
    })
  }

  async renderEvidenceHistory(chain: string, tokenMint: string): Promise<string | null> {
    const history = await this.repository.getHistory(chain, tokenMint, 50)
    if (!history) return null

    const candidate = history.candidate
    const evidence = (candidate.evidence || {}) as Record<string, unknown>
    const rationale = Array.isArray(evidence.rationale) ? evidence.rationale.map(String) : []
    const sources = Array.isArray(evidence.evidenceSources) ? evidence.evidenceSources.map(String) : []
    const errors = Array.isArray(evidence.collectionErrors) ? evidence.collectionErrors.map(String) : []
    const pools = Array.isArray(evidence.liquidityPools)
      ? (evidence.liquidityPools as Array<Record<string, unknown>>)
      : []
    const label = String(evidence.symbol || evidence.name || candidate.tokenMint.slice(0, 8))
    const projectLinks = this.renderProjectLinks(evidence)
    const rawApiPath = `/api/discovery/candidates/${encodeURIComponent(chain)}/${encodeURIComponent(tokenMint)}/history`

    return renderFuturisticPage({
      title: `${label} Evidence | FoilOps`,
      activeNav: 'discovery',
      headerActionsHtml: `
        <a class="fx-button secondary" href="/dashboard/discovery">Back to Discovery</a>
        <a class="fx-button secondary" href="${rawApiPath}">Raw JSON</a>
        <form method="post" action="/logout"><button class="fx-button" type="submit">Logout</button></form>
      `,
      heroHtml: `
        <section class="hero">
          <div>
            <p class="fx-eyebrow">Candidate evidence record · ${this.escape(chain)}</p>
            <h1>${this.escape(label)}</h1>
            <p class="fx-lead mint-value">${this.escape(candidate.tokenMint)}</p>
          </div>
          <article class="card verdict-card">
            <p class="eyebrow">Current verdict</p>
            <div class="big">${this.escape(candidate.classification)}</div>
            <p>${this.escape(candidate.source)} · detected ${this.formatDate(candidate.detectedAt)}</p>
          </article>
        </section>
      `,
      contentHtml: `
        <section class="stats evidence-stats">
          ${this.metric('Opportunity', candidate.opportunityScore, 'Higher is stronger, after evidence gates.')}
          ${this.metric('Risk', candidate.riskScore, 'Lower is safer.')}
          ${this.metric('Liquidity', this.money(evidence.liquidityUsd), 'Must be independently verified at $10,000+.')}
          ${this.metric('Top 10 Holders', this.percent(evidence.top10HolderPercent), 'Lower concentration is preferred.')}
          ${this.metric('Creator Holdings', this.percent(evidence.creatorHoldPercent), 'Creator concentration risk.')}
          ${this.metric('Holder Accounts', evidence.holderAccountsSampled ?? '—', 'Accounts sampled during collection.')}
        </section>

        <section class="section detail-grid">
          <article class="card">
            <h2>Safety Checks</h2>
            <div class="check-list">
              ${this.check('Liquidity threshold', typeof evidence.liquidityUsd === 'number' && evidence.liquidityUsd >= 10_000, this.money(evidence.liquidityUsd))}
              ${this.check('Mint authority revoked', evidence.mintAuthority === null, evidence.mintAuthority === null ? 'No active authority' : String(evidence.mintAuthority || 'Unknown'))}
              ${this.check('Freeze authority revoked', evidence.freezeAuthority === null, evidence.freezeAuthority === null ? 'No active authority' : String(evidence.freezeAuthority || 'Unknown'))}
              ${this.check('Top 10 concentration ≤ 50%', Number(evidence.top10HolderPercent) <= 50, this.percent(evidence.top10HolderPercent))}
              ${this.check('Creator holdings ≤ 20%', Number(evidence.creatorHoldPercent) <= 20, this.percent(evidence.creatorHoldPercent))}
              ${this.check('Holder history complete', evidence.holderHistoryComplete === true, evidence.holderHistoryComplete === true ? 'Complete' : 'Incomplete')}
            </div>
          </article>
          <article class="card">
            <h2>Why This Verdict</h2>
            <ul class="readable-list">${rationale.map((item) => `<li>${this.escape(item)}</li>`).join('') || '<li>No rationale was recorded.</li>'}</ul>
            <h3>Evidence Sources</h3>
            <div class="tag-row">${sources.map((source) => `<span class="evidence-tag">${this.escape(source)}</span>`).join('') || '<span class="evidence-tag">None recorded</span>'}</div>
            <h3>Project Links</h3>
            <div class="tag-row">${projectLinks || '<span class="evidence-tag">No website or social links found</span>'}</div>
          </article>
        </section>

        <section class="section table-card">
          <div class="section-header"><div class="section-header-copy"><h2>Liquidity Evidence</h2><p class="section-subtitle">Only verified pool liquidity counts toward the $10,000 gate.</p></div></div>
          <table><thead><tr><th>Pool</th><th>Verified Pair</th><th>Token Share</th><th>Verified USD</th></tr></thead>
          <tbody>${pools.map((pool) => `<tr><td class="mint-value">${this.escape(pool.address || '—')}</td><td>${pool.verifiedPair ? 'Yes' : 'No'}</td><td>${this.percent(pool.tokenBalancePercent)}</td><td>${this.money(pool.verifiedLiquidityUsd)}</td></tr>`).join('') || '<tr><td colspan="4">No verified liquidity pool was found.</td></tr>'}</tbody></table>
        </section>

        <section class="section table-card">
          <div class="section-header"><div class="section-header-copy"><h2>Score History</h2><p class="section-subtitle">Each observation is preserved so you can see how the evidence and verdict changed.</p></div></div>
          <table><thead><tr><th>Observed</th><th>Verdict</th><th>Opportunity</th><th>Risk</th><th>Liquidity</th><th>Top 10</th></tr></thead>
          <tbody>${history.observations.map((observation) => {
            const snapshot = (observation.evidence || {}) as Record<string, unknown>
            return `<tr><td>${this.formatDate(observation.observedAt)}</td><td>${this.escape(observation.classification)}</td><td>${observation.opportunityScore}</td><td>${observation.riskScore}</td><td>${this.money(snapshot.liquidityUsd)}</td><td>${this.percent(snapshot.top10HolderPercent)}</td></tr>`
          }).join('') || '<tr><td colspan="6">No observations recorded.</td></tr>'}</tbody></table>
        </section>
        ${errors.length ? `<section class="section"><div class="notice warning"><strong>Collection issues</strong><ul>${errors.map((error) => `<li>${this.escape(error)}</li>`).join('')}</ul></div></section>` : ''}
      `,
      extraStyles: `
        .verdict-card { min-width:280px; }
        .mint-value { overflow-wrap:anywhere; font-family:monospace; }
        .evidence-stats { grid-template-columns:repeat(3,minmax(0,1fr)); }
        .detail-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
        .check-list { display:grid; gap:10px; }
        .check-row { display:grid; grid-template-columns:24px 1fr; gap:10px; padding:10px 0; border-bottom:1px solid var(--fx-line); }
        .check-icon { font-weight:800; color:var(--fx-danger); }
        .check-icon.pass { color:#68e5a0; }
        .check-copy strong,.check-copy span { display:block; }
        .check-copy span { color:var(--fx-muted); font-size:.85rem; margin-top:2px; overflow-wrap:anywhere; }
        .readable-list { padding-left:20px; color:var(--fx-muted); line-height:1.7; }
        .tag-row { display:flex; flex-wrap:wrap; gap:8px; }
        .evidence-tag { padding:6px 9px; border:1px solid var(--fx-line); border-radius:999px; color:var(--fx-muted); }
        @media (max-width:900px) { .detail-grid,.evidence-stats { grid-template-columns:1fr; } }
      `,
    })
  }

  private renderCandidate(candidate: Candidate, rank: number): string {
    const evidence = (candidate.evidence || {}) as Record<string, unknown>
    const rationale = Array.isArray(evidence.rationale) ? evidence.rationale.map(String).slice(0, 5) : []
    const label = String(evidence.symbol || evidence.name || candidate.tokenMint.slice(0, 8))
    const website = this.safeUrl(evidence.website)
    return `
      <article class="card candidate-card">
        <div class="candidate-head">
          <div><div class="candidate-rank">Rank ${rank} · ${this.escape(candidate.chain)}</div><h3>${this.escape(label)}</h3></div>
          <span class="classification">${this.escape(candidate.classification || candidate.status)}</span>
        </div>
        <div class="score-row">
          <div class="score-box"><span>Opportunity</span><strong>${candidate.opportunityScore ?? '—'}</strong></div>
          <div class="score-box"><span>Risk</span><strong>${candidate.riskScore ?? '—'}</strong></div>
        </div>
        <div class="candidate-mint">${this.escape(candidate.tokenMint)}</div>
        <ul class="evidence-list">${rationale.map((item) => `<li>${this.escape(item)}</li>`).join('') || '<li>Evidence collection pending</li>'}</ul>
        <div class="candidate-meta"><span>${this.escape(candidate.source)}</span><span>Detected ${this.escape(candidate.detectedAt.toISOString())}</span></div>
        ${website ? `<a class="fx-button secondary" href="${this.escape(website)}" target="_blank" rel="noopener noreferrer nofollow">Visit Website</a>` : '<div class="notice">No project website found</div>'}
        <a class="fx-button secondary" href="/dashboard/discovery/${encodeURIComponent(candidate.chain)}/${encodeURIComponent(candidate.tokenMint)}">Evidence History</a>
      </article>
    `
  }

  private escape(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  private metric(label: string, value: unknown, description: string): string {
    return `<article class="card"><div class="eyebrow">${this.escape(label)}</div><div class="big">${this.escape(value)}</div><p>${this.escape(description)}</p></article>`
  }

  private check(label: string, passed: boolean, detail: string): string {
    return `<div class="check-row"><span class="check-icon${passed ? ' pass' : ''}">${passed ? '✓' : '×'}</span><div class="check-copy"><strong>${this.escape(label)}</strong><span>${this.escape(detail)}</span></div></div>`
  }

  private money(value: unknown): string {
    const amount = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(amount) && value !== null ? `$${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : 'Not verified'
  }

  private percent(value: unknown): string {
    const amount = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(amount) && value !== null ? `${amount.toFixed(2)}%` : 'Unknown'
  }

  private formatDate(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value)
    return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  }

  private safeUrl(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null
    try {
      const url = new URL(value.trim())
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
    } catch {
      return null
    }
  }

  private renderProjectLinks(evidence: Record<string, unknown>): string {
    return [
      ['Website', evidence.website],
      ['X / Twitter', evidence.twitter],
      ['Telegram', evidence.telegram],
    ]
      .map(([label, value]) => {
        const url = this.safeUrl(value)
        return url
          ? `<a class="evidence-tag" href="${this.escape(url)}" target="_blank" rel="noopener noreferrer nofollow">${this.escape(label)}</a>`
          : ''
      })
      .join('')
  }
}
