import { PrismaLaunchCandidateRepository } from '../repositories/prisma/launch-candidate'
import { renderFuturisticPage } from './site-theme'

type Candidate = Awaited<ReturnType<PrismaLaunchCandidateRepository['list']>>[number]

export class LaunchDiscoveryDashboard {
  constructor(private readonly repository: PrismaLaunchCandidateRepository) {}

  async renderHtmlDashboard(): Promise<string> {
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
        <section class="section card research-workbench">
          <div class="section-header"><div class="section-header-copy"><p class="eyebrow">Deep investigation</p><h2>Research any Solana or Base token</h2><p class="section-subtitle">Collect controls, holders, every visible pool, LP-lock evidence, creator conflicts, protocol/DAO/NFT claims, and an evidence-weighted verdict.</p></div></div>
          <div class="research-controls"><select id="research-chain"><option value="solana">Solana</option><option value="base">Base</option></select><input id="research-mint" placeholder="Paste a Solana mint or Base contract" autocomplete="off" spellcheck="false"><button class="fx-button" id="run-research" type="button">Investigate Token</button></div>
          <div id="research-status" class="notice">No token investigated in this session.</div>
          <div id="research-result"></div>
        </section>
        <section class="section card base-swap-workbench">
          <div class="section-header"><div class="section-header-copy"><p class="eyebrow">Base execution</p><h2>Confirmation-required swap</h2><p class="section-subtitle">Quotes are screened by FoilOps risk and liquidity gates. Live execution requires a dedicated server wallet and a second explicit confirmation.</p></div><span id="base-swap-mode" class="badge">Checking…</span></div>
          <div class="swap-grid"><label>Sell token<input id="swap-sell-token" value="ETH" placeholder="ETH or Base contract"></label><label>Buy token<input id="swap-buy-token" placeholder="Base token contract"></label><label>Amount<input id="swap-amount" inputmode="decimal" placeholder="0.01"></label><label>Slippage (bps)<input id="swap-slippage" type="number" min="1" max="300" value="100"></label></div>
          <div class="research-controls"><button class="fx-button secondary" id="base-swap-quote" type="button">Get Safe Quote</button><button class="fx-button secondary" id="base-swap-watch" type="button">Start Server Watch</button><button class="fx-button" id="base-swap-confirm" type="button" disabled>Confirm Live Swap</button></div>
          <div id="base-swap-status" class="notice">A quote does not execute a transaction.</div><div id="base-swap-quote-result"></div><div id="base-swap-watches"></div>
        </section>
        <section class="section card auto-buy-workbench">
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
          <div class="research-controls"><button class="fx-button secondary" id="ab-create" type="button">Verify Contract & Create Draft</button><button class="fx-button danger" id="ab-kill-info" type="button">Emergency status</button></div>
          <div id="ab-status" class="notice">AUTO BUY is disabled until you explicitly enable the toggle, create a reviewed draft, and press ARM.</div>
          <div id="ab-orders"></div>
        </section>
        <section class="viz-grid">
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
        .score-bars { align-content:center; height:100%; }
        .legend-row { display:flex;align-items:center;justify-content:space-between;gap:12px;color:var(--fx-muted);font-size:.84rem; }
        .legend-key { display:inline-flex;align-items:center;gap:9px; }
        .legend-dot { width:10px;height:10px;border-radius:50%;background:var(--dot);box-shadow:0 0 14px var(--dot); }
        @media (max-width:900px) { .discovery-grid { grid-template-columns:1fr; } }
        .research-controls{display:flex;gap:10px}.research-controls input{flex:1;min-width:0}.research-controls input,.research-controls select{padding:13px 14px;border-radius:12px;border:1px solid var(--fx-line-strong);background:#091522;color:var(--fx-text)}
        .research-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:14px}.research-panel{padding:14px;border:1px solid var(--fx-line);border-radius:14px;background:rgba(255,255,255,.025)}.research-panel strong{display:block;font-size:1.35rem}.finding{margin-top:8px;padding:10px;border-left:3px solid var(--fx-secondary);background:rgba(255,255,255,.025)}.finding b{color:var(--fx-warning)}
        .swap-grid{display:grid;grid-template-columns:1.2fr 1.2fr .7fr .7fr;gap:10px;margin:12px 0}.swap-grid label{display:grid;gap:6px;color:var(--fx-muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.05em}.swap-grid input{padding:12px;border-radius:10px;border:1px solid var(--fx-line-strong);background:#091522;color:var(--fx-text);min-width:0}.quote-warning{border-color:var(--fx-warning);margin-top:12px}
        .auto-buy-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:12px 0}.auto-buy-grid label{display:grid;gap:6px;color:var(--fx-muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.04em}.auto-buy-grid input,.auto-buy-grid select{padding:11px;border-radius:10px;border:1px solid var(--fx-line-strong);background:#091522;color:var(--fx-text);min-width:0}.auto-buy-grid label:first-child{grid-column:span 2}.auto-toggle{display:flex;gap:10px;align-items:flex-start;padding:12px;margin:12px 0;border:1px solid var(--fx-warning);border-radius:12px;color:var(--fx-warning)}.auto-order{margin-top:12px;padding:14px;border:1px solid var(--fx-line);border-radius:14px}.auto-order-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.auto-order-grid span{overflow-wrap:anywhere}.danger{border-color:var(--fx-danger)!important;color:var(--fx-danger)!important}
        @media(max-width:900px){.research-controls{flex-direction:column}.research-grid{grid-template-columns:1fr 1fr}}@media(max-width:520px){.research-grid{grid-template-columns:1fr}}
        @media(max-width:900px){.swap-grid{grid-template-columns:1fr 1fr}}@media(max-width:520px){.swap-grid{grid-template-columns:1fr}}
        @media(max-width:900px){.auto-buy-grid{grid-template-columns:1fr 1fr}.auto-order-grid{grid-template-columns:1fr 1fr}}@media(max-width:520px){.auto-buy-grid,.auto-order-grid{grid-template-columns:1fr}.auto-buy-grid label:first-child{grid-column:auto}}
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
          document.getElementById('run-research').addEventListener('click',async()=>{
            const mint=document.getElementById('research-mint').value.trim(), chain=document.getElementById('research-chain').value, button=document.getElementById('run-research'), status=document.getElementById('research-status'), out=document.getElementById('research-result');
            if(!mint){status.textContent='Paste a Solana mint or Base contract first.';return} button.disabled=true;status.textContent='Collecting independent evidence…';out.innerHTML='';
            try{const response=await fetch('/api/discovery/research',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mint,chain})});const r=await response.json();if(!response.ok)throw new Error(r.message||'Research failed');
              status.textContent='Research completed '+new Date(r.observedAt).toLocaleString()+' · confidence '+r.scores.confidence+'%';
              const findings=Object.entries(r.findings).map(([k,v])=>'<div class="finding"><b>'+esc(k.toUpperCase())+' · '+esc(v.status)+'</b><span>'+esc(v.summary)+'</span></div>').join('');
              out.innerHTML='<div class="research-grid"><div class="research-panel"><span>Verdict</span><strong>'+esc(r.scores.verdict)+'</strong></div><div class="research-panel"><span>Overall risk</span><strong>'+esc(r.scores.overallRisk)+'/100</strong></div><div class="research-panel"><span>Liquidity</span><strong>'+money(r.market.liquidityUsd)+'</strong></div><div class="research-panel"><span>Top 10</span><strong>'+Number(r.holders.top10Percent).toFixed(2)+'%</strong></div></div><h3>'+esc(r.identity.name||r.mint)+' evidence dossier</h3>'+findings+'<div class="detail-grid" style="margin-top:12px"><div class="research-panel"><h3>Green flags</h3><ul class="readable-list">'+r.greenFlags.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></div><div class="research-panel"><h3>Red flags</h3><ul class="readable-list">'+r.redFlags.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></div></div><details style="margin-top:12px"><summary>Raw evidence and next checks</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(JSON.stringify(r,null,2))+'</pre></details>';
            }catch(error){status.textContent=error.message||'Research failed'}finally{button.disabled=false}
          });
          let baseSwapConfirmation=null,baseSwapWatchBusy=false;
          async function loadBaseSwapStatus(){try{const r=await fetch('/api/base-swap/status').then(x=>x.json());document.getElementById('base-swap-mode').textContent=r.enabled&&r.configured?'LIVE · CONFIRMATION REQUIRED':r.configured?'CONFIGURED · LIVE DISABLED':'NOT CONFIGURED';document.getElementById('base-swap-status').textContent=(r.walletAddress?'Wallet '+r.walletAddress.slice(0,8)+'…'+r.walletAddress.slice(-6):'No execution wallet')+' · max '+r.maxTradeEth+' ETH · max slippage '+r.maxSlippageBps+' bps';}catch{document.getElementById('base-swap-mode').textContent='UNAVAILABLE'}}
          async function requestBaseQuote(){const button=document.getElementById('base-swap-quote'),status=document.getElementById('base-swap-status'),out=document.getElementById('base-swap-quote-result'),confirm=document.getElementById('base-swap-confirm');if(baseSwapWatchBusy)return false;baseSwapWatchBusy=true;baseSwapConfirmation=null;confirm.disabled=true;button.disabled=true;status.textContent='Checking wallet balance, token risk, liquidity and live route…';try{const response=await fetch('/api/base-swap/quote',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sellToken:document.getElementById('swap-sell-token').value,buyToken:document.getElementById('swap-buy-token').value,amount:document.getElementById('swap-amount').value,slippageBps:Number(document.getElementById('swap-slippage').value)})});const q=await response.json();if(!response.ok)throw new Error(q.message||'Quote failed');baseSwapConfirmation=q.confirmationId;confirm.disabled=false;status.textContent='Route is live. Quote expires '+new Date(q.expiresAt).toLocaleTimeString()+'. Review and press Confirm Live Swap.';out.innerHTML='<div class="research-grid"><div class="research-panel"><span>You sell</span><strong>'+esc(q.sellAmount)+' '+esc(q.sellSymbol)+'</strong></div><div class="research-panel"><span>Expected</span><strong>'+esc(q.expectedBuyAmount)+' '+esc(q.buySymbol)+'</strong></div><div class="research-panel"><span>Minimum</span><strong>'+esc(q.minimumBuyAmount)+' '+esc(q.buySymbol)+'</strong></div><div class="research-panel"><span>Token risk</span><strong>'+esc(q.researchRisk??'—')+'</strong></div></div><div class="notice quote-warning">A valid route was found. No transaction occurs until you press Confirm Live Swap.</div>';document.title='ROUTE LIVE · Confirm Base Swap';return true;}catch(error){status.textContent=error.message||'Quote failed';out.innerHTML='';return false;}finally{baseSwapWatchBusy=false;button.disabled=false}}
          function stopBaseSwapWatch(){document.getElementById('base-swap-watch').disabled=false}
          document.getElementById('base-swap-quote').addEventListener('click',()=>requestBaseQuote(false));
          async function loadBaseWatches(){try{const payload=await fetch('/api/base-swap/watches').then(r=>r.json());const active=(payload.watches||[]).filter(w=>w.status==='WATCHING'||w.status==='READY');document.getElementById('base-swap-watches').innerHTML=active.length?'<h3>Persistent watches</h3>'+active.map(w=>'<div class="finding"><b>'+esc(w.status)+'</b><span>'+esc(w.buyToken)+' · '+esc(w.amount)+' ETH · '+esc(w.slippageBps)+' bps · '+esc(w.attempts)+' checks</span>'+(w.status==='READY'?'<button class="fx-button secondary" data-watch-review="'+esc(w.id)+'">Review fresh quote</button>':'')+'<button class="fx-button secondary" data-watch-cancel="'+esc(w.id)+'">Cancel</button></div>').join(''):'';document.querySelectorAll('[data-watch-cancel]').forEach(b=>b.addEventListener('click',async()=>{await fetch('/api/base-swap/watches/'+encodeURIComponent(b.dataset.watchCancel)+'/cancel',{method:'POST'});loadBaseWatches()}));document.querySelectorAll('[data-watch-review]').forEach(b=>b.addEventListener('click',()=>requestBaseQuote()));const requested=new URLSearchParams(location.search).get('baseWatch');const match=active.find(w=>w.id===requested);if(match&&!baseSwapConfirmation){document.getElementById('swap-sell-token').value=match.sellToken;document.getElementById('swap-buy-token').value=match.buyToken;document.getElementById('swap-amount').value=match.amount;document.getElementById('swap-slippage').value=match.slippageBps;if(match.status==='READY'){history.replaceState({},'',location.pathname);requestBaseQuote()}}}catch{}}
          document.getElementById('base-swap-watch').addEventListener('click',async()=>{const button=document.getElementById('base-swap-watch'),status=document.getElementById('base-swap-status');button.disabled=true;try{const response=await fetch('/api/base-swap/watches',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sellToken:document.getElementById('swap-sell-token').value,buyToken:document.getElementById('swap-buy-token').value,amount:document.getElementById('swap-amount').value,slippageBps:Number(document.getElementById('swap-slippage').value)})});const watch=await response.json();if(!response.ok)throw new Error(watch.message||'Watch creation failed');status.textContent='Server watch armed. FoilOps will keep checking even if you close this page and will alert Telegram when a route is ready.';await loadBaseWatches()}catch(error){status.textContent=error.message||'Watch creation failed'}finally{button.disabled=false}});
          document.getElementById('base-swap-confirm').addEventListener('click',async()=>{if(!baseSwapConfirmation)return;const button=document.getElementById('base-swap-confirm'),status=document.getElementById('base-swap-status');if(!window.confirm('Execute this Base swap with real funds? This cannot be undone.'))return;button.disabled=true;status.textContent='Simulating and submitting the Base transaction…';try{const response=await fetch('/api/base-swap/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirmationId:baseSwapConfirmation})});const r=await response.json();if(!response.ok)throw new Error(r.message||'Swap failed');baseSwapConfirmation=null;status.innerHTML='Swap '+esc(r.status)+'. <a href="https://basescan.org/tx/'+encodeURIComponent(r.transactionHash)+'" target="_blank" rel="noopener noreferrer">View transaction</a>';}catch(error){status.textContent=error.message||'Swap failed';}finally{button.disabled=true}});
          const watchId=new URLSearchParams(location.search).get('baseWatch');if(watchId)document.getElementById('base-swap-status').textContent='Telegram alert opened. Loading the watched limits and refreshing a current quote…';
          loadBaseSwapStatus();loadBaseWatches();setInterval(loadBaseWatches,15000);
          let autoBuyStatus={enabled:false,killSwitch:true};
          async function loadAutoBuy(){
            try{
              autoBuyStatus=await fetch('/api/liquidity-auto-buy/status').then(r=>r.json());
              document.getElementById('auto-buy-global').textContent=autoBuyStatus.killSwitch?'KILL SWITCH ACTIVE':autoBuyStatus.enabled?'AVAILABLE · EXPLICIT ARM':'SERVER DISABLED';
              const payload=await fetch('/api/liquidity-auto-buy/orders').then(r=>r.json()),orders=payload.orders||[];
              document.getElementById('ab-orders').innerHTML=orders.map(o=>'<article class="auto-order"><div class="candidate-head"><div><b>'+esc(o.state)+'</b><div class="candidate-mint">'+esc(o.tokenAddress)+'</div></div>'+(o.transactionHash?'<a href="https://basescan.org/tx/'+encodeURIComponent(o.transactionHash)+'" target="_blank" rel="noopener noreferrer">BaseScan</a>':'')+'</div><div class="auto-order-grid"><span>Spend<br><b>'+esc(o.spendAmount)+' '+esc(o.sellToken)+'</b></span><span>Liquidity<br><b>'+money(o.currentLiquidityUsd)+'</b></span><span>Pool / DEX<br><b>'+esc(o.poolRouter||'Waiting')+'</b></span><span>Expected raw output<br><b>'+esc(o.expectedOutput||'—')+'</b></span><span>Impact limit<br><b>'+esc(o.maxPriceImpactBps)+' bps</b></span><span>Slippage limit<br><b>'+esc(o.maxSlippageBps)+' bps</b></span><span>Gas limit<br><b>'+esc(o.maxGasCostWei)+' wei</b></span><span>Status<br><b>'+esc(o.lastReason||'—')+'</b></span></div><div class="research-controls" style="margin-top:10px">'+(o.state==='DRAFT'?'<button class="fx-button" data-ab-arm="'+esc(o.id)+'">ARM reviewed order</button>':'')+(!['CONFIRMED','CANCELLED'].includes(o.state)?'<button class="fx-button danger" data-ab-cancel="'+esc(o.id)+'">Emergency CANCEL</button>':'')+'<button class="fx-button secondary" data-ab-audit="'+esc(o.id)+'">Audit history</button></div><pre id="audit-'+esc(o.id)+'" style="display:none;white-space:pre-wrap"></pre></article>').join('')||'<div class="notice">No auto-buy orders configured.</div>';
              document.querySelectorAll('[data-ab-arm]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('ARM this exact order for unattended execution? Review every displayed limit before continuing.'))return;await autoBuyAction('/api/liquidity-auto-buy/orders/'+encodeURIComponent(b.dataset.abArm)+'/arm')}));
              document.querySelectorAll('[data-ab-cancel]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('Emergency-cancel this order?'))return;await autoBuyAction('/api/liquidity-auto-buy/orders/'+encodeURIComponent(b.dataset.abCancel)+'/cancel')}));
              document.querySelectorAll('[data-ab-audit]').forEach(b=>b.addEventListener('click',async()=>{const p=await fetch('/api/liquidity-auto-buy/orders/'+encodeURIComponent(b.dataset.abAudit)+'/audit').then(r=>r.json()),el=document.getElementById('audit-'+b.dataset.abAudit);el.style.display='block';el.textContent=JSON.stringify(p.events||[],null,2)}));
            }catch(error){document.getElementById('ab-status').textContent=error.message||'Auto-buy status unavailable'}
          }
          async function autoBuyAction(url){const response=await fetch(url,{method:'POST'}),body=await response.json();document.getElementById('ab-status').textContent=response.ok?'Order updated: '+body.state:(body.message||'Action failed');await loadAutoBuy()}
          document.getElementById('ab-create').addEventListener('click',async()=>{
            const input={tokenAddress:document.getElementById('ab-token').value.trim(),sellToken:document.getElementById('ab-sell').value,spendAmount:document.getElementById('ab-amount').value,maxSlippageBps:Number(document.getElementById('ab-slippage').value),maxPriceImpactBps:Number(document.getElementById('ab-impact').value),maxGasCostEth:document.getElementById('ab-gas').value,minPoolLiquidityUsd:Number(document.getElementById('ab-liquidity').value),transactionDeadlineSecs:Number(document.getElementById('ab-deadline').value),retryLimit:Number(document.getElementById('ab-retries').value),permittedRouters:[document.getElementById('ab-router').value],autoBuyEnabled:document.getElementById('ab-auto').checked};
            const summary='Exact contract: '+input.tokenAddress+'\nSpend: '+input.spendAmount+' '+input.sellToken+'\nMax slippage: '+input.maxSlippageBps+' bps\nMax price impact: '+input.maxPriceImpactBps+' bps\nMax gas: '+input.maxGasCostEth+' ETH\nMinimum liquidity: $'+input.minPoolLiquidityUsd+'\nDeadline: '+input.transactionDeadlineSecs+' seconds\nRetries: '+input.retryLimit+'\nRouter: '+input.permittedRouters[0]+'\nAUTO authorization: '+input.autoBuyEnabled;
            if(!confirm('Review draft parameters:\n\n'+summary+'\n\nCreate this DRAFT? This does not arm or execute it.'))return;
            const response=await fetch('/api/liquidity-auto-buy/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}),body=await response.json();document.getElementById('ab-status').textContent=response.ok?'Verified Base contract and created DRAFT. Review the card, then press ARM.':(body.message||'Draft creation failed');await loadAutoBuy();
          });
          document.getElementById('ab-kill-info').addEventListener('click',()=>alert(autoBuyStatus.killSwitch?'Emergency kill switch is ACTIVE. No auto-buy can execute.':'Emergency kill switch is not active. Use Emergency CANCEL per order, or set BASE_AUTO_BUY_KILL_SWITCH=true on the server.'));
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
