type StrategyDirection = 'buy' | 'sell' | 'watch'

type StrategyObservation = {
  tokenMint: string
  walletAddress: string
  direction: 'buy' | 'sell'
  score: number
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  emittedAt: number
  txSignature: string
  rationale: string[]
}

type TokenPositionState = {
  tokenMint: string
  open: boolean
  openedAt: number
  lastUpdatedAt: number
  lastDirection: 'buy' | 'sell'
  lastScore: number
  confirmations: number
  walletAddresses: Set<string>
  txSignatures: string[]
}

export type SmartMoneyPortfolioDecision = {
  action: 'BUY' | 'SELL' | 'WATCH'
  confirmed: boolean
  confirmationCount: number
  reason: string[]
  tokenState: {
    tokenMint: string
    open: boolean
    confirmations: number
    walletCount: number
    lastScore: number
    lastDirection: 'buy' | 'sell'
  }
}

export type SmartMoneyPortfolioSummary = {
  activePositions: number
  confirmedBuys: number
  confirmedSells: number
  watchedTokens: number
  confirmationsRequired: number
  openTokens: Array<{
    tokenMint: string
    confirmations: number
    walletCount: number
    lastScore: number
    lastDirection: 'buy' | 'sell'
  }>
  recentDecisions: Array<{
    tokenMint: string
    action: 'BUY' | 'SELL' | 'WATCH'
    confirmed: boolean
    score: number
    direction: 'buy' | 'sell'
    at: string
  }>
}

export class SmartMoneyPortfolioStrategy {
  private readonly confirmationWindowMs = Math.max(
    5 * 60_000,
    Number(process.env.SMART_MONEY_CONFIRMATION_WINDOW_MS || 30 * 60_000),
  )
  private readonly confirmationsRequired = Math.max(1, Number(process.env.SMART_MONEY_CONFIRMATIONS_REQUIRED || 2))
  private readonly minBuyScore = Math.max(1, Math.min(100, Number(process.env.SMART_MONEY_MIN_BUY_SCORE || 75)))
  private readonly minSellScore = Math.max(1, Math.min(100, Number(process.env.SMART_MONEY_MIN_SELL_SCORE || 68)))
  private readonly maxOpenPositions = Math.max(1, Number(process.env.SMART_MONEY_MAX_OPEN_POSITIONS || 8))

  private observationsByToken: Map<string, StrategyObservation[]> = new Map()
  private positionsByToken: Map<string, TokenPositionState> = new Map()
  private recentDecisionLog: Array<{
    tokenMint: string
    action: 'BUY' | 'SELL' | 'WATCH'
    confirmed: boolean
    score: number
    direction: 'buy' | 'sell'
    at: string
  }> = []

