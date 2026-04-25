import type { Express, Request, RequestHandler, Response } from 'express'
import { PublicKey } from '@solana/web3.js'
import { renderFuturisticPage } from '../lib/site-theme'
import { RpcConnectionManager } from '../providers/solana'

const SPL_TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')

type FlowStep = {
  from: string
  to: string
  signature: string
  amount: string
  asset: string
  hop: number
}

type FlowTraceSummary = {
  alerts: string[]
  terminalWallets: Array<{
    address: string
    hop: number
    reason: string
    reachedViaMixer: boolean
    firstMixerHop: number | null
  }>
  mixerTrace: {
    encountered: boolean
    mixerWallets: string[]
    downstreamWallets: string[]
  } | null
  platformTrace: {
    exchange: {
      encountered: boolean
      wallets: string[]
      downstreamWallets: string[]
    }
    bridge: {
      encountered: boolean
      wallets: string[]
      downstreamWallets: string[]
    }
  } | null
  bridgeRouteAttribution: {
    encountered: boolean
    canonicalFamilies: string[]
    canonicalPrograms: string[]
    relayerWallets: string[]
    handoffWallets: string[]
    handoffs: Array<{
      signature: string
      hop: number
      from: string
      to: string
      amount: string
      asset: string
      timestamp?: string
      bridgeFamily: string
      bridgeLabel: string
      relayerHint: boolean
    }>
  } | null
  crossChainContinuation: {
    encountered: boolean
    bridgeFamilies: string[]
    recommendedNextChains: string[]
    continuationCandidates: Array<{
      sourceWallet: string
      bridgeWallet: string
      signature: string
      hop: number
      bridgeFamily: string
      bridgeLabel: string
      candidateNextChains: string[]
      resolverHint: string
      confidence: number
      reason: string
      observedAt?: string
    }>
    unresolvedHandoffs: string[]
    notes: string[]
  } | null
  riskConfidenceModel: {
    modelVersion: string
    baseConfidence: number
    attenuation: number
    adjustedConfidence: number
    degradationLevel: string
    boundariesCrossed: string[]
    events: Array<{
      boundary: string
      hop: number
      signature: string
      wallet: string
      impact: number
      reason: string
    }>
    notes: string[]
  } | null
  cexDepositHeuristics: {
    detected: boolean
    confidence: number
    exchangeWalletCount: number
    exchangeTransferCount: number
    totalExchangeOutflowSol: number
    exchangeClusters: Array<{
      label: string
      walletCount: number
      transferCount: number
      wallets: string[]
    }>
    memoSignals: {
      memoTransferCount: number
      memoSignatureCount: number
      memoSamples: string[]
    }
    evidence: Array<{
      code: string
      score: number
      summary: string
      signatures: string[]
      wallets: string[]
      details?: Record<string, number | string>
    }>
  } | null
}

type ScamWalletRepositoryLike = {
  getLatestFlowTrace(wallet: string): Promise<{ metadata?: unknown } | null>
  getMixerRouteAudit(): Promise<
    Array<{
      sourceWallet: string
      latestTraceAt: string | null
      mixerWallets: string[]
      downstreamWallets: string[]
    }>
  >
  getMixerRouteAudit(filters: {
    sourceWallet?: string
    mixerWallet?: string
    startDate?: Date
    endDate?: Date
  }): Promise<
    Array<{
      sourceWallet: string
      latestTraceAt: string | null
      mixerWallets: string[]
      downstreamWallets: string[]
    }>
  >
}

type WalletClusterServiceLike = {
  getLatestCluster(wallet: string): Promise<{
    clusterScore: number
    riskScore: number
    wallets: string[]
  } | null>
}

type FundFlowTracerLike = {
  traceWalletFlow(
    wallet: string,
    maxHops: number,
    signaturesPerHop: number,
    options?: {
      traceAllFirstHopRecipients?: boolean
      followAllRecipients?: boolean
      maxVisitedWallets?: number
    },
  ): Promise<unknown>
}

export type GraphRouteDeps = {
  scamWalletRepository: ScamWalletRepositoryLike
  walletClusterService: WalletClusterServiceLike
  fundFlowTracer?: FundFlowTracerLike
  aiAnalyzer?: {
    analyzeWallet(wallet: string): Promise<string>
  }
  apiAuthMiddleware?: RequestHandler
  pageAuthMiddleware?: RequestHandler
}

function extractFlowSteps(flowMetadata: unknown): FlowStep[] {
  const candidate = flowMetadata as { steps?: FlowStep[] } | undefined
  if (!candidate?.steps || !Array.isArray(candidate.steps)) return []
  return candidate.steps
}

function extractFlowTraceSummary(flowMetadata: unknown): FlowTraceSummary {
  const candidate = flowMetadata as
    | {
        alerts?: string[]
        terminalWallets?: Array<{
          address?: string
          hop?: number
          reason?: string
          reachedViaMixer?: boolean
          firstMixerHop?: number | null
        }>
        mixerTrace?: {
          encountered?: boolean
          mixerWallets?: string[]
          downstreamWallets?: string[]
        }
        platformTrace?: {
          exchange?: {
            encountered?: boolean
            wallets?: string[]
            downstreamWallets?: string[]
          }
          bridge?: {
            encountered?: boolean
            wallets?: string[]
            downstreamWallets?: string[]
          }
        }
        bridgeRouteAttribution?: {
          encountered?: boolean
          canonicalFamilies?: string[]
          canonicalPrograms?: string[]
          relayerWallets?: string[]
          handoffWallets?: string[]
          handoffs?: Array<{
            signature?: string
            hop?: number
            from?: string
            to?: string
            amount?: string
            asset?: string
            timestamp?: string
            bridgeFamily?: string
            bridgeLabel?: string
            relayerHint?: boolean
          }>
        }
        crossChainContinuation?: {
          encountered?: boolean
          bridgeFamilies?: string[]
          recommendedNextChains?: string[]
          continuationCandidates?: Array<{
            sourceWallet?: string
            bridgeWallet?: string
            signature?: string
            hop?: number
            bridgeFamily?: string
            bridgeLabel?: string
            candidateNextChains?: string[]
            resolverHint?: string
            confidence?: number
            reason?: string
            observedAt?: string
          }>
          unresolvedHandoffs?: string[]
          notes?: string[]
        }
        riskConfidenceModel?: {
          modelVersion?: string
          baseConfidence?: number
          attenuation?: number
          adjustedConfidence?: number
          degradationLevel?: string
          boundariesCrossed?: string[]
          events?: Array<{
            boundary?: string
            hop?: number
            signature?: string
            wallet?: string
            impact?: number
            reason?: string
          }>
          notes?: string[]
        }
        cexDepositHeuristics?: {
          detected?: boolean
          confidence?: number
          exchangeWalletCount?: number
          exchangeTransferCount?: number
          totalExchangeOutflowSol?: number
          exchangeClusters?: Array<{
            label?: string
            walletCount?: number
            transferCount?: number
            wallets?: string[]
          }>
          memoSignals?: {
            memoTransferCount?: number
            memoSignatureCount?: number
            memoSamples?: string[]
          }
          evidence?: Array<{
            code?: string
            score?: number
            summary?: string
            signatures?: string[]
            wallets?: string[]
            details?: Record<string, number | string>
          }>
        }
      }
    | undefined

  const alerts = Array.isArray(candidate?.alerts) ? candidate!.alerts.filter((a) => typeof a === 'string') : []
  const terminalWallets = Array.isArray(candidate?.terminalWallets)
    ? candidate!.terminalWallets
        .filter((item) => typeof item?.address === 'string')
        .map((item) => ({
          address: item.address as string,
          hop: typeof item.hop === 'number' ? item.hop : 0,
          reason: typeof item.reason === 'string' ? item.reason : 'UNKNOWN',
          reachedViaMixer: item.reachedViaMixer === true,
          firstMixerHop: typeof item.firstMixerHop === 'number' ? item.firstMixerHop : null,
        }))
    : []

  const mixerTrace = candidate?.mixerTrace
    ? {
        encountered: candidate.mixerTrace.encountered === true,
        mixerWallets: Array.isArray(candidate.mixerTrace.mixerWallets)
          ? candidate.mixerTrace.mixerWallets.filter((w) => typeof w === 'string')
          : [],
        downstreamWallets: Array.isArray(candidate.mixerTrace.downstreamWallets)
          ? candidate.mixerTrace.downstreamWallets.filter((w) => typeof w === 'string')
          : [],
      }
    : null

  const platformTrace = candidate?.platformTrace
    ? {
        exchange: {
          encountered: candidate.platformTrace.exchange?.encountered === true,
          wallets: Array.isArray(candidate.platformTrace.exchange?.wallets)
            ? candidate.platformTrace.exchange!.wallets.filter((w) => typeof w === 'string')
            : [],
          downstreamWallets: Array.isArray(candidate.platformTrace.exchange?.downstreamWallets)
            ? candidate.platformTrace.exchange!.downstreamWallets.filter((w) => typeof w === 'string')
            : [],
        },
        bridge: {
          encountered: candidate.platformTrace.bridge?.encountered === true,
          wallets: Array.isArray(candidate.platformTrace.bridge?.wallets)
            ? candidate.platformTrace.bridge!.wallets.filter((w) => typeof w === 'string')
            : [],
          downstreamWallets: Array.isArray(candidate.platformTrace.bridge?.downstreamWallets)
            ? candidate.platformTrace.bridge!.downstreamWallets.filter((w) => typeof w === 'string')
            : [],
        },
      }
    : null

  const bridgeRouteAttribution = candidate?.bridgeRouteAttribution
    ? {
        encountered: candidate.bridgeRouteAttribution.encountered === true,
        canonicalFamilies: Array.isArray(candidate.bridgeRouteAttribution.canonicalFamilies)
          ? candidate.bridgeRouteAttribution.canonicalFamilies.filter((value) => typeof value === 'string')
          : [],
        canonicalPrograms: Array.isArray(candidate.bridgeRouteAttribution.canonicalPrograms)
          ? candidate.bridgeRouteAttribution.canonicalPrograms.filter((value) => typeof value === 'string')
          : [],
        relayerWallets: Array.isArray(candidate.bridgeRouteAttribution.relayerWallets)
          ? candidate.bridgeRouteAttribution.relayerWallets.filter((value) => typeof value === 'string')
          : [],
        handoffWallets: Array.isArray(candidate.bridgeRouteAttribution.handoffWallets)
          ? candidate.bridgeRouteAttribution.handoffWallets.filter((value) => typeof value === 'string')
          : [],
        handoffs: Array.isArray(candidate.bridgeRouteAttribution.handoffs)
          ? candidate.bridgeRouteAttribution.handoffs
              .filter((item) => typeof item?.signature === 'string')
              .map((item) => ({
                signature: item.signature as string,
                hop: typeof item.hop === 'number' ? item.hop : 0,
                from: typeof item.from === 'string' ? item.from : '',
                to: typeof item.to === 'string' ? item.to : '',
                amount: typeof item.amount === 'string' ? item.amount : '0',
                asset: typeof item.asset === 'string' ? item.asset : 'UNKNOWN',
                timestamp: typeof item.timestamp === 'string' ? item.timestamp : undefined,
                bridgeFamily: typeof item.bridgeFamily === 'string' ? item.bridgeFamily : 'GENERIC_BRIDGE',
                bridgeLabel: typeof item.bridgeLabel === 'string' ? item.bridgeLabel : 'Unknown bridge route',
                relayerHint: item.relayerHint === true,
              }))
          : [],
      }
    : null

  const crossChainContinuation = candidate?.crossChainContinuation
    ? {
        encountered: candidate.crossChainContinuation.encountered === true,
        bridgeFamilies: Array.isArray(candidate.crossChainContinuation.bridgeFamilies)
          ? candidate.crossChainContinuation.bridgeFamilies.filter((value) => typeof value === 'string')
          : [],
        recommendedNextChains: Array.isArray(candidate.crossChainContinuation.recommendedNextChains)
          ? candidate.crossChainContinuation.recommendedNextChains.filter((value) => typeof value === 'string')
          : [],
        continuationCandidates: Array.isArray(candidate.crossChainContinuation.continuationCandidates)
          ? candidate.crossChainContinuation.continuationCandidates
              .filter((item) => typeof item?.signature === 'string')
              .map((item) => ({
                sourceWallet: typeof item.sourceWallet === 'string' ? item.sourceWallet : '',
                bridgeWallet: typeof item.bridgeWallet === 'string' ? item.bridgeWallet : '',
                signature: item.signature as string,
                hop: typeof item.hop === 'number' ? item.hop : 0,
                bridgeFamily: typeof item.bridgeFamily === 'string' ? item.bridgeFamily : 'GENERIC_BRIDGE',
                bridgeLabel: typeof item.bridgeLabel === 'string' ? item.bridgeLabel : 'Unknown bridge route',
                candidateNextChains: Array.isArray(item.candidateNextChains)
                  ? item.candidateNextChains.filter((value) => typeof value === 'string')
                  : [],
                resolverHint: typeof item.resolverHint === 'string' ? item.resolverHint : 'bridge:manual-correlation',
                confidence: typeof item.confidence === 'number' ? item.confidence : 0,
                reason: typeof item.reason === 'string' ? item.reason : 'No reason provided',
                observedAt: typeof item.observedAt === 'string' ? item.observedAt : undefined,
              }))
          : [],
        unresolvedHandoffs: Array.isArray(candidate.crossChainContinuation.unresolvedHandoffs)
          ? candidate.crossChainContinuation.unresolvedHandoffs.filter((value) => typeof value === 'string')
          : [],
        notes: Array.isArray(candidate.crossChainContinuation.notes)
          ? candidate.crossChainContinuation.notes.filter((value) => typeof value === 'string')
          : [],
      }
    : null

  const riskConfidenceModel = candidate?.riskConfidenceModel
    ? {
        modelVersion:
          typeof candidate.riskConfidenceModel.modelVersion === 'string'
            ? candidate.riskConfidenceModel.modelVersion
            : 'unknown',
        baseConfidence:
          typeof candidate.riskConfidenceModel.baseConfidence === 'number'
            ? candidate.riskConfidenceModel.baseConfidence
            : 0,
        attenuation:
          typeof candidate.riskConfidenceModel.attenuation === 'number' ? candidate.riskConfidenceModel.attenuation : 0,
        adjustedConfidence:
          typeof candidate.riskConfidenceModel.adjustedConfidence === 'number'
            ? candidate.riskConfidenceModel.adjustedConfidence
            : 0,
        degradationLevel:
          typeof candidate.riskConfidenceModel.degradationLevel === 'string'
            ? candidate.riskConfidenceModel.degradationLevel
            : 'LOW',
        boundariesCrossed: Array.isArray(candidate.riskConfidenceModel.boundariesCrossed)
          ? candidate.riskConfidenceModel.boundariesCrossed.filter((value) => typeof value === 'string')
          : [],
        events: Array.isArray(candidate.riskConfidenceModel.events)
          ? candidate.riskConfidenceModel.events
              .filter((item) => typeof item?.boundary === 'string')
              .map((item) => ({
                boundary: item.boundary as string,
                hop: typeof item.hop === 'number' ? item.hop : 0,
                signature: typeof item.signature === 'string' ? item.signature : '',
                wallet: typeof item.wallet === 'string' ? item.wallet : '',
                impact: typeof item.impact === 'number' ? item.impact : 0,
                reason: typeof item.reason === 'string' ? item.reason : '',
              }))
          : [],
        notes: Array.isArray(candidate.riskConfidenceModel.notes)
          ? candidate.riskConfidenceModel.notes.filter((value) => typeof value === 'string')
          : [],
      }
    : null

  const cexDepositHeuristics = candidate?.cexDepositHeuristics
    ? {
        detected: candidate.cexDepositHeuristics.detected === true,
        confidence:
          typeof candidate.cexDepositHeuristics.confidence === 'number' ? candidate.cexDepositHeuristics.confidence : 0,
        exchangeWalletCount:
          typeof candidate.cexDepositHeuristics.exchangeWalletCount === 'number'
            ? candidate.cexDepositHeuristics.exchangeWalletCount
            : 0,
        exchangeTransferCount:
          typeof candidate.cexDepositHeuristics.exchangeTransferCount === 'number'
            ? candidate.cexDepositHeuristics.exchangeTransferCount
            : 0,
        totalExchangeOutflowSol:
          typeof candidate.cexDepositHeuristics.totalExchangeOutflowSol === 'number'
            ? candidate.cexDepositHeuristics.totalExchangeOutflowSol
            : 0,
        exchangeClusters: Array.isArray(candidate.cexDepositHeuristics.exchangeClusters)
          ? candidate.cexDepositHeuristics.exchangeClusters
              .filter((item) => typeof item?.label === 'string')
              .map((item) => ({
                label: item.label as string,
                walletCount: typeof item.walletCount === 'number' ? item.walletCount : 0,
                transferCount: typeof item.transferCount === 'number' ? item.transferCount : 0,
                wallets: Array.isArray(item.wallets) ? item.wallets.filter((w) => typeof w === 'string') : [],
              }))
          : [],
        memoSignals: {
          memoTransferCount:
            typeof candidate.cexDepositHeuristics.memoSignals?.memoTransferCount === 'number'
              ? candidate.cexDepositHeuristics.memoSignals.memoTransferCount
              : 0,
          memoSignatureCount:
            typeof candidate.cexDepositHeuristics.memoSignals?.memoSignatureCount === 'number'
              ? candidate.cexDepositHeuristics.memoSignals.memoSignatureCount
              : 0,
          memoSamples: Array.isArray(candidate.cexDepositHeuristics.memoSignals?.memoSamples)
            ? candidate.cexDepositHeuristics.memoSignals!.memoSamples.filter((value) => typeof value === 'string')
            : [],
        },
        evidence: Array.isArray(candidate.cexDepositHeuristics.evidence)
          ? candidate.cexDepositHeuristics.evidence
              .filter((item) => typeof item?.code === 'string')
              .map((item) => ({
                code: item.code as string,
                score: typeof item.score === 'number' ? item.score : 0,
                summary: typeof item.summary === 'string' ? item.summary : '',
                signatures: Array.isArray(item.signatures)
                  ? item.signatures.filter((sig) => typeof sig === 'string')
                  : [],
                wallets: Array.isArray(item.wallets) ? item.wallets.filter((w) => typeof w === 'string') : [],
                details: item.details,
              }))
          : [],
      }
    : null

  return {
    alerts,
    terminalWallets,
    mixerTrace,
    platformTrace,
    bridgeRouteAttribution,
    crossChainContinuation,
    riskConfidenceModel,
    cexDepositHeuristics,
  }
}

