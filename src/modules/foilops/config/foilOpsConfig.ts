// ─── FoilOps Configuration ─────────────────────────────────────────────────────
// Single source of truth for all scoring thresholds, rules, and weights.
// Values can be overridden via environment variables for easy tuning in production.

function envNumber(key: string, fallback: number): number {
  const v = process.env[key]
  if (v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// ─── Wallet Scoring Rules ──────────────────────────────────────────────────────

export const walletRules = {
  // Early-entry scoring
  earlyEntry: {
    // Entry within this many seconds → max score
    veryEarlyThresholdSeconds: envNumber('FOILOPS_EARLY_ENTRY_VERY_EARLY_S', 60),
    // Entry within this many seconds → good score
    earlyThresholdSeconds: envNumber('FOILOPS_EARLY_ENTRY_EARLY_S', 300),
    // Entry within this many seconds → partial score
    lateThresholdSeconds: envNumber('FOILOPS_EARLY_ENTRY_LATE_S', 900),
    weights: {
      veryEarly: envNumber('FOILOPS_EARLY_ENTRY_W_VERY_EARLY', 100),
      early: envNumber('FOILOPS_EARLY_ENTRY_W_EARLY', 70),
      late: envNumber('FOILOPS_EARLY_ENTRY_W_LATE', 30),
      after: envNumber('FOILOPS_EARLY_ENTRY_W_AFTER', 0),
    },
  },

  // Launch participation scoring
  participation: {
    // Minimum launches observed for a reliable sample
    minLaunchSampleSize: envNumber('FOILOPS_PARTICIPATION_MIN_SAMPLE', 3),
    // Participation in >= this fraction of observed launches → high score
    highRateThreshold: envNumber('FOILOPS_PARTICIPATION_HIGH_RATE', 0.7),
    // Participation in >= this fraction → medium score
    mediumRateThreshold: envNumber('FOILOPS_PARTICIPATION_MED_RATE', 0.4),
    weights: {
      high: envNumber('FOILOPS_PARTICIPATION_W_HIGH', 100),
      medium: envNumber('FOILOPS_PARTICIPATION_W_MED', 60),
      low: envNumber('FOILOPS_PARTICIPATION_W_LOW', 20),
    },
  },

  // Momentum participation scoring
  momentum: {
    // A "momentum window" is the period where price increases > X% within Y minutes
    priceIncreaseMinPct: envNumber('FOILOPS_MOMENTUM_MIN_PCT', 20),
    windowMinutes: envNumber('FOILOPS_MOMENTUM_WINDOW_MIN', 10),
    weights: {
      alwaysPresent: envNumber('FOILOPS_MOMENTUM_W_ALWAYS', 100),
      oftenPresent: envNumber('FOILOPS_MOMENTUM_W_OFTEN', 65),
      rarelyPresent: envNumber('FOILOPS_MOMENTUM_W_RARELY', 20),
    },
  },

  // Repeat success scoring
  success: {
    // Exit within this many minutes of peak → counted as a success
    profitableExitWindowMinutes: envNumber('FOILOPS_SUCCESS_EXIT_WINDOW_MIN', 30),
    weights: {
      highSuccessRate: envNumber('FOILOPS_SUCCESS_W_HIGH', 100),
      medSuccessRate: envNumber('FOILOPS_SUCCESS_W_MED', 60),
      lowSuccessRate: envNumber('FOILOPS_SUCCESS_W_LOW', 20),
    },
    highSuccessRateThreshold: envNumber('FOILOPS_SUCCESS_HIGH_RATE', 0.65),
    medSuccessRateThreshold: envNumber('FOILOPS_SUCCESS_MED_RATE', 0.35),
  },

  // Exit timing scoring
  exitTiming: {
    // Exiting before this fraction of peak-to-dump duration → good score
    goodExitFractionThreshold: envNumber('FOILOPS_EXIT_GOOD_FRACTION', 0.4),
    weights: {
      earlyExit: envNumber('FOILOPS_EXIT_W_EARLY', 100),
      midExit: envNumber('FOILOPS_EXIT_W_MID', 55),
      lateExit: envNumber('FOILOPS_EXIT_W_LATE', 15),
    },
  },

  // Rug-risk scoring
  rugRisk: {
    // How many rug-associated events before the score climbs sharply
    rugEventHardThreshold: envNumber('FOILOPS_RUG_EVENT_HARD', 3),
    weights: {
      flagged: envNumber('FOILOPS_RUG_W_FLAGGED', 30),
      perEvent: envNumber('FOILOPS_RUG_W_PER_EVENT', 10),
      clusterOverlap: envNumber('FOILOPS_RUG_W_CLUSTER_OVERLAP', 20),
    },
  },

  // Dump severity scoring
  dumpSeverity: {
    // Sell-off of > X% of holdings within Y minutes after entry = severe dump signal
    largeSellPctThreshold: envNumber('FOILOPS_DUMP_LARGE_SELL_PCT', 70),
    rapidDumpWindowMinutes: envNumber('FOILOPS_DUMP_RAPID_WINDOW_MIN', 5),
    weights: {
      rapidDump: envNumber('FOILOPS_DUMP_W_RAPID', 80),
      largeSell: envNumber('FOILOPS_DUMP_W_LARGE', 50),
    },
  },

  // Cluster suspicion scoring
  cluster: {
    // A single link of this type raises suspicion significantly
    highWeightLinkTypes: ['shared-funder', 'co-launch'],
    linkWeights: {
      'shared-funder': envNumber('FOILOPS_CLUSTER_W_SHARED_FUNDER', 35),
      'co-launch': envNumber('FOILOPS_CLUSTER_W_CO_LAUNCH', 25),
      'shared-counterparty': envNumber('FOILOPS_CLUSTER_W_SHARED_CP', 15),
      'similar-exit-pattern': envNumber('FOILOPS_CLUSTER_W_SIM_EXIT', 10),
      'downstream-consolidation': envNumber('FOILOPS_CLUSTER_W_DS_CONSOL', 20),
    },
    // Minimum confidence threshold to count a cluster link
    minLinkConfidence: envNumber('FOILOPS_CLUSTER_MIN_CONFIDENCE', 0.4),
  },

  // Suspicious funding scoring
  suspiciousFunding: {
    weights: {
      fromKnownBadActor: envNumber('FOILOPS_FUND_W_BAD_ACTOR', 50),
      fromMixer: envNumber('FOILOPS_FUND_W_MIXER', 40),
      fromExchangeWithdrawal: envNumber('FOILOPS_FUND_W_EXCHANGE', 5),
      fromNewWallet: envNumber('FOILOPS_FUND_W_NEW_WALLET', 20),
    },
  },

  // Classification thresholds
  classification: {
    // Minimum opportunity score to be an "early-entrant"
    earlyEntrantMinOpportunity: envNumber('FOILOPS_CLASS_EARLY_MIN_OPP', 70),
    earlyEntrantMaxRisk: envNumber('FOILOPS_CLASS_EARLY_MAX_RISK', 40),
    // Minimum opportunity score to be a "momentum-wallet"
    momentumMinOpportunity: envNumber('FOILOPS_CLASS_MOMENTUM_MIN_OPP', 55),
    momentumMaxRisk: envNumber('FOILOPS_CLASS_MOMENTUM_MAX_RISK', 55),
    // Minimum risk score to be "high-risk"
    highRiskMinRisk: envNumber('FOILOPS_CLASS_HIGH_RISK_MIN', 65),
    // Minimum opportunity score to stay on "watchlist"
    watchlistMinOpportunity: envNumber('FOILOPS_CLASS_WATCHLIST_MIN_OPP', 30),
  },
} as const

// ─── Token Risk Rules ──────────────────────────────────────────────────────────

export const tokenRules = {
  creatorHold: {
    // Creator holding > X% is a red flag
    dangerousThreshold: envNumber('FOILOPS_TOKEN_CREATOR_DANGER_PCT', 20),
    severeThreshold: envNumber('FOILOPS_TOKEN_CREATOR_SEVERE_PCT', 40),
    weights: {
      severe: envNumber('FOILOPS_TOKEN_CREATOR_W_SEVERE', 40),
      dangerous: envNumber('FOILOPS_TOKEN_CREATOR_W_DANGEROUS', 20),
    },
  },
  top10Holders: {
    // Top 10 wallets holding > X% is a concentration risk
    dangerousThreshold: envNumber('FOILOPS_TOKEN_TOP10_DANGER_PCT', 50),
    severeThreshold: envNumber('FOILOPS_TOKEN_TOP10_SEVERE_PCT', 80),
    weights: {
      severe: envNumber('FOILOPS_TOKEN_TOP10_W_SEVERE', 35),
      dangerous: envNumber('FOILOPS_TOKEN_TOP10_W_DANGEROUS', 15),
    },
  },
  liquidity: {
    // Liquidity below X USD is a danger signal
    dangerousThreshold: envNumber('FOILOPS_TOKEN_LIQ_DANGER_USD', 10_000),
    severeThreshold: envNumber('FOILOPS_TOKEN_LIQ_SEVERE_USD', 1_000),
    weights: {
      severe: envNumber('FOILOPS_TOKEN_LIQ_W_SEVERE', 30),
      dangerous: envNumber('FOILOPS_TOKEN_LIQ_W_DANGEROUS', 15),
    },
  },
  liquidityRemoval: {
    // > X% of liquidity removed → extreme risk
    dangerousThreshold: envNumber('FOILOPS_TOKEN_LIQREMOVE_DANGER_PCT', 30),
    severeThreshold: envNumber('FOILOPS_TOKEN_LIQREMOVE_SEVERE_PCT', 70),
    weights: {
      severe: envNumber('FOILOPS_TOKEN_LIQREMOVE_W_SEVERE', 40),
      dangerous: envNumber('FOILOPS_TOKEN_LIQREMOVE_W_DANGEROUS', 20),
    },
  },
  dumpPressure: {
    // Number of large sells in first N minutes
    observationWindowMinutes: envNumber('FOILOPS_TOKEN_DUMP_WINDOW_MIN', 10),
    largeSellCountThreshold: envNumber('FOILOPS_TOKEN_DUMP_LARGE_SELL_COUNT', 3),
    weights: {
      severe: envNumber('FOILOPS_TOKEN_DUMP_W_SEVERE', 30),
      moderate: envNumber('FOILOPS_TOKEN_DUMP_W_MODERATE', 15),
    },
  },
  suspiciousWalletLinks: {
    weights: {
      perWallet: envNumber('FOILOPS_TOKEN_SUSPWALLET_W_PER', 10),
      maxContribution: envNumber('FOILOPS_TOKEN_SUSPWALLET_W_MAX', 30),
    },
  },
  classification: {
    saferMax: envNumber('FOILOPS_TOKEN_CLASS_SAFER_MAX', 30),
    watchlistMax: envNumber('FOILOPS_TOKEN_CLASS_WATCHLIST_MAX', 55),
    highRiskMax: envNumber('FOILOPS_TOKEN_CLASS_HIGH_RISK_MAX', 75),
  },
} as const

// ─── Tracing Rules ─────────────────────────────────────────────────────────────

export const tracingRules = {
  // Max hops to follow when tracing wallet-to-wallet fund flow
  maxFlowHops: envNumber('FOILOPS_TRACE_MAX_FLOW_HOPS', 4),
  // Minimum SOL transferred to count a hop as meaningful
  minHopAmountSol: envNumber('FOILOPS_TRACE_MIN_HOP_SOL', 0.01),
  // Lookback window for cluster link computation
  clusterLookbackDays: envNumber('FOILOPS_CLUSTER_LOOKBACK_DAYS', 30),
  // Number of co-launches needed to form a "co-launch" cluster link
  coLaunchMinCount: envNumber('FOILOPS_COLAUNCH_MIN_COUNT', 2),
  // How many top wallet records to return from feed endpoints
  feedTopWalletCount: envNumber('FOILOPS_FEED_TOP_WALLET_COUNT', 50),
  // How many launch feed items to return
  feedLaunchCount: envNumber('FOILOPS_FEED_LAUNCH_COUNT', 100),
} as const

// ─── Barrel export ─────────────────────────────────────────────────────────────

export const foilOpsConfig = {
  walletRules,
  tokenRules,
  tracingRules,
} as const

export type FoilOpsConfig = typeof foilOpsConfig