  evaluate(input: {
    tokenMint: string
    walletAddress: string
    direction: StrategyDirection
    score: number
    confidence: 'LOW' | 'MEDIUM' | 'HIGH'
    txSignature: string
    rationale: string[]
  }): SmartMoneyPortfolioDecision {
    const now = Date.now()
    this.prune(now)

    if (input.direction === 'watch') {
      return this.recordDecision(input.tokenMint, 'WATCH', false, 'watch', input.score, [
        'direction: watch',
        ...input.rationale,
      ])
    }

    const observation: StrategyObservation = {
      tokenMint: input.tokenMint,
      walletAddress: input.walletAddress,
      direction: input.direction,
      score: input.score,
      confidence: input.confidence,
      emittedAt: now,
      txSignature: input.txSignature,
      rationale: input.rationale,
    }

    const tokenObservations = this.observationsByToken.get(input.tokenMint) || []
    tokenObservations.push(observation)
    this.observationsByToken.set(
      input.tokenMint,
      tokenObservations.filter((row) => now - row.emittedAt <= this.confirmationWindowMs),
    )

    const recentSameDirection =
      this.observationsByToken
        .get(input.tokenMint)
        ?.filter(
          (row) => row.direction === observation.direction && now - row.emittedAt <= this.confirmationWindowMs,
        ) || []

    const walletCount = new Set(recentSameDirection.map((row) => row.walletAddress)).size
    const confirmationCount = recentSameDirection.length
    const position = this.positionsByToken.get(input.tokenMint)

    if (input.direction === 'buy') {
      if (input.score < this.minBuyScore) {
        return this.recordDecision(input.tokenMint, 'WATCH', false, 'buy', input.score, [
          `buy_score_below_threshold:${input.score}<${this.minBuyScore}`,
          ...input.rationale,
        ])
      }

      if (position?.open) {
        position.lastUpdatedAt = now
        position.lastDirection = 'buy'
        position.lastScore = input.score
        position.confirmations = confirmationCount
        position.walletAddresses.add(input.walletAddress)
        position.txSignatures.push(input.txSignature)

        return this.recordDecision(input.tokenMint, 'WATCH', false, 'buy', input.score, [
          'token_already_open',
          `active_positions:${this.positionsByToken.size}`,
          ...input.rationale,
        ])
      }

      if (this.positionsByToken.size >= this.maxOpenPositions) {
        return this.recordDecision(input.tokenMint, 'WATCH', false, 'buy', input.score, [
          `max_open_positions_reached:${this.maxOpenPositions}`,
          ...input.rationale,
        ])
      }

      if (confirmationCount < this.confirmationsRequired) {
        return this.recordDecision(input.tokenMint, 'WATCH', false, 'buy', input.score, [
          `buy_confirmation_count:${confirmationCount}/${this.confirmationsRequired}`,
          ...input.rationale,
        ])
      }

      this.positionsByToken.set(input.tokenMint, {
        tokenMint: input.tokenMint,
        open: true,
        openedAt: now,
        lastUpdatedAt: now,
        lastDirection: 'buy',
        lastScore: input.score,
        confirmations: confirmationCount,
        walletAddresses: new Set([input.walletAddress]),
        txSignatures: [input.txSignature],
      })

      return this.recordDecision(input.tokenMint, 'BUY', true, 'buy', input.score, [
        `buy_confirmed:${confirmationCount}/${this.confirmationsRequired}`,
        `wallets:${walletCount}`,
        ...input.rationale,
      ])
    }

    if (!position?.open) {
      return this.recordDecision(input.tokenMint, 'WATCH', false, 'sell', input.score, [
        'sell_without_open_position',
        ...input.rationale,
      ])
    }

    if (input.score < this.minSellScore && confirmationCount < this.confirmationsRequired) {
      position.lastUpdatedAt = now
      position.lastDirection = 'sell'
      position.lastScore = input.score
      position.confirmations = confirmationCount
      position.walletAddresses.add(input.walletAddress)
      position.txSignatures.push(input.txSignature)

      return this.recordDecision(input.tokenMint, 'WATCH', false, 'sell', input.score, [
        `sell_score_or_confirmation_below_threshold:${input.score}<${this.minSellScore} or ${confirmationCount}<${this.confirmationsRequired}`,
        ...input.rationale,
      ])
    }

    this.positionsByToken.delete(input.tokenMint)
    return this.recordDecision(input.tokenMint, 'SELL', true, 'sell', input.score, [
      `sell_confirmed:${confirmationCount}/${this.confirmationsRequired}`,
      ...input.rationale,
    ])
  }

  getSummary(): SmartMoneyPortfolioSummary {
    const openTokens = Array.from(this.positionsByToken.values()).map((position) => ({
      tokenMint: position.tokenMint,
      confirmations: position.confirmations,
      walletCount: position.walletAddresses.size,
      lastScore: position.lastScore,
      lastDirection: position.lastDirection,
    }))

    return {
      activePositions: openTokens.length,
      confirmedBuys: this.recentDecisionLog.filter((row) => row.action === 'BUY' && row.confirmed).length,
      confirmedSells: this.recentDecisionLog.filter((row) => row.action === 'SELL' && row.confirmed).length,
      watchedTokens: this.observationsByToken.size,
      confirmationsRequired: this.confirmationsRequired,
      openTokens,
      recentDecisions: this.recentDecisionLog.slice(-15).reverse(),
    }
  }

  private recordDecision(
    tokenMint: string,
    action: 'BUY' | 'SELL' | 'WATCH',
    confirmed: boolean,
    direction: 'buy' | 'sell' | 'watch',
    score: number,
    reason: string[],
  ): SmartMoneyPortfolioDecision {
    const position = this.positionsByToken.get(tokenMint)
    this.recentDecisionLog.push({
      tokenMint,
      action,
      confirmed,
      score,
      direction: direction === 'watch' ? 'buy' : direction,
      at: new Date().toISOString(),
    })

    if (this.recentDecisionLog.length > 50) {
      this.recentDecisionLog = this.recentDecisionLog.slice(-50)
    }

    return {
      action,
      confirmed,
      confirmationCount: position?.confirmations || 0,
      reason,
      tokenState: {
        tokenMint,
        open: position?.open || false,
        confirmations: position?.confirmations || 0,
        walletCount: position?.walletAddresses.size || 0,
        lastScore: position?.lastScore || score,
        lastDirection: position?.lastDirection || (direction === 'watch' ? 'buy' : direction),
      },
    }
  }

  private prune(now: number): void {
    for (const [tokenMint, observations] of this.observationsByToken.entries()) {
      const filtered = observations.filter((row) => now - row.emittedAt <= this.confirmationWindowMs)
      if (filtered.length === 0) {
        this.observationsByToken.delete(tokenMint)
      } else {
        this.observationsByToken.set(tokenMint, filtered)
      }
    }

    for (const [tokenMint, position] of this.positionsByToken.entries()) {
      if (now - position.lastUpdatedAt > this.confirmationWindowMs * 4) {
        this.positionsByToken.delete(tokenMint)
      }
    }
  }
}

export const smartMoneyPortfolioStrategy = new SmartMoneyPortfolioStrategy()