function renderGraphPage(wallet: string) {
  const safeWallet = wallet.replace(/[^A-Za-z0-9_-]/g, '')

  return renderFuturisticPage({
    title: 'FoilOps Wallet Graph',
    activeNav: 'graph',
    headerActionsHtml:
      '<form class="logout-form" method="post" action="/logout"><button class="fx-button" type="submit">Logout</button></form>',
    extraStyles:
      '.wrap { display:grid; gap:16px; } .dot { width:10px; height:10px; border-radius:50%; display:inline-block; margin-right:5px; vertical-align:middle; } svg text { fill: #ffd0d4; font-family: "IBM Plex Mono", monospace; } svg line { stroke: rgba(255,40,60,.30); } .wallet-chip.chip-tracked { border-color: rgba(255, 30, 50, 0.30); background: rgba(255, 30, 50, 0.10); color: #ff9aa3; } .wallet-chip.chip-source { border-color: rgba(200, 0, 20, 0.30); background: rgba(200, 0, 20, 0.10); color: #ff8090; } .wallet-chip.chip-both { border-color: rgba(255, 119, 68, 0.30); background: rgba(255, 119, 68, 0.10); color: #ffcca8; box-shadow: 0 0 0 1px rgba(255, 119, 68, 0.08) inset; } .chip-legend { display:flex; flex-wrap:wrap; gap:10px; margin: 10px 0 0; } .chip-legend-item { display:inline-flex; align-items:center; gap:8px; color:#c9a0a0; font-size:0.82rem; } .chip-legend-item .wallet-chip { cursor:default; } .retrace-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap:10px; margin:10px 0; } .retrace-label { font-size:.78rem; color:#b99; margin-bottom:4px; display:block; } .retrace-json { white-space: pre-wrap; word-break: break-word; max-height: 260px; overflow:auto; border:1px solid rgba(255,255,255,.1); padding:10px; border-radius:10px; background: rgba(0,0,0,.2); font-size:.78rem; color:#f0dede; } .retrace-heuristics { border:1px solid rgba(255,255,255,.12); border-radius:10px; padding:10px; margin:10px 0 8px; background: rgba(0,0,0,.16); } .retrace-heuristics-header { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:8px; } .retrace-heuristics-title { font-size:.82rem; letter-spacing:.06em; text-transform:uppercase; color:#d9b2b2; } .retrace-confidence-badge { display:inline-flex; align-items:center; padding:4px 8px; border-radius:999px; border:1px solid rgba(255,255,255,.15); font-size:.74rem; font-weight:600; } .retrace-confidence-tier-none { color:#c8b6b6; background: rgba(200,182,182,.12); border-color: rgba(200,182,182,.26); } .retrace-confidence-tier-low { color:#ffd1a5; background: rgba(255,150,64,.14); border-color: rgba(255,150,64,.28); } .retrace-confidence-tier-medium { color:#ffe59b; background: rgba(222,177,49,.16); border-color: rgba(222,177,49,.3); } .retrace-confidence-tier-high { color:#b5f0c8; background: rgba(43,179,106,.18); border-color: rgba(43,179,106,.34); } .retrace-heuristics-metrics { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px; } .retrace-metric-pill { border:1px solid rgba(255,255,255,.1); border-radius:999px; padding:3px 8px; font-size:.74rem; color:#e9d5d5; background: rgba(255,255,255,.03); } .retrace-evidence-cards { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:8px; } .retrace-evidence-card { border:1px solid rgba(255,255,255,.12); border-radius:10px; padding:8px; background: rgba(0,0,0,.18); } .retrace-evidence-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:4px; } .retrace-evidence-code { font-size:.74rem; letter-spacing:.05em; text-transform:uppercase; color:#f8c0c0; } .retrace-evidence-score { font-size:.74rem; color:#f6dfaa; } .retrace-evidence-summary { font-size:.79rem; color:#efdcdc; margin-bottom:6px; } .retrace-evidence-meta { font-size:.72rem; color:#cda7a7; line-height:1.35; } .retrace-risk { border:1px solid rgba(255,255,255,.12); border-radius:10px; padding:10px; margin:10px 0 8px; background: rgba(0,0,0,.16); } .retrace-risk-header { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:8px; } .retrace-risk-title { font-size:.82rem; letter-spacing:.06em; text-transform:uppercase; color:#d9b2b2; } .retrace-risk-badge { display:inline-flex; align-items:center; padding:4px 8px; border-radius:999px; border:1px solid rgba(255,255,255,.15); font-size:.74rem; font-weight:600; } .retrace-risk-level-low { color:#b5f0c8; background: rgba(43,179,106,.18); border-color: rgba(43,179,106,.34); } .retrace-risk-level-medium { color:#ffe59b; background: rgba(222,177,49,.16); border-color: rgba(222,177,49,.3); } .retrace-risk-level-high { color:#ffb3b3; background: rgba(210,59,59,.18); border-color: rgba(210,59,59,.34); } .retrace-risk-body { display:grid; grid-template-columns: 130px 1fr; gap:10px; align-items:start; } .retrace-risk-gauge { width:110px; height:110px; border-radius:50%; display:grid; place-items:center; background: conic-gradient(#2bb36a 0%, #2bb36a 0%, rgba(255,255,255,.10) 0%); border:1px solid rgba(255,255,255,.14); margin:0 auto; } .retrace-risk-gauge-core { width:78px; height:78px; border-radius:50%; background: rgba(10,10,10,.78); display:flex; flex-direction:column; align-items:center; justify-content:center; } .retrace-risk-gauge-value { font-size:1.05rem; font-weight:700; color:#f6dede; line-height:1; } .retrace-risk-gauge-label { margin-top:2px; font-size:.66rem; letter-spacing:.05em; text-transform:uppercase; color:#bca0a0; } .retrace-risk-metrics { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px; } .retrace-risk-timeline { display:grid; gap:8px; } .retrace-risk-event { border:1px solid rgba(255,255,255,.10); border-left:3px solid rgba(255,255,255,.18); border-radius:8px; padding:7px 8px; background: rgba(0,0,0,.2); } .retrace-risk-event-head { display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:.74rem; color:#f0d0d0; margin-bottom:4px; } .retrace-risk-event-body { font-size:.72rem; color:#d6b3b3; line-height:1.35; } .retrace-risk-event-boundary-mixer { border-left-color: #d23b3b; background: rgba(210,59,59,.12); } .retrace-risk-event-boundary-exchange { border-left-color: #deb131; background: rgba(222,177,49,.12); } .retrace-risk-event-boundary-cex_deposit { border-left-color: #ff8f4d; background: rgba(255,143,77,.12); } .retrace-risk-event-boundary-bridge { border-left-color: #4bb2ff; background: rgba(75,178,255,.12); } @media (max-width: 760px) { .retrace-risk-body { grid-template-columns: 1fr; } }',
    heroHtml: `
      <section class="page-header">
        <div>
          <p class="fx-eyebrow">Relationship analysis</p>
          <h1 class="page-title">Wallet Graph</h1>
          <p class="page-subtitle">Inspect linked wallets, cluster signals, and analyst-side summaries from the protected graph view.</p>
        </div>
        <div class="card" style="min-width:280px">
          <p class="eyebrow">Current query</p>
          <div class="big mono" id="graph-current-query">${safeWallet || 'none'}</div>
          <p>Load any wallet address to pull flow edges, inferred cluster links, and AI wallet analysis into one view.</p>
        </div>
      </section>
    `,
    contentHtml: `
      <div class="wrap">
        <div class="panel section">
      <div class="section-header">
        <div class="section-header-copy">
          <h2>Graph Query + Intelligence Summary</h2>
          <p class="section-subtitle">Load a wallet, inspect followed-wallet overlap, and review coverage plus AI analysis in one control block.</p>
        </div>
      </div>
      <div class="top">
        <input id="wallet" value="${safeWallet}" placeholder="Enter wallet" />
        <button id="load" class="fx-button primary">Load Graph</button>
      </div>
      <div id="followed-wallets" class="wallet-list"></div>
      <div class="chip-legend" aria-label="Followed wallet legend">
        <span class="chip-legend-item"><span class="wallet-chip chip-tracked">Tracked</span><span>Tracked wallet only</span></span>
        <span class="chip-legend-item"><span class="wallet-chip chip-source">Source</span><span>Source watchlist only</span></span>
        <span class="chip-legend-item"><span class="wallet-chip chip-both">Tracked + Source</span><span>Present in both pools</span></span>
      </div>
      <div class="summary-grid" id="graph-summary">
        <article class="summary-tile"><p class="summary-tile-label">Selected Wallet</p><div class="summary-tile-value mono" id="graph-summary-wallet">Waiting for selection</div><p class="summary-tile-copy">The wallet currently loaded into the graph canvas.</p></article>
        <article class="summary-tile"><p class="summary-tile-label">Coverage</p><div class="summary-tile-value" id="graph-summary-coverage">Nodes 0 | Edges 0</div><p class="summary-tile-copy">Flow and cluster breadth currently rendered.</p></article>
        <article class="summary-tile"><p class="summary-tile-label">Cluster Status</p><div class="summary-tile-value" id="graph-summary-cluster">Waiting for graph</div><p class="summary-tile-copy">Quick read of cluster score and risk for the current wallet.</p></article>
        <article class="summary-tile"><p class="summary-tile-label">Analysis</p><div class="summary-tile-value" id="graph-summary-analysis">Idle</div><p class="summary-tile-copy">Analyst-side interpretation from the AI summary endpoint.</p></article>
      </div>
      <div id="meta" class="meta">Loading...</div>
      <div id="analysis-summary" class="analysis-panel">Analysis loading...</div>
      <div id="token-holdings-section" style="display:none">
        <p class="eyebrow" style="margin-top:18px">Token Holdings</p>
        <div id="token-holdings-list" class="meta">Loading tokens...</div>
      </div>
      <div class="panel" style="margin-top:14px; padding:12px; border:1px solid rgba(255,255,255,.08)">
        <p class="eyebrow">Deep Retrace (On-demand)</p>
        <div class="retrace-grid">
          <div>
            <label class="retrace-label" for="retrace-wallet">Wallet</label>
            <input id="retrace-wallet" placeholder="Wallet address" value="${safeWallet}" />
          </div>
          <div>
            <label class="retrace-label" for="retrace-max-hops">Max hops (1-12)</label>
            <input id="retrace-max-hops" type="number" min="1" max="12" value="8" />
          </div>
          <div>
            <label class="retrace-label" for="retrace-sigs">Signatures/hop (1-50)</label>
            <input id="retrace-sigs" type="number" min="1" max="50" value="20" />
          </div>
          <div>
            <label class="retrace-label" for="retrace-max-visited">Max wallets (50-2000)</label>
            <input id="retrace-max-visited" type="number" min="50" max="2000" value="500" />
          </div>
        </div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin:8px 0 10px">
          <label><input id="retrace-follow-all" type="checkbox" checked /> Follow all recipients</label>
          <label><input id="retrace-first-hop" type="checkbox" /> Fan-out first hop only</label>
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
          <button id="run-deep-retrace" class="fx-button primary" type="button">Run Deep Retrace</button>
          <span id="deep-retrace-status" class="meta">Idle</span>
        </div>
        <div id="deep-retrace-heuristics" class="retrace-heuristics" style="display:none">
          <div class="retrace-heuristics-header">
            <span class="retrace-heuristics-title">CEX Deposit Heuristics</span>
            <span id="retrace-confidence-badge" class="retrace-confidence-badge retrace-confidence-tier-none">No signal</span>
          </div>
          <div id="retrace-heuristics-metrics" class="retrace-heuristics-metrics"></div>
          <div id="retrace-evidence-cards" class="retrace-evidence-cards"></div>
        </div>
        <div id="deep-retrace-risk" class="retrace-risk" style="display:none">
          <div class="retrace-risk-header">
            <span class="retrace-risk-title">Risk Confidence Model</span>
            <span id="retrace-risk-badge" class="retrace-risk-badge retrace-risk-level-low">Low degradation</span>
          </div>
          <div class="retrace-risk-body">
            <div id="retrace-risk-gauge" class="retrace-risk-gauge">
              <div class="retrace-risk-gauge-core">
                <div id="retrace-risk-gauge-value" class="retrace-risk-gauge-value">0%</div>
                <div class="retrace-risk-gauge-label">confidence</div>
              </div>
            </div>
            <div>
              <div id="retrace-risk-metrics" class="retrace-risk-metrics"></div>
              <div id="retrace-risk-timeline" class="retrace-risk-timeline"></div>
            </div>
          </div>
        </div>
        <pre id="deep-retrace-result" class="retrace-json">Run retrace to view JSON output.</pre>
      </div>
        </div>

        <div class="panel section">
          <div class="section-header">
            <div class="section-header-copy">
              <h2>Wallet Relationship Canvas</h2>
              <p class="section-subtitle">Visual map of primary wallet, nearby flow participants, and inferred cluster neighbors.</p>
            </div>
          </div>
          <svg id="graph" viewBox="0 0 900 430" preserveAspectRatio="xMidYMid meet"></svg>
          <div class="legend">
            <span><span class="dot" style="background:#ff7744"></span>Cluster Wallet</span>
            <span><span class="dot" style="background:#ff5a7a"></span>Primary Wallet</span>
            <span><span class="dot" style="background:#cc0820"></span>Related Wallet</span>
          </div>
          <div id="wallet-list" class="wallet-list"></div>
        </div>

        <div id="wallet-popup" class="wallet-popup" role="dialog" aria-modal="false" aria-label="Wallet details">
          <div class="wallet-popup-title">Wallet Address</div>
          <div id="wallet-popup-value" class="wallet-popup-value"></div>
          <div class="wallet-popup-actions">
            <button id="wallet-popup-copy" class="fx-button primary" type="button">Copy Address</button>
            <button id="wallet-popup-analyze" class="fx-button" type="button">Analyze Wallet</button>
            <a id="wallet-popup-solscan" class="fx-button secondary" href="#" target="_blank" rel="noopener noreferrer">Open in Solscan</a>
            <button id="wallet-popup-close" class="fx-button" type="button">Close</button>
          </div>
          <div id="wallet-popup-analysis" class="wallet-popup-analysis">Analysis not loaded.</div>
        </div>
      </div>
    `,
    scriptHtml: `<script>

    const svg = document.getElementById('graph')
    const meta = document.getElementById('meta')
    const walletInput = document.getElementById('wallet')
    const button = document.getElementById('load')
    const walletList = document.getElementById('wallet-list')
    const analysisSummary = document.getElementById('analysis-summary')
    const tokenHoldingsSection = document.getElementById('token-holdings-section')
    const tokenHoldingsList = document.getElementById('token-holdings-list')
    const followedWallets = document.getElementById('followed-wallets')
    const walletPopup = document.getElementById('wallet-popup')
    const walletPopupValue = document.getElementById('wallet-popup-value')
    const walletPopupCopy = document.getElementById('wallet-popup-copy')
    const walletPopupAnalyze = document.getElementById('wallet-popup-analyze')
    const walletPopupClose = document.getElementById('wallet-popup-close')
    const walletPopupSolscan = document.getElementById('wallet-popup-solscan')
    const walletPopupAnalysis = document.getElementById('wallet-popup-analysis')
    const graphCurrentQuery = document.getElementById('graph-current-query')
    const graphSummaryWallet = document.getElementById('graph-summary-wallet')
    const graphSummaryCoverage = document.getElementById('graph-summary-coverage')
    const graphSummaryCluster = document.getElementById('graph-summary-cluster')
    const graphSummaryAnalysis = document.getElementById('graph-summary-analysis')
    const retraceWalletInput = document.getElementById('retrace-wallet')
    const retraceMaxHopsInput = document.getElementById('retrace-max-hops')
    const retraceSigsInput = document.getElementById('retrace-sigs')
    const retraceMaxVisitedInput = document.getElementById('retrace-max-visited')
    const retraceFollowAllInput = document.getElementById('retrace-follow-all')
    const retraceFirstHopInput = document.getElementById('retrace-first-hop')
    const runDeepRetraceButton = document.getElementById('run-deep-retrace')
    const deepRetraceStatus = document.getElementById('deep-retrace-status')
    const deepRetraceResult = document.getElementById('deep-retrace-result')
    const deepRetraceHeuristics = document.getElementById('deep-retrace-heuristics')
    const retraceConfidenceBadge = document.getElementById('retrace-confidence-badge')
    const retraceHeuristicsMetrics = document.getElementById('retrace-heuristics-metrics')
    const retraceEvidenceCards = document.getElementById('retrace-evidence-cards')
    const deepRetraceRisk = document.getElementById('deep-retrace-risk')
    const retraceRiskBadge = document.getElementById('retrace-risk-badge')
    const retraceRiskGauge = document.getElementById('retrace-risk-gauge')
    const retraceRiskGaugeValue = document.getElementById('retrace-risk-gauge-value')
    const retraceRiskMetrics = document.getElementById('retrace-risk-metrics')
    const retraceRiskTimeline = document.getElementById('retrace-risk-timeline')
    let selectedWalletAddress = ''

    function getActiveWalletAddress() {
      const selected = selectedWalletAddress && selectedWalletAddress.trim()
      if (selected) return selected
      const currentQuery = walletInput && walletInput.value ? walletInput.value.trim() : ''
      return currentQuery
    }

    function syncWalletPopupActions() {
      const wallet = getActiveWalletAddress()
      const hasWallet = !!wallet

      if (walletPopupAnalyze) {
        walletPopupAnalyze.disabled = !hasWallet
      }

      if (walletPopupCopy) {
        walletPopupCopy.disabled = !hasWallet
      }

      if (walletPopupSolscan) {
        walletPopupSolscan.href = hasWallet
          ? 'https://solscan.io/account/' + encodeURIComponent(wallet)
          : '#'
        walletPopupSolscan.setAttribute('aria-disabled', hasWallet ? 'false' : 'true')
      }
    }

    function short(value) {
      if (!value || value.length < 10) return value
      return value.slice(0, 5) + '...' + value.slice(-4)
    }

    function formatSolAmount(value) {
      const amount = Number(value)
      if (!Number.isFinite(amount)) return '0'
      if (Math.abs(amount) >= 1000) return amount.toLocaleString(undefined, { maximumFractionDigits: 2 })
      return amount.toFixed(4)
    }

    function getConfidenceTier(confidence, detected) {
      if (!detected || confidence <= 0) {
        return { label: 'No signal', className: 'retrace-confidence-tier-none' }
      }
      if (confidence >= 75) {
        return { label: 'High confidence', className: 'retrace-confidence-tier-high' }
      }
      if (confidence >= 45) {
        return { label: 'Medium confidence', className: 'retrace-confidence-tier-medium' }
      }
      return { label: 'Low confidence', className: 'retrace-confidence-tier-low' }
    }

    function makeMetricPill(label, value) {
      const pill = document.createElement('span')
      pill.className = 'retrace-metric-pill'
      pill.textContent = label + ': ' + value
      return pill
    }

    function clampPercent(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return 0
      return Math.max(0, Math.min(100, Math.round(number)))
    }

    function getRiskBadgeConfig(level) {
      const normalized = typeof level === 'string' ? level.toUpperCase() : 'LOW'
      if (normalized === 'HIGH') {
        return { label: 'High degradation', className: 'retrace-risk-level-high', gaugeColor: '#d23b3b' }
      }
      if (normalized === 'MEDIUM') {
        return { label: 'Medium degradation', className: 'retrace-risk-level-medium', gaugeColor: '#deb131' }
      }
      return { label: 'Low degradation', className: 'retrace-risk-level-low', gaugeColor: '#2bb36a' }
    }

    function getBoundaryClass(boundary) {
      const normalized = typeof boundary === 'string' ? boundary.toUpperCase() : ''
      if (normalized === 'MIXER') return 'retrace-risk-event-boundary-mixer'
      if (normalized === 'EXCHANGE') return 'retrace-risk-event-boundary-exchange'
      if (normalized === 'CEX_DEPOSIT') return 'retrace-risk-event-boundary-cex_deposit'
      if (normalized === 'BRIDGE') return 'retrace-risk-event-boundary-bridge'
      return ''
    }

    function resetDeepRetraceRiskModel() {
      if (deepRetraceRisk) deepRetraceRisk.style.display = 'none'
      if (retraceRiskMetrics) retraceRiskMetrics.innerHTML = ''
      if (retraceRiskTimeline) retraceRiskTimeline.innerHTML = ''
      if (retraceRiskBadge) {
        retraceRiskBadge.className = 'retrace-risk-badge retrace-risk-level-low'
        retraceRiskBadge.textContent = 'Low degradation'
      }
      if (retraceRiskGauge) {
        retraceRiskGauge.style.background =
          'conic-gradient(#2bb36a 0%, #2bb36a 0%, rgba(255,255,255,.10) 0%)'
      }
      if (retraceRiskGaugeValue) {
        retraceRiskGaugeValue.textContent = '0%'
      }
    }

    function renderDeepRetraceRiskModel(model) {
      if (!deepRetraceRisk || !retraceRiskBadge || !retraceRiskGauge || !retraceRiskGaugeValue || !retraceRiskMetrics || !retraceRiskTimeline) {
        return
      }

      if (!model || typeof model !== 'object') {
        resetDeepRetraceRiskModel()
        return
      }

      const adjustedConfidence = clampPercent(model.adjustedConfidence)
      const baseConfidence = clampPercent(model.baseConfidence)
      const attenuation = Number.isFinite(Number(model.attenuation)) ? Number(model.attenuation) : 0
      const degradationLevel = typeof model.degradationLevel === 'string' ? model.degradationLevel : 'LOW'
      const boundariesCrossed = Array.isArray(model.boundariesCrossed) ? model.boundariesCrossed : []
      const events = Array.isArray(model.events) ? model.events : []
      const modelVersion = typeof model.modelVersion === 'string' ? model.modelVersion : 'unknown'

      const riskConfig = getRiskBadgeConfig(degradationLevel)
      retraceRiskBadge.className = 'retrace-risk-badge ' + riskConfig.className
      retraceRiskBadge.textContent = riskConfig.label

      retraceRiskGauge.style.background =
        'conic-gradient(' + riskConfig.gaugeColor + ' 0%, ' + riskConfig.gaugeColor + ' ' + adjustedConfidence + '%, rgba(255,255,255,.10) ' + adjustedConfidence + '%)'
      retraceRiskGaugeValue.textContent = adjustedConfidence + '%'

      retraceRiskMetrics.innerHTML = ''
      retraceRiskMetrics.appendChild(makeMetricPill('Base', String(baseConfidence)))
      retraceRiskMetrics.appendChild(makeMetricPill('Attenuation', String(attenuation)))
      retraceRiskMetrics.appendChild(makeMetricPill('Boundaries', String(boundariesCrossed.length)))
      retraceRiskMetrics.appendChild(makeMetricPill('Model', modelVersion))

      retraceRiskTimeline.innerHTML = ''
      const sortedEvents = [...events].sort((a, b) => {
        const ah = Number.isFinite(Number(a && a.hop)) ? Number(a.hop) : 0
        const bh = Number.isFinite(Number(b && b.hop)) ? Number(b.hop) : 0
        if (ah !== bh) return ah - bh
        const ai = Number.isFinite(Number(a && a.impact)) ? Number(a.impact) : 0
        const bi = Number.isFinite(Number(b && b.impact)) ? Number(b.impact) : 0
        return bi - ai
      })

      if (sortedEvents.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'retrace-risk-event-body'
        empty.textContent = 'No boundary events recorded in this retrace.'
        retraceRiskTimeline.appendChild(empty)
      } else {
        sortedEvents.forEach((event) => {
          const item = document.createElement('article')
          const boundaryClass = getBoundaryClass(event && event.boundary ? event.boundary : '')
          item.className = 'retrace-risk-event' + (boundaryClass ? ' ' + boundaryClass : '')

          const head = document.createElement('div')
          head.className = 'retrace-risk-event-head'

          const boundary = document.createElement('span')
          boundary.textContent = String(event.boundary || 'UNKNOWN') + ' @ hop ' + String(event.hop || 0)

          const impact = document.createElement('span')
          impact.textContent = '-' + String(Number.isFinite(Number(event.impact)) ? Number(event.impact) : 0)

          head.appendChild(boundary)
          head.appendChild(impact)

          const body = document.createElement('div')
          body.className = 'retrace-risk-event-body'
          const signature = event && event.signature ? short(String(event.signature)) : 'n/a'
          const wallet = event && event.wallet ? short(String(event.wallet)) : 'n/a'
          const reason = event && event.reason ? String(event.reason) : 'No reason provided.'
          body.textContent = 'Tx: ' + signature + ' | Wallet: ' + wallet + ' | ' + reason

          item.appendChild(head)
          item.appendChild(body)
          retraceRiskTimeline.appendChild(item)
        })
      }

      deepRetraceRisk.style.display = 'block'
    }

    function getEvidenceRuleConfig(code) {
      const normalized = code ? String(code) : 'UNKNOWN_RULE'
      if (normalized === 'REPEATED_EXCHANGE_TARGET') {
        return {
          severity: 'High',
          rank: 1,
          description: 'Repeated transfers to the same exchange wallet suggest deliberate deposit routing.',
        }
      }
      if (normalized === 'BURST_EXCHANGE_ACTIVITY') {
        return {
          severity: 'High',
          rank: 2,
          description: 'Clustered exchange transfers in a short window suggest liquidation/deposit behavior.',
        }
      }
      if (normalized === 'MULTI_EXCHANGE_SPLIT') {
        return {
          severity: 'Medium',
          rank: 3,
          description: 'Flow split across multiple exchange wallets may indicate distribution for exit.',
        }
      }
      if (normalized === 'ROUND_SOL_AMOUNTS') {
        return {
          severity: 'Low',
          rank: 4,
          description: 'Round SOL transfer sizing can indicate operational batching behavior.',
        }
      }
      if (normalized === 'DEPOSIT_MEMO_HINT') {
        return {
          severity: 'Medium',
          rank: 4,
          description: 'Memo usage on exchange-bound transfers can indicate custodial deposit formatting.',
        }
      }
      return {
        severity: 'Low',
        rank: 6,
        description: 'Custom evidence rule triggered. Review signatures and details for context.',
      }
    }

    function resetDeepRetraceHeuristics() {
      if (deepRetraceHeuristics) deepRetraceHeuristics.style.display = 'none'
      if (retraceHeuristicsMetrics) retraceHeuristicsMetrics.innerHTML = ''
      if (retraceEvidenceCards) retraceEvidenceCards.innerHTML = ''
      if (retraceConfidenceBadge) {
        retraceConfidenceBadge.className = 'retrace-confidence-badge retrace-confidence-tier-none'
        retraceConfidenceBadge.textContent = 'No signal'
      }
    }

    function renderDeepRetraceHeuristics(heuristics) {
      if (!deepRetraceHeuristics || !retraceConfidenceBadge || !retraceHeuristicsMetrics || !retraceEvidenceCards) {
        return
      }

      if (!heuristics || typeof heuristics !== 'object') {
        resetDeepRetraceHeuristics()
        return
      }

      const detected = heuristics.detected === true
      const confidence = Number.isFinite(Number(heuristics.confidence)) ? Number(heuristics.confidence) : 0
      const exchangeWalletCount = Number.isFinite(Number(heuristics.exchangeWalletCount))
        ? Number(heuristics.exchangeWalletCount)
        : 0
      const exchangeTransferCount = Number.isFinite(Number(heuristics.exchangeTransferCount))
        ? Number(heuristics.exchangeTransferCount)
        : 0
      const totalExchangeOutflowSol = Number.isFinite(Number(heuristics.totalExchangeOutflowSol))
        ? Number(heuristics.totalExchangeOutflowSol)
        : 0
      const evidence = Array.isArray(heuristics.evidence) ? heuristics.evidence : []
      const sortedEvidence = [...evidence].sort((a, b) => {
        const aCode = a && a.code ? String(a.code) : 'UNKNOWN_RULE'
        const bCode = b && b.code ? String(b.code) : 'UNKNOWN_RULE'
        const aConfig = getEvidenceRuleConfig(aCode)
        const bConfig = getEvidenceRuleConfig(bCode)

        if (aConfig.rank !== bConfig.rank) {
          return aConfig.rank - bConfig.rank
        }

        const aScore = a && Number.isFinite(Number(a.score)) ? Number(a.score) : 0
        const bScore = b && Number.isFinite(Number(b.score)) ? Number(b.score) : 0
        return bScore - aScore
      })

      const tier = getConfidenceTier(confidence, detected)
      retraceConfidenceBadge.className = 'retrace-confidence-badge ' + tier.className
      retraceConfidenceBadge.textContent = tier.label + ' (' + confidence + '%)'

      retraceHeuristicsMetrics.innerHTML = ''
      retraceHeuristicsMetrics.appendChild(makeMetricPill('Exchange wallets', String(exchangeWalletCount)))
      retraceHeuristicsMetrics.appendChild(makeMetricPill('Exchange transfers', String(exchangeTransferCount)))
      retraceHeuristicsMetrics.appendChild(makeMetricPill('SOL outflow', formatSolAmount(totalExchangeOutflowSol) + ' SOL'))

      retraceEvidenceCards.innerHTML = ''
      if (sortedEvidence.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'retrace-evidence-card retrace-evidence-meta'
        empty.textContent = 'No evidence rules triggered for this retrace.'
        retraceEvidenceCards.appendChild(empty)
      } else {
        sortedEvidence.forEach((item) => {
          const card = document.createElement('article')
          card.className = 'retrace-evidence-card'

          const head = document.createElement('div')
          head.className = 'retrace-evidence-head'

          const code = document.createElement('span')
          code.className = 'retrace-evidence-code'
          code.textContent = item && item.code ? String(item.code) : 'UNKNOWN_RULE'

          const score = document.createElement('span')
          score.className = 'retrace-evidence-score'
          score.textContent = '+' + (item && Number.isFinite(Number(item.score)) ? Number(item.score) : 0)

          const ruleConfig = getEvidenceRuleConfig(code.textContent)

          head.appendChild(code)
          head.appendChild(score)

          const summary = document.createElement('div')
          summary.className = 'retrace-evidence-summary'
          summary.textContent = item && item.summary ? String(item.summary) : 'No summary available.'

          const description = document.createElement('div')
          description.className = 'retrace-evidence-meta'
          description.textContent = 'Severity: ' + ruleConfig.severity + ' | ' + ruleConfig.description

          const meta = document.createElement('div')
          meta.className = 'retrace-evidence-meta'
          const signatureCount = item && Array.isArray(item.signatures) ? item.signatures.length : 0
          const walletCount = item && Array.isArray(item.wallets) ? item.wallets.length : 0
          meta.textContent = 'Signatures: ' + signatureCount + ' | Wallets: ' + walletCount

          card.appendChild(head)
          card.appendChild(summary)
          card.appendChild(description)
          card.appendChild(meta)

          if (item && item.details && typeof item.details === 'object') {
            const detailKeys = Object.keys(item.details)
            if (detailKeys.length > 0) {
              const detailLine = document.createElement('div')
              detailLine.className = 'retrace-evidence-meta'
              detailLine.textContent = detailKeys
                .slice(0, 4)
                .map((key) => key + ': ' + String(item.details[key]))
                .join(' | ')
              card.appendChild(detailLine)
            }
          }

          retraceEvidenceCards.appendChild(card)
        })
      }

      deepRetraceHeuristics.style.display = 'block'
    }

    function setCurrentQuery(wallet) {
      if (!graphCurrentQuery) return
      graphCurrentQuery.textContent = wallet ? wallet : 'none'
      syncWalletPopupActions()
    }

    function formatTokenAmount(amount, decimals) {
      if (amount === 0) return '0'
      if (amount < 0.0001) return '<0.0001'
      if (amount >= 1e9) return (amount / 1e9).toFixed(2) + 'B'
      if (amount >= 1e6) return (amount / 1e6).toFixed(2) + 'M'
      if (amount >= 1e3) return (amount / 1e3).toFixed(2) + 'K'
      return amount.toFixed(decimals > 4 ? 4 : decimals)
    }

    async function loadTokenHoldings(wallet) {
      if (!tokenHoldingsSection || !tokenHoldingsList) return
      tokenHoldingsSection.style.display = 'block'
      tokenHoldingsList.textContent = 'Loading tokens...'
      try {
        const res = await fetch('/api/graph/tokens/' + encodeURIComponent(wallet))
        if (!res.ok) {
          tokenHoldingsList.textContent = 'Could not load token holdings.'
          return
        }
        const data = await res.json()
        const tokens = Array.isArray(data.tokens) ? data.tokens : []
        if (tokens.length === 0) {
          tokenHoldingsList.innerHTML = '<span style="color:#8ba4c0">No SPL token balances found.</span>'
          return
        }
        const rows = tokens.map(t => {
          const mintShort = t.mint ? t.mint.slice(0, 6) + '..' + t.mint.slice(-4) : '?'
          const link = 'https://solscan.io/token/' + encodeURIComponent(t.mint || '')
          return '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(100,140,180,0.1)">'
            + '<a href="' + link + '" target="_blank" rel="noopener noreferrer" class="mono" style="color:#81c4ff;font-size:0.82rem;text-decoration:none">' + mintShort + '</a>'
            + '<span class="mono" style="font-size:0.82rem;color:#d7e6ff">' + formatTokenAmount(t.amount, t.decimals) + '</span>'
            + '</div>'
        }).join('')
        tokenHoldingsList.innerHTML = rows
      } catch {
        tokenHoldingsList.textContent = 'Token fetch failed.'
      }
    }

    function clearSvg() {
      while (svg.firstChild) svg.removeChild(svg.firstChild)
    }

    async function copyWalletAddress(address) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(address)
        } else {
          const input = document.createElement('textarea')
          input.value = address
          document.body.appendChild(input)
          input.select()
          document.execCommand('copy')
          document.body.removeChild(input)
        }
        meta.textContent = 'Copied wallet: ' + address
      } catch {
        meta.textContent = 'Could not copy wallet address from browser clipboard.'
      }
    }

    function openWalletPopup(address) {
      selectedWalletAddress = address
      walletPopupValue.textContent = address
      syncWalletPopupActions()
      walletPopupAnalysis.textContent = 'Analysis loading...'
      walletPopup.classList.add('active')
      loadWalletAnalysis(address, walletPopupAnalysis)
    }

    function closeWalletPopup() {
      walletPopup.classList.remove('active')
      selectedWalletAddress = ''
      syncWalletPopupActions()
    }

    async function loadWalletAnalysis(address, targetElement) {
      if (graphSummaryAnalysis) {
        graphSummaryAnalysis.textContent = 'Loading...'
      }
      try {
        const response = await fetch('/api/graph/analyze/' + encodeURIComponent(address))
        if (!response.ok) {
          targetElement.textContent = 'Analysis unavailable for this wallet right now.'
          if (graphSummaryAnalysis) {
            graphSummaryAnalysis.textContent = 'Unavailable'
          }
          return
        }

        const payload = await response.json()
        targetElement.textContent = payload.analysis || 'No analysis returned.'
        if (graphSummaryAnalysis) {
          graphSummaryAnalysis.textContent = 'Ready'
        }
      } catch {
        targetElement.textContent = 'Analysis request failed.'
        if (graphSummaryAnalysis) {
          graphSummaryAnalysis.textContent = 'Request failed'
        }
      }
    }

    function updateGraphSummary(data) {
      if (graphSummaryWallet) {
        graphSummaryWallet.textContent = data && data.wallet ? short(data.wallet) : 'Waiting for selection'
      }
      if (graphSummaryCoverage) {
        const nodes = Array.isArray(data?.nodes) ? data.nodes.length : 0
        const edges = Array.isArray(data?.edges) ? data.edges.length : 0
        graphSummaryCoverage.textContent = 'Nodes ' + nodes + ' | Edges ' + edges
      }
      if (graphSummaryCluster) {
        graphSummaryCluster.textContent = data?.cluster
          ? 'Score ' + data.cluster.score + ' | Risk ' + data.cluster.riskScore
          : 'No cluster found'
      }
    }

    function renderWalletList(data) {
      walletList.innerHTML = ''

      const sortedNodes = [...(data.nodes || [])].sort((a, b) => {
        if (a.id === data.wallet) return -1
        if (b.id === data.wallet) return 1
        return a.id.localeCompare(b.id)
      })

      sortedNodes.forEach((node) => {
        const chip = document.createElement('button')
        chip.className = 'wallet-chip'
        chip.type = 'button'
        chip.title = 'Click to view/copy full wallet address'
        chip.textContent = (node.id === data.wallet ? '[PRIMARY] ' : '') + node.label
        chip.addEventListener('click', () => openWalletPopup(node.label))
        walletList.appendChild(chip)
      })
    }

    function renderFollowedWallets(wallets) {
      if (!followedWallets) return
      followedWallets.innerHTML = ''

      if (!Array.isArray(wallets) || wallets.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'meta'
        empty.textContent = 'No followed wallets available yet. Add tracked/source wallets to auto-populate this graph view.'
        followedWallets.appendChild(empty)
        return
      }

      wallets.slice(0, 30).forEach((entry) => {
        const wallet = (entry && entry.wallet) ? String(entry.wallet) : ''
        if (!wallet) return
        const sourceList = Array.isArray(entry.sources) ? entry.sources.map((source) => String(source)) : []
        const sources = sourceList.length > 0 ? sourceList.join(' + ') : 'followed'
        const chip = document.createElement('button')
        chip.className = 'wallet-chip'
        if (sourceList.includes('tracked') && sourceList.includes('source')) {
          chip.classList.add('chip-both')
        } else if (sourceList.includes('source')) {
          chip.classList.add('chip-source')
        } else {
          chip.classList.add('chip-tracked')
        }
        chip.type = 'button'
        chip.title = 'Load graph for ' + wallet
        chip.textContent = short(wallet) + ' [' + sources + ']'
        chip.addEventListener('click', () => {
          walletInput.value = wallet
          loadGraph()
        })
        followedWallets.appendChild(chip)
      })
    }

    async function loadFollowedWallets() {
      try {
        const response = await fetch('/api/graph/followed-wallets')
        if (!response.ok) {
          return []
        }
        const payload = await response.json()
        const wallets = Array.isArray(payload.wallets) ? payload.wallets : []
        renderFollowedWallets(wallets)
        return wallets
      } catch {
        return []
      }
    }

    function mk(tag, attrs = {}) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)))
      return el
    }

    function draw(data) {
      clearSvg()
      const cx = 450
      const cy = 215
      const radius = 150
      const nodes = data.nodes || []
      const edges = data.edges || []

      const positions = new Map()
      nodes.forEach((node, idx) => {
        const angle = (Math.PI * 2 * idx) / Math.max(1, nodes.length)
        positions.set(node.id, {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
          node,
        })
      })

      edges.forEach((edge) => {
        const from = positions.get(edge.from)
        const to = positions.get(edge.to)
        if (!from || !to) return
        svg.appendChild(mk('line', {
          x1: from.x,
          y1: from.y,
          x2: to.x,
          y2: to.y,
          stroke: '#d8cbb6',
          'stroke-width': 1.6,
        }))
      })

      nodes.forEach((node) => {
        const point = positions.get(node.id)
        const isPrimary = node.id === data.wallet
        const fill = isPrimary ? '#b14a2c' : node.inCluster ? '#007a6e' : '#7a6f63'

        svg.appendChild(mk('circle', {
          cx: point.x,
          cy: point.y,
          r: isPrimary ? 11 : 8,
          fill,
        }))

        const circle = mk('circle', {
          cx: point.x,
          cy: point.y,
          r: isPrimary ? 15 : 12,
          fill: 'transparent',
          style: 'cursor:pointer;',
        })
        circle.addEventListener('click', () => openWalletPopup(node.label))
        svg.appendChild(circle)

        const label = mk('text', {
          x: point.x,
          y: point.y - 14,
          'text-anchor': 'middle',
          'font-size': 11,
          fill: '#1f1a14',
          style: 'cursor:pointer; user-select:none;',
        })
        label.textContent = short(node.label)
        label.setAttribute('title', 'Click to view/copy wallet address')
        label.addEventListener('click', () => openWalletPopup(node.label))
        svg.appendChild(label)
      })

      if (edges.length === 0) {
        const hint = mk('text', {
          x: cx,
          y: 390,
          'text-anchor': 'middle',
          'font-size': 12,
          fill: '#5f5446',
        })
        hint.textContent =
          nodes.length <= 1
            ? 'No flow/cluster links found yet for this wallet. Try /flag_wallet or /cluster to enrich data.'
            : 'Showing inferred cluster links. No recorded fund-flow edges for this wallet yet.'
        svg.appendChild(hint)
      }
    }

    async function loadGraph() {
      const wallet = walletInput.value.trim()
      if (!wallet) {
        meta.textContent = 'Enter a wallet to load graph.'
        setCurrentQuery('')
        updateGraphSummary(null)
        clearSvg()
        return
      }

      setCurrentQuery(wallet)
      if (retraceWalletInput) {
        retraceWalletInput.value = wallet
      }
      meta.textContent = 'Loading graph...'
      if (graphSummaryWallet) {
        graphSummaryWallet.textContent = short(wallet)
      }
      if (graphSummaryCoverage) {
        graphSummaryCoverage.textContent = 'Loading...'
      }
      if (graphSummaryCluster) {
        graphSummaryCluster.textContent = 'Loading...'
      }
      const res = await fetch('/api/graph/' + encodeURIComponent(wallet))
      if (!res.ok) {
        meta.textContent = 'Failed to load graph data.'
        if (graphSummaryCoverage) {
          graphSummaryCoverage.textContent = 'Load failed'
        }
        if (graphSummaryCluster) {
          graphSummaryCluster.textContent = 'Unavailable'
        }
        clearSvg()
        return
      }

      const data = await res.json()
      const clusterSummary = data.cluster
        ? 'cluster score ' + data.cluster.score + ', risk ' + data.cluster.riskScore
        : 'no cluster found'

      meta.textContent = 'Nodes: ' + data.nodes.length + ' | Edges: ' + data.edges.length + ' | ' + clusterSummary
  updateGraphSummary(data)
      draw(data)
      renderWalletList(data)
      analysisSummary.textContent = 'Analysis loading...'
      loadWalletAnalysis(wallet, analysisSummary)
      loadTokenHoldings(wallet)
      history.replaceState({}, '', '/graph/' + encodeURIComponent(wallet))
    }

    async function runDeepRetrace() {
      const wallet = retraceWalletInput && retraceWalletInput.value
        ? retraceWalletInput.value.trim()
        : walletInput.value.trim()

      if (!wallet) {
        if (deepRetraceStatus) deepRetraceStatus.textContent = 'Wallet is required.'
        return
      }

      const maxHops = Number(retraceMaxHopsInput && retraceMaxHopsInput.value ? retraceMaxHopsInput.value : 8)
      const signaturesPerHop = Number(retraceSigsInput && retraceSigsInput.value ? retraceSigsInput.value : 20)
      const maxVisitedWallets = Number(
        retraceMaxVisitedInput && retraceMaxVisitedInput.value ? retraceMaxVisitedInput.value : 500,
      )
      const followAllRecipients = !!(retraceFollowAllInput && retraceFollowAllInput.checked)
      const traceAllFirstHopRecipients = !!(retraceFirstHopInput && retraceFirstHopInput.checked)

      if (deepRetraceStatus) deepRetraceStatus.textContent = 'Running deep retrace...'
      if (deepRetraceResult) deepRetraceResult.textContent = 'Loading...'
      resetDeepRetraceHeuristics()
      resetDeepRetraceRiskModel()
      if (runDeepRetraceButton) runDeepRetraceButton.disabled = true

      try {
        const res = await fetch('/api/graph/retrace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet,
            maxHops,
            signaturesPerHop,
            maxVisitedWallets,
            followAllRecipients,
            traceAllFirstHopRecipients,
          }),
        })

        const payload = await res.json().catch(() => ({ message: 'Invalid response' }))
        if (!res.ok) {
          if (deepRetraceStatus) deepRetraceStatus.textContent = 'Deep retrace failed.'
          if (deepRetraceResult) deepRetraceResult.textContent = JSON.stringify(payload, null, 2)
          return
        }

        if (deepRetraceStatus) {
          const stepCount = Array.isArray(payload?.trace?.steps) ? payload.trace.steps.length : 0
          deepRetraceStatus.textContent = 'Completed. Steps: ' + stepCount
        }
        renderDeepRetraceHeuristics(payload?.trace?.cexDepositHeuristics)
        renderDeepRetraceRiskModel(payload?.trace?.riskConfidenceModel)
        if (deepRetraceResult) deepRetraceResult.textContent = JSON.stringify(payload, null, 2)
      } catch (error) {
        if (deepRetraceStatus) deepRetraceStatus.textContent = 'Deep retrace request failed.'
        resetDeepRetraceHeuristics()
        resetDeepRetraceRiskModel()
        if (deepRetraceResult) {
          const message = error && error.message ? error.message : String(error)
          deepRetraceResult.textContent = JSON.stringify({ message }, null, 2)
        }
      } finally {
        if (runDeepRetraceButton) runDeepRetraceButton.disabled = false
      }
    }

    button.addEventListener('click', loadGraph)
    if (runDeepRetraceButton) {
      runDeepRetraceButton.addEventListener('click', runDeepRetrace)
    }
    walletPopupCopy.addEventListener('click', () => {
      const wallet = getActiveWalletAddress()
      if (wallet) {
        copyWalletAddress(wallet)
      }
    })
    walletPopupAnalyze.addEventListener('click', () => {
      const wallet = getActiveWalletAddress()
      if (wallet) {
        walletPopupAnalysis.textContent = 'Analysis loading...'
        loadWalletAnalysis(wallet, walletPopupAnalysis)
      }
    })
    walletPopupSolscan.addEventListener('click', (e) => {
      const wallet = getActiveWalletAddress()
      if (!wallet) {
        e.preventDefault()
        meta.textContent = 'Select or load a wallet first.'
        return
      }
      walletPopupSolscan.href = 'https://solscan.io/account/' + encodeURIComponent(wallet)
    })
    walletPopupClose.addEventListener('click', closeWalletPopup)
    walletInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadGraph()
    })
    ;(async function bootstrap() {
      const followed = await loadFollowedWallets()
      if (!walletInput.value.trim() && followed.length > 0 && followed[0] && followed[0].wallet) {
        walletInput.value = String(followed[0].wallet)
      }
      setCurrentQuery(walletInput.value.trim())
      syncWalletPopupActions()
      loadGraph()
    })()
  </script>`,
  })
}

