type Deployment = { contractAddress: string; chainId: number }
type Asset = {
  id: string
  tokenSymbol: string
  tokenName: string
  deployments: Deployment[]
  currentMultiplier: string
  status: string
}
import { RobinhoodChainlinkClient } from './robinhood-chainlink-client'

export type RobinhoodStockTokenEvidence = {
  id: string
  symbol: string
  name: string
  status: string
  currentMultiplier: string
  bidUsd: number | null
  askUsd: number | null
  tokenBidUsd: number | null
  tokenAskUsd: number | null
  isTradingHalt: boolean | null
  oracleFeedAddress: string | null
  oraclePriceUsd: number | null
  oracleUpdatedAt: string | null
  oracleHeartbeatSeconds: number | null
  oracleStale: boolean | null
  restOracleDivergencePct: number | null
  oraclePaused: boolean | null
  onchainMultiplier: string | null
  multiplierMatchesRest: boolean | null
}

export class RobinhoodStockTokenClient {
  private assetsCache: { expiresAt: number; assets: Asset[] } | null = null
  constructor(private readonly chainlink = new RobinhoodChainlinkClient()) {}

  async findByContract(contractAddress: string, chainId = 4663): Promise<RobinhoodStockTokenEvidence | null> {
    const assets = await this.getAssets()
    const address = contractAddress.toLowerCase()
    const asset = assets.find((row) =>
      row.deployments?.some((deployment) => deployment.chainId === chainId && deployment.contractAddress.toLowerCase() === address),
    )
    if (!asset) return null

    let bidUsd: number | null = null
    let askUsd: number | null = null
    let isTradingHalt: boolean | null = null
    try {
      const response = await fetch(`https://api.robinhood.com/rhj/prices/${encodeURIComponent(asset.tokenSymbol)}`, {
        signal: AbortSignal.timeout(8_000),
      })
      if (response.ok) {
        const body = (await response.json()) as { quotes?: Array<{ bid?: string; ask?: string; isTradingHalt?: boolean }> }
        const quote = body.quotes?.[0]
        const bid = Number(quote?.bid)
        const ask = Number(quote?.ask)
        bidUsd = Number.isFinite(bid) ? bid : null
        askUsd = Number.isFinite(ask) ? ask : null
        isTradingHalt = typeof quote?.isTradingHalt === 'boolean' ? quote.isTradingHalt : null
      }
    } catch {
      // Asset identity remains authoritative even when the short-lived quote is unavailable.
    }

    const multiplier = Number(asset.currentMultiplier)
    const oracle = await this.chainlink.getTokenPrice(asset.tokenSymbol).catch(() => null)
    const [pausedHex, multiplierHex] = await Promise.all([
      this.callToken(contractAddress, '0x7706ba52').catch(() => null), // oraclePaused()
      this.callToken(contractAddress, '0xa60bf13d').catch(() => null), // uiMultiplier()
    ])
    const oraclePaused = pausedHex ? BigInt(pausedHex) !== BigInt(0) : null
    const multiplierRaw = multiplierHex ? BigInt(multiplierHex) : null
    const onchainMultiplier = multiplierRaw === null ? null : (Number(multiplierRaw) / 1e18).toString()
    const restMultiplierRaw = this.decimalTo18(asset.currentMultiplier)
    const tokenMid = bidUsd !== null && askUsd !== null && Number.isFinite(multiplier)
      ? ((bidUsd + askUsd) / 2) * multiplier
      : null
    const divergence = oracle && tokenMid && oracle.priceUsd > 0
      ? Math.abs(tokenMid - oracle.priceUsd) / oracle.priceUsd * 100
      : null
    return {
      id: asset.id,
      symbol: asset.tokenSymbol,
      name: asset.tokenName,
      status: asset.status,
      currentMultiplier: asset.currentMultiplier,
      bidUsd,
      askUsd,
      tokenBidUsd: bidUsd !== null && Number.isFinite(multiplier) ? bidUsd * multiplier : null,
      tokenAskUsd: askUsd !== null && Number.isFinite(multiplier) ? askUsd * multiplier : null,
      isTradingHalt,
      oracleFeedAddress: oracle?.feedAddress || null,
      oraclePriceUsd: oracle?.priceUsd ?? null,
      oracleUpdatedAt: oracle?.updatedAt || null,
      oracleHeartbeatSeconds: oracle?.heartbeatSeconds ?? null,
      oracleStale: oracle?.stale ?? null,
      restOracleDivergencePct: divergence === null ? null : Number(divergence.toFixed(4)),
      oraclePaused,
      onchainMultiplier,
      multiplierMatchesRest: multiplierRaw === null ? null : multiplierRaw === restMultiplierRaw,
    }
  }

  private async callToken(to: string, data: string): Promise<string> {
    const response = await fetch(process.env.ROBINHOOD_CHAIN_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
      signal: AbortSignal.timeout(8_000),
    })
    const payload = (await response.json()) as { result?: string }
    if (!response.ok || !payload.result) throw new Error('Robinhood token contract call failed')
    return payload.result
  }

  private decimalTo18(value: string): bigint {
    const [whole = '0', fraction = ''] = value.split('.')
    return BigInt(whole) * BigInt(10) ** BigInt(18) + BigInt((fraction + '0'.repeat(18)).slice(0, 18))
  }

  private async getAssets(): Promise<Asset[]> {
    if (this.assetsCache && this.assetsCache.expiresAt > Date.now()) return this.assetsCache.assets
    const response = await fetch('https://api.robinhood.com/rhj/assets', { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`Robinhood Stock Token assets HTTP ${response.status}`)
    const body = (await response.json()) as { assets?: Asset[] }
    const assets = Array.isArray(body.assets) ? body.assets : []
    this.assetsCache = { expiresAt: Date.now() + 60 * 60_000, assets }
    return assets
  }
}
