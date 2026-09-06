import { ParsedAccountData, PublicKey } from '@solana/web3.js'
import { RpcConnectionManager } from '../providers/solana'
import { TokenInvestigator } from './token-investigator'
import { DetectedLaunch, LaunchEvidence } from './new-launch-types'

export class LaunchEvidenceCollector {
  constructor(private readonly tokenInvestigator = new TokenInvestigator()) {}

  async collect(launch: DetectedLaunch): Promise<LaunchEvidence> {
    const connection = RpcConnectionManager.getRandomConnection()
    const mint = new PublicKey(launch.tokenMint)
    const errors: string[] = []
    let mintAuthority: string | null = null
    let freezeAuthority: string | null = null
    let decimals = 0
    let supplyRaw = '0'
    let top10HolderPercent = 100
    let creatorHoldPercent = 0
    let creatorSolBalance: number | null = null
    let holderAccountsSampled = 0

    let enrichment: Awaited<ReturnType<TokenInvestigator['fetchTokenEnrichment']>> = {}
    try {
      enrichment = await this.tokenInvestigator.fetchTokenEnrichment(launch.tokenMint)
    } catch {
      errors.push('market-enrichment-unavailable')
    }

    try {
      const info = await connection.getParsedAccountInfo(mint)
      const data = info.value?.data as ParsedAccountData | undefined
      const parsed = data?.parsed?.info
      mintAuthority = parsed?.mintAuthority || null
      freezeAuthority = parsed?.freezeAuthority || null
      decimals = Number(parsed?.decimals || 0)
      supplyRaw = String(parsed?.supply || '0')
    } catch {
      errors.push('mint-account-unavailable')
    }

    const supply = Number(supplyRaw)
    try {
      const largest = await connection.getTokenLargestAccounts(mint)
      holderAccountsSampled = largest.value.length
      // Pump.fun custody inventory is not an end-holder and would otherwise make
      // every fresh launch look almost 100% concentrated.
      const endHolderAccounts = largest.value.filter(
        (row) => row.address.toBase58() !== enrichment.bondingCurveTokenAccount,
      )
      const topRaw = endHolderAccounts.slice(0, 10).reduce((sum, row) => sum + Number(row.amount || 0), 0)
      top10HolderPercent = supply > 0 ? Math.min(100, (topRaw / supply) * 100) : 100
    } catch {
      errors.push('largest-accounts-unavailable')
    }

    if (launch.creatorWallet) {
      try {
        const creator = new PublicKey(launch.creatorWallet)
        const [balance, accounts] = await Promise.all([
          connection.getBalance(creator),
          connection.getParsedTokenAccountsByOwner(creator, { mint }),
        ])
        creatorSolBalance = balance / 1e9
        const creatorRaw = accounts.value.reduce((sum, row) => {
          const data = row.account.data as ParsedAccountData
          return sum + Number(data.parsed?.info?.tokenAmount?.amount || 0)
        }, 0)
        creatorHoldPercent = supply > 0 ? Math.min(100, (creatorRaw / supply) * 100) : 0
      } catch {
        errors.push('creator-holdings-unavailable')
      }
    }

    return {
      chain: 'solana',
      tokenMint: launch.tokenMint,
      creatorWallet: launch.creatorWallet,
      mintAuthority,
      freezeAuthority,
      decimals,
      supplyRaw,
      top10HolderPercent: Number(top10HolderPercent.toFixed(4)),
      creatorHoldPercent: Number(creatorHoldPercent.toFixed(4)),
      creatorSolBalance,
      holderAccountsSampled,
      liquidityUsd: typeof enrichment.liquidityUsd === 'number' ? enrichment.liquidityUsd : null,
      marketCapUsd: typeof enrichment.currentMarketCapUsd === 'number' ? enrichment.currentMarketCapUsd : null,
      name: enrichment.name || null,
      symbol: enrichment.symbol || null,
      website: enrichment.website || null,
      twitter: enrichment.twitter || null,
      telegram: enrichment.telegram || null,
      evidenceSources: ['solana-rpc', ...(Object.keys(enrichment).length > 0 ? ['market-enrichment'] : [])],
      collectionErrors: errors,
      collectedAt: new Date().toISOString(),
      assetCategory: 'SPECULATIVE_TOKEN',
      officialStockToken: null,
      holderHistoryComplete: true,
      liquidityPools: [],
    }
  }
}