type MixerRouteAuditGroup = {
  sourceWallet: string
  latestTraceAt: string | null
  mixerWallets: string[]
  downstreamWallets: string[]
}

function parseDateQuery(value: unknown, endOfDay = false): Date | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined

  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? new Date(`${trimmed}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
    : new Date(trimmed)

  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function getMixerRouteFilters(req: Request): {
  sourceWallet?: string
  mixerWallet?: string
  startDate?: Date
  endDate?: Date
} {
  const sourceWallet = typeof req.query.sourceWallet === 'string' ? req.query.sourceWallet.trim() : ''
  const mixerWallet = typeof req.query.mixerWallet === 'string' ? req.query.mixerWallet.trim() : ''

  return {
    sourceWallet: sourceWallet || undefined,
    mixerWallet: mixerWallet || undefined,
    startDate: parseDateQuery(req.query.startDate),
    endDate: parseDateQuery(req.query.endDate, true),
  }
}

function buildMixerRouteAuditPayload(groupedBySourceWallet: MixerRouteAuditGroup[]) {
  const totalGroups = groupedBySourceWallet.length
  const mixerWallets = Array.from(new Set(groupedBySourceWallet.flatMap((group) => group.mixerWallets))).sort()
  const downstreamWallets = Array.from(
    new Set(groupedBySourceWallet.flatMap((group) => group.downstreamWallets)),
  ).sort()

  return {
    groupedBySourceWallet,
    summary: {
      totalSourceWalletCount: totalGroups,
      sourceWalletCount: groupedBySourceWallet.length,
      mixerWalletCount: mixerWallets.length,
      downstreamWalletCount: downstreamWallets.length,
      mixerWallets,
      downstreamWallets,
    },
  }
}

function buildPaginatedMixerRouteAuditPayload(
  groupedBySourceWallet: MixerRouteAuditGroup[],
  page: number,
  pageSize: number,
) {
  const safePageSize = Math.max(1, Math.min(100, Math.floor(pageSize)))
  const totalGroups = groupedBySourceWallet.length
  const totalPages = Math.max(1, Math.ceil(totalGroups / safePageSize))
  const safePage = Math.max(1, Math.min(totalPages, Math.floor(page)))
  const startIndex = (safePage - 1) * safePageSize
  const pagedGroups = groupedBySourceWallet.slice(startIndex, startIndex + safePageSize)
  const payload = buildMixerRouteAuditPayload(pagedGroups) as {
    groupedBySourceWallet: MixerRouteAuditGroup[]
    summary: Record<string, unknown>
  }

  return {
    ...payload,
    summary: {
      ...payload.summary,
      totalSourceWalletCount: totalGroups,
      sourceWalletCount: pagedGroups.length,
    },
    pagination: {
      page: safePage,
      pageSize: safePageSize,
      totalPages,
      totalGroups,
      hasPreviousPage: safePage > 1,
      hasNextPage: safePage < totalPages,
    },
  }
}

function parsePositiveIntQuery(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.min(max, Math.floor(parsed)))
}

function csvCell(value: unknown): string {
  const stringValue = value == null ? '' : String(value)
  return `"${stringValue.replace(/"/g, '""')}"`
}

