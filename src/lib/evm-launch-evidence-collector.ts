import { DetectedLaunch, LaunchEvidence } from './new-launch-types'
import { RobinhoodStockTokenClient } from './robinhood-stock-token-client'
import { RobinhoodChainlinkClient } from './robinhood-chainlink-client'

export class EvmLaunchEvidenceCollector {
  private readonly officialMainnetRpc = 'https://rpc.mainnet.chain.robinhood.com/'
  constructor(
    private readonly stockTokens = new RobinhoodStockTokenClient(),
    private readonly chainlink = new RobinhoodChainlinkClient(),
  ) {}

  async collect(launch: DetectedLaunch): Promise<LaunchEvidence> {
    const errors: string[] = []
    const rpc = async <T>(method: string, params: unknown[]): Promise<T> => {
      const response = await fetch(process.env.ROBINHOOD_CHAIN_RPC_URL || this.officialMainnetRpc, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(10_000),
      })
      const payload = (await response.json()) as { result?: T; error?: { message?: string } }
      if (!response.ok || payload.result === undefined || payload.error) throw new Error(payload.error?.message || `${method} failed`)
      return payload.result
    }
    const call = async (selector: string) => {
      return rpc<string>('eth_call', [{ to: launch.tokenMint, data: selector }, 'latest']).catch(() => '0x')
    }
    const callAt = async (to: string, selector: string) =>
      rpc<string>('eth_call', [{ to, data: selector }, 'latest']).catch(() => '0x')
    const uint = (hex: string) => hex === '0x' ? null : BigInt(hex)
    const text = (hex: string) => {
      if (!hex || hex === '0x') return null
      try {
        const clean = hex.slice(2)
        if (clean.length === 64) {
          return Buffer.from(clean, 'hex').toString('utf8').replace(/\0+$/, '') || null
        }
        const offset = Number.parseInt(clean.slice(0, 64), 16) * 2
        const length = Number.parseInt(clean.slice(offset, offset + 64), 16) * 2
        return Buffer.from(clean.slice(offset + 64, offset + 64 + length), 'hex').toString('utf8')
      } catch { return null }
    }

    const [nameHex, symbolHex, decimalsHex, supplyHex, ownerHex] = await Promise.all([
      call('0x06fdde03'), call('0x95d89b41'), call('0x313ce567'), call('0x18160ddd'), call('0x8da5cb5b'),
    ])
    const totalSupply = uint(supplyHex)
    const decimals = Number(uint(decimalsHex) || BigInt(0))
    if (totalSupply === null) errors.push('erc20-total-supply-unavailable')
    const owner = ownerHex.length >= 66 ? `0x${ownerHex.slice(-40)}`.toLowerCase() : null
    if (!text(symbolHex) || totalSupply === null) errors.push('contract-not-verified-as-erc20')
    let officialStockToken = null
    try {
      officialStockToken = await this.stockTokens.findByContract(
        launch.tokenMint,
        Number(process.env.ROBINHOOD_CHAIN_ID || 4663),
      )
    } catch {
      errors.push('official-stock-token-registry-unavailable')
    }

    const balances = new Map<string, bigint>()
    let holderHistoryComplete = true
    const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
    try {
      const latest = Number.parseInt(await rpc<string>('eth_blockNumber', []), 16)
      const maxBlocks = Math.max(100, Number(process.env.ROBINHOOD_HOLDER_LOG_MAX_BLOCKS || 5000))
      const fromBlock = Math.max(launch.slot, latest - maxBlocks + 1)
      holderHistoryComplete = fromBlock === launch.slot
      if (!holderHistoryComplete) errors.push('holder-history-window-truncated')
      const logs = await rpc<Array<{ topics: string[]; data: string }>>('eth_getLogs', [{
        address: launch.tokenMint,
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: 'latest',
        topics: [transferTopic],
      }])
      const zero = '0x0000000000000000000000000000000000000000'
      for (const log of logs) {
        if (log.topics.length < 3) continue
        const from = `0x${log.topics[1].slice(-40)}`.toLowerCase()
        const to = `0x${log.topics[2].slice(-40)}`.toLowerCase()
        const amount = BigInt(log.data || '0x0')
        if (from !== zero) balances.set(from, (balances.get(from) || BigInt(0)) - amount)
        if (to !== zero) balances.set(to, (balances.get(to) || BigInt(0)) + amount)
      }
    } catch {
      errors.push('holder-transfer-logs-unavailable')
      holderHistoryComplete = false
    }

