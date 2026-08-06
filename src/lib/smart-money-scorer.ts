import { WalletDetails } from './wallet-details'

type ParsedSwapLike = {
  type: string | undefined
  platform: string | null
  tokenTransfers: {
    tokenInMint: string
    tokenOutMint: string
  }
}

export type SmartMoneyDirection = 'buy' | 'sell' | 'watch'

export type SmartMoneyScoreResult = {
  score: number
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  direction: SmartMoneyDirection
  shouldTrade: boolean
  rationale: string[]
  walletProfile: {
    winrate?: number
    pnl_7d?: number
    token_num?: number
    last_active_timestamp?: number
    total_value?: number
    tags?: string[]
  } | null
}

type ScoreCacheEntry = {
  expiresAt: number
  value: NonNullable<SmartMoneyScoreResult['walletProfile']>
}

export class SmartMoneyScorer {
  private walletDetails: WalletDetails
  private profileCache: Map<string, ScoreCacheEntry> = new Map()
  private readonly cacheTtlMs = Math.max(30_000, Number(process.env.SMART_MONEY_PROFILE_CACHE_TTL_MS || 300_000))
  private readonly buyThreshold = Math.max(1, Math.min(100, Number(process.env.SMART_MONEY_BUY_THRESHOLD || 70)))
  private readonly sellThreshold = Math.max(1, Math.min(100, Number(process.env.SMART_MONEY_SELL_THRESHOLD || 62)))

  constructor() {
    this.walletDetails = new WalletDetails()
  }

  async scoreParsedSwap(input: {
    walletAddress: string
    parsed: ParsedSwapLike
    transactionSignature: string
    walletTxCount?: number
  }): Promise<SmartMoneyScoreResult> {
    const direction = this.resolveDirection(input.parsed)
    const walletProfile = await this.getWalletProfile(input.walletAddress)
    const rationale: string[] = []
    let score = 25

    if (direction === 'buy') {
      score += 12
      rationale.push('direction: buy')
    } else if (direction === 'sell') {
      score += 8
      rationale.push('direction: sell')
    }

    if (input.parsed.platform === 'mint_pumpfun') {
      score += 18
      rationale.push('platform: launch deployment')
    } else if (input.parsed.platform === 'pumpfun') {
      score += 14
      rationale.push('platform: pumpfun')
    } else if (input.parsed.platform === 'jupiter') {
      score += 10
      rationale.push('platform: jupiter route')
    } else if (input.parsed.platform === 'raydium') {
      score += 8
      rationale.push('platform: raydium')
    }

    if (walletProfile) {
      const winrate = Number(walletProfile.winrate || 0)
      const pnl7d = Number(walletProfile.pnl_7d || 0)
      const totalValueUsd = Number(walletProfile.total_value || 0)
      const tokenCount = Number(walletProfile.token_num || 0)

      if (winrate >= 0.65) {
        score += 18
        rationale.push(`wallet winrate: ${(winrate * 100).toFixed(1)}%`)
      } else if (winrate >= 0.55) {
        score += 10
        rationale.push(`wallet winrate: ${(winrate * 100).toFixed(1)}%`)
      } else if (winrate > 0) {
        score -= 8
        rationale.push(`wallet winrate weak: ${(winrate * 100).toFixed(1)}%`)
      }

      if (pnl7d > 0) {
        score += Math.min(15, Math.round(Math.log10(pnl7d + 10) * 4))
        rationale.push(`7d pnl positive: ${pnl7d.toFixed(2)}`)
      } else if (pnl7d < 0) {
        score -= Math.min(15, Math.round(Math.log10(Math.abs(pnl7d) + 10) * 4))
        rationale.push(`7d pnl negative: ${pnl7d.toFixed(2)}`)
      }

      if (totalValueUsd >= 250_000) {
        score += 8
        rationale.push(`wallet size: $${Math.round(totalValueUsd).toLocaleString()}`)
      }

      if (tokenCount >= 5 && tokenCount <= 250) {
        score += 5
        rationale.push(`token count: ${tokenCount}`)
      }

      if (walletProfile.tags?.some((tag: string) => /smart|whale|trader|alpha/i.test(tag))) {
        score += 6
        rationale.push(`profile tags: ${walletProfile.tags.join(', ')}`)
      }

      if (walletProfile.last_active_timestamp) {
        const ageHours = Math.max(0, (Date.now() / 1000 - walletProfile.last_active_timestamp) / 3600)
        if (ageHours <= 72) {
          score += 5
          rationale.push(`recently active: ${ageHours.toFixed(1)}h ago`)
        }
      }
    } else {
      score -= 4
      rationale.push('wallet profile unavailable')
    }

    if (typeof input.walletTxCount === 'number') {
      if (input.walletTxCount >= 20) {
        score += 4
        rationale.push(`tracked tx count: ${input.walletTxCount}`)
      } else if (input.walletTxCount <= 2) {
        score -= 4
        rationale.push(`tracked tx count low: ${input.walletTxCount}`)
      }
    }

    score = Math.max(0, Math.min(100, Math.round(score)))

    const shouldTrade =
      direction !== 'watch' &&
      ((direction === 'buy' && score >= this.buyThreshold) || (direction === 'sell' && score >= this.sellThreshold))
    const confidence = score >= 85 ? 'HIGH' : score >= 65 ? 'MEDIUM' : 'LOW'

    return {
      score,
      confidence,
      direction,
      shouldTrade,
      rationale,
      walletProfile,
    }
  }

  private resolveDirection(parsed: ParsedSwapLike): SmartMoneyDirection {
    if (parsed.type === 'buy') {
      return 'buy'
    }

    if (parsed.type === 'sell') {
      return 'sell'
    }

    if (parsed.platform === 'mint_pumpfun') {
      return 'buy'
    }

    return 'watch'
  }

  private async getWalletProfile(walletAddress: string) {
    const cached = this.profileCache.get(walletAddress)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value
    }

    const profile = await this.walletDetails.getWalletPNL(walletAddress)
    if (!profile) {
      return null
    }

    const normalized = {
      winrate: profile.winrate,
      pnl_7d: profile.pnl_7d,
      token_num: profile.token_num,
      last_active_timestamp: profile.last_active_timestamp,
      total_value: profile.total_value,
      tags: profile.tags,
    }

    this.profileCache.set(walletAddress, {
      expiresAt: Date.now() + this.cacheTtlMs,
      value: normalized,
    })

    return normalized
  }
}

export const smartMoneyScorer = new SmartMoneyScorer()
