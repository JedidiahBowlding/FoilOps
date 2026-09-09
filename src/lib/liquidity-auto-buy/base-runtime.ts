import { Contract, JsonRpcProvider, Wallet, formatUnits, getAddress, isAddress, parseUnits } from 'ethers'
import type { AutoBuyOrder, AutoBuyRuntime, PoolObservation, SwapQuote } from './types'
import { BASE_ALLOWANCE_HOLDER, BASE_CHAIN_ID, BASE_NATIVE, BASE_USDC } from './types'

const ERC20_ABI = ['function decimals() view returns (uint8)','function symbol() view returns (string)','function totalSupply() view returns (uint256)','function balanceOf(address) view returns (uint256)','function allowance(address,address) view returns (uint256)','function approve(address,uint256) returns (bool)']

export class LiquidityMonitor {
  constructor(private readonly provider: JsonRpcProvider) {}
  async verifyContract(address: string) {
    if (!isAddress(address)) throw new Error('A valid Base token contract is required')
    if (Number((await this.provider.getNetwork()).chainId) !== BASE_CHAIN_ID) throw new Error('RPC is not connected to Base mainnet')
    if ((await this.provider.getCode(address)) === '0x') throw new Error('No contract exists at the configured Base address')
    // ERC-20 metadata is optional and some launch contracts intentionally revert it
    // before initialization. Bytecode proves the exact Base contract exists; the
    // later 0x route, output, pool and exact-swap simulation remain mandatory.
    const token = new Contract(address, ERC20_ABI, this.provider)
    await Promise.allSettled([token.symbol(), token.decimals(), token.totalSupply()])
  }
  async observe(address: string): Promise<PoolObservation|null> {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`Liquidity source HTTP ${response.status}`)
    const body = await response.json() as any
    const pairs = (Array.isArray(body?.pairs) ? body.pairs : []).filter((pair: any) => pair.chainId === 'base' && [pair.baseToken?.address, pair.quoteToken?.address].some((x: string) => x?.toLowerCase() === address.toLowerCase()))
    const pair = pairs.sort((a: any,b: any) => Number(b.liquidity?.usd||0)-Number(a.liquidity?.usd||0))[0]
    if (!pair?.pairAddress || !isAddress(pair.pairAddress)) return null
    return { tokenAddress: address.toLowerCase(), poolAddress: pair.pairAddress.toLowerCase(), dex: String(pair.dexId||'unknown'), liquidityUsd: Number(pair.liquidity?.usd||0), tokenPriceUsd: Number(pair.priceUsd||0), observedAt: new Date().toISOString() }
  }
}

export class PoolValidator {
  constructor(private readonly provider: JsonRpcProvider) {}
  async validate(observation: PoolObservation, order: AutoBuyOrder) {
    if (observation.tokenAddress !== order.tokenAddress.toLowerCase()) throw new Error('Pool token does not exactly match configured contract')
    if (observation.liquidityUsd < order.minPoolLiquidityUsd) throw new Error(`Pool liquidity $${Math.round(observation.liquidityUsd)} is below configured minimum`)
    if (!Number.isFinite(observation.tokenPriceUsd) || observation.tokenPriceUsd <= 0) throw new Error('Pool does not expose a usable token price')
    const supported=(process.env.BASE_AUTO_BUY_SUPPORTED_DEXES||'uniswap,aerodrome,baseswap,pancakeswap').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean)
    if(!supported.some(dex=>observation.dex.toLowerCase().includes(dex)))throw new Error(`Pool DEX ${observation.dex} is not in the supported allowlist`)
    if ((await this.provider.getCode(observation.poolAddress)) === '0x') throw new Error('Reported pool is not a deployed Base contract')
  }
}