    const positiveBalances = [...balances.entries()].filter(([, amount]) => amount > BigInt(0)).sort((a, b) => a[1] > b[1] ? -1 : 1)
    const circulating = positiveBalances.reduce((sum, [, amount]) => sum + amount, BigInt(0))
    const percent = (amount: bigint) => circulating > BigInt(0) ? Number(amount * BigInt(1_000_000) / circulating) / 10_000 : 0
    let top10HolderPercent = positiveBalances.slice(0, 10).reduce((sum, [, amount]) => sum + percent(amount), 0)
    const creatorHoldPercent = launch.creatorWallet ? percent(balances.get(launch.creatorWallet.toLowerCase()) || BigInt(0)) : 0
    const liquidityPools: LaunchEvidence['liquidityPools'] = []
    const weth = '0x0bd7d308f8e1639fab988df18a8011f41eacad73'
    const usdg = '0x5fc5360d0400a0fd4f2af552add042d716f1d168'
    const ethPrice = await this.chainlink.getTokenPrice('ETH').catch(() => null)
    const decodeAddress = (hex: string) => hex.length >= 66 ? `0x${hex.slice(-40)}`.toLowerCase() : null
    for (const [address, amount] of positiveBalances.slice(0, 20)) {
      try {
        const code = await rpc<string>('eth_getCode', [address, 'latest'])
        if (code !== '0x' && address !== launch.tokenMint.toLowerCase()) {
          const [token0Hex, token1Hex, reservesHex] = await Promise.all([
            callAt(address, '0x0dfe1681'), callAt(address, '0xd21220a7'), callAt(address, '0x0902f1ac'),
          ])
          const token0 = decodeAddress(token0Hex)
          const token1 = decodeAddress(token1Hex)
          const isPair = token0 === launch.tokenMint.toLowerCase() || token1 === launch.tokenMint.toLowerCase()
          let verifiedLiquidityUsd: number | null = null
          if (isPair && reservesHex.length >= 130) {
            const words = reservesHex.slice(2).match(/.{64}/g) || []
            const reserve0 = BigInt(`0x${words[0] || '0'}`)
            const reserve1 = BigInt(`0x${words[1] || '0'}`)
            const quote = token0 === launch.tokenMint.toLowerCase() ? token1 : token0
            const quoteReserve = token0 === launch.tokenMint.toLowerCase() ? reserve1 : reserve0
            if (quote === usdg) verifiedLiquidityUsd = Number(quoteReserve) / 1e18 * 2
            if (quote === weth && ethPrice && !ethPrice.stale) verifiedLiquidityUsd = Number(quoteReserve) / 1e18 * ethPrice.priceUsd * 2
          }
          liquidityPools.push({
            address,
            verifiedPair: isPair,
            tokenBalanceRaw: amount.toString(),
            tokenBalancePercent: percent(amount),
            verifiedLiquidityUsd: verifiedLiquidityUsd === null ? null : Number(verifiedLiquidityUsd.toFixed(2)),
          })
        }
      } catch { /* retain holder evidence even when code lookup fails */ }
    }
    const verifiedPairAddresses = new Set(liquidityPools.filter((pool) => pool.verifiedPair).map((pool) => pool.address))
    top10HolderPercent = positiveBalances
      .filter(([address]) => !verifiedPairAddresses.has(address))
      .slice(0, 10)
      .reduce((sum, [, amount]) => sum + percent(amount), 0)

    return {
      chain: 'robinhood', tokenMint: launch.tokenMint, creatorWallet: launch.creatorWallet,
      mintAuthority: owner === '0x0000000000000000000000000000000000000000' ? null : owner,
      freezeAuthority: null, decimals, supplyRaw: totalSupply?.toString() || '0',
      top10HolderPercent: Number(top10HolderPercent.toFixed(4)), creatorHoldPercent: Number(creatorHoldPercent.toFixed(4)), creatorSolBalance: null,
      holderAccountsSampled: positiveBalances.length,
      liquidityUsd: liquidityPools.reduce<number | null>((best, pool) => pool.verifiedLiquidityUsd === null ? best : Math.max(best || 0, pool.verifiedLiquidityUsd), null),
      marketCapUsd: null,
      name: text(nameHex), symbol: text(symbolHex), website: null, twitter: null, telegram: null,
      evidenceSources: ['robinhood-chain-rpc'],
      collectionErrors: [
        ...errors,
        ...(liquidityPools.length === 0
          ? ['liquidity-pool-not-detected']
          : liquidityPools.every((pool) => pool.verifiedLiquidityUsd === null) ? ['liquidity-usd-unverified'] : []),
      ],
      collectedAt: new Date().toISOString(),
      assetCategory: officialStockToken ? 'OFFICIAL_STOCK_TOKEN' : 'UNVERIFIED_CONTRACT',
      officialStockToken,
      holderHistoryComplete,
      liquidityPools,
    }
  }
}
