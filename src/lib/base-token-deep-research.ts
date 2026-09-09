import type { DeepTokenResearch, ResearchFinding } from './token-deep-research'

const DEFAULT_BASE_RPC = 'https://mainnet.base.org'
export const EVM_RESEARCH_CHAINS = {
  base: { chainId: 8453, rpcEnv: 'BASE_RPC_URL', rpc: DEFAULT_BASE_RPC, dex: 'base', explorer: 'https://basescan.org' },
  ethereum: { chainId: 1, rpcEnv: 'ETHEREUM_RPC_URL', rpc: 'https://eth.llamarpc.com', dex: 'ethereum', explorer: 'https://etherscan.io' },
  arbitrum: { chainId: 42161, rpcEnv: 'ARBITRUM_RPC_URL', rpc: 'https://arb1.arbitrum.io/rpc', dex: 'arbitrum', explorer: 'https://arbiscan.io' },
  optimism: { chainId: 10, rpcEnv: 'OPTIMISM_RPC_URL', rpc: 'https://mainnet.optimism.io', dex: 'optimism', explorer: 'https://optimistic.etherscan.io' },
  polygon: { chainId: 137, rpcEnv: 'POLYGON_RPC_URL', rpc: 'https://polygon-rpc.com', dex: 'polygon', explorer: 'https://polygonscan.com' },
  bsc: { chainId: 56, rpcEnv: 'BSC_RPC_URL', rpc: 'https://bsc-dataseed.binance.org', dex: 'bsc', explorer: 'https://bscscan.com' },
  avalanche: { chainId: 43114, rpcEnv: 'AVALANCHE_RPC_URL', rpc: 'https://api.avax.network/ext/bc/C/rpc', dex: 'avalanche', explorer: 'https://snowtrace.io' },
} as const
export type EvmResearchChain = keyof typeof EVM_RESEARCH_CHAINS
const ZERO = '0x0000000000000000000000000000000000000000'
const EIP1967_IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'

const isAddress = (value: string) => /^0x[a-fA-F0-9]{40}$/.test(value)
const number = (value: unknown) => Number(value || 0)
const addressWord = (hex: string | null) => hex && hex.length >= 66 ? `0x${hex.slice(-40)}`.toLowerCase() : null
const uintWord = (hex: string | null) => hex && hex !== '0x' ? BigInt(hex) : null
const decodeString = (hex: string | null): string | undefined => {
  if (!hex || hex === '0x') return undefined
  try {
    const clean = hex.slice(2)
    if (clean.length === 64) return Buffer.from(clean, 'hex').toString('utf8').replace(/\0+$/, '') || undefined
    const offset = Number.parseInt(clean.slice(0, 64), 16) * 2
    const length = Number.parseInt(clean.slice(offset, offset + 64), 16) * 2
    return Buffer.from(clean.slice(offset + 64, offset + 64 + length), 'hex').toString('utf8') || undefined
  } catch { return undefined }
}