export class QuoteEngine {
  constructor(private readonly provider: JsonRpcProvider) {}
  async quote(order: AutoBuyOrder, observation: PoolObservation): Promise<SwapQuote> {
    const wallet = this.wallet()
    const sellToken = order.sellToken === 'ETH' ? BASE_NATIVE : BASE_USDC
    const decimals = order.sellToken === 'ETH' ? 18 : 6
    const sellAmount = parseUnits(order.spendAmount, decimals)
    const balance=order.sellToken==='ETH'?await this.provider.getBalance(wallet.address):await new Contract(BASE_USDC,ERC20_ABI,this.provider).balanceOf(wallet.address)
    if(balance<sellAmount)throw new Error(`Insufficient ${order.sellToken} balance for authorized spend`)
    const url = new URL('https://api.0x.org/swap/allowance-holder/quote')
    Object.entries({ chainId: String(BASE_CHAIN_ID), sellToken, buyToken: order.tokenAddress, sellAmount: sellAmount.toString(), taker: wallet.address, slippageBps: String(order.maxSlippageBps) }).forEach(([key,value])=>url.searchParams.set(key,value))
    const response = await fetch(url, { headers: { '0x-api-key': this.apiKey(), '0x-version': 'v2' }, signal: AbortSignal.timeout(15_000) })
    const body = await response.json() as any
    if (!response.ok || !body?.transaction?.to || !body?.transaction?.data) throw new Error(body?.reason || body?.message || `No usable 0x route (HTTP ${response.status})`)
    const buyAmount = BigInt(body.buyAmount||0), minBuyAmount = BigInt(body.minBuyAmount||0)
    const gasLimit = BigInt(body.transaction.gas||0), gasPrice = BigInt(body.transaction.gasPrice||body.transaction.maxFeePerGas||0)
    let approvalGas=BigInt(0)
    if(order.sellToken==='USDC'){
      const spender=body?.issues?.allowance?.spender||body?.allowanceTarget
      if(String(spender).toLowerCase()!==BASE_ALLOWANCE_HOLDER||String(body.transaction.to).toLowerCase()!==BASE_ALLOWANCE_HOLDER)throw new Error('Untrusted allowance target')
      const token=new Contract(BASE_USDC,ERC20_ABI,wallet.connect(this.provider));const allowance:bigint=await token.allowance(wallet.address,spender)
      if(allowance<sellAmount)approvalGas=await token.approve.estimateGas(spender,sellAmount)
    }
    const sellUsd = Number(order.spendAmount) * (order.sellToken === 'USDC' ? 1 : await this.ethUsd())
    const token = new Contract(order.tokenAddress, ERC20_ABI, this.provider)
    const tokenDecimals = Number(await token.decimals())
    const outputUsd = Number(formatUnits(buyAmount, tokenDecimals)) * observation.tokenPriceUsd
    const priceImpactBps = sellUsd > 0 ? Math.max(0, Math.ceil((1-outputUsd/sellUsd)*10_000)) : 10_000
    if(order.sellToken==='ETH'&&balance<sellAmount+(gasLimit+approvalGas)*gasPrice)throw new Error('Insufficient ETH balance for spend plus maximum estimated gas')
    body.foilopsApprovalGas=approvalGas.toString()
    return { router: 'ZEROX_ALLOWANCE_HOLDER', sellAmount, buyAmount, minBuyAmount, gasLimit, gasPrice, gasCostWei: (gasLimit+approvalGas)*gasPrice, priceImpactBps, transaction: { to: body.transaction.to, data: body.transaction.data, value: BigInt(body.transaction.value||0), gasLimit, gasPrice }, raw: body }
  }
  private async ethUsd() { const r=await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot',{signal:AbortSignal.timeout(8_000)}); if(!r.ok)throw new Error('ETH/USD reference unavailable'); const b=await r.json() as any; const n=Number(b?.data?.amount); if(!Number.isFinite(n)||n<=0)throw new Error('ETH/USD reference invalid'); return n }
  wallet() { const key=process.env.BASE_EXECUTION_PRIVATE_KEY?.trim(); if(!key)throw new Error('Execution wallet is not configured'); return new Wallet(key) }
  private apiKey(){const key=process.env.ZEROX_API_KEY?.trim();if(!key)throw new Error('0x API key is not configured');return key}
}

export class RiskGuard {
  enforce(order: AutoBuyOrder, observation: PoolObservation, quote: SwapQuote) {
    if (order.chainId !== BASE_CHAIN_ID) throw new Error('Order chain is not Base mainnet')
    if (observation.tokenAddress !== order.tokenAddress.toLowerCase()) throw new Error('Exact token-address check failed')
    if (!order.permittedRouters.includes(quote.router)) throw new Error('Quote router is not permitted by this order')
    if (quote.buyAmount <= BigInt(0) || quote.minBuyAmount <= BigInt(0)) throw new Error('Expected output or amountOutMinimum is zero')
    if (quote.priceImpactBps > order.maxPriceImpactBps) throw new Error(`Price impact ${quote.priceImpactBps} bps exceeds configured limit`)
    if (quote.gasCostWei > BigInt(order.maxGasCostWei)) throw new Error('Estimated gas cost exceeds configured limit')
    if (!order.autoBuyEnabled) throw new Error('AUTO BUY is not enabled for this order')
    if (!order.expiresAt || order.expiresAt.getTime() <= Date.now()) throw new Error('Transaction deadline expired')
  }
}

export class TransactionBuilder {
  build(order: AutoBuyOrder, quote: SwapQuote) {
    if (quote.minBuyAmount <= BigInt(0) || quote.minBuyAmount > quote.buyAmount) throw new Error('Invalid amountOutMinimum')
    if (!order.expiresAt || Date.now() >= order.expiresAt.getTime()) throw new Error('Transaction deadline expired')
    if (!isAddress(quote.transaction.to)) throw new Error('Invalid transaction target')
    return { to:getAddress(quote.transaction.to), data:quote.transaction.data, value:quote.transaction.value, gasLimit:quote.transaction.gasLimit, gasPrice:quote.transaction.gasPrice }
  }
}

export class SwapSimulator {
  constructor(private readonly provider: JsonRpcProvider, private readonly walletAddress: string) {}
  async simulate(request: any) { await this.provider.call({ ...request, from: this.walletAddress }) }
}

export class TransactionSigner {
  constructor(private readonly wallet: Wallet) {}
  async signAndSend(request: any) { return this.wallet.sendTransaction(request) }
}

export class ExecutionEngine {
  constructor(private readonly provider: JsonRpcProvider, private readonly quotes: QuoteEngine, private readonly guard: RiskGuard, private readonly builder: TransactionBuilder) {}
  async execute(order: AutoBuyOrder, observation: PoolObservation, quote: SwapQuote, onBroadcast?: (hash:string)=>Promise<void>) {
    if (process.env.BASE_AUTO_BUY_ENABLED !== 'true' || process.env.BASE_AUTO_BUY_RUNTIME_ENABLED !== 'true' || process.env.BASE_AUTO_BUY_HARD_KILL_SWITCH === 'true') throw new Error('Global AUTO BUY execution is disabled')
    if (Number((await this.provider.getNetwork()).chainId) !== BASE_CHAIN_ID) throw new Error('Execution RPC is not Base mainnet')
    this.guard.enforce(order, observation, quote)
    const wallet = this.quotes.wallet().connect(this.provider)
    if (order.sellToken === 'USDC') {
      const raw = quote.raw as any, spender=raw?.issues?.allowance?.spender||raw?.allowanceTarget
      if (String(spender).toLowerCase()!==BASE_ALLOWANCE_HOLDER || String(quote.transaction.to).toLowerCase()!==BASE_ALLOWANCE_HOLDER) throw new Error('Untrusted allowance target')
      const token=new Contract(BASE_USDC,ERC20_ABI,wallet); const allowance:bigint=await token.allowance(wallet.address,spender)
      if(allowance<quote.sellAmount){const approval=await token.approve(spender,quote.sellAmount);await approval.wait(1)}
    }
    const request=this.builder.build(order,quote)
    if((await this.provider.getCode(request.to))==='0x')throw new Error('Swap target is not deployed')
    await new SwapSimulator(this.provider,wallet.address).simulate(request)
    const sent=await new TransactionSigner(wallet).signAndSend(request)
    if(onBroadcast)await onBroadcast(sent.hash)
    const receipt=await Promise.race([sent.wait(1),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Transaction receipt timeout; reconciliation required')),120_000))])
    return { hash:sent.hash,status:receipt?.status??null }
  }
}

export class BaseAutoBuyRuntime implements AutoBuyRuntime {
  readonly provider=new JsonRpcProvider(process.env.BASE_SWAP_RPC_URL?.trim()||'https://mainnet.base.org',BASE_CHAIN_ID,{staticNetwork:true})
  readonly monitor=new LiquidityMonitor(this.provider); readonly pools=new PoolValidator(this.provider); readonly quotes=new QuoteEngine(this.provider); readonly riskGuard=new RiskGuard(); readonly builder=new TransactionBuilder(); readonly execution=new ExecutionEngine(this.provider,this.quotes,this.riskGuard,this.builder)
  verifyContract(a:string){return this.monitor.verifyContract(a)} observe(a:string){return this.monitor.observe(a)} validatePool(o:PoolObservation,r:AutoBuyOrder){return this.pools.validate(o,r)} quote(r:AutoBuyOrder,o:PoolObservation){return this.quotes.quote(r,o)}
  guard(r:AutoBuyOrder,o:PoolObservation,q:SwapQuote){this.riskGuard.enforce(r,o,q)}
  async simulate(r:AutoBuyOrder,q:SwapQuote){const wallet=this.quotes.wallet();const request=this.builder.build(r,q);await new SwapSimulator(this.provider,wallet.address).simulate(request)}
  execute(r:AutoBuyOrder,q:SwapQuote,onBroadcast?: (hash:string)=>Promise<void>){return this.execution.execute(r,{tokenAddress:r.tokenAddress.toLowerCase(),poolAddress:r.poolAddress||'',dex:r.poolRouter||'',liquidityUsd:r.currentLiquidityUsd||0,tokenPriceUsd:1,observedAt:new Date().toISOString()},q,onBroadcast)}
  async receipt(hash:string){const r=await this.provider.getTransactionReceipt(hash);return r?{status:r.status}:null}
}
