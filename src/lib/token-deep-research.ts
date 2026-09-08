import { ParsedAccountData, PublicKey } from '@solana/web3.js'
import { RpcConnectionManager } from '../providers/solana'

type FindingStatus = 'VERIFIED' | 'CLAIMED' | 'CONFLICTING' | 'NOT_FOUND'
export type ResearchFinding = { status: FindingStatus; summary: string; sources: string[] }
export type DeepTokenResearch = {
  mint: string
  observedAt: string
  identity: { name?: string; symbol?: string; description?: string; website?: string; twitter?: string }
  controls: { program: string; supply: number | null; decimals: number | null; mintAuthority: string | null | undefined; freezeAuthority: string | null | undefined; extensions: string[] }
  market: { priceUsd: number | null; marketCapUsd: number | null; liquidityUsd: number; volume24hUsd: number; pools: Array<{ venue: string; address: string; liquidityUsd: number; volume24hUsd: number; pairUrl?: string }> }
  holders: { top10Percent: number | null; largestAccounts: Array<{ account: string; owner?: string; percent: number }> }
  provenance: { creators: string[]; launchpad?: string; createdAt?: string; conflict: boolean }
  findings: { liquidity: ResearchFinding; lpLock: ResearchFinding; dao: ResearchFinding; nfts: ResearchFinding; protocol: ResearchFinding }
  scores: { technicalRisk: number; marketRisk: number; operationalRisk: number; overallRisk: number; confidence: number; verdict: 'RESEARCH' | 'WATCHLIST' | 'HIGH_RISK' | 'REJECT' }
  redFlags: string[]
  greenFlags: string[]
  nextChecks: string[]
  sources: string[]
  errors: string[]
}

const DEX = 'https://api.dexscreener.com/latest/dex/tokens/'
const RUG = 'https://api.rugcheck.xyz/v1/tokens/'
const PUMP = 'https://frontend-api-v3.pump.fun/coins/'