export class BaseTokenDeepResearchService {
  private readonly config
  private readonly rpcUrls: string[]
  constructor(chain: EvmResearchChain = 'base') {
    this.config = EVM_RESEARCH_CHAINS[chain]
    const executionRpc = chain === 'base' ? process.env.BASE_SWAP_RPC_URL?.trim() : undefined
    this.rpcUrls = Array.from(new Set([executionRpc, process.env[this.config.rpcEnv]?.trim(), this.config.rpc].filter(Boolean))) as string[]
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const failures: string[] = []
    for (const rpcUrl of this.rpcUrls) {
      try {
        const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(12_000) })
        const body = await response.json() as { result?: T; error?: { message?: string } }
        if (!response.ok || body.result === undefined || body.error) throw new Error(body.error?.message || `HTTP ${response.status}`)
        return body.result
      } catch (error) {
        failures.push(`${new URL(rpcUrl).hostname}: ${error instanceof Error ? error.message : 'failed'}`)
      }
    }
    throw new Error(`EVM RPC ${method} failed (${failures.join('; ')})`)
  }

  private async call(to: string, data: string): Promise<string | null> {
    for (const delay of [0, 250, 750]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      try {
        const result = await this.rpc<string>('eth_call', [{ to, data }, 'latest'])
        if (result && result !== '0x') return result
      } catch { /* bounded read-only retry across configured RPCs */ }
    }
    return null
  }

  private async json(url: string): Promise<any> {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`${new URL(url).hostname}: HTTP ${response.status}`)
    return response.json()
  }

  async research(input: string): Promise<DeepTokenResearch> {
    const mint = input.trim().toLowerCase()
    if (!isAddress(mint)) throw new Error('A valid Base contract address is required')
    const errors: string[] = []
    const safe = async <T>(label: string, task: Promise<T>, fallback: T): Promise<T> => {
      try { return await task } catch (error) { errors.push(`${label}: ${error instanceof Error ? error.message : 'unavailable'}`); return fallback }
    }
    const [chainId, code, nameHex, symbolHex, decimalsHex, supplyHex, ownerHex, pausedHex, implementationWord, dex, security, creation] = await Promise.all([
      safe('chain id', this.rpc<string>('eth_chainId', []), '0x0'),
      safe('contract code', this.rpc<string>('eth_getCode', [mint, 'latest']), '0x'),
      this.call(mint, '0x06fdde03'), this.call(mint, '0x95d89b41'), this.call(mint, '0x313ce567'), this.call(mint, '0x18160ddd'),
      this.call(mint, '0x8da5cb5b'), this.call(mint, '0x5c975abb'),
      safe('proxy slot', this.rpc<string>('eth_getStorageAt', [mint, EIP1967_IMPLEMENTATION_SLOT, 'latest']), '0x'),
      safe('DexScreener', this.json(`https://api.dexscreener.com/latest/dex/tokens/${mint}`), {}),
      safe('GoPlus security', this.json(`https://api.gopluslabs.io/api/v1/token_security/${this.config.chainId}?contract_addresses=${mint}`), {}),
      this.fetchCreation(mint, errors),
    ])
    if (Number.parseInt(chainId, 16) !== this.config.chainId) throw new Error(`configured RPC returned chain ID ${Number.parseInt(chainId, 16)}, expected ${this.config.chainId}`)
    if (!code || code === '0x') throw new Error('No contract code exists at this address')
    const decimals = Number(uintWord(decimalsHex) || BigInt(0))
    const rawSupply = uintWord(supplyHex)
    const supply = rawSupply === null ? null : Number(rawSupply) / 10 ** decimals
    if (!decodeString(symbolHex) || rawSupply === null) throw new Error('Contract does not expose the expected ERC-20 symbol and totalSupply interface')
    const implementation = addressWord(implementationWord)
    const owner = addressWord(ownerHex)
    const paused = pausedHex && pausedHex !== '0x' ? uintWord(pausedHex) === BigInt(1) : null
    const pairs = Array.isArray(dex?.pairs) ? dex.pairs.filter((pair: any) => pair.chainId === this.config.dex && [pair.baseToken?.address, pair.quoteToken?.address].some((address: unknown) => String(address || '').toLowerCase() === mint)) : []
    const pools = pairs.map((pair: any) => ({ venue: String(pair.dexId || 'unknown'), address: String(pair.pairAddress || ''), liquidityUsd: number(pair.liquidity?.usd), volume24hUsd: number(pair.volume?.h24), pairUrl: pair.url })).sort((a: any, b: any) => b.liquidityUsd - a.liquidityUsd)
    const materialPools = pools.filter((pool: any) => pool.liquidityUsd >= 1_000)
    const liquidityUsd = materialPools.reduce((n: number, pool: any) => n + pool.liquidityUsd, 0)
    const volume24hUsd = pools.reduce((n: number, pool: any) => n + pool.volume24hUsd, 0)
    const primary = pairs.sort((a: any, b: any) => number(b.liquidity?.usd) - number(a.liquidity?.usd))[0]
    const sec = security?.result?.[mint] || security?.result?.[Object.keys(security?.result || {})[0]] || {}
    const top10Percent = sec.holder_count && Array.isArray(sec.holders) ? sec.holders.slice(0, 10).reduce((n: number, h: any) => n + number(h.percent) * 100, 0) : null
    const holders = Array.isArray(sec.holders) ? sec.holders.slice(0, 20).map((h: any) => ({ account: String(h.address || ''), owner: undefined, percent: number(h.percent) * 100 })) : []
    const websites = pairs.flatMap((pair: any) => pair.info?.websites || []).map((x: any) => x.url).filter(Boolean)
    const socials = pairs.flatMap((pair: any) => pair.info?.socials || [])
    const projectText = [decodeString(nameHex), decodeString(symbolHex), ...websites, ...socials.map((x: any) => x.url)].filter(Boolean).join(' ').toLowerCase()
    const creators = [creation.creator].filter(Boolean) as string[]
    const redFlags: string[] = [], greenFlags: string[] = []
    if (owner && owner !== ZERO) redFlags.push(`Owner/admin remains active: ${owner}`); else greenFlags.push('Ownable owner is renounced or not exposed')
    if (implementation && implementation !== ZERO) redFlags.push(`EIP-1967 upgradeable proxy detected: ${implementation}`)
    if (paused === true) redFlags.push('Contract currently reports paused=true')
    if (sec.is_honeypot === '1') redFlags.push('GoPlus flags the token as a honeypot')
    if (sec.cannot_sell_all === '1') redFlags.push('GoPlus reports holders may be unable to sell all tokens')
    if (sec.is_blacklisted === '1') redFlags.push('Contract exposes blacklist behavior')
    if (sec.is_mintable === '1') redFlags.push('Supply is reported mintable')
    if (number(sec.buy_tax) > .05 || number(sec.sell_tax) > .05) redFlags.push(`High token tax: buy ${(number(sec.buy_tax) * 100).toFixed(1)}%, sell ${(number(sec.sell_tax) * 100).toFixed(1)}%`)
    if (liquidityUsd >= 100_000) greenFlags.push(`Material Base liquidity: $${Math.round(liquidityUsd).toLocaleString()}`)
    if (liquidityUsd < 10_000) redFlags.push('Visible liquidity is below the $10,000 threshold')
    if (top10Percent !== null && top10Percent > 50) redFlags.push(`Top-ten reported holders control ${top10Percent.toFixed(1)}%`)
    const lockPercent = this.lockPercent(sec)
    if (lockPercent !== null && lockPercent >= 90) greenFlags.push(`${lockPercent.toFixed(1)}% of reported LP is locked/burned`)
    const technicalRisk = Math.min(100, (owner && owner !== ZERO ? 18 : 0) + (implementation && implementation !== ZERO ? 25 : 0) + (sec.is_honeypot === '1' ? 70 : 0) + (sec.is_mintable === '1' ? 25 : 0) + (sec.is_blacklisted === '1' ? 20 : 0) + (paused === true ? 30 : 0))
    const marketRisk = Math.min(100, (liquidityUsd < 10_000 ? 60 : liquidityUsd < 100_000 ? 35 : 15) + (top10Percent === null ? 15 : top10Percent > 50 ? 35 : top10Percent > 25 ? 20 : 8) + (primary && number(primary.volume?.h24) > number(primary.liquidity?.usd) * 20 ? 20 : 0))
    const operationalRisk = Math.min(100, (implementation && implementation !== ZERO ? 25 : 5) + (creation.creator ? 5 : 15) + (/dao|protocol|vault|reward|nft/.test(projectText) ? 25 : 5))
    const overallRisk = Math.round(technicalRisk * .4 + marketRisk * .4 + operationalRisk * .2)
    const finding = (status: ResearchFinding['status'], summary: string, sources: string[]): ResearchFinding => ({ status, summary, sources })
    const web = websites[0]
    return {
      mint, observedAt: new Date().toISOString(),
      identity: { name: decodeString(nameHex) || primary?.baseToken?.name, symbol: decodeString(symbolHex) || primary?.baseToken?.symbol, website: web, twitter: socials.find((x: any) => x.type === 'twitter')?.url },
      controls: { program: implementation && implementation !== ZERO ? `EIP-1967 proxy → ${implementation}` : 'Base EVM contract', supply, decimals, mintAuthority: owner === ZERO ? null : owner, freezeAuthority: paused === false ? null : paused === true ? owner : undefined, extensions: [implementation && implementation !== ZERO ? 'upgradeable-proxy' : 'direct-contract', sec.is_mintable === '1' ? 'mintable' : 'mintability-not-found', sec.is_blacklisted === '1' ? 'blacklist' : 'blacklist-not-found'] },
      market: { priceUsd: number(primary?.priceUsd) || null, marketCapUsd: number(primary?.marketCap || primary?.fdv) || null, liquidityUsd, volume24hUsd, pools: pools.slice(0, 12) },
      holders: { top10Percent, largestAccounts: holders },
      provenance: { creators, launchpad: primary?.dexId, createdAt: creation.timestamp, conflict: false },
      findings: {
        liquidity: finding(liquidityUsd >= 10_000 ? 'VERIFIED' : 'NOT_FOUND', `${materialPools.length} material pools; displayed liquidity totals $${Math.round(liquidityUsd).toLocaleString()}.`, [`https://dexscreener.com/${this.config.dex}/${primary?.pairAddress || mint}`]),
        lpLock: finding(lockPercent !== null ? 'VERIFIED' : 'NOT_FOUND', lockPercent !== null ? `Reported locked/burned LP: ${lockPercent.toFixed(2)}%.` : 'No reliable LP-lock percentage was returned.', [`https://gopluslabs.io/token-security/${this.config.chainId}`]),
        protocol: finding(/protocol|vault|reward/.test(projectText) ? 'CLAIMED' : 'NOT_FOUND', /protocol|vault|reward/.test(projectText) ? 'Protocol language appears in project-linked evidence; contract execution remains to be traced.' : 'No protocol evidence found in collected sources.', web ? [web] : []),
        dao: finding(/dao/.test(projectText) ? 'CLAIMED' : 'NOT_FOUND', /dao/.test(projectText) ? 'DAO language found; Governor, timelock, Safe ownership and proposal history remain unverified.' : 'No DAO governance evidence found.', web ? [web] : []),
        nfts: finding(/nft|erc721|erc1155/.test(projectText) ? 'CLAIMED' : 'NOT_FOUND', /nft|erc721|erc1155/.test(projectText) ? 'NFT association claimed; collection contracts and ownership remain unverified.' : 'No NFT association found in collected evidence.', web ? [web] : []),
      },
      scores: { technicalRisk, marketRisk, operationalRisk, overallRisk, confidence: Math.max(25, 92 - errors.length * 10 - (top10Percent === null ? 10 : 0)), verdict: overallRisk >= 75 ? 'REJECT' : overallRisk >= 45 ? 'HIGH_RISK' : overallRisk >= 25 ? 'WATCHLIST' : 'RESEARCH' },
      redFlags, greenFlags,
      nextChecks: ['Verify source code and proxy implementation on BaseScan', 'Identify proxy admin, owner, Safe signers and timelock delay', 'Trace deployer funding and all previous deployments', 'Verify LP NFT/locker ownership for Aerodrome and Uniswap positions', 'Verify DAO Governor proposals and NFT collection contracts rather than relying on website text'],
      sources: Array.from(new Set([`${this.config.explorer}/token/${mint}`, `https://api.dexscreener.com/latest/dex/tokens/${mint}`, `https://api.gopluslabs.io/api/v1/token_security/${this.config.chainId}?contract_addresses=${mint}`, ...websites])), errors,
    }
  }

  private lockPercent(sec: any): number | null {
    const holders = Array.isArray(sec.lp_holders) ? sec.lp_holders : []
    if (!holders.length) return null
    return Math.min(100, holders.filter((h: any) => h.is_locked === 1 || h.is_locked === '1' || String(h.address).toLowerCase() === ZERO).reduce((n: number, h: any) => n + number(h.percent) * 100, 0))
  }

  private async fetchCreation(address: string, errors: string[]): Promise<{ creator?: string; timestamp?: string }> {
    const key = process.env.BASESCAN_API_KEY?.trim() || process.env.ETHERSCAN_API_KEY?.trim()
    if (!key) return {}
    try {
      const data = await this.json(`https://api.etherscan.io/v2/api?chainid=8453&module=contract&action=getcontractcreation&contractaddresses=${address}&apikey=${encodeURIComponent(key)}`)
      const row = Array.isArray(data?.result) ? data.result[0] : null
      return { creator: row?.contractCreator?.toLowerCase(), timestamp: row?.timestamp ? new Date(Number(row.timestamp) * 1000).toISOString() : undefined }
    } catch (error) { errors.push(`contract creation: ${error instanceof Error ? error.message : 'unavailable'}`); return {} }
  }
}
