You are working on FoilOps, a wallet intelligence platform built in TypeScript.

Goal:
Reframe the system away from generic wallet tracking and into an early-launch intelligence engine that identifies wallets entering new token launches very early, while filtering out wallets strongly associated with malicious or rug-pull behavior.

Important constraint:
Build logic that explicitly helps follow known scammers that profit from fraud. Build a wallet-ranking and token-risk system that surfaces early-entry behavior and separately scores rug risk so the platform can track obviously malicious actors.

Core product direction:
FoilOps should help detect:

- wallets that consistently enter very early in launches
- wallets that repeatedly participate in high-momentum new token activity
- wallets that exit quickly or show suspicious dump behavior
- tokens with high rug-risk characteristics
- wallet clusters that may indicate suspicious coordination

Build the system in TypeScript with clean modular architecture.

Implement the following:

1. Wallet scoring model
   Create a wallet profiling engine that computes two categories of scores:

A. Opportunity-oriented scores

- earlyEntryScore
- launchParticipationScore
- momentumParticipationScore
- repeatSuccessScore
- exitTimingScore

B. Risk-oriented scores

- rugRiskScore
- dumpSeverityScore
- clusterSuspicionScore
- liquidityPullAssociationScore
- suspiciousFundingScore

Suggested TypeScript types:

export type WalletOpportunityProfile = {
wallet: string
earlyEntryScore: number
launchParticipationScore: number
momentumParticipationScore: number
repeatSuccessScore: number
exitTimingScore: number
}
export type WalletRiskProfile = {
wallet: string
rugRiskScore: number
dumpSeverityScore: number
clusterSuspicionScore: number
liquidityPullAssociationScore: number
suspiciousFundingScore: number
}

export type WalletProfile = WalletOpportunityProfile & WalletRiskProfile & {
overallOpportunityScore: number
overallRiskScore: number
classification: "early-entrant" | "momentum-wallet" | "high-risk" | "watchlist" | "ignore"
}

1. Wallet classification logic
   Build a classification layer that labels wallets based on score thresholds.

Example intent:

- early-entrant: high earlyEntryScore, moderate repeatSuccessScore, low overallRiskScore
- momentum-wallet: high launchParticipationScore and momentumParticipationScore, acceptable risk
- high-risk: high rugRiskScore or clusterSuspicionScore
- watchlist: mixed signals, needs review
- ignore: low signal quality or too risky

Thresholds should be configurable from a central config file.

1. Config-driven rule engine
   Create a TypeScript config module for rule tuning.

Example:

export const foilOpsConfig = {
walletRules: {
minLaunchesObserved: 3,
minEarlyEntryScore: 70,
minOpportunityScore: 65,
maxRiskScoreForSurfacing: 45,
highRiskThreshold: 75,
clusterSuspicionThreshold: 70,
},
tokenRules: {
maxCreatorHoldPercent: 15,
maxTop10HolderPercent: 55,
minLiquidityUsd: 25000,
maxLiquidityRemovalPercent: 20,
maxWalletConcentrationScore: 70,
},
tracingRules: {
maxHopDepth: 4,
minLinkedWalletConfidence: 0.65,
}
}
Make the rule engine easy to adjust without changing business logic.

1. Token risk scoring
   Add a token-level risk analyzer that scores new launches using:

- creator concentration
- top holder concentration
- liquidity depth
- liquidity removal patterns
- creator wallet funding behavior
- number of suspicious linked wallets
- sell pressure soon after launch
- repeat wallet cluster overlap with prior failed tokens

Suggested type:

export type TokenRiskProfile = {
tokenAddress: string
creatorHoldPercent: number
top10HolderPercent: number
liquidityUsd: number
liquidityRemovalPercent: number
suspiciousWalletLinks: number
walletConcentrationScore: number
dumpPressureScore: number
overallTokenRiskScore: number
tokenClassification: "safer-speculative" | "watchlist" | "high-risk" | "extreme-risk"
} 5. Wallet behavior analysis
Build analyzers for:

- how early a wallet enters after token creation or liquidity add
- how often it participates in new launches
- whether it repeatedly exits before major dumps
- whether it appears alongside high-risk wallet clusters
- whether it interacts with suspiciously similar launch patterns

