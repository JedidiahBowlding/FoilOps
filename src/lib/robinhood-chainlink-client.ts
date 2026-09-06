type FeedMetadata = {
  name: string
  path: string
  proxyAddress: string | null
  heartbeat: number
  decimals?: number
  docs?: { baseAsset?: string; blockchainName?: string }
}

export type ChainlinkPriceEvidence = {
  feedAddress: string
  priceUsd: number
  updatedAt: string
  heartbeatSeconds: number
  stale: boolean
}

export class RobinhoodChainlinkClient {
  private cache: { expiresAt: number; feeds: FeedMetadata[] } | null = null
  private readonly metadataUrl = 'https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json'
  private readonly rpcUrl = 'https://rpc.mainnet.chain.robinhood.com/'

  async getTokenPrice(symbol: string): Promise<ChainlinkPriceEvidence | null> {
    const feed = (await this.getFeeds()).find((row) => {
      const base = row.docs?.baseAsset?.toUpperCase()
      return Boolean(row.proxyAddress) && (base === symbol.toUpperCase() || row.path.toUpperCase().includes(`${symbol.toUpperCase()}-USD`))
    })
    if (!feed?.proxyAddress) return null

    const [roundHex, decimalsHex] = await Promise.all([
      this.call(feed.proxyAddress, '0xfeaf968c'), // latestRoundData()
      this.call(feed.proxyAddress, '0x313ce567'), // decimals()
    ])
    const words = roundHex.slice(2).match(/.{64}/g) || []
    if (words.length < 4) return null
    const rawAnswer = BigInt(`0x${words[1]}`)
    const signedAnswer = rawAnswer >= BigInt(2) ** BigInt(255) ? rawAnswer - BigInt(2) ** BigInt(256) : rawAnswer
    const decimals = Number(BigInt(decimalsHex || '0x0'))
    const updatedAtSeconds = Number(BigInt(`0x${words[3]}`))
    if (signedAnswer <= BigInt(0) || updatedAtSeconds <= 0) return null
    const priceUsd = Number(signedAnswer) / 10 ** decimals
    const heartbeatSeconds = Number(feed.heartbeat || 0)
    const stale = heartbeatSeconds > 0 && Date.now() / 1000 - updatedAtSeconds > heartbeatSeconds
    return {
      feedAddress: feed.proxyAddress,
      priceUsd,
      updatedAt: new Date(updatedAtSeconds * 1000).toISOString(),
      heartbeatSeconds,
      stale,
    }
  }

  private async getFeeds(): Promise<FeedMetadata[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.feeds
    const response = await fetch(this.metadataUrl, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`Chainlink feed metadata HTTP ${response.status}`)
    const feeds = (await response.json()) as FeedMetadata[]
    this.cache = { expiresAt: Date.now() + 60 * 60_000, feeds: Array.isArray(feeds) ? feeds : [] }
    return this.cache.feeds
  }

  private async call(to: string, data: string): Promise<string> {
    const response = await fetch(process.env.ROBINHOOD_CHAIN_RPC_URL || this.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) throw new Error(`Robinhood Chainlink RPC HTTP ${response.status}`)
    const payload = (await response.json()) as { result?: string; error?: { message?: string } }
    if (!payload.result || payload.error) throw new Error(payload.error?.message || 'Chainlink eth_call failed')
    return payload.result
  }
}