async function json(url: string): Promise<any> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${new URL(url).hostname}: HTTP ${response.status}`)
  return response.json()
}

export class TokenDeepResearchService {
  async research(mintInput: string): Promise<DeepTokenResearch> {
    const mint = new PublicKey(mintInput.trim()).toBase58()
    const connection = RpcConnectionManager.getRandomConnection()
    const errors: string[] = []
    const settled = await Promise.allSettled([
      connection.getParsedAccountInfo(new PublicKey(mint), 'confirmed'),
      connection.getTokenLargestAccounts(new PublicKey(mint), 'confirmed'),
      json(`${DEX}${mint}`),
      json(`${RUG}${mint}/report`),
      json(`${PUMP}${mint}`),
    ])
    const take = (index: number, label: string) => {
      const item = settled[index]
      if (item.status === 'fulfilled') return item.value as any
      errors.push(`${label}: ${item.reason instanceof Error ? item.reason.message : 'unavailable'}`)
      return null
    }
    const mintInfo = take(0, 'mint account')
    const largest = take(1, 'holder accounts')
    const dex = take(2, 'DexScreener')
    const rug = take(3, 'RugCheck')
    const pump = take(4, 'Pump.fun')
    const parsed = mintInfo?.value?.data as ParsedAccountData | undefined
    if (!parsed?.parsed?.info) throw new Error('Address is not a parsed Solana token mint')
    const info = parsed.parsed.info
    const supply = Number(info.supply) / 10 ** Number(info.decimals || 0)
    const pairs = Array.isArray(dex?.pairs) ? dex.pairs.filter((pair: any) => pair.baseToken?.address === mint) : []
    const pools = pairs.map((pair: any) => ({
      venue: String(pair.dexId || 'unknown'), address: String(pair.pairAddress || ''),
      liquidityUsd: Number(pair.liquidity?.usd || 0), volume24hUsd: Number(pair.volume?.h24 || 0), pairUrl: pair.url,
    })).sort((a: any, b: any) => b.liquidityUsd - a.liquidityUsd)
    const liquidityUsd = pools.reduce((total: number, pool: any) => total + (pool.liquidityUsd >= 1_000 ? pool.liquidityUsd : 0), 0)
    const primary = pairs.sort((a: any, b: any) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0))[0]
    const largestAccounts = Array.isArray(largest?.value) ? largest.value.slice(0, 20) : []
    let owners: Array<string | undefined> = largestAccounts.map(() => undefined)
    try {
      const accounts = await connection.getMultipleParsedAccounts(largestAccounts.map((entry: any) => entry.address), { commitment: 'confirmed' })
      owners = accounts.value.map((account: any) => (account?.data as ParsedAccountData)?.parsed?.info?.owner)
    } catch (error) {
      errors.push(`holder ownership: ${error instanceof Error ? error.message : 'unavailable'}`)
    }
    const holderRows = largestAccounts.map((entry: any, i: number) => ({ account: entry.address.toBase58(), owner: owners[i], percent: supply > 0 ? (Number(entry.uiAmount || 0) / supply) * 100 : 0 }))
    const top10Percent = holderRows.slice(0, 10).reduce((n: number, h: any) => n + h.percent, 0)
    const metadata = info.extensions?.find((e: any) => e.extension === 'tokenMetadata')?.state || {}
    const websites = pairs.flatMap((pair: any) => pair.info?.websites || []).map((x: any) => x.url).filter(Boolean)
    const socials = pairs.flatMap((pair: any) => pair.info?.socials || [])
    const website = pump?.website || websites[0]
    const text = [metadata.name, metadata.symbol, metadata.description, pump?.description, website, ...websites].filter(Boolean).join(' ').toLowerCase()
    const lpPct = Number(rug?.markets?.[0]?.lp?.lpLockedPct)
    const creators = Array.from(new Set([pump?.creator, rug?.creator].filter(Boolean))) as string[]
    const extensions = Array.isArray(info.extensions) ? info.extensions.map((e: any) => e.extension) : []
    const greenFlags: string[] = [], redFlags: string[] = []
    if (info.mintAuthority === null) greenFlags.push('Mint authority is revoked')
    else redFlags.push('Mint authority remains active or could not be verified')
    if (info.freezeAuthority === null) greenFlags.push('Freeze authority is revoked')
    else redFlags.push('Freeze authority remains active or could not be verified')
    if (liquidityUsd >= 100_000) greenFlags.push(`Material visible liquidity: $${Math.round(liquidityUsd).toLocaleString()}`)
    if (liquidityUsd < 10_000) redFlags.push('Visible liquidity is below the $10,000 discovery floor')
    if (Number(primary?.volume?.h24 || 0) > Number(primary?.liquidity?.usd || 0) * 20) redFlags.push('Primary-pool turnover exceeds liquidity by more than 20×')
    if (creators.length > 1) redFlags.push('Creator attribution conflicts across sources')
    if (top10Percent > 50) redFlags.push(`Top-ten accounts control ${top10Percent.toFixed(1)}% of supply`)
    const technicalRisk = Math.min(100, (info.mintAuthority === null ? 0 : 30) + (info.freezeAuthority === null ? 0 : 25) + (extensions.some((x: string) => /transferFee|transferHook|permanentDelegate/i.test(x)) ? 30 : 0))
    const createdMs = Number(pump?.created_timestamp || primary?.pairCreatedAt || 0)
    const launchAgeDays = createdMs > 0 ? (Date.now() - createdMs) / 86_400_000 : null
    const maxMove24h = Math.max(...pairs.map((pair: any) => Math.abs(Number(pair.priceChange?.h24 || 0))), 0)
    const marketRisk = Math.min(100, (liquidityUsd < 10_000 ? 55 : liquidityUsd < 100_000 ? 30 : 15) + (top10Percent > 50 ? 35 : top10Percent > 25 ? 20 : 10) + (Number(primary?.volume?.h24 || 0) > Number(primary?.liquidity?.usd || 0) * 20 ? 20 : 0) + (launchAgeDays !== null && launchAgeDays < 7 ? 25 : launchAgeDays !== null && launchAgeDays < 30 ? 12 : 0) + (maxMove24h >= 50 ? 15 : maxMove24h >= 20 ? 8 : 0))
    const operationalRisk = Math.min(100, (creators.length > 1 ? 25 : 10) + (/protocol|dao|stock|reward|vault/.test(text) ? 30 : 10) + (/dao/.test(text) ? 20 : 0))
    const overallRisk = Math.round(technicalRisk * .3 + marketRisk * .4 + operationalRisk * .3)
    const confidence = Math.max(25, 95 - errors.length * 12 - (creators.length > 1 ? 10 : 0))
    const finding = (status: FindingStatus, summary: string, sources: string[]): ResearchFinding => ({ status, summary, sources })
    const sourceUrls = [`https://explorer.solana.com/address/${mint}`, `${DEX}${mint}`, `${RUG}${mint}/report`, `${PUMP}${mint}`, ...websites].filter(Boolean)
    return {
      mint, observedAt: new Date().toISOString(),
      identity: { name: metadata.name || pump?.name || primary?.baseToken?.name, symbol: metadata.symbol || pump?.symbol || primary?.baseToken?.symbol, description: metadata.description || pump?.description, website, twitter: pump?.twitter || socials.find((x: any) => x.type === 'twitter')?.url },
      controls: { program: mintInfo.value.owner.toBase58(), supply: Number.isFinite(supply) ? supply : null, decimals: Number(info.decimals), mintAuthority: info.mintAuthority, freezeAuthority: info.freezeAuthority, extensions },
      market: { priceUsd: Number(primary?.priceUsd) || null, marketCapUsd: Number(primary?.marketCap || primary?.fdv) || null, liquidityUsd, volume24hUsd: pools.reduce((n: number, p: any) => n + p.volume24hUsd, 0), pools: pools.slice(0, 12) },
      holders: { top10Percent, largestAccounts: holderRows },
      provenance: { creators, launchpad: pump ? 'Pump.fun' : primary?.dexId, createdAt: pump?.created_timestamp ? new Date(Number(pump.created_timestamp)).toISOString() : primary?.pairCreatedAt ? new Date(Number(primary.pairCreatedAt)).toISOString() : undefined, conflict: creators.length > 1 },
      findings: {
        liquidity: finding(liquidityUsd >= 10_000 ? 'VERIFIED' : 'NOT_FOUND', `${pools.length} pools found; material displayed liquidity totals $${Math.round(liquidityUsd).toLocaleString()}.`, [`${DEX}${mint}`]),
        lpLock: finding(Number.isFinite(lpPct) ? 'VERIFIED' : 'NOT_FOUND', Number.isFinite(lpPct) ? `Largest reported market LP lock: ${lpPct.toFixed(2)}%.` : 'No independently parsed LP-lock percentage was returned.', [`${RUG}${mint}/report`]),
        protocol: finding(/protocol|stock|reward|vault|otcdesks/.test(text) ? 'CLAIMED' : 'NOT_FOUND', /protocol|stock|reward|vault|otcdesks/.test(text) ? 'Protocol association appears in project-supplied metadata or links; execution still requires transaction tracing.' : 'No protocol association found in collected metadata.', website ? [website] : []),
        dao: finding(/dao/.test(text) ? 'CLAIMED' : 'NOT_FOUND', /dao/.test(text) ? 'DAO language was found, but governance contracts, proposals, voting and treasury control were not independently verified.' : 'No verifiable DAO governance evidence was found.', website ? [website] : []),
        nfts: finding(/nft|metaplex|desk/.test(text) ? 'CLAIMED' : 'NOT_FOUND', /nft|metaplex|desk/.test(text) ? 'NFT association appears in collected project evidence; collection and vault ownership must be verified separately.' : 'No NFT collection evidence was found in collected token metadata.', website ? [website] : []),
      },
      scores: { technicalRisk, marketRisk, operationalRisk, overallRisk, confidence, verdict: overallRisk >= 75 ? 'REJECT' : overallRisk >= 35 ? 'HIGH_RISK' : overallRisk >= 20 ? 'WATCHLIST' : 'RESEARCH' },
      redFlags, greenFlags,
      nextChecks: ['Trace one complete protocol fee-to-reward distribution cycle', 'Verify protocol program upgrade and configuration authorities', 'Cluster largest holder wallets by common funding and transfer history', 'Verify any NFT collection address, vault derivation, assets, royalties and transfer behavior', 'Require signed wallet proof for public team identities'],
      sources: Array.from(new Set(sourceUrls)), errors,
    }
  }
}
