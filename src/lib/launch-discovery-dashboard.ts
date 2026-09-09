import { PrismaLaunchCandidateRepository } from '../repositories/prisma/launch-candidate'
import { renderFuturisticPage } from './site-theme'
import { ExecutionTimeline, NetworkBadge, OrderSummary, StatusBadge } from './institutional-ui'

type Candidate = Awaited<ReturnType<PrismaLaunchCandidateRepository['list']>>[number]

export class LaunchDiscoveryDashboard {
  constructor(private readonly repository: PrismaLaunchCandidateRepository) {}

  async renderHtmlDashboard(view: 'discovery' | 'research' | 'execution' = 'discovery'): Promise<string> {
    const candidates = await this.repository.list({ limit: 100 })
    const ranked = candidates.filter((candidate) => candidate.classification !== 'REJECT').slice(0, 3)
    const rankedIds = new Set(ranked.map((candidate) => candidate.id))
    const displayed = [...ranked, ...candidates.filter((candidate) => !rankedIds.has(candidate.id))].slice(0, 3)
    const robinhoodCandidates = candidates.filter((candidate) => candidate.chain === 'robinhood').slice(0, 3)
    const solanaCount = candidates.filter((candidate) => candidate.chain === 'solana').length
    const robinhoodCount = candidates.filter((candidate) => candidate.chain === 'robinhood').length
    const promisingCount = candidates.filter((candidate) => candidate.classification === 'PROMISING').length
    const watchCount = candidates.filter((candidate) => candidate.classification === 'WATCH').length
    const officialCount = candidates.filter((candidate) => candidate.classification === 'OFFICIAL_STOCK_TOKEN').length
    const otherCount = Math.max(0, candidates.length - promisingCount - watchCount - officialCount)
    const verdictTotal = Math.max(1, candidates.length)
    const promisingEnd = (promisingCount / verdictTotal) * 100
    const watchEnd = promisingEnd + (watchCount / verdictTotal) * 100
    const officialEnd = watchEnd + (officialCount / verdictTotal) * 100
    const chartCandidates = candidates.slice(0, 6)

    return renderFuturisticPage({
      title: view === 'research' ? 'FoilOps Research Lab' : view === 'execution' ? 'FoilOps Execution' : 'FoilOps Launch Discovery',
      activeNav: view === 'discovery' ? 'discovery' : view === 'research' ? 'home' : 'trading',
      headerActionsHtml: `
        <button class="fx-button" id="poll-launches" type="button"${view === 'discovery' ? '' : ' hidden'} aria-label="Scan for launches" title="Scan for launches">Scan</button>
        <button class="fx-icon-button" id="refresh-launches" type="button" aria-label="Refresh data" title="Refresh data">↻</button>
        <a class="fx-icon-button fx-raw-data" href="/api/discovery/candidates?limit=100" aria-label="View raw data" title="View raw data">{ }</a>
        <form method="post" action="/logout"><button class="fx-icon-button" type="submit" aria-label="Log out" title="Log out">↗</button></form>
      `,
      heroHtml: `
        <section class="hero">
          <div>
            <p class="fx-eyebrow">Autonomous evidence pipeline</p>
            <h1>${view === 'research' ? 'Research Lab' : view === 'execution' ? 'Execution Controls' : 'Launch Discovery'}</h1>
            <p class="fx-lead">${view === 'research' ? 'Investigate traditional assets and exact multi-chain contracts with deterministic evidence and AI analyst teams.' : view === 'execution' ? 'Review Base quotes, persistent watches, and explicitly authorized liquidity auto-buy orders.' : 'New token launches ranked by independently collected evidence. A candidate is research—not a buy recommendation.'}</p>
          </div>
          <article class="card" style="min-width:280px">
            <p class="eyebrow">Current inventory</p>
            <div class="big">${candidates.length}</div>
            <p>${ranked.length} non-rejected · ${solanaCount} Solana · ${robinhoodCount} Robinhood.</p>
          </article>
        </section>
      `,
      contentHtml: `
        <section class="section card research-workbench">
          <div class="section-header"><div class="section-header-copy"><p class="eyebrow">TradingAgents · complete upstream workflow</p><h2>Stocks, ETFs & Yahoo Finance Crypto</h2><p class="section-subtitle">Run its original market, fundamentals, news, social, debate, trader and risk teams alongside FoilOps contract research.</p></div><span id="ta-badge" class="badge">Checking…</span></div>
          <div class="research-controls"><input id="ta-ticker" placeholder="NVDA, SPY, BTC-USD…" autocomplete="off"><input id="ta-date" type="date"><button class="fx-button" id="ta-run" type="button">Run TradingAgents</button></div>
          <div id="ta-status" class="notice">The Python research service is disabled by default.</div><div id="ta-result"></div>
          <div class="agent-terminal"><div class="agent-terminal-bar"><span></span><span></span><span></span><b>foilops@tradingagents:~</b><button id="ta-terminal-clear" type="button">Clear</button></div><pre id="ta-terminal" role="log" aria-live="polite">FoilOps TradingAgents terminal ready.&#10;</pre></div>
        </section>
        <section class="section card research-workbench">
          <div class="section-header"><div class="section-header-copy"><p class="eyebrow">Deep investigation</p><h2>Research any Solana or Base token</h2><p class="section-subtitle">Collect controls, holders, every visible pool, LP-lock evidence, creator conflicts, protocol/DAO/NFT claims, and an evidence-weighted verdict.</p></div></div>
          <div class="research-controls"><select id="research-chain"><option value="solana">Solana</option><option value="base">Base</option><option value="ethereum">Ethereum</option><option value="arbitrum">Arbitrum</option><option value="optimism">Optimism</option><option value="polygon">Polygon</option><option value="bsc">BNB Chain</option><option value="avalanche">Avalanche</option></select><input id="research-mint" placeholder="Paste a token contract or mint" autocomplete="off" spellcheck="false"><button class="fx-button" id="run-research" type="button">Investigate Token</button><button class="fx-button secondary" id="run-agent-contract" type="button">Run AI Research Team</button></div>
          <div id="research-status" class="notice">No token investigated in this session.</div>
          <div id="research-result"></div>
        </section>
        <section class="section card base-swap-workbench">
          ${OrderSummary({ action: 'Build a Base swap', network: 'Base · Chain 8453', mode: 'Manual confirmation', status: 'Awaiting quote' })}
          <div class="section-header"><div class="section-header-copy"><p class="eyebrow">Base execution</p><h2>Confirmation-required swap</h2><p class="section-subtitle">Quotes are screened by FoilOps risk and liquidity gates. Live execution requires a dedicated server wallet and a second explicit confirmation.</p></div><span id="base-swap-mode" class="badge">Checking…</span></div>
          <div class="swap-grid"><label>Sell token<input id="swap-sell-token" value="ETH" placeholder="ETH or Base contract"></label><label>Buy token<input id="swap-buy-token" placeholder="Base token contract"></label><label>Amount<input id="swap-amount" inputmode="decimal" placeholder="0.01"></label><label>Slippage (bps)<input id="swap-slippage" type="number" min="1" max="300" value="100"></label></div>
          <label class="auto-toggle"><input id="swap-risk-override" type="checkbox"><span>Override the numerical research-risk score for this exact-address watch/quote. Contract, liquidity, route, slippage, gas and simulation checks remain enforced.</span></label>
          <div class="research-controls"><button class="fx-button secondary" id="base-swap-quote" type="button">Get Safe Quote</button><button class="fx-button secondary" id="base-swap-watch" type="button">Start Server Watch</button><button class="fx-button" id="base-swap-confirm" type="button" disabled>Confirm Live Swap</button></div>
          <div id="base-swap-status" class="notice">A quote does not execute a transaction.</div><div id="base-swap-quote-result"></div><div id="base-swap-watches"></div>
        </section>
        <section class="section card auto-buy-workbench">
          ${OrderSummary({ action: 'Configure an exact-address auto-buy', network: 'Base · Chain 8453', mode: 'Explicit authorization', status: 'Not armed' })}
          ${ExecutionTimeline(0)}
          <div class="section-header"><div class="section-header-copy"><p class="eyebrow">Base · explicitly pre-authorized</p><h2>Liquidity Auto-Buy</h2><p class="section-subtitle">Monitors one exact Base contract and fails closed unless every pool, route, output, impact, slippage, gas, deadline and simulation constraint passes.</p></div><span id="auto-buy-global" class="badge">Checking…</span></div>
          <div class="auto-buy-grid">
            <label>Exact token contract<input id="ab-token" placeholder="0x…" autocomplete="off"></label>
            <label>Spend asset<select id="ab-sell"><option>ETH</option><option>USDC</option></select></label>
            <label>Authorized amount<input id="ab-amount" value="0.01" inputmode="decimal"></label>
            <label>Max slippage (bps)<input id="ab-slippage" type="number" value="100" min="1" max="300"></label>
            <label>Max price impact (bps)<input id="ab-impact" type="number" value="300" min="1" max="500"></label>
            <label>Max gas cost (ETH)<input id="ab-gas" value="0.003" inputmode="decimal"></label>
            <label>Minimum pool liquidity (USD)<input id="ab-liquidity" type="number" value="10000" min="10000"></label>
            <label>Order deadline (seconds)<input id="ab-deadline" type="number" value="86400" min="60" max="604800"></label>
            <label>Execution retry limit<input id="ab-retries" type="number" value="2" min="1" max="10"></label>
            <label>Permitted router<select id="ab-router"><option value="ZEROX_ALLOWANCE_HOLDER">0x AllowanceHolder</option></select></label>
          </div>
          <label class="auto-toggle"><input id="ab-auto" type="checkbox"><span>AUTO BUY authorization — I understand this order may execute unattended within exactly these limits.</span></label>
          <div class="research-controls"><button class="fx-button secondary" id="ab-create" type="button">Verify Contract & Create Draft</button><label class="master-switch"><input id="ab-master" type="checkbox"><span>Master AUTO BUY</span></label></div>
          <div id="ab-status" class="notice">AUTO BUY is disabled until you explicitly enable the toggle, create a reviewed draft, and press ARM.</div>
          <div id="ab-orders"></div>
        </section>
        <section class="viz-grid discovery-overview">
          <article class="card viz-card">
            <div class="viz-head"><div><p class="eyebrow">Signal composition</p><h2 class="viz-title">Candidate verdicts</h2><p class="viz-caption">How the evidence pipeline currently classifies collected launches.</p></div><span class="badge">${candidates.length} total</span></div>
            <div class="donut-wrap">
              <div class="donut" style="--p1:${promisingEnd.toFixed(2)}%;--p2:${watchEnd.toFixed(2)}%;--p3:${officialEnd.toFixed(2)}%"><div class="donut-label">${promisingCount + watchCount}<small>qualified</small></div></div>
              <div class="bar-list">
                ${this.legendRow('Promising', promisingCount, 'var(--fx-primary)')}
                ${this.legendRow('Watch', watchCount, 'var(--fx-secondary)')}
                ${this.legendRow('Official stock', officialCount, 'var(--fx-warning)')}
                ${this.legendRow('Rejected / other', otherCount, 'var(--fx-danger)')}
              </div>
            </div>
          </article>
          <article class="card viz-card">
            <div class="viz-head"><div><p class="eyebrow">Opportunity radar</p><h2 class="viz-title">Top evidence scores</h2><p class="viz-caption">Opportunity strength versus the 100-point scoring ceiling.</p></div><span class="badge">Live</span></div>
            <div class="bar-list score-bars">
              ${
                chartCandidates
                  .map((candidate) => {
                    const evidence = (candidate.evidence || {}) as Record<string, unknown>
                    const label = String(evidence.symbol || evidence.name || candidate.tokenMint.slice(0, 8))
                    return `<div class="bar-row"><div class="bar-meta"><span>${this.escape(label)} · ${this.escape(candidate.chain)}</span><strong>${candidate.opportunityScore}</strong></div><div class="bar-track"><span class="bar-fill" style="--value:${Math.max(0, Math.min(100, candidate.opportunityScore))}%"></span></div></div>`
                  })
                  .join('') ||
                '<div class="empty-state"><strong>Waiting for candidates</strong><span>Run a scan to populate the score chart.</span></div>'
              }
            </div>
          </article>
        </section>
        <section class="section discovery-overview">
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
        <section class="section discovery-overview">
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
        ${view === 'discovery' ? '.research-workbench,.base-swap-workbench,.auto-buy-workbench{display:none!important}' : view === 'research' ? '.discovery-overview,.base-swap-workbench,.auto-buy-workbench{display:none!important}' : '.discovery-overview,.research-workbench{display:none!important}'}
        .research-workbench,.base-swap-workbench,.auto-buy-workbench{width:min(100%,1120px);margin-inline:auto;min-width:0}.research-workbench>*,.base-swap-workbench>*,.auto-buy-workbench>*{min-width:0}
        .discovery-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; }
        .candidate-card { display:flex; flex-direction:column; gap:14px; min-width:0; position:relative; overflow:hidden; }
        .candidate-card:before{content:"";position:absolute;inset:0 0 auto;height:2px;background:linear-gradient(90deg,var(--fx-primary),var(--fx-secondary),transparent)}
        .candidate-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }
        .candidate-rank { color:var(--fx-warning); font-size:.78rem; letter-spacing:.12em; text-transform:uppercase; }
        .candidate-mint { overflow-wrap:anywhere; color:var(--fx-muted); font-family:monospace; font-size:.78rem; }
        .score-row { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
        .score-box { padding:10px; border:1px solid var(--fx-line); border-radius:12px; background:rgba(255,255,255,.025); }
        .score-box strong { display:block; font-size:1.55rem; }
        .classification { display:inline-flex; padding:5px 9px; border-radius:999px; border:1px solid var(--fx-line-strong); color:var(--fx-warning); font-size:.75rem; }
        .candidate-visuals{display:grid;grid-template-columns:1.4fr .8fr;gap:12px;align-items:center}.sparkline{height:62px;width:100%;overflow:visible}.sparkline path.line{fill:none;stroke:var(--fx-primary);stroke-width:2.5;vector-effect:non-scaling-stroke}.sparkline path.area{fill:url(#candidate-gradient);opacity:.22}.risk-gauge{--risk:0;aspect-ratio:1;width:70px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--fx-danger) calc(var(--risk)*1%),rgba(255,255,255,.07) 0);position:relative}.risk-gauge:after{content:"";position:absolute;inset:7px;border-radius:50%;background:var(--fx-panel)}.risk-gauge b{z-index:1;font-variant-numeric:tabular-nums}.concentration{display:grid;gap:6px}.concentration div{height:6px;background:rgba(255,255,255,.08);border-radius:4px;overflow:hidden}.concentration i{display:block;height:100%;width:var(--value);background:linear-gradient(90deg,var(--fx-primary),var(--fx-warning));border-radius:inherit}.source-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.source-icon{display:inline-grid;place-items:center;width:28px;height:28px;border:1px solid var(--fx-line);border-radius:8px;color:var(--fx-muted);font-size:.72rem}.candidate-actions{display:flex;gap:8px;margin-top:auto}.candidate-actions .fx-button{flex:1;text-align:center;justify-content:center}
        .evidence-list { margin:0; padding-left:18px; color:var(--fx-muted); }
        .candidate-meta { display:flex; gap:8px; flex-wrap:wrap; color:var(--fx-muted); font-size:.8rem; }
        .score-bars { align-content:center; height:100%; }
        .legend-row { display:flex;align-items:center;justify-content:space-between;gap:12px;color:var(--fx-muted);font-size:.84rem; }
        .legend-key { display:inline-flex;align-items:center;gap:9px; }
        .legend-dot { width:10px;height:10px;border-radius:50%;background:var(--dot);box-shadow:0 0 14px var(--dot); }
        @media (max-width:900px) { .discovery-grid { grid-template-columns:1fr; } }
        .research-controls{display:flex;align-items:center;gap:10px;max-width:980px}.research-controls input{flex:1 1 260px;min-width:0}.research-controls select{flex:0 1 190px;min-width:130px}.research-controls .fx-button{flex:0 0 auto;max-width:240px}.research-controls input,.research-controls select{padding:13px 14px;border-radius:12px;border:1px solid var(--fx-line-strong);background:#091522;color:var(--fx-text)}
        .research-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:14px}.research-panel{padding:14px;border:1px solid var(--fx-line);border-radius:14px;background:rgba(255,255,255,.025)}.research-panel strong{display:block;font-size:1.35rem}.finding{margin-top:8px;padding:10px;border-left:3px solid var(--fx-secondary);background:rgba(255,255,255,.025)}.finding b{color:var(--fx-warning)}
        .agent-terminal{margin-top:14px;border:1px solid rgba(71,255,191,.25);border-radius:14px;overflow:hidden;background:#020a09;box-shadow:inset 0 0 40px rgba(0,255,170,.035)}.agent-terminal-bar{display:flex;align-items:center;gap:7px;padding:9px 12px;background:#0a1615;border-bottom:1px solid rgba(71,255,191,.16);color:#84b8aa;font:12px monospace}.agent-terminal-bar span{width:10px;height:10px;border-radius:50%;background:#ff5f57}.agent-terminal-bar span:nth-child(2){background:#febc2e}.agent-terminal-bar span:nth-child(3){background:#28c840}.agent-terminal-bar b{margin-left:5px;font-weight:500}.agent-terminal-bar button{margin-left:auto;background:transparent;border:1px solid rgba(71,255,191,.2);border-radius:6px;color:#84b8aa;cursor:pointer}.agent-terminal pre{margin:0;min-height:240px;max-height:520px;overflow:auto;padding:14px;color:#80ffc8;font:12px/1.55 "IBM Plex Mono",monospace;white-space:pre-wrap;overflow-wrap:anywhere}
        .swap-grid{display:grid;grid-template-columns:minmax(180px,1.2fr) minmax(180px,1.2fr) minmax(120px,.7fr) minmax(120px,.7fr);gap:10px;margin:12px 0;max-width:980px}.swap-grid label{display:grid;gap:6px;color:var(--fx-muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;min-width:0}.swap-grid input{padding:12px;border-radius:10px;border:1px solid var(--fx-line-strong);background:#091522;color:var(--fx-text);min-width:0}.quote-warning{border-color:var(--fx-warning);margin-top:12px}
        .auto-buy-grid{display:grid;grid-template-columns:repeat(3,minmax(180px,1fr));gap:10px;margin:12px 0;max-width:980px}.auto-buy-grid label{display:grid;gap:6px;color:var(--fx-muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;min-width:0}.auto-buy-grid input,.auto-buy-grid select{padding:11px;border-radius:10px;border:1px solid var(--fx-line-strong);background:#091522;color:var(--fx-text);min-width:0}.auto-buy-grid label:first-child{grid-column:span 2}.auto-toggle{display:flex;gap:10px;align-items:flex-start;padding:12px;margin:12px 0;max-width:980px;border:1px solid var(--fx-warning);border-radius:12px;color:var(--fx-warning);overflow-wrap:anywhere}.auto-toggle input{flex:0 0 auto;width:20px}.master-switch{display:inline-flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid var(--fx-danger);border-radius:999px;color:var(--fx-danger);font-weight:700}.master-switch:has(input:checked){border-color:var(--fx-success);color:var(--fx-success);box-shadow:0 0 18px rgba(52,211,153,.18)}.master-switch input{width:20px;height:20px}.auto-order{margin-top:12px;padding:14px;border:1px solid var(--fx-line);border-radius:14px;min-width:0}.auto-order-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.auto-order-grid span{overflow-wrap:anywhere}.danger{border-color:var(--fx-danger)!important;color:var(--fx-danger)!important}
        @media(max-width:900px){.research-controls{display:grid;grid-template-columns:1fr 1fr;max-width:none}.research-controls input,.research-controls select,.research-controls .fx-button{width:100%;max-width:none;min-width:0}.research-grid{grid-template-columns:1fr 1fr}}
        @media(max-width:900px){.swap-grid{grid-template-columns:1fr 1fr}}@media(max-width:520px){.swap-grid{grid-template-columns:1fr}}
        @media(max-width:900px){.auto-buy-grid{grid-template-columns:1fr 1fr}.auto-order-grid{grid-template-columns:1fr 1fr}}@media(max-width:560px){.research-workbench,.base-swap-workbench,.auto-buy-workbench{padding:14px}.research-controls,.research-grid,.swap-grid,.auto-buy-grid,.auto-order-grid{grid-template-columns:minmax(0,1fr)}.research-controls{display:grid}.auto-buy-grid label:first-child{grid-column:auto}.research-controls .fx-button,.master-switch{width:100%;max-width:none;justify-content:center}.agent-terminal pre{min-height:180px;max-height:360px;padding:11px;font-size:11px}.agent-terminal-bar b{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.section-header-copy h2{overflow-wrap:anywhere}.auto-order .candidate-head{flex-direction:column}.auto-order-grid span{padding:8px;border-bottom:1px solid var(--fx-line)}}
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
          const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
          const money=n=>Number.isFinite(Number(n))?'$'+Number(n).toLocaleString(undefined,{maximumFractionDigits:0}):'—';
          const percentBps=n=>Number.isFinite(Number(n))?(Number(n)/100).toFixed(1)+'%':'—';
          const ethFromWei=n=>{try{const v=BigInt(n||0),whole=v/1000000000000000000n,fraction=(v%1000000000000000000n).toString().padStart(18,'0').slice(0,6).replace(/0+$/,'');return whole.toString()+(fraction?'.'+fraction:'')+' ETH'}catch{return '—'}};
          const orderTone=s=>s==='CONFIRMED'?'success':s==='FAILED'||s==='CANCELLED'?'danger':s==='ARMED'||s==='MONITORING'||s==='LIQUIDITY_DETECTED'?'warning':'info';
          const terminal=document.getElementById('ta-terminal');const term=(message)=>{terminal.textContent+='['+new Date().toLocaleTimeString()+'] '+String(message)+'\\n';terminal.scrollTop=terminal.scrollHeight};document.getElementById('ta-terminal-clear').addEventListener('click',()=>terminal.textContent='');
          async function loadTradingAgentsStatus(){try{const s=await fetch('/api/trading-agents/status').then(r=>r.json());document.getElementById('ta-badge').textContent=!s.enabled?'DISABLED':s.reachable?'READY':'OFFLINE';document.getElementById('ta-status').textContent=s.reachable?'TradingAgents is ready. Analyses can take several minutes and use provider credits.':(s.message||'Service unavailable');}catch{document.getElementById('ta-badge').textContent='OFFLINE'}}
          document.getElementById('ta-date').value=new Date().toISOString().slice(0,10);
          document.getElementById('ta-run').addEventListener('click',async()=>{const button=document.getElementById('ta-run'),status=document.getElementById('ta-status'),out=document.getElementById('ta-result'),ticker=document.getElementById('ta-ticker').value.trim();if(!ticker)return void(status.textContent='Enter a Yahoo Finance ticker.');button.disabled=true;term('$ tradingagents analyze '+ticker+' --date '+document.getElementById('ta-date').value);term('Starting market, fundamentals, news and social analysts…');status.textContent='Analyst team is running. This may take several minutes…';try{const response=await fetch('/api/trading-agents/ticker',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ticker,date:document.getElementById('ta-date').value})}),r=await response.json();if(!response.ok)throw new Error(r.message||'Analysis failed');term('Analyst graph complete. Rendering portfolio decision.');Object.entries(r.reports||{}).forEach(([name,report])=>term('\\n=== '+name.toUpperCase()+' ===\\n'+(typeof report==='string'?report:JSON.stringify(report,null,2))));term('\\n=== FINAL DECISION ===\\n'+r.decision);term('Process completed successfully.');status.textContent='TradingAgents completed '+r.ticker+' for '+r.analysisDate+'.';out.innerHTML='<h3>Portfolio decision</h3><div class="notice">'+esc(r.decision)+'</div><details style="margin-top:12px"><summary>Complete analyst and debate reports</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(JSON.stringify(r.reports,null,2))+'</pre></details>';}catch(error){term('ERROR: '+(error.message||'Analysis failed'));status.textContent=error.message||'Analysis failed';out.innerHTML='';}finally{button.disabled=false}});
          loadTradingAgentsStatus();
          document.getElementById('run-research').addEventListener('click',async()=>{
            const mint=document.getElementById('research-mint').value.trim(), chain=document.getElementById('research-chain').value, button=document.getElementById('run-research'), status=document.getElementById('research-status'), out=document.getElementById('research-result');
            if(!mint){status.textContent='Paste a Solana mint or Base contract first.';return} button.disabled=true;status.textContent='Collecting independent evidence…';out.innerHTML='';
            try{const response=await fetch('/api/discovery/research',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mint,chain})});const r=await response.json();if(!response.ok)throw new Error(r.message||'Research failed');
              status.textContent='Research completed '+new Date(r.observedAt).toLocaleString()+' · confidence '+r.scores.confidence+'%';
              const findings=Object.entries(r.findings).map(([k,v])=>'<div class="finding"><b>'+esc(k.toUpperCase())+' · '+esc(v.status)+'</b><span>'+esc(v.summary)+'</span></div>').join('');
              out.innerHTML='<div class="research-grid"><div class="research-panel"><span>Verdict</span><strong>'+esc(r.scores.verdict)+'</strong></div><div class="research-panel"><span>Overall risk</span><strong>'+esc(r.scores.overallRisk)+'/100</strong></div><div class="research-panel"><span>Liquidity</span><strong>'+money(r.market.liquidityUsd)+'</strong></div><div class="research-panel"><span>Top 10</span><strong>'+Number(r.holders.top10Percent).toFixed(2)+'%</strong></div></div><h3>'+esc(r.identity.name||r.mint)+' evidence dossier</h3>'+findings+'<div class="detail-grid" style="margin-top:12px"><div class="research-panel"><h3>Green flags</h3><ul class="readable-list">'+r.greenFlags.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></div><div class="research-panel"><h3>Red flags</h3><ul class="readable-list">'+r.redFlags.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></div></div><details style="margin-top:12px"><summary>Raw evidence and next checks</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(JSON.stringify(r,null,2))+'</pre></details>';
            }catch(error){status.textContent=error.message||'Research failed'}finally{button.disabled=false}
          });
          document.getElementById('run-agent-contract').addEventListener('click',async()=>{const address=document.getElementById('research-mint').value.trim(),chain=document.getElementById('research-chain').value,button=document.getElementById('run-agent-contract'),status=document.getElementById('research-status'),out=document.getElementById('research-result');if(!address)return void(status.textContent='Paste a contract or mint first.');button.disabled=true;term('$ foilops investigate --chain '+chain+' --address '+address);term('Collecting deterministic on-chain evidence before AI analysis…');status.textContent='Collecting evidence, then running four independent analysts and risk synthesis…';try{const response=await fetch('/api/trading-agents/contract',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({address,chain})}),r=await response.json();if(!response.ok)throw new Error(r.message||'AI research failed');Object.entries(r.reports||{}).forEach(([name,report])=>term('\\n=== '+name.toUpperCase()+' ===\\n'+report));term('\\n=== RISK MANAGER ===\\n'+r.decision);term('Contract research completed successfully.');status.textContent='AI research team completed for exact '+chain+' address.';out.innerHTML='<h3>Risk-manager dossier</h3><div class="notice" style="white-space:pre-wrap">'+esc(r.decision)+'</div><details style="margin-top:12px"><summary>Independent analyst reports</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(JSON.stringify(r.reports,null,2))+'</pre></details>';}catch(error){term('ERROR: '+(error.message||'AI research failed'));status.textContent=error.message||'AI research failed';}finally{button.disabled=false}});
          let baseSwapConfirmation=null,baseSwapWatchBusy=false;
          async function loadBaseSwapStatus(){try{const r=await fetch('/api/base-swap/status').then(x=>x.json());document.getElementById('base-swap-mode').textContent=r.enabled&&r.configured?'LIVE · CONFIRMATION REQUIRED':r.configured?'CONFIGURED · LIVE DISABLED':'NOT CONFIGURED';document.getElementById('base-swap-status').textContent=(r.walletAddress?'Wallet '+r.walletAddress.slice(0,8)+'…'+r.walletAddress.slice(-6):'No execution wallet')+' · max '+r.maxTradeEth+' ETH · max slippage '+r.maxSlippageBps+' bps';}catch{document.getElementById('base-swap-mode').textContent='UNAVAILABLE'}}
          async function requestBaseQuote(){const button=document.getElementById('base-swap-quote'),status=document.getElementById('base-swap-status'),out=document.getElementById('base-swap-quote-result'),confirm=document.getElementById('base-swap-confirm');if(baseSwapWatchBusy)return false;baseSwapWatchBusy=true;baseSwapConfirmation=null;confirm.disabled=true;button.disabled=true;status.textContent='Checking wallet balance, token risk, liquidity and live route…';try{const response=await fetch('/api/base-swap/quote',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sellToken:document.getElementById('swap-sell-token').value,buyToken:document.getElementById('swap-buy-token').value,amount:document.getElementById('swap-amount').value,slippageBps:Number(document.getElementById('swap-slippage').value),riskOverride:document.getElementById('swap-risk-override').checked})});const q=await response.json();if(!response.ok)throw new Error(q.message||'Quote failed');baseSwapConfirmation=q.confirmationId;confirm.disabled=false;status.textContent='Route is live. Quote expires '+new Date(q.expiresAt).toLocaleTimeString()+'. Review and press Confirm Live Swap.';out.innerHTML='<div class="research-grid"><div class="research-panel"><span>You sell</span><strong>'+esc(q.sellAmount)+' '+esc(q.sellSymbol)+'</strong></div><div class="research-panel"><span>Expected</span><strong>'+esc(q.expectedBuyAmount)+' '+esc(q.buySymbol)+'</strong></div><div class="research-panel"><span>Minimum</span><strong>'+esc(q.minimumBuyAmount)+' '+esc(q.buySymbol)+'</strong></div><div class="research-panel"><span>Token risk</span><strong>'+esc(q.researchRisk??'—')+(q.researchRiskOverridden?' · OVERRIDDEN':'')+'</strong></div></div><div class="notice quote-warning">'+esc(q.warning)+'</div>';document.title='ROUTE LIVE · Confirm Base Swap';return true;}catch(error){status.textContent=error.message||'Quote failed';out.innerHTML='';return false;}finally{baseSwapWatchBusy=false;button.disabled=false}}
          function stopBaseSwapWatch(){document.getElementById('base-swap-watch').disabled=false}
          document.getElementById('base-swap-quote').addEventListener('click',()=>requestBaseQuote(false));
          async function loadBaseWatches(){try{const payload=await fetch('/api/base-swap/watches').then(r=>r.json());const active=(payload.watches||[]).filter(w=>w.status==='WATCHING'||w.status==='READY');document.getElementById('base-swap-watches').innerHTML=active.length?'<h3>Persistent watches</h3>'+active.map(w=>'<div class="finding"><b>'+esc(w.status)+'</b><span>'+esc(w.buyToken)+' · '+esc(w.amount)+' ETH · '+esc(w.slippageBps)+' bps · '+esc(w.attempts)+' checks</span>'+(w.status==='READY'?'<button class="fx-button secondary" data-watch-review="'+esc(w.id)+'">Review fresh quote</button>':'')+'<button class="fx-button secondary" data-watch-cancel="'+esc(w.id)+'">Cancel</button></div>').join(''):'';document.querySelectorAll('[data-watch-cancel]').forEach(b=>b.addEventListener('click',async()=>{await fetch('/api/base-swap/watches/'+encodeURIComponent(b.dataset.watchCancel)+'/cancel',{method:'POST'});loadBaseWatches()}));document.querySelectorAll('[data-watch-review]').forEach(b=>b.addEventListener('click',()=>requestBaseQuote()));const requested=new URLSearchParams(location.search).get('baseWatch');const match=active.find(w=>w.id===requested);if(match&&!baseSwapConfirmation){document.getElementById('swap-sell-token').value=match.sellToken;document.getElementById('swap-buy-token').value=match.buyToken;document.getElementById('swap-amount').value=match.amount;document.getElementById('swap-slippage').value=match.slippageBps;if(match.status==='READY'){history.replaceState({},'',location.pathname);requestBaseQuote()}}}catch{}}
          document.getElementById('base-swap-watch').addEventListener('click',async()=>{const button=document.getElementById('base-swap-watch'),status=document.getElementById('base-swap-status');button.disabled=true;try{const riskOverride=document.getElementById('swap-risk-override').checked;if(riskOverride&&!confirm('Override the research-risk score for this exact contract? Other safety checks remain mandatory.'))return;const response=await fetch('/api/base-swap/watches',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sellToken:document.getElementById('swap-sell-token').value,buyToken:document.getElementById('swap-buy-token').value,amount:document.getElementById('swap-amount').value,slippageBps:Number(document.getElementById('swap-slippage').value),riskOverride})});const watch=await response.json();if(!response.ok)throw new Error(watch.message||'Watch creation failed');status.textContent='Server watch armed. FoilOps will keep checking even if you close this page and will alert Telegram when a route is ready.';await loadBaseWatches()}catch(error){status.textContent=error.message||'Watch creation failed'}finally{button.disabled=false}});
          document.getElementById('base-swap-confirm').addEventListener('click',async()=>{if(!baseSwapConfirmation)return;const button=document.getElementById('base-swap-confirm'),status=document.getElementById('base-swap-status');if(!window.confirm('Execute this Base swap with real funds? This cannot be undone.'))return;button.disabled=true;status.textContent='Simulating and submitting the Base transaction…';try{const response=await fetch('/api/base-swap/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirmationId:baseSwapConfirmation})});const r=await response.json();if(!response.ok)throw new Error(r.message||'Swap failed');baseSwapConfirmation=null;status.innerHTML='Swap '+esc(r.status)+'. <a href="https://basescan.org/tx/'+encodeURIComponent(r.transactionHash)+'" target="_blank" rel="noopener noreferrer">View transaction</a>';}catch(error){status.textContent=error.message||'Swap failed';}finally{button.disabled=true}});
          const watchId=new URLSearchParams(location.search).get('baseWatch');if(watchId)document.getElementById('base-swap-status').textContent='Telegram alert opened. Loading the watched limits and refreshing a current quote…';
          loadBaseSwapStatus();loadBaseWatches();setInterval(loadBaseWatches,15000);
          let autoBuyStatus={enabled:false,killSwitch:true};
          async function loadAutoBuy(){
            try{
              autoBuyStatus=await fetch('/api/liquidity-auto-buy/status').then(r=>r.json());
              document.getElementById('auto-buy-global').textContent=autoBuyStatus.hardKillSwitch?'HARD KILL ACTIVE':autoBuyStatus.effectiveEnabled?'MASTER ON · EXPLICIT ARM':autoBuyStatus.enabled?'MASTER OFF':'SERVER DISABLED';
              const master=document.getElementById('ab-master');master.checked=Boolean(autoBuyStatus.masterEnabled);master.disabled=!autoBuyStatus.enabled||autoBuyStatus.hardKillSwitch;
              const payload=await fetch('/api/liquidity-auto-buy/orders').then(r=>r.json()),orders=payload.orders||[];
              document.getElementById('ab-orders').innerHTML=orders.map(o=>'<article class="auto-order"><div class="candidate-head"><div><span class="ui-status ui-status--'+orderTone(o.state)+'">'+esc(o.state)+'</span><h3>Buy '+esc(o.spendAmount)+' '+esc(o.sellToken)+' of exact-address token</h3><div class="candidate-mint">'+esc(o.tokenAddress)+'</div></div>'+(o.transactionHash?'<a href="https://basescan.org/tx/'+encodeURIComponent(o.transactionHash)+'" target="_blank" rel="noopener noreferrer">View on BaseScan ↗</a>':'')+'</div><div class="auto-order-grid"><article class="ui-metric"><div class="ui-metric__head"><span>Authorized spend</span></div><strong>'+esc(o.spendAmount)+' '+esc(o.sellToken)+'</strong></article><article class="ui-metric"><div class="ui-metric__head"><span>Usable liquidity</span></div><strong>'+money(o.currentLiquidityUsd)+'</strong><small>'+esc(o.poolRouter||'Waiting for supported pool')+'</small></article><article class="ui-metric"><div class="ui-metric__head"><span>Estimated output</span></div><strong>'+esc(o.expectedOutput||'Pending route')+'</strong></article><article class="ui-metric"><div class="ui-metric__head"><span>Price impact limit</span></div><strong>'+percentBps(o.maxPriceImpactBps)+'</strong></article><article class="ui-metric"><div class="ui-metric__head"><span>Slippage limit</span></div><strong>'+percentBps(o.maxSlippageBps)+'</strong></article><article class="ui-metric"><div class="ui-metric__head"><span>Gas ceiling</span></div><strong>'+ethFromWei(o.maxGasCostWei)+'</strong></article></div><div class="ui-risk-check ui-risk-check--'+(o.lastReason?'warning':'pending')+'"><span aria-hidden="true">'+(o.lastReason?'!':'·')+'</span><div><strong>Latest validation</strong><small>'+esc(o.lastReason||'Waiting for monitor observation')+'</small></div></div><details class="ui-drawer"><summary>Advanced details and exact values</summary><div><code>impact='+esc(o.maxPriceImpactBps)+' bps · slippage='+esc(o.maxSlippageBps)+' bps · gas='+esc(o.maxGasCostWei)+' wei</code></div></details><div class="research-controls" style="margin-top:10px">'+(o.state==='DRAFT'?'<button class="fx-button" data-ab-arm="'+esc(o.id)+'">ARM reviewed order</button>':'')+(!['CONFIRMED','CANCELLED'].includes(o.state)?'<button class="fx-button danger" data-ab-cancel="'+esc(o.id)+'">Emergency CANCEL</button>':'')+'<button class="fx-button secondary" data-ab-audit="'+esc(o.id)+'">Audit history</button></div><pre id="audit-'+esc(o.id)+'" style="display:none;white-space:pre-wrap"></pre></article>').join('')||'<div class="notice">No auto-buy orders configured.</div>';
              document.querySelectorAll('[data-ab-arm]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('ARM this exact order for unattended execution? Review every displayed limit before continuing.'))return;b.disabled=true;b.textContent='Arming…';await autoBuyAction('/api/liquidity-auto-buy/orders/'+encodeURIComponent(b.dataset.abArm)+'/arm','Order ARMED. Monitoring exact-address liquidity now.')}));
              document.querySelectorAll('[data-ab-cancel]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('Emergency-cancel this order?'))return;b.disabled=true;b.textContent='Cancelling…';await autoBuyAction('/api/liquidity-auto-buy/orders/'+encodeURIComponent(b.dataset.abCancel)+'/cancel','Order cancelled.')}));
              document.querySelectorAll('[data-ab-audit]').forEach(b=>b.addEventListener('click',async()=>{const p=await fetch('/api/liquidity-auto-buy/orders/'+encodeURIComponent(b.dataset.abAudit)+'/audit').then(r=>r.json()),el=document.getElementById('audit-'+b.dataset.abAudit);el.style.display='block';el.textContent=JSON.stringify(p.events||[],null,2)}));
            }catch(error){document.getElementById('ab-status').textContent=error.message||'Auto-buy status unavailable'}
          }
          async function autoBuyAction(url,successMessage){const status=document.getElementById('ab-status');try{const response=await fetch(url,{method:'POST',headers:{accept:'application/json'},credentials:'same-origin'});const text=await response.text();let body={};try{body=text?JSON.parse(text):{}}catch{throw new Error('Server returned HTTP '+response.status+' instead of JSON')}if(!response.ok)throw new Error(body.message||'Action failed with HTTP '+response.status);status.className='notice';status.textContent=successMessage||('Order updated: '+body.state);await loadAutoBuy();return body}catch(error){status.className='notice warning';status.textContent='Could not update order: '+(error.message||'Unknown request error');await loadAutoBuy();return null}}
          document.getElementById('ab-create').addEventListener('click',async()=>{
            const input={tokenAddress:document.getElementById('ab-token').value.trim(),sellToken:document.getElementById('ab-sell').value,spendAmount:document.getElementById('ab-amount').value,maxSlippageBps:Number(document.getElementById('ab-slippage').value),maxPriceImpactBps:Number(document.getElementById('ab-impact').value),maxGasCostEth:document.getElementById('ab-gas').value,minPoolLiquidityUsd:Number(document.getElementById('ab-liquidity').value),transactionDeadlineSecs:Number(document.getElementById('ab-deadline').value),retryLimit:Number(document.getElementById('ab-retries').value),permittedRouters:[document.getElementById('ab-router').value],autoBuyEnabled:document.getElementById('ab-auto').checked};
            const summary='Exact contract: '+input.tokenAddress+'\\nSpend: '+input.spendAmount+' '+input.sellToken+'\\nMax slippage: '+input.maxSlippageBps+' bps\\nMax price impact: '+input.maxPriceImpactBps+' bps\\nMax gas: '+input.maxGasCostEth+' ETH\\nMinimum liquidity: $'+input.minPoolLiquidityUsd+'\\nDeadline: '+input.transactionDeadlineSecs+' seconds\\nRetries: '+input.retryLimit+'\\nRouter: '+input.permittedRouters[0]+'\\nAUTO authorization: '+input.autoBuyEnabled;
            if(!confirm('Review draft parameters:\\n\\n'+summary+'\\n\\nCreate this DRAFT? This does not arm or execute it.'))return;
            const response=await fetch('/api/liquidity-auto-buy/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}),body=await response.json();document.getElementById('ab-status').textContent=response.ok?'Verified Base contract and created DRAFT. Review the card, then press ARM.':(body.message||'Draft creation failed');await loadAutoBuy();
          });
          document.getElementById('ab-master').addEventListener('change',async(event)=>{const enabled=event.currentTarget.checked;if(enabled&&!confirm('Turn Master AUTO BUY ON? Only individually reviewed and ARMED orders can execute.')){event.currentTarget.checked=false;return}if(!enabled&&!confirm('Turn Master AUTO BUY OFF immediately? Armed orders will remain saved but cannot execute.')){event.currentTarget.checked=true;return}const response=await fetch('/api/liquidity-auto-buy/master',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({enabled})}),body=await response.json();document.getElementById('ab-status').textContent=response.ok?(enabled?'Master AUTO BUY is ON. Only explicitly ARMED orders are eligible.':'Master AUTO BUY is OFF. Monitoring and execution are stopped.'):(body.message||'Could not change master switch');await loadAutoBuy()});
          loadAutoBuy();setInterval(loadAutoBuy,15000);
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
    const liquiditySeries = history.observations.map((observation) => Number(((observation.evidence || {}) as Record<string, unknown>).liquidityUsd)).filter(Number.isFinite)
    const maxLiquidity = Math.max(1, ...liquiditySeries)
    const liquidityPoints = liquiditySeries.length > 1 ? liquiditySeries.map((value, index) => `${(index / (liquiditySeries.length - 1)) * 100},${58 - (value / maxLiquidity) * 50}`).join(' ') : '0,50 100,50'
    const concentration = Number(evidence.top10HolderPercent)
    const risk = Math.max(0, Math.min(100, candidate.riskScore))

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
        <section class="section intelligence-hero card">
          <div><p class="eyebrow">Liquidity history · ${liquiditySeries.length} observations</p><h2>${this.money(evidence.liquidityUsd)} verified liquidity</h2><svg class="history-chart" viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label="Verified liquidity observation history"><polyline points="${liquidityPoints}" fill="none" stroke="var(--fx-primary)" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg></div>
          <div class="detail-gauge"><div class="risk-gauge" style="--risk:${risk}" aria-label="Risk score ${risk} out of 100"><b>${risk}</b></div><span>Risk score</span></div>
          <div class="holder-visual"><strong>${this.percent(concentration)}</strong><span>Top 10 holder concentration</span><div><i style="--value:${Number.isFinite(concentration) ? Math.max(0, Math.min(100, concentration)) : 0}%"></i></div></div>
        </section>
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
          <tbody>${
            history.observations
              .map((observation) => {
                const snapshot = (observation.evidence || {}) as Record<string, unknown>
                return `<tr><td>${this.formatDate(observation.observedAt)}</td><td>${this.escape(observation.classification)}</td><td>${observation.opportunityScore}</td><td>${observation.riskScore}</td><td>${this.money(snapshot.liquidityUsd)}</td><td>${this.percent(snapshot.top10HolderPercent)}</td></tr>`
              })
              .join('') || '<tr><td colspan="6">No observations recorded.</td></tr>'
          }</tbody></table>
        </section>
        ${errors.length ? `<section class="section"><div class="notice warning"><strong>Collection issues</strong><ul>${errors.map((error) => `<li>${this.escape(error)}</li>`).join('')}</ul></div></section>` : ''}
      `,
      extraStyles: `
        .verdict-card { min-width:280px; }
        .intelligence-hero{display:grid;grid-template-columns:minmax(0,1fr) 120px 240px;align-items:center;gap:28px}.history-chart{width:100%;height:120px;margin-top:12px;background:linear-gradient(180deg,rgba(56,189,248,.08),transparent);border-bottom:1px solid var(--fx-line)}.detail-gauge{display:grid;justify-items:center;gap:8px;color:var(--fx-muted)}.risk-gauge{--risk:0;aspect-ratio:1;width:82px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--fx-danger) calc(var(--risk)*1%),rgba(255,255,255,.07) 0);position:relative}.risk-gauge:after{content:"";position:absolute;inset:8px;border-radius:50%;background:var(--fx-panel)}.risk-gauge b{z-index:1;font-size:1.4rem}.holder-visual{display:grid;gap:8px}.holder-visual strong{font-size:1.8rem}.holder-visual span{color:var(--fx-muted)}.holder-visual div{height:8px;border-radius:5px;background:rgba(255,255,255,.08);overflow:hidden}.holder-visual i{display:block;height:100%;width:var(--value);background:linear-gradient(90deg,var(--fx-primary),var(--fx-warning),var(--fx-danger))}
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
        @media (max-width:900px) { .detail-grid,.evidence-stats,.intelligence-hero { grid-template-columns:1fr; }.detail-gauge{justify-items:start}.history-chart{height:90px} }
      `,
    })
  }