function buildMixerRouteAuditCsv(groupedBySourceWallet: MixerRouteAuditGroup[]): string {
  const header = [
    'sourceWallet',
    'latestTraceAt',
    'mixerWalletCount',
    'downstreamWalletCount',
    'mixerWallets',
    'downstreamWallets',
  ]
  const rows = groupedBySourceWallet.map((group) => [
    csvCell(group.sourceWallet),
    csvCell(group.latestTraceAt || ''),
    csvCell(group.mixerWallets.length),
    csvCell(group.downstreamWallets.length),
    csvCell(group.mixerWallets.join(' | ')),
    csvCell(group.downstreamWallets.join(' | ')),
  ])

  return [header.map(csvCell).join(','), ...rows.map((row) => row.join(','))].join('\n')
}

function renderMixerRoutesDashboard(): string {
  return renderFuturisticPage({
    title: 'FoilOps Mixer Route Audit',
    activeNav: 'scam',
    headerActionsHtml:
      '<form class="logout-form" method="post" action="/logout"><button class="fx-button" type="submit">Logout</button></form>',
    heroHtml: `
      <section class="topbar">
        <div class="topbar-copy">
          <p class="fx-eyebrow">Mixer exposure map</p>
          <h1>Mixer Route Audit</h1>
          <p class="fx-lead">Review every flagged source wallet that touched a mixer, inspect downstream recipients after mixer hops, filter by wallet and date, and export grouped audit rows as CSV.</p>
        </div>
        <div class="card" style="min-width:300px">
          <p class="eyebrow">Exports</p>
          <div class="big" id="mixer-route-source-count">0</div>
          <p><span id="mixer-route-mixer-count">0</span> mixer wallets and <span id="mixer-route-downstream-count">0</span> downstream wallets in the current filtered view.</p>
        </div>
      </section>
    `,
    extraStyles:
      '.mixer-toolbar { display:grid; grid-template-columns: repeat(5, minmax(0, 1fr)) auto auto; gap:12px; align-items:end; } .mixer-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:14px; } .mixer-card { border:1px solid rgba(255,90,122,.22); } .mixer-lists { display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:12px; } .mixer-list { border:1px solid rgba(255,255,255,.08); border-radius:14px; padding:12px; background: rgba(0,0,0,.18); min-height: 150px; } .mixer-list h3 { margin:0 0 8px; font-size:.95rem; display:flex; justify-content:space-between; gap:10px; align-items:center; } .mixer-wallet-row { display:inline-flex; align-items:center; gap:6px; margin:0 8px 8px 0; position:relative; } .mixer-wallet-chip { display:inline-flex; padding:6px 10px; border-radius:999px; border:1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.03); color:#f2dede; font-size:.76rem; word-break:break-all; text-decoration:none; } .mixer-wallet-copy { border:1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.04); color:#f8dede; border-radius:999px; padding:5px 8px; font-size:.72rem; } .mixer-wallet-copy:hover, .mixer-summary-card.is-clickable:hover, .mixer-bulk-actions .fx-button:hover { border-color: rgba(255,119,68,.4); background: rgba(255,119,68,.08); } .mixer-copy-toast { position:absolute; top:-26px; right:0; padding:3px 8px; border-radius:999px; background: rgba(255,119,68,.95); color:#160b08; font-size:.68rem; font-weight:700; pointer-events:none; opacity:0; transform: translateY(4px); transition: opacity .16s ease, transform .16s ease; } .mixer-copy-toast.is-visible { opacity:1; transform: translateY(0); } .mixer-meta { color:#caa; font-size:.82rem; } .mixer-summary-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:12px; margin-top:12px; } .mixer-summary-card { border:1px solid rgba(255,255,255,.08); border-radius:16px; padding:14px; background: rgba(0,0,0,.16); } .mixer-summary-card.is-clickable { cursor:pointer; } .mixer-summary-card.is-active { border-color: rgba(255,119,68,.42); box-shadow: 0 0 0 1px rgba(255,119,68,.18) inset; } .mixer-card-header { display:flex; justify-content:space-between; gap:10px; align-items:flex-start; } .mixer-header-actions { display:inline-flex; gap:6px; align-items:center; flex-wrap:wrap; position:relative; } .mixer-bulk-actions { display:flex; gap:10px; align-items:center; flex-wrap:wrap; } .mixer-bulk-count { display:inline-flex; align-items:center; justify-content:center; min-width:42px; padding:5px 10px; border-radius:999px; border:1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.05); color:#f6d7cf; font-size:.78rem; } .mixer-cap-label { display:inline-flex; align-items:center; gap:8px; color:#f6d7cf; font-size:.78rem; } .mixer-cap-label input { width:82px; } .mixer-table-empty { color:#caa; } @media (max-width: 1120px) { .mixer-toolbar { grid-template-columns: repeat(2, minmax(0, 1fr)); } } @media (max-width: 720px) { .mixer-toolbar, .mixer-lists { grid-template-columns: 1fr; } }',
    contentHtml: `
      <section class="section control-shell">
        <div class="section-header">
          <div class="section-header-copy">
            <p class="fx-eyebrow">Filter set</p>
            <h2>Scoped audit query</h2>
            <p class="section-subtitle">Use partial wallet matches and a trace-date window to tighten the grouped mixer route view before exporting.</p>
          </div>
        </div>
        <form id="mixer-route-filter-form" class="mixer-toolbar">
          <label>Source wallet
            <input id="filter-source-wallet" name="sourceWallet" type="text" placeholder="Partial source wallet" />
          </label>
          <label>Mixer or downstream wallet
            <input id="filter-mixer-wallet" name="mixerWallet" type="text" placeholder="Partial mixer or recipient wallet" />
          </label>
          <label>Start date
            <input id="filter-start-date" name="startDate" type="date" />
          </label>
          <label>End date
            <input id="filter-end-date" name="endDate" type="date" />
          </label>
          <button class="fx-button primary" type="submit">Apply Filters</button>
          <button class="fx-button secondary" id="mixer-route-clear" type="button">Clear</button>
          <a class="fx-button secondary" id="mixer-route-export-json" href="/api/scam-wallets/mixer-routes/export?format=json">Export JSON</a>
          <a class="fx-button secondary" id="mixer-route-export-csv" href="/api/scam-wallets/mixer-routes/export?format=csv">Export CSV</a>
        </form>
        <div id="mixer-route-status" class="control-status">Loading mixer route audit...</div>
      </section>
      <section class="section panel">
        <div class="section-header">
          <div class="section-header-copy">
            <p class="fx-eyebrow">Current totals</p>
            <h2>Filtered summary</h2>
          </div>
        </div>
        <div id="mixer-route-summary" class="mixer-summary-grid"></div>
      </section>
      <section class="section panel">
        <div class="section-header">
          <div class="section-header-copy">
            <p class="fx-eyebrow">Grouped output</p>
            <h2>Source wallets and their mixer paths</h2>
          </div>
          <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
            <div class="mixer-bulk-actions">
              <span class="mixer-bulk-count" id="mixer-route-bulk-count">0 targets</span>
              <label class="mixer-cap-label">Tab cap
                <input id="mixer-route-bulk-tab-cap" type="number" min="1" max="100" step="1" value="25" />
              </label>
              <button class="fx-button secondary" id="mixer-route-bulk-copy" type="button">Copy View Wallets</button>
              <button class="fx-button secondary" id="mixer-route-source-export-json" type="button">Export Source JSON</button>
              <button class="fx-button secondary" id="mixer-route-source-export-csv" type="button">Export Source CSV</button>
              <button class="fx-button secondary" id="mixer-route-bulk-export-json" type="button">Export View JSON</button>
              <button class="fx-button secondary" id="mixer-route-bulk-export-csv" type="button">Export View CSV</button>
              <button class="fx-button secondary" id="mixer-route-bulk-open" type="button">Open View As Graph Tabs</button>
            </div>
            <label>Rows per page
              <select id="mixer-route-page-size">
                <option value="10">10</option>
                <option value="25" selected>25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </label>
            <div id="mixer-route-pagination-meta" class="mixer-meta">Page 1 of 1</div>
            <button class="fx-button secondary" id="mixer-route-prev" type="button">Previous</button>
            <button class="fx-button secondary" id="mixer-route-next" type="button">Next</button>
          </div>
        </div>
        <div id="mixer-route-results" class="mixer-grid"></div>
      </section>
    `,
    scriptHtml: `<script>
      const filterForm = document.getElementById('mixer-route-filter-form')
      const sourceInput = document.getElementById('filter-source-wallet')
      const mixerInput = document.getElementById('filter-mixer-wallet')
      const startInput = document.getElementById('filter-start-date')
      const endInput = document.getElementById('filter-end-date')
      const clearButton = document.getElementById('mixer-route-clear')
      const exportJsonLink = document.getElementById('mixer-route-export-json')
      const exportCsvLink = document.getElementById('mixer-route-export-csv')
      const pageSizeInput = document.getElementById('mixer-route-page-size')
      const bulkCountEl = document.getElementById('mixer-route-bulk-count')
      const bulkTabCapInput = document.getElementById('mixer-route-bulk-tab-cap')
      const bulkCopyButton = document.getElementById('mixer-route-bulk-copy')
      const sourceExportJsonButton = document.getElementById('mixer-route-source-export-json')
      const sourceExportCsvButton = document.getElementById('mixer-route-source-export-csv')
      const bulkExportJsonButton = document.getElementById('mixer-route-bulk-export-json')
      const bulkExportCsvButton = document.getElementById('mixer-route-bulk-export-csv')
      const bulkOpenButton = document.getElementById('mixer-route-bulk-open')
      const prevButton = document.getElementById('mixer-route-prev')
      const nextButton = document.getElementById('mixer-route-next')
      const paginationMeta = document.getElementById('mixer-route-pagination-meta')
      const statusEl = document.getElementById('mixer-route-status')
      const summaryEl = document.getElementById('mixer-route-summary')
      const resultsEl = document.getElementById('mixer-route-results')
      const sourceCountEl = document.getElementById('mixer-route-source-count')
      const mixerCountEl = document.getElementById('mixer-route-mixer-count')
      const downstreamCountEl = document.getElementById('mixer-route-downstream-count')
      const BULK_OPEN_CONFIRM_THRESHOLD = 10
      const DEFAULT_BULK_OPEN_CAP = 25
      let currentPage = 1
      let currentView = 'all'
      let currentBulkWallets = []
      let currentSourceWallets = []

      function getStateFromUrl() {
        const params = new URLSearchParams(window.location.search)
        const sourceWallet = params.get('sourceWallet') || ''
        const mixerWallet = params.get('mixerWallet') || ''
        const startDate = params.get('startDate') || ''
        const endDate = params.get('endDate') || ''
        const page = Math.max(1, Number(params.get('page') || '1'))
        const pageSize = params.get('pageSize') || '25'
        const tabCap = params.get('tabCap') || String(DEFAULT_BULK_OPEN_CAP)
        const view = params.get('view') || 'all'
        return { sourceWallet, mixerWallet, startDate, endDate, page, pageSize, tabCap, view }
      }

      function applyStateFromUrl() {
        const state = getStateFromUrl()
        sourceInput.value = state.sourceWallet
        mixerInput.value = state.mixerWallet
        startInput.value = state.startDate
        endInput.value = state.endDate
        pageSizeInput.value = ['10', '25', '50', '100'].includes(state.pageSize) ? state.pageSize : '25'
        bulkTabCapInput.value = String(Math.max(1, Math.min(100, Number(state.tabCap) || DEFAULT_BULK_OPEN_CAP)))
        currentPage = state.page
        currentView = ['all', 'mixer', 'downstream'].includes(state.view) ? state.view : 'all'
      }

      function persistStateToUrl() {
        const params = new URLSearchParams()
        if (sourceInput.value.trim()) params.set('sourceWallet', sourceInput.value.trim())
        if (mixerInput.value.trim()) params.set('mixerWallet', mixerInput.value.trim())
        if (startInput.value) params.set('startDate', startInput.value)
        if (endInput.value) params.set('endDate', endInput.value)
        if (currentPage > 1) params.set('page', String(currentPage))
        if ((pageSizeInput.value || '25') !== '25') params.set('pageSize', String(pageSizeInput.value || '25'))
        if ((bulkTabCapInput.value || String(DEFAULT_BULK_OPEN_CAP)) !== String(DEFAULT_BULK_OPEN_CAP)) params.set('tabCap', String(bulkTabCapInput.value || DEFAULT_BULK_OPEN_CAP))
        if (currentView !== 'all') params.set('view', currentView)
        const nextUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '')
        window.history.replaceState(null, '', nextUrl)
      }

      function escapeHtml(value) {
        return String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;')
      }

      function buildQueryString() {
        const params = new URLSearchParams()
        if (sourceInput.value.trim()) params.set('sourceWallet', sourceInput.value.trim())
        if (mixerInput.value.trim()) params.set('mixerWallet', mixerInput.value.trim())
        if (startInput.value) params.set('startDate', startInput.value)
        if (endInput.value) params.set('endDate', endInput.value)
        params.set('page', String(currentPage))
        params.set('pageSize', String(pageSizeInput.value || '25'))
        return params.toString()
      }

      function updateExportLink() {
        const query = buildQueryString()
        exportJsonLink.href = '/api/scam-wallets/mixer-routes/export?format=json' + (query ? '&' + query : '')
        exportCsvLink.href = '/api/scam-wallets/mixer-routes/export?format=csv' + (query ? '&' + query : '')
      }

      function renderSummary(payload) {
        const summary = payload.summary || {}
        sourceCountEl.textContent = String(summary.totalSourceWalletCount || summary.sourceWalletCount || 0)
        mixerCountEl.textContent = String(summary.mixerWalletCount || 0)
        downstreamCountEl.textContent = String(summary.downstreamWalletCount || 0)

        summaryEl.innerHTML = [
          ['Matched source wallets', summary.totalSourceWalletCount || summary.sourceWalletCount || 0, 'all'],
          ['Shown this page', summary.sourceWalletCount || 0, 'all'],
          ['Mixer wallets', summary.mixerWalletCount || 0, 'mixer'],
          ['Downstream wallets', summary.downstreamWalletCount || 0, 'downstream'],
        ].map(([label, value, view]) => {
          const activeClass = currentView === view ? ' is-active' : ''
          const clickableClass = view === 'all' && label === 'Shown this page' ? '' : ' is-clickable'
          const attrs = view === 'all' && label === 'Shown this page' ? '' : ' data-view="' + escapeHtml(view) + '"'
          return '<article class="mixer-summary-card' + clickableClass + activeClass + '"' + attrs + '><p class="eyebrow">' + escapeHtml(label) + '</p><div class="big">' + escapeHtml(value) + '</div></article>'
        }).join('')

        summaryEl.querySelectorAll('[data-view]').forEach(function(card) {
          card.addEventListener('click', function() {
            const nextView = card.getAttribute('data-view') || 'all'
            currentView = nextView
            currentPage = 1
            persistStateToUrl()
            loadAudit()
          })
        })
      }

      function graphLink(wallet) {
        return '/graph/' + encodeURIComponent(wallet)
      }

      function getSubviewLabel() {
        if (currentView === 'mixer') return 'Mixer'
        if (currentView === 'downstream') return 'Downstream'
        return 'Visible'
      }

      function getSubviewKey() {
        return getSubviewLabel().toLowerCase()
      }

      function getSourceWalletsForCurrentPage(groups) {
        return Array.from(new Set(groups.map(function(group) { return group.sourceWallet }).filter(Boolean)))
      }

      function getBulkOpenCap() {
        const parsed = Number(bulkTabCapInput.value || String(DEFAULT_BULK_OPEN_CAP))
        return Math.max(1, Math.min(100, Number.isFinite(parsed) ? Math.floor(parsed) : DEFAULT_BULK_OPEN_CAP))
      }

      function getBulkExportBaseName() {
        const dateStamp = new Date().toISOString().slice(0, 10)
        return 'mixer-route-' + getSubviewKey() + '-wallets-page-' + currentPage + '-' + dateStamp
      }

      function getSourceExportBaseName() {
        const dateStamp = new Date().toISOString().slice(0, 10)
        return 'mixer-route-source-wallets-page-' + currentPage + '-' + dateStamp
      }

      function downloadBlob(content, fileName, type) {
        const blob = new Blob([content], { type })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = fileName
        document.body.appendChild(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(url)
      }

      function showCopyToast(target, message) {
        const host = target.closest('.mixer-wallet-row, .mixer-header-actions') || target.parentElement
        if (!host) return
        let toast = host.querySelector('.mixer-copy-toast')
        if (!toast) {
          toast = document.createElement('span')
          toast.className = 'mixer-copy-toast'
          host.appendChild(toast)
        }
        toast.textContent = message
        toast.classList.add('is-visible')
        window.clearTimeout(toast._hideTimer)
        toast._hideTimer = window.setTimeout(function() {
          toast.classList.remove('is-visible')
        }, 1200)
      }

      function getWalletsForCurrentView(groups) {
        const wallets = groups.flatMap((group) => {
          if (currentView === 'mixer') return Array.isArray(group.mixerWallets) ? group.mixerWallets : []
          if (currentView === 'downstream') return Array.isArray(group.downstreamWallets) ? group.downstreamWallets : []
          return [
            ...(Array.isArray(group.mixerWallets) ? group.mixerWallets : []),
            ...(Array.isArray(group.downstreamWallets) ? group.downstreamWallets : []),
          ]
        })

        return Array.from(new Set(wallets.filter(Boolean)))
      }

      function exportWalletSet(wallets, mode, fileNameBase, metadata) {
        if (mode === 'json') {
          downloadBlob(
            JSON.stringify({ ...metadata, count: wallets.length, wallets }, null, 2),
            fileNameBase + '.json',
            'application/json;charset=utf-8',
          )
          return
        }

        const csvLines = ['wallet', ...wallets.map(function(wallet) { return '"' + String(wallet).replace(/"/g, '""') + '"' })]
        downloadBlob(csvLines.join('\n'), fileNameBase + '.csv', 'text/csv;charset=utf-8')
      }

      function updateBulkActions() {
        const subviewEnabled = currentBulkWallets.length > 0 && currentView !== 'all'
        const sourceEnabled = currentSourceWallets.length > 0 && currentView === 'all'
        const activeCount = currentView === 'all' ? currentSourceWallets.length : currentBulkWallets.length
        const activeLabel = currentView === 'all' ? 'source targets' : getSubviewKey() + ' targets'
        bulkCountEl.textContent = activeCount + ' ' + activeLabel
        bulkCopyButton.disabled = !subviewEnabled
        sourceExportJsonButton.disabled = !sourceEnabled
        sourceExportCsvButton.disabled = !sourceEnabled
        bulkExportJsonButton.disabled = !subviewEnabled
        bulkExportCsvButton.disabled = !subviewEnabled
        bulkOpenButton.disabled = !subviewEnabled
        bulkCopyButton.textContent = subviewEnabled
          ? 'Copy ' + getSubviewLabel() + ' Wallets (' + currentBulkWallets.length + ')'
          : 'Copy View Wallets'
        sourceExportJsonButton.textContent = sourceEnabled
          ? 'Export Source JSON (' + currentSourceWallets.length + ')'
          : 'Export Source JSON'
        sourceExportCsvButton.textContent = sourceEnabled
          ? 'Export Source CSV (' + currentSourceWallets.length + ')'
          : 'Export Source CSV'
        bulkExportJsonButton.textContent = subviewEnabled
          ? 'Export ' + getSubviewLabel() + ' JSON'
          : 'Export View JSON'
        bulkExportCsvButton.textContent = subviewEnabled
          ? 'Export ' + getSubviewLabel() + ' CSV'
          : 'Export View CSV'
        bulkOpenButton.textContent = subviewEnabled
          ? 'Open ' + getSubviewLabel() + ' As Graph Tabs'
          : 'Open View As Graph Tabs'
        bulkCountEl.title = currentView === 'all'
          ? currentSourceWallets.length + ' unique source wallets are currently visible in the all view on this page'
          : currentBulkWallets.length + ' unique wallets are currently visible in the ' + getSubviewKey() + ' subview on this page'
        bulkTabCapInput.title = 'Maximum number of graph tabs to open at once for the current subview'
        bulkCopyButton.title = subviewEnabled
          ? 'Copy all wallets shown in the current ' + getSubviewLabel().toLowerCase() + ' subview'
          : 'Switch to Mixer wallets or Downstream wallets to bulk copy visible addresses'
        sourceExportJsonButton.title = sourceEnabled
          ? 'Export only the source wallets shown on this page as JSON'
          : 'Switch back to the all view to export visible source wallets'
        sourceExportCsvButton.title = sourceEnabled
          ? 'Export only the source wallets shown on this page as CSV'
          : 'Switch back to the all view to export visible source wallets'
        bulkExportJsonButton.title = subviewEnabled
          ? 'Export only the currently visible ' + getSubviewKey() + ' wallets on this page as JSON'
          : 'Switch to Mixer wallets or Downstream wallets to export visible wallet addresses'
        bulkExportCsvButton.title = subviewEnabled
          ? 'Export only the currently visible ' + getSubviewKey() + ' wallets on this page as CSV'
          : 'Switch to Mixer wallets or Downstream wallets to export visible wallet addresses'
        bulkOpenButton.title = subviewEnabled
          ? 'Open graph tabs for all wallets shown in the current ' + getSubviewLabel().toLowerCase() + ' subview'
          : 'Switch to Mixer wallets or Downstream wallets to open visible wallet graphs'
      }

      function copyButton(wallet) {
        return '<button class="mixer-wallet-copy" type="button" data-copy-wallet="' + escapeHtml(wallet) + '" title="Copy wallet address">Copy</button>'
      }

      function walletChips(wallets) {
        if (!Array.isArray(wallets) || wallets.length === 0) {
          return '<p class="mixer-table-empty">None in this filtered view.</p>'
        }
        return wallets.map((wallet) => '<span class="mixer-wallet-row"><a class="mixer-wallet-chip" href="' + graphLink(wallet) + '" title="Open graph for ' + escapeHtml(wallet) + '">' + escapeHtml(wallet) + '</a>' + copyButton(wallet) + '</span>').join('')
      }

      function renderPagination(payload) {
        const pagination = payload.pagination || {}
        const page = Number(pagination.page || 1)
        const totalPages = Number(pagination.totalPages || 1)
        paginationMeta.textContent = 'Page ' + page + ' of ' + totalPages
        prevButton.disabled = !pagination.hasPreviousPage
        nextButton.disabled = !pagination.hasNextPage
      }

      function renderResults(payload) {
        const groups = Array.isArray(payload.groupedBySourceWallet) ? payload.groupedBySourceWallet : []
        if (groups.length === 0) {
          currentBulkWallets = []
          currentSourceWallets = []
          updateBulkActions()
          resultsEl.innerHTML = '<article class="card"><p class="mixer-table-empty">No mixer-route groups matched the current filters.</p></article>'
          return
        }

        const displayGroups = groups.filter((group) => {
          if (currentView === 'mixer') return Array.isArray(group.mixerWallets) && group.mixerWallets.length > 0
          if (currentView === 'downstream') return Array.isArray(group.downstreamWallets) && group.downstreamWallets.length > 0
          return true
        })

        if (displayGroups.length === 0) {
          currentBulkWallets = []
          currentSourceWallets = []
          updateBulkActions()
          resultsEl.innerHTML = '<article class="card"><p class="mixer-table-empty">No groups matched the current subview.</p></article>'
          return
        }

        currentSourceWallets = getSourceWalletsForCurrentPage(displayGroups)
        currentBulkWallets = getWalletsForCurrentView(displayGroups)
        updateBulkActions()

        resultsEl.innerHTML = displayGroups.map((group) => {
          const latestTrace = group.latestTraceAt ? new Date(group.latestTraceAt).toLocaleString() : 'n/a'
          return '<article class="card mixer-card">'
            + '<header class="mixer-card-header"><div><h3><a href="' + graphLink(group.sourceWallet) + '">' + escapeHtml(group.sourceWallet) + '</a></h3><div class="mixer-header-actions">' + copyButton(group.sourceWallet) + '</div></div><span class="risk">' + escapeHtml(group.mixerWallets.length) + ' mixers</span></header>'
            + '<p class="mixer-meta"><strong>Latest trace:</strong> ' + escapeHtml(latestTrace) + ' • <strong>Downstream wallets:</strong> ' + escapeHtml(group.downstreamWallets.length) + '</p>'
            + '<div class="mixer-lists">'
            + (currentView !== 'downstream' ? '<section class="mixer-list"><h3><span>Mixer wallets touched</span><span class="mixer-meta">' + escapeHtml(group.mixerWallets.length) + '</span></h3>' + walletChips(group.mixerWallets) + '</section>' : '')
            + (currentView !== 'mixer' ? '<section class="mixer-list"><h3><span>Downstream after mixer hops</span><span class="mixer-meta">' + escapeHtml(group.downstreamWallets.length) + '</span></h3>' + walletChips(group.downstreamWallets) + '</section>' : '')
            + '</div>'
            + '</article>'
        }).join('')

        resultsEl.querySelectorAll('[data-copy-wallet]').forEach(function(button) {
          button.addEventListener('click', async function(event) {
            event.preventDefault()
            event.stopPropagation()
            const wallet = button.getAttribute('data-copy-wallet') || ''
            try {
              await navigator.clipboard.writeText(wallet)
              statusEl.textContent = 'Copied wallet: ' + wallet
              showCopyToast(button, 'Copied')
            } catch {
              statusEl.textContent = 'Failed to copy wallet: ' + wallet
              statusEl.classList.add('error')
              showCopyToast(button, 'Failed')
            }
          })
        })
      }

      async function loadAudit() {
        persistStateToUrl()
        updateExportLink()
        statusEl.textContent = 'Loading mixer route audit...'
        statusEl.classList.remove('error')

        try {
          const query = buildQueryString()
          const response = await fetch('/api/scam-wallets/mixer-routes' + (query ? '?' + query : ''))
          const payload = await response.json().catch(() => ({ message: 'Unexpected response' }))
          if (!response.ok) {
            throw new Error(payload.message || 'Failed to load mixer route audit')
          }

          renderSummary(payload)
          renderPagination(payload)
          renderResults(payload)
          statusEl.textContent = 'Loaded page ' + String(payload.pagination?.page || 1) + ' with ' + String(payload.summary?.sourceWalletCount || 0) + ' grouped source wallets shown in ' + currentView + ' view.'
        } catch (error) {
          summaryEl.innerHTML = ''
          resultsEl.innerHTML = '<article class="card"><p class="mixer-table-empty">Mixer route audit failed to load.</p></article>'
          paginationMeta.textContent = 'Page 1 of 1'
          prevButton.disabled = true
          nextButton.disabled = true
          statusEl.textContent = error.message || 'Failed to load mixer route audit.'
          statusEl.classList.add('error')
        }
      }

      filterForm.addEventListener('submit', function(event) {
        event.preventDefault()
        currentPage = 1
        loadAudit()
      })

      clearButton.addEventListener('click', function() {
        filterForm.reset()
        currentPage = 1
        loadAudit()
      })

      pageSizeInput.addEventListener('change', function() {
        currentPage = 1
        loadAudit()
      })

      bulkTabCapInput.addEventListener('change', function() {
        bulkTabCapInput.value = String(getBulkOpenCap())
        persistStateToUrl()
      })

      prevButton.addEventListener('click', function() {
        currentPage = Math.max(1, currentPage - 1)
        loadAudit()
      })

      nextButton.addEventListener('click', function() {
        currentPage += 1
        loadAudit()
      })

      bulkCopyButton.addEventListener('click', async function() {
        if (currentView === 'all' || currentBulkWallets.length === 0) {
          statusEl.textContent = 'Switch to Mixer wallets or Downstream wallets to bulk copy visible addresses.'
          statusEl.classList.add('error')
          return
        }

        statusEl.classList.remove('error')
        try {
          await navigator.clipboard.writeText(currentBulkWallets.join('\n'))
          statusEl.textContent = 'Copied ' + currentBulkWallets.length + ' ' + getSubviewLabel().toLowerCase() + ' wallets from this page.'
        } catch {
          statusEl.textContent = 'Failed to bulk copy visible wallets.'
          statusEl.classList.add('error')
        }
      })

      sourceExportJsonButton.addEventListener('click', function() {
        if (currentView !== 'all' || currentSourceWallets.length === 0) {
          statusEl.textContent = 'Switch to the all view to export visible source wallets.'
          statusEl.classList.add('error')
          return
        }

        statusEl.classList.remove('error')
        exportWalletSet(currentSourceWallets, 'json', getSourceExportBaseName(), {
          view: 'all',
          page: currentPage,
          pageSize: Number(pageSizeInput.value || '25'),
          walletType: 'source',
        })
        statusEl.textContent = 'Exported ' + currentSourceWallets.length + ' visible source wallets as JSON.'
      })

      sourceExportCsvButton.addEventListener('click', function() {
        if (currentView !== 'all' || currentSourceWallets.length === 0) {
          statusEl.textContent = 'Switch to the all view to export visible source wallets.'
          statusEl.classList.add('error')
          return
        }

        statusEl.classList.remove('error')
        exportWalletSet(currentSourceWallets, 'csv', getSourceExportBaseName(), {
          view: 'all',
          page: currentPage,
          pageSize: Number(pageSizeInput.value || '25'),
          walletType: 'source',
        })
        statusEl.textContent = 'Exported ' + currentSourceWallets.length + ' visible source wallets as CSV.'
      })

      bulkExportJsonButton.addEventListener('click', function() {
        if (currentView === 'all' || currentBulkWallets.length === 0) {
          statusEl.textContent = 'Switch to Mixer wallets or Downstream wallets to export visible wallet addresses.'
          statusEl.classList.add('error')
          return
        }

        statusEl.classList.remove('error')
        exportWalletSet(currentBulkWallets, 'json', getBulkExportBaseName(), {
          view: currentView,
          page: currentPage,
          pageSize: Number(pageSizeInput.value || '25'),
          walletType: getSubviewKey(),
        })
        statusEl.textContent = 'Exported ' + currentBulkWallets.length + ' visible ' + getSubviewKey() + ' wallets as JSON.'
      })

      bulkExportCsvButton.addEventListener('click', function() {
        if (currentView === 'all' || currentBulkWallets.length === 0) {
          statusEl.textContent = 'Switch to Mixer wallets or Downstream wallets to export visible wallet addresses.'
          statusEl.classList.add('error')
          return
        }

        statusEl.classList.remove('error')
        exportWalletSet(currentBulkWallets, 'csv', getBulkExportBaseName(), {
          view: currentView,
          page: currentPage,
          pageSize: Number(pageSizeInput.value || '25'),
          walletType: getSubviewKey(),
        })
        statusEl.textContent = 'Exported ' + currentBulkWallets.length + ' visible ' + getSubviewKey() + ' wallets as CSV.'
      })

      bulkOpenButton.addEventListener('click', function() {
        if (currentView === 'all' || currentBulkWallets.length === 0) {
          statusEl.textContent = 'Switch to Mixer wallets or Downstream wallets to open visible wallet graphs.'
          statusEl.classList.add('error')
          return
        }

        statusEl.classList.remove('error')
        let walletsToOpen = currentBulkWallets
        const bulkOpenCap = getBulkOpenCap()
        if (walletsToOpen.length > bulkOpenCap) {
          const confirmedCappedOpen = window.confirm(
            'This action targets ' + walletsToOpen.length + ' wallets. For safety, bulk graph open is capped at ' + bulkOpenCap + ' tabs. Open only the first ' + bulkOpenCap + ' tabs?'
          )
          if (!confirmedCappedOpen) {
            statusEl.textContent = 'Bulk graph open cancelled.'
            return
          }
          walletsToOpen = walletsToOpen.slice(0, bulkOpenCap)
        } else if (walletsToOpen.length >= BULK_OPEN_CONFIRM_THRESHOLD) {
          const confirmedLargeOpen = window.confirm(
            'Open ' + walletsToOpen.length + ' graph tabs for the current ' + getSubviewKey() + ' subview?'
          )
          if (!confirmedLargeOpen) {
            statusEl.textContent = 'Bulk graph open cancelled.'
            return
          }
        }

        let openedCount = 0
        walletsToOpen.forEach(function(wallet) {
          const newTab = window.open(graphLink(wallet), '_blank', 'noopener,noreferrer')
          if (newTab) openedCount += 1
        })

        if (openedCount === 0) {
          statusEl.textContent = 'Graph tabs were blocked by the browser. Allow pop-ups for this page to use bulk open.'
          statusEl.classList.add('error')
          return
        }

        statusEl.textContent = 'Opened ' + openedCount + ' graph tabs for the current ' + getSubviewKey() + ' subview.'
      })

      applyStateFromUrl()
      updateBulkActions()
      loadAudit()
    </script>`,
  })
}

