import { randomUUID } from 'crypto'
import { appendFile, chmod } from 'fs/promises'
import path from 'path'
import { Contract, JsonRpcProvider, Wallet, formatUnits, getAddress, isAddress, parseUnits } from 'ethers'
import { BaseTokenDeepResearchService } from './base-token-deep-research'

const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const BASE_ALLOWANCE_HOLDER = '0x0000000000001ff3684f28c67538d4d072c22734'
const ERC20_ABI = ['function decimals() view returns (uint8)', 'function symbol() view returns (string)', 'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)']

type PendingSwap = {
  id: string; expiresAt: number; sellToken: string; buyToken: string; sellAmount: bigint; sellSymbol: string; buySymbol: string
  sellDecimals: number; buyDecimals: number; quote: any; researchRisk: number | null; liquidityUsd: number | null
}

export class BaseSwapService {
  // Keep execution isolated from high-volume research RPCs. A depleted research
  // provider must not stall launch watches or transaction submission.
  private readonly rpcUrl = process.env.BASE_SWAP_RPC_URL?.trim() || 'https://mainnet.base.org'
  private readonly provider = new JsonRpcProvider(this.rpcUrl, 8453, { staticNetwork: true })
  private readonly research = new BaseTokenDeepResearchService()
  private readonly pending = new Map<string, PendingSwap>()
  private executing = false

  status() {
    const key = process.env.BASE_EXECUTION_PRIVATE_KEY?.trim()
    let walletAddress: string | null = null
    try { if (key) walletAddress = new Wallet(key).address } catch { /* invalid key is reported as unavailable */ }
    return { chain: 'base', chainId: 8453, enabled: process.env.BASE_SWAP_ENABLED === 'true', configured: Boolean(walletAddress && process.env.ZEROX_API_KEY), walletAddress, executionMode: process.env.BASE_SWAP_ENABLED === 'true' ? 'confirmation-required' : 'disabled', minLiquidityUsd: Number(process.env.BASE_SWAP_MIN_LIQUIDITY_USD || 10_000), maxRiskScore: Number(process.env.BASE_SWAP_MAX_RISK_SCORE || 45), maxSlippageBps: Number(process.env.BASE_SWAP_MAX_SLIPPAGE_BPS || 300), maxTradeEth: Number(process.env.BASE_SWAP_MAX_TRADE_ETH || .05) }
  }

  async quote(input: { sellToken: string; buyToken: string; amount: string; slippageBps?: number }) {
    const wallet = this.wallet()
    const sellToken = this.token(input.sellToken), buyToken = this.token(input.buyToken)
    if (sellToken === buyToken) throw new Error('Sell and buy tokens must differ')
    const slippageBps = Math.max(1, Math.floor(Number(input.slippageBps || 100)))
    if (slippageBps > this.status().maxSlippageBps) throw new Error(`Slippage exceeds the ${this.status().maxSlippageBps} bps safety limit`)
    const sellMeta = await this.metadata(sellToken), buyMeta = await this.metadata(buyToken)
    const sellAmount = parseUnits(String(input.amount), sellMeta.decimals)
    if (sellAmount <= BigInt(0)) throw new Error('Amount must be greater than zero')
    if (sellToken === NATIVE && Number(input.amount) > this.status().maxTradeEth) throw new Error(`Trade exceeds the ${this.status().maxTradeEth} ETH limit`)
    const balance = sellToken === NATIVE ? await this.provider.getBalance(wallet.address) : await new Contract(sellToken, ERC20_ABI, this.provider).balanceOf(wallet.address)
    if (balance < sellAmount) throw new Error(`Insufficient ${sellMeta.symbol} balance`)
    let researchRisk: number | null = null, liquidityUsd: number | null = null
    const researchedToken = buyToken === NATIVE ? sellToken : buyToken
    if (researchedToken !== NATIVE) {
      const report = await this.research.research(researchedToken)
      researchRisk = report.scores.overallRisk; liquidityUsd = report.market.liquidityUsd
      if (researchRisk > this.status().maxRiskScore) throw new Error(`Risk score ${researchRisk} exceeds the ${this.status().maxRiskScore} live-trade limit`)
      if (liquidityUsd < this.status().minLiquidityUsd) throw new Error(`Verified liquidity $${Math.round(liquidityUsd).toLocaleString()} is below the live-trade minimum`)
      if (report.redFlags.some((flag) => /honeypot|unable to sell|blacklist/i.test(flag))) throw new Error('Token failed the honeypot/sellability/blacklist gate')
    }
    const url = new URL('https://api.0x.org/swap/allowance-holder/quote')
    Object.entries({ chainId: '8453', sellToken, buyToken, sellAmount: sellAmount.toString(), taker: wallet.address, slippageBps: String(slippageBps) }).forEach(([key, value]) => url.searchParams.set(key, value))
    const response = await fetch(url, { headers: { '0x-api-key': this.apiKey(), '0x-version': 'v2' }, signal: AbortSignal.timeout(15_000) })
    const body = await response.json() as any
    if (!response.ok || !body?.transaction?.to || !body?.transaction?.data) throw new Error(body?.reason || body?.message || `0x quote failed with HTTP ${response.status}`)
    const id = randomUUID(), expiresAt = Date.now() + 120_000
    const pending: PendingSwap = { id, expiresAt, sellToken, buyToken, sellAmount, sellSymbol: sellMeta.symbol, buySymbol: buyMeta.symbol, sellDecimals: sellMeta.decimals, buyDecimals: buyMeta.decimals, quote: body, researchRisk, liquidityUsd }
    this.pending.set(id, pending); this.cleanup()
    return { confirmationId: id, expiresAt: new Date(expiresAt).toISOString(), chain: 'base', walletAddress: wallet.address, sellToken, buyToken, sellSymbol: sellMeta.symbol, buySymbol: buyMeta.symbol, sellAmount: formatUnits(sellAmount, sellMeta.decimals), expectedBuyAmount: formatUnits(BigInt(body.buyAmount || 0), buyMeta.decimals), minimumBuyAmount: formatUnits(BigInt(body.minBuyAmount || body.buyAmount || 0), buyMeta.decimals), estimatedGas: body.transaction.gas || null, gasPrice: body.transaction.gasPrice || null, route: body.route || null, liquidityUsd, researchRisk, warning: 'Quote is not a trade. Review it, then explicitly confirm within two minutes.' }
  }