  private renderCandidate(candidate: Candidate, rank: number): string {
    const evidence = (candidate.evidence || {}) as Record<string, unknown>
    const rationale = Array.isArray(evidence.rationale) ? evidence.rationale.map(String).slice(0, 5) : []
    const label = String(evidence.symbol || evidence.name || candidate.tokenMint.slice(0, 8))
    const website = this.safeUrl(evidence.website)
    const twitter = this.safeUrl(evidence.twitter)
    const telegram = this.safeUrl(evidence.telegram)
    const liquidity = typeof evidence.liquidityUsd === 'number' ? evidence.liquidityUsd : null
    const concentration = typeof evidence.top10HolderPercent === 'number' ? Math.max(0, Math.min(100, evidence.top10HolderPercent)) : null
    const risk = Math.max(0, Math.min(100, Number(candidate.riskScore || 0)))
    const signalPoints = [12, 12 + candidate.opportunityScore * .22, 18 + (100 - risk) * .18, 22 + Math.min(28, Math.log10(Math.max(1, liquidity || 1)) * 6), 28 + candidate.opportunityScore * .3]
    const sparkPoints = signalPoints.map((point, index) => `${index * 25},${60 - Math.max(5, Math.min(55, point))}`).join(' ')
    const verified = Boolean(evidence.contractVerified || evidence.verifiedContract || evidence.mintAuthority === null)
    return `
      <article class="card candidate-card">
        <div class="candidate-head">
          <div><div class="candidate-rank">Rank ${rank} · ${this.escape(candidate.chain)}</div><h3>${this.escape(label)}</h3></div>
          ${StatusBadge(candidate.classification || candidate.status, candidate.classification === 'REJECT' ? 'danger' : candidate.classification === 'PROMISING' ? 'success' : 'warning', candidate.classification === 'PROMISING' ? '✓' : '!')}
        </div>
        <div class="source-row">${NetworkBadge(candidate.chain)}${StatusBadge(verified ? 'Contract verified' : 'Verification pending', verified ? 'success' : 'neutral', verified ? '✓' : '·')}<span class="source-icon" title="Source: ${this.escape(candidate.source)}">SRC</span>${website ? '<span class="source-icon" title="Website found">WEB</span>' : ''}${twitter ? '<span class="source-icon" title="X / Twitter found">X</span>' : ''}${telegram ? '<span class="source-icon" title="Telegram found">TG</span>' : ''}</div>
        <div class="candidate-visuals"><div><small>Evidence signal profile</small><svg class="sparkline" viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label="Evidence signal profile, not price history"><defs><linearGradient id="candidate-gradient" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#38bdf8"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0"/></linearGradient></defs><polyline points="${sparkPoints}" fill="none" stroke="var(--fx-primary)" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg></div><div class="risk-gauge" style="--risk:${risk}" aria-label="Risk score ${risk} out of 100"><b>${risk}</b></div></div>
        <div class="score-row">
          <div class="score-box"><span>Liquidity</span><strong>${this.money(liquidity)}</strong></div>
          <div class="score-box"><span>Opportunity</span><strong>${candidate.opportunityScore ?? '—'}</strong></div>
        </div>
        <div class="concentration"><small>Top 10 holder concentration · ${this.percent(concentration)}</small><div><i style="--value:${concentration ?? 0}%"></i></div></div>
        <div class="candidate-mint">${this.escape(candidate.tokenMint)}</div>
        <ul class="evidence-list">${rationale.map((item) => `<li>${this.escape(item)}</li>`).join('') || '<li>Evidence collection pending</li>'}</ul>
        <div class="candidate-meta"><span>${this.escape(candidate.source)}</span><span>Detected ${this.escape(candidate.detectedAt.toISOString())}</span></div>
        <div class="candidate-actions">${website ? `<a class="fx-button secondary" href="${this.escape(website)}" target="_blank" rel="noopener noreferrer nofollow">Website</a>` : ''}<a class="fx-button" href="/dashboard/discovery/${encodeURIComponent(candidate.chain)}/${encodeURIComponent(candidate.tokenMint)}">Open intelligence</a></div>
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

  private legendRow(label: string, count: number, color: string): string {
    return `<div class="legend-row"><span class="legend-key"><i class="legend-dot" style="--dot:${color}"></i>${this.escape(label)}</span><strong>${count}</strong></div>`
  }

  private metric(label: string, value: unknown, description: string): string {
    return `<article class="card"><div class="eyebrow">${this.escape(label)}</div><div class="big">${this.escape(value)}</div><p>${this.escape(description)}</p></article>`
  }

  private check(label: string, passed: boolean, detail: string): string {
    return `<div class="check-row"><span class="check-icon${passed ? ' pass' : ''}">${passed ? '✓' : '×'}</span><div class="check-copy"><strong>${this.escape(label)}</strong><span>${this.escape(detail)}</span></div></div>`
  }

  private money(value: unknown): string {
    const amount = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(amount) && value !== null
      ? `$${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
      : 'Not verified'
  }

  private percent(value: unknown): string {
    const amount = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(amount) && value !== null ? `${amount.toFixed(2)}%` : 'Unknown'
  }

  private formatDate(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value)
    return Number.isNaN(date.getTime())
      ? 'Unknown'
      : date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
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