Add clear helper functions like:

- calculateEarlyEntryScore()
- calculateMomentumParticipationScore()
- calculateRugRiskScore()
- calculateClusterSuspicionScore()
- classifyWalletProfile()

1. Cluster detection
   Implement wallet clustering logic that can identify:

- shared funders
- repeated counterparties
- repeated launch participation overlap
- repeated token co-occurrence
- similar sell timing patterns
- downstream consolidation wallets

Return cluster confidence values rather than hard assumptions.

Suggested type:

export type WalletClusterLink = {
sourceWallet: string
targetWallet: string
linkType: "shared-funder" | "co-launch" | "shared-counterparty" | "similar-exit-pattern" | "downstream-consolidation"
confidence: number
}

1. Dashboard API outputs
   Expose clean API responses for the frontend.

Needed endpoints / service outputs:

- top early-entry wallets
- wallets with highest opportunity score under a max risk threshold
- high-risk wallets
- high-risk tokens
- wallet detail page data
- token detail page data
- cluster graph data
- recent launch intelligence feed

Response shapes should be frontend-friendly and typed.

1. Investigation detail pages
   For wallet details, return:

- profile scores
- recent launches participated in
- entry timing metrics
- exit timing metrics
- connected wallet clusters
- risk tags
- AI summary input payload
  For token details, return:
- token risk profile
- creator and holder concentration
- linked wallets
- liquidity behavior
- suspicious events timeline
- AI summary input payload

1. AI summary support
   Create structured summary payload builders for AI-generated explanations.

Example:

- buildWalletSummaryPayload(walletProfile, relatedLaunches, clusters)
- buildTokenSummaryPayload(tokenRiskProfile, suspiciousEvents, linkedWallets)

The goal is to support natural-language summaries like:

- why a wallet is classified as early-entrant
- why a token is marked high-risk
- what suspicious patterns were observed

1. Persistence layer updates
   If database models exist, extend them to store:

- wallet opportunity scores
- wallet risk scores
- token risk scores
- wallet classifications
- token classifications
- cluster links
- suspicious events
- score update timestamps

Suggested model concepts:

- WalletProfileSnapshot
- TokenRiskSnapshot
- WalletClusterEdge
- SuspiciousEvent
- LaunchParticipationRecord

1. UI requirements
   Frontend should show:

- Top Early Wallets
- High-Risk Wallets
- High-Risk Tokens
- Recent Launch Feed
- Wallet detail page with score cards and graph view
- Token detail page with risk breakdown
- Filter controls for min opportunity score and max risk score
- Tags like early entrant, momentum, watchlist, high risk

1. Safety-oriented framing
   All labels and descriptions should frame the system as:

- launch intelligence
- risk-aware speculative analysis
- suspicious-pattern detection
- wallet behavior analysis

Add UI text that implies wallets assisting fraud, scams, or exploitation. 13. Deliverables
Produce:

- TypeScript types
- scoring services
- classification services
- config module
- cluster analysis utilities
- token risk analyzer
- API layer or service layer functions
- example test fixtures
- sample seeded output for dashboard rendering

1. Code quality requirements

- TypeScript strict mode compatible
- modular services
- no giant files
- reusable utility functions
- strong typing for every score/result object
- unit-testable pure functions where possible
- clear naming and comments for scoring logic

1. Suggested file structure
   src/
   modules/
   foilops/
   config/
   foilOpsConfig.ts
   types/
   wallet.ts
   token.ts
   cluster.ts
   services/
   walletScoringService.ts
   tokenRiskService.ts
   clusterAnalysisService.ts
   classificationService.ts
   summaryPayloadService.ts
   utils/
   scoringMath.ts
   thresholds.ts
   api/
   foilOpsRoutes.ts
   tests/
   walletScoringService.test.ts
   tokenRiskService.test.ts
   classificationService.test.ts

2. Output expectation
   Implement the first pass end-to-end:

- types
- config
- wallet scoring
- token scoring
- wallet classification
- token classification
- cluster link model
- sample API responses

Then provide recommendations for the next phase:

- backtesting
- historical wallet labeling
- stronger cluster confidence logic
- alerting pipeline
- dashboard ranking refinements