  async execute(confirmationId: string) {
    if (this.executing) throw new Error('Another Base transaction is currently executing')
    if (!this.status().enabled) throw new Error('Base live swaps are disabled')
    const pending = this.pending.get(confirmationId)
    if (!pending || pending.expiresAt < Date.now()) throw new Error('Confirmation expired; request a new quote')
    this.pending.delete(confirmationId)
    this.executing = true
    try {
    const wallet = this.wallet().connect(this.provider)
    const network = await this.provider.getNetwork()
    if (Number(network.chainId) !== 8453) throw new Error('Execution RPC is not Base mainnet')
    const spender = pending.quote?.issues?.allowance?.spender || pending.quote?.allowanceTarget
    let approvalHash: string | null = null
    if (pending.sellToken !== NATIVE) {
      if (!spender || !isAddress(spender)) throw new Error('Quote did not provide a verified allowance spender')
      if (spender.toLowerCase() !== BASE_ALLOWANCE_HOLDER) throw new Error('Quote returned an untrusted Base allowance target')
      if (String(pending.quote?.transaction?.to || '').toLowerCase() !== BASE_ALLOWANCE_HOLDER) throw new Error('Quote returned an unexpected AllowanceHolder entry point')
      const token = new Contract(pending.sellToken, ERC20_ABI, wallet)
      const allowance: bigint = await token.allowance(wallet.address, spender)
      if (allowance < pending.sellAmount) {
        const approval = await token.approve(spender, pending.sellAmount)
        approvalHash = approval.hash
        await approval.wait(1)
      }
    }
    const tx = pending.quote.transaction
    if (!isAddress(tx.to) || (await this.provider.getCode(tx.to)) === '0x') throw new Error('Quote transaction target is not a deployed Base contract')
    const request = { to: getAddress(tx.to), data: tx.data, value: BigInt(tx.value || 0), gasLimit: tx.gas ? BigInt(tx.gas) : undefined, gasPrice: tx.gasPrice ? BigInt(tx.gasPrice) : undefined }
    await this.provider.call({ ...request, from: wallet.address })
    const sent = await wallet.sendTransaction(request)
    const receipt = await sent.wait(1)
    const result = { status: receipt?.status === 1 ? 'executed' : 'failed', chain: 'base', transactionHash: sent.hash, approvalHash, blockNumber: receipt?.blockNumber || null, sellToken: pending.sellToken, buyToken: pending.buyToken, sellAmount: formatUnits(pending.sellAmount, pending.sellDecimals), expectedBuyAmount: formatUnits(BigInt(pending.quote.buyAmount || 0), pending.buyDecimals) }
    await this.audit({ timestamp: new Date().toISOString(), confirmationId, ...result })
    return result
    } catch (error) {
      await this.audit({ timestamp: new Date().toISOString(), confirmationId, status: 'error', sellToken: pending.sellToken, buyToken: pending.buyToken, message: error instanceof Error ? error.message : 'Unknown execution error' })
      throw error
    } finally {
      this.executing = false
    }
  }

  private wallet() { const key = process.env.BASE_EXECUTION_PRIVATE_KEY?.trim(); if (!key) throw new Error('BASE_EXECUTION_PRIVATE_KEY is not configured'); try { return new Wallet(key) } catch { throw new Error('BASE_EXECUTION_PRIVATE_KEY is invalid') } }
  private apiKey() { const key = process.env.ZEROX_API_KEY?.trim(); if (!key) throw new Error('ZEROX_API_KEY is not configured'); return key }
  private token(value: string) { const token = value.trim().toLowerCase(); if (['eth', 'native'].includes(token)) return NATIVE; if (!isAddress(token)) throw new Error('Token must be ETH or a valid Base contract address'); return token }
  private async metadata(token: string) { if (token === NATIVE) return { symbol: 'ETH', decimals: 18 }; const contract = new Contract(token, ERC20_ABI, this.provider); const [symbol, decimals] = await Promise.all([contract.symbol(), contract.decimals()]); return { symbol: String(symbol), decimals: Number(decimals) } }
  private cleanup() { const now = Date.now(); for (const [id, item] of this.pending) if (item.expiresAt < now) this.pending.delete(id) }
  private async audit(entry: Record<string, unknown>) { const file = path.resolve(process.cwd(), 'data/base-swap-audit.jsonl'); await appendFile(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 }); await chmod(file, 0o600) }
}