export function registerGraphRoutes(app: Express, deps: GraphRouteDeps) {
  const apiAuthMiddleware = deps.apiAuthMiddleware || ((_req, _res, next) => next())
  const pageAuthMiddleware = deps.pageAuthMiddleware || ((_req, _res, next) => next())

  app.get('/api/scam-wallets/mixer-routes', apiAuthMiddleware, async (req: Request, res: Response) => {
    try {
      const groupedBySourceWallet = await deps.scamWalletRepository.getMixerRouteAudit(getMixerRouteFilters(req))
      const page = parsePositiveIntQuery(req.query.page, 1, 100000)
      const pageSize = parsePositiveIntQuery(req.query.pageSize, 25, 100)
      res.status(200).json(buildPaginatedMixerRouteAuditPayload(groupedBySourceWallet, page, pageSize))
    } catch (error) {
      console.error('Mixer route audit API error', error)
      res.status(500).json({ message: 'Failed to build mixer route audit' })
    }
  })

  app.get('/api/scam-wallets/mixer-routes/export', apiAuthMiddleware, async (req: Request, res: Response) => {
    try {
      const groupedBySourceWallet = await deps.scamWalletRepository.getMixerRouteAudit(getMixerRouteFilters(req))
      const format = req.query.format === 'json' ? 'json' : 'csv'

      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Content-Disposition', 'attachment; filename="mixer-route-audit.json"')
        res.status(200).send(JSON.stringify(buildMixerRouteAuditPayload(groupedBySourceWallet), null, 2))
        return
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', 'attachment; filename="mixer-route-audit.csv"')
      res.status(200).send(buildMixerRouteAuditCsv(groupedBySourceWallet))
    } catch (error) {
      console.error('Mixer route export API error', error)
      res.status(500).json({ message: 'Failed to export mixer route audit' })
    }
  })

  app.post('/api/graph/retrace', apiAuthMiddleware, async (req: Request, res: Response) => {
    try {
      if (!deps.fundFlowTracer) {
        res.status(503).json({ message: 'Fund flow tracer is not configured' })
        return
      }

      const wallet = typeof req.body?.wallet === 'string' ? req.body.wallet.trim() : ''
      if (!wallet) {
        res.status(400).json({ message: 'wallet is required' })
        return
      }

      try {
        new PublicKey(wallet)
      } catch {
        res.status(400).json({ message: 'Invalid wallet address' })
        return
      }

      const maxHopsRaw = Number(req.body?.maxHops)
      const signaturesPerHopRaw = Number(req.body?.signaturesPerHop)
      const maxVisitedWalletsRaw = Number(req.body?.maxVisitedWallets)

      const maxHops = Number.isFinite(maxHopsRaw) ? Math.max(1, Math.min(12, Math.floor(maxHopsRaw))) : 8
      const signaturesPerHop = Number.isFinite(signaturesPerHopRaw)
        ? Math.max(1, Math.min(50, Math.floor(signaturesPerHopRaw)))
        : 20
      const maxVisitedWallets = Number.isFinite(maxVisitedWalletsRaw)
        ? Math.max(50, Math.min(2000, Math.floor(maxVisitedWalletsRaw)))
        : 500

      const followAllRecipients = req.body?.followAllRecipients !== false
      const traceAllFirstHopRecipients = req.body?.traceAllFirstHopRecipients === true

      const trace = await deps.fundFlowTracer.traceWalletFlow(wallet, maxHops, signaturesPerHop, {
        followAllRecipients,
        traceAllFirstHopRecipients,
        maxVisitedWallets,
      })

      res.status(200).json({
        wallet,
        config: {
          maxHops,
          signaturesPerHop,
          maxVisitedWallets,
          followAllRecipients,
          traceAllFirstHopRecipients,
        },
        trace,
      })
    } catch (error) {
      console.error('Graph retrace API error', error)
      res.status(500).json({ message: 'Failed to run deep retrace' })
    }
  })

  app.get('/api/graph/:wallet', apiAuthMiddleware, async (req: Request, res: Response) => {
    try {
      const wallet = req.params.wallet
      const latestFlow = await deps.scamWalletRepository.getLatestFlowTrace(wallet)
      const cluster = await deps.walletClusterService.getLatestCluster(wallet)

      const steps = extractFlowSteps(latestFlow?.metadata)
      const traceSummary = extractFlowTraceSummary(latestFlow?.metadata)
      const nodeSet = new Set<string>([wallet])
      const edges = steps.map((step) => {
        nodeSet.add(step.from)
        nodeSet.add(step.to)
        return {
          from: step.from,
          to: step.to,
          label: `${step.amount} ${step.asset}`,
          signature: step.signature,
          hop: step.hop,
        }
      })

      const clusterWallets = Array.isArray(cluster?.wallets) ? cluster.wallets : []
      for (const clusterWallet of clusterWallets) {
        nodeSet.add(clusterWallet)
      }

      if (edges.length === 0) {
        for (const clusterWallet of clusterWallets) {
          if (clusterWallet === wallet) continue
          edges.push({
            from: wallet,
            to: clusterWallet,
            label: 'cluster-link',
            signature: 'cluster-link',
            hop: 0,
          })
        }
      }

      const nodes = Array.from(nodeSet).map((address) => ({
        id: address,
        label: address,
        inCluster: clusterWallets.includes(address),
      }))

      res.status(200).json({
        wallet,
        nodes,
        edges,
        trace: traceSummary,
        cluster: cluster
          ? {
              score: cluster.clusterScore,
              riskScore: cluster.riskScore,
              wallets: cluster.wallets,
            }
          : null,
      })
    } catch (error) {
      console.error('Graph API error', error)
      res.status(500).json({ message: 'Failed to build graph data' })
    }
  })

  app.get('/api/graph/tokens/:wallet', apiAuthMiddleware, async (req: Request, res: Response) => {
    try {
      const wallet = req.params.wallet
      if (!wallet || wallet.length < 32) {
        res.status(400).json({ message: 'Invalid wallet address' })
        return
      }
      const connection = RpcConnectionManager.getRandomConnection()
      const pubkey = new PublicKey(wallet)
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, { programId: SPL_TOKEN_PROGRAM_ID })
      const tokens = tokenAccounts.value
        .map((account) => {
          const info = (
            account.account.data as {
              parsed?: { info?: { mint?: string; tokenAmount?: { uiAmount?: number; decimals?: number } } }
            }
          ).parsed?.info
          if (!info) return null
          const amount = info.tokenAmount?.uiAmount ?? 0
          const decimals = info.tokenAmount?.decimals ?? 0
          return { mint: info.mint, amount, decimals }
        })
        .filter((t): t is { mint: string | undefined; amount: number; decimals: number } => t !== null && t.amount > 0)
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 50)
      res.status(200).json({ wallet, tokens })
    } catch (error) {
      console.error('Token holdings error', error)
      res.status(500).json({ message: 'Failed to fetch token accounts' })
    }
  })

  app.get('/api/graph/analyze/:wallet', apiAuthMiddleware, async (req: Request, res: Response) => {
    try {
      const wallet = req.params.wallet
      if (!deps.aiAnalyzer) {
        res.status(200).json({
          wallet,
          analysis: 'Analyzer is not configured for graph mode.',
        })
        return
      }

      const analysis = await deps.aiAnalyzer.analyzeWallet(wallet)
      res.status(200).json({ wallet, analysis })
    } catch (error) {
      console.error('Graph analyze API error', error)
      res.status(500).json({ message: 'Failed to analyze wallet for graph view' })
    }
  })

  app.get('/graph/:wallet?', pageAuthMiddleware, (req: Request, res: Response) => {
    const wallet = (req.params.wallet || '').trim()
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.status(200).send(renderGraphPage(wallet))
  })

  app.get('/dashboard/mixer-routes', pageAuthMiddleware, (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.status(200).send(renderMixerRoutesDashboard())
  })
}
