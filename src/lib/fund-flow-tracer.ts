import {
  ParsedInstruction,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  PublicKey,
  TokenBalance,
  TokenAmount,
} from '@solana/web3.js'
import { RpcConnectionManager } from '../providers/solana'
import {
  KNOWN_PLATFORM_PROGRAMS,
  KNOWN_PLATFORM_WALLETS,
  MIXER_KEYWORDS,
  PlatformCategory,
} from '../constants/trace-platforms'
import { KNOWN_SCAM_WALLETS } from '../constants/known-scam-wallets'
import { ValidTransactions } from './valid-transactions'
import { AnomalyDetector } from './anomaly-detector'
import { ChainRegistry } from './chains'
import { SupportedChain } from './chains/types'

export type FlowStep = {
  hop: number
  from: string
  to: string
  signature: string
  blockTime?: number
  timestamp?: string
  asset: 'SOL' | 'TOKEN'
  amount: string
  tokenMint?: string
  categories: PlatformCategory[]
  matchedPlatforms: string[]
  memoPresent?: boolean
  memoPreview?: string
  linkedToLaunchPattern: boolean
}

export type FlowTraceResult = {
  wallet: string
  tracedAt: string
  maxHops: number
  steps: FlowStep[]
  alerts: string[]
  terminalWallets: TerminalWallet[]
  mixerTrace: MixerTraceSummary
  platformTrace: PlatformTraceSummary
  bridgeRouteAttribution: BridgeRouteAttribution
  crossChainContinuation: CrossChainContinuationSummary
  riskConfidenceModel: RiskConfidenceModel
  cexDepositHeuristics: CexDepositHeuristicSummary
}

export type BridgeFamily = 'WORMHOLE' | 'DEBRIDGE' | 'GENERIC_BRIDGE'

export type BridgeHandoffRecord = {
  signature: string
  hop: number
  from: string
  to: string
  amount: string
  asset: 'SOL' | 'TOKEN'
  timestamp?: string
  bridgeFamily: BridgeFamily
  bridgeLabel: string
  relayerHint: boolean
}

export type BridgeRouteAttribution = {
  encountered: boolean
  canonicalFamilies: BridgeFamily[]
  canonicalPrograms: string[]
  relayerWallets: string[]
  handoffWallets: string[]
  handoffs: BridgeHandoffRecord[]
}

export type CrossChainContinuationCandidate = {
  sourceWallet: string
  bridgeWallet: string
  signature: string
  hop: number
  bridgeFamily: BridgeFamily
  bridgeLabel: string
  candidateNextChains: string[]
  resolverHint: string
  confidence: number
  reason: string
  observedAt?: string
}

export type CrossChainContinuationSummary = {
  encountered: boolean
  bridgeFamilies: BridgeFamily[]
  recommendedNextChains: string[]
  continuationCandidates: CrossChainContinuationCandidate[]
  unresolvedHandoffs: string[]
  notes: string[]
}

export type RiskConfidenceBoundary = 'MIXER' | 'EXCHANGE' | 'CEX_DEPOSIT' | 'BRIDGE'

export type RiskConfidenceEvent = {
  boundary: RiskConfidenceBoundary
  hop: number
  signature: string
  wallet: string
  impact: number
  reason: string
}

export type RiskConfidenceModel = {
  modelVersion: string
  baseConfidence: number
  attenuation: number
  adjustedConfidence: number
  degradationLevel: 'LOW' | 'MEDIUM' | 'HIGH'
  boundariesCrossed: RiskConfidenceBoundary[]
  events: RiskConfidenceEvent[]
  notes: string[]
}

type QueueNode = {
  address: string
  hop: number
  path: string[]
  pathSignatures: string[]
  reachedViaMixer: boolean
  firstMixerHop: number | null
  reachedViaExchange: boolean
  reachedViaBridge: boolean
}

export type TerminalWalletReason =
  | 'NO_FOLLOWABLE_OUTGOING'
  | 'MAX_HOPS_REACHED'
  | 'VISIT_CAP_REACHED'
  | 'CYCLE_OR_REVISIT'

export type TerminalWallet = {
  address: string
  hop: number
  reason: TerminalWalletReason
  path: string[]
  pathSignatures: string[]
  reachedViaMixer: boolean
  firstMixerHop: number | null
}

export type MixerTraceSummary = {
  encountered: boolean
  mixerWallets: string[]
  downstreamWallets: string[]
}

export type PlatformTraceSummary = {
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
}

export type CexDepositEvidence = {
  code:
    | 'REPEATED_EXCHANGE_TARGET'
    | 'ROUND_SOL_AMOUNTS'
    | 'MULTI_EXCHANGE_SPLIT'
    | 'BURST_EXCHANGE_ACTIVITY'
    | 'DEPOSIT_MEMO_HINT'
  score: number
  summary: string
  signatures: string[]
  wallets: string[]
  details?: Record<string, number | string>
}

export type CexExchangeCluster = {
  label: string
  walletCount: number
  transferCount: number
  wallets: string[]
}

export type CexMemoSignalSummary = {
  memoTransferCount: number
  memoSignatureCount: number
  memoSamples: string[]
}

export type CexDepositHeuristicSummary = {
  detected: boolean
  confidence: number
  exchangeWalletCount: number
  exchangeTransferCount: number
  totalExchangeOutflowSol: number
  exchangeClusters: CexExchangeCluster[]
  memoSignals: CexMemoSignalSummary
  evidence: CexDepositEvidence[]
}

export type FlowTraceOptions = {
  traceAllFirstHopRecipients?: boolean
  followAllRecipients?: boolean
  maxVisitedWallets?: number
}

export class FundFlowTracer {
  private anomalyDetector: AnomalyDetector
  private chainRegistry: ChainRegistry
  private static readonly BRIDGE_RELAYER_KEYWORDS = ['relayer', 'router', 'guardian', 'executor', 'redeem']
  private static readonly BRIDGE_FAMILY_CHAIN_HINTS: Record<BridgeFamily, string[]> = {
    WORMHOLE: ['ethereum', 'bsc', 'polygon', 'avalanche', 'arbitrum', 'optimism', 'base', 'aptos', 'sui'],
    DEBRIDGE: ['ethereum', 'bsc', 'polygon', 'arbitrum', 'optimism', 'base'],
    GENERIC_BRIDGE: ['unknown'],
  }
  private static readonly RISK_CONFIDENCE_MODEL_VERSION = '1.0.0'

  constructor() {
    this.anomalyDetector = new AnomalyDetector()
    this.chainRegistry = new ChainRegistry()
  }

  async traceWalletFlowByChain(walletAddress: string, chain: SupportedChain, limit = 25) {
    const adapter = this.chainRegistry.getAdapter(chain)
    const normalizedWallet = adapter.normalizeWallet(walletAddress)
    const txs = await adapter.getRecentTransactions(normalizedWallet, limit)

    return {
      wallet: normalizedWallet,
      chain,
      tracedAt: new Date().toISOString(),
      transactions: txs,
    }
  }

  async traceWalletFlow(
    walletAddress: string,
    maxHops = 3,
    signaturesPerHop = 12,
    options: FlowTraceOptions = {},
  ): Promise<FlowTraceResult> {
    const visited = new Set<string>()
    const queue: QueueNode[] = [
      {
        address: walletAddress,
        hop: 0,
        path: [walletAddress],
        pathSignatures: [],
        reachedViaMixer: false,
        firstMixerHop: null,
        reachedViaExchange: false,
        reachedViaBridge: false,
      },
    ]
    const steps: FlowStep[] = []
    const alerts: string[] = []
    const terminalWallets = new Map<string, TerminalWallet>()
    const mixerWallets = new Set<string>()
    const downstreamWalletsViaMixer = new Set<string>()
    const exchangeWallets = new Set<string>()
    const downstreamWalletsViaExchange = new Set<string>()
    const bridgeWallets = new Set<string>()
    const downstreamWalletsViaBridge = new Set<string>()
    const maxVisitedWallets = Math.max(10, options.maxVisitedWallets || 300)

    while (queue.length > 0) {
      const current = queue.shift()!

      if (visited.size >= maxVisitedWallets) {
        alerts.push(`Trace truncated at ${maxVisitedWallets} wallets to protect runtime`)
        this.upsertTerminalWallet(terminalWallets, {
          address: current.address,
          hop: current.hop,
          reason: 'VISIT_CAP_REACHED',
          path: current.path,
          pathSignatures: current.pathSignatures,
          reachedViaMixer: current.reachedViaMixer,
          firstMixerHop: current.firstMixerHop,
        })

        for (const pending of queue) {
          this.upsertTerminalWallet(terminalWallets, {
            address: pending.address,
            hop: pending.hop,
            reason: 'VISIT_CAP_REACHED',
            path: pending.path,
            pathSignatures: pending.pathSignatures,
            reachedViaMixer: pending.reachedViaMixer,
            firstMixerHop: pending.firstMixerHop,
          })
        }
        break
      }

      if (visited.has(current.address) || current.hop >= maxHops) {
        continue
      }

      visited.add(current.address)
      let hasFollowableOutgoing = false

      const signatures = await this.getAddressSignatures(current.address, signaturesPerHop)

      for (const signatureInfo of signatures) {
        const tx = await this.getParsedTransaction(signatureInfo.signature)
        if (!tx) continue

        const txSteps = this.extractFlowSteps(
          current.address,
          current.hop + 1,
          signatureInfo.signature,
          tx,
          signatureInfo.blockTime,
        )

        for (const step of txSteps) {
          steps.push(step)

          const isMixerHop = step.categories.includes('MIXER')
          const isExchangeHop = step.categories.includes('EXCHANGE')
          const isBridgeHop = step.categories.includes('BRIDGE')
          if (isMixerHop) {
            mixerWallets.add(step.to)
          }
          if (isExchangeHop) {
            exchangeWallets.add(step.to)
          }
          if (isBridgeHop) {
            bridgeWallets.add(step.to)
          }

          if (step.linkedToLaunchPattern) {
            alerts.push(`Launch pattern seen at hop ${step.hop} via ${step.signature}`)
          }

          if (
            step.categories.some((category) => category === 'MIXER' || category === 'EXCHANGE' || category === 'SCAM')
          ) {
            alerts.push(
              `Known platform interaction: ${step.categories.join(', ')} at ${step.to} (hop ${step.hop}, tx ${step.signature})`,
            )
          }

          const shouldTraceStep = this.shouldContinueTracing(step, current.hop + 1, options)
          const isLikelyTraceTarget = this.isLikelyTraceTarget(step.to)
          if (!shouldTraceStep || !isLikelyTraceTarget) {
            continue
          }

          hasFollowableOutgoing = true

          const nextHop = current.hop + 1
          const nextPath = [...current.path, step.to]
          const nextPathSignatures = [...current.pathSignatures, step.signature]
          const reachedViaMixer = current.reachedViaMixer || isMixerHop
          const reachedViaExchange = current.reachedViaExchange || isExchangeHop
          const reachedViaBridge = current.reachedViaBridge || isBridgeHop
          const firstMixerHop = current.firstMixerHop ?? (isMixerHop ? step.hop : null)

          if (nextHop >= maxHops) {
            if (reachedViaMixer) {
              downstreamWalletsViaMixer.add(step.to)
            }
            if (reachedViaExchange) {
              downstreamWalletsViaExchange.add(step.to)
            }
            if (reachedViaBridge) {
              downstreamWalletsViaBridge.add(step.to)
            }
            this.upsertTerminalWallet(terminalWallets, {
              address: step.to,
              hop: nextHop,
              reason: 'MAX_HOPS_REACHED',
              path: nextPath,
              pathSignatures: nextPathSignatures,
              reachedViaMixer,
              firstMixerHop,
            })
            continue
          }

          if (visited.has(step.to)) {
            if (reachedViaMixer) {
              downstreamWalletsViaMixer.add(step.to)
            }
            if (reachedViaExchange) {
              downstreamWalletsViaExchange.add(step.to)
            }
            if (reachedViaBridge) {
              downstreamWalletsViaBridge.add(step.to)
            }
            this.upsertTerminalWallet(terminalWallets, {
              address: step.to,
              hop: nextHop,
              reason: 'CYCLE_OR_REVISIT',
              path: nextPath,
              pathSignatures: nextPathSignatures,
              reachedViaMixer,
              firstMixerHop,
            })
            continue
          }

          queue.push({
            address: step.to,
            hop: nextHop,
            path: nextPath,
            pathSignatures: nextPathSignatures,
            reachedViaMixer,
            firstMixerHop,
            reachedViaExchange,
            reachedViaBridge,
          })
        }
      }

      if (current.hop > 0 && !hasFollowableOutgoing) {
        if (current.reachedViaMixer) {
          downstreamWalletsViaMixer.add(current.address)
        }
        if (current.reachedViaExchange) {
          downstreamWalletsViaExchange.add(current.address)
        }
        if (current.reachedViaBridge) {
          downstreamWalletsViaBridge.add(current.address)
        }
        this.upsertTerminalWallet(terminalWallets, {
          address: current.address,
          hop: current.hop,
          reason: 'NO_FOLLOWABLE_OUTGOING',
          path: current.path,
          pathSignatures: current.pathSignatures,
          reachedViaMixer: current.reachedViaMixer,
          firstMixerHop: current.firstMixerHop,
        })
      }
    }

    const anomalies = this.anomalyDetector.detect(steps)
    for (const anomaly of anomalies) {
      alerts.push(`[ANOMALY_DETECTED] ${anomaly.type}: ${anomaly.message}`)
    }

    const terminalWalletList = Array.from(terminalWallets.values()).sort((a, b) => a.hop - b.hop)
    if (mixerWallets.size > 0) {
      alerts.push(`Mixer interaction detected across ${mixerWallets.size} wallet(s)`)
    }
    if (downstreamWalletsViaMixer.size > 0) {
      alerts.push(`Mixer path tracing reached ${downstreamWalletsViaMixer.size} downstream wallet(s)`)
    }
    if (exchangeWallets.size > 0) {
      alerts.push(`Exchange interaction detected across ${exchangeWallets.size} wallet(s)`)
    }
    if (downstreamWalletsViaExchange.size > 0) {
      alerts.push(`Exchange path tracing reached ${downstreamWalletsViaExchange.size} downstream wallet(s)`)
    }
    if (bridgeWallets.size > 0) {
      alerts.push(`Bridge interaction detected across ${bridgeWallets.size} wallet(s)`)
    }
    if (downstreamWalletsViaBridge.size > 0) {
      alerts.push(`Bridge path tracing reached ${downstreamWalletsViaBridge.size} downstream wallet(s)`)
    }

    const bridgeRouteAttribution = this.buildBridgeRouteAttribution(steps)
    if (bridgeRouteAttribution.encountered) {
      alerts.push(
        `Bridge route attribution: ${bridgeRouteAttribution.canonicalFamilies.join(', ')} (${bridgeRouteAttribution.handoffs.length} handoff txs)`,
      )
    }

    const crossChainContinuation = this.buildCrossChainContinuation(bridgeRouteAttribution)
    if (crossChainContinuation.encountered) {
      alerts.push(
        `Cross-chain continuation scaffold: ${crossChainContinuation.continuationCandidates.length} candidate(s) across ${crossChainContinuation.recommendedNextChains.join(', ')}`,
      )
    }

    const cexDepositHeuristics = this.buildCexDepositHeuristics(steps)
    if (cexDepositHeuristics.detected) {
      alerts.push(
        `CEX deposit pattern suspicion ${cexDepositHeuristics.confidence}/100 (${cexDepositHeuristics.exchangeTransferCount} exchange transfers)`,
      )
    }

    const riskConfidenceModel = this.buildRiskConfidenceModel(steps, cexDepositHeuristics, bridgeRouteAttribution)
    alerts.push(
      `Risk confidence ${riskConfidenceModel.adjustedConfidence}/100 (attenuation ${riskConfidenceModel.attenuation}, ${riskConfidenceModel.degradationLevel.toLowerCase()} degradation)`,
    )

    return {
      wallet: walletAddress,
      tracedAt: new Date().toISOString(),
      maxHops,
      steps,
      alerts: Array.from(new Set(alerts)),
      terminalWallets: terminalWalletList,
      mixerTrace: {
        encountered: mixerWallets.size > 0,
        mixerWallets: Array.from(mixerWallets),
        downstreamWallets: Array.from(downstreamWalletsViaMixer),
      },
      platformTrace: {
        exchange: {
          encountered: exchangeWallets.size > 0,
          wallets: Array.from(exchangeWallets),
          downstreamWallets: Array.from(downstreamWalletsViaExchange),
        },
        bridge: {
          encountered: bridgeWallets.size > 0,
          wallets: Array.from(bridgeWallets),
          downstreamWallets: Array.from(downstreamWalletsViaBridge),
        },
      },
      bridgeRouteAttribution,
      crossChainContinuation,
      riskConfidenceModel,
      cexDepositHeuristics,
    }
  }

  private buildRiskConfidenceModel(
    steps: FlowStep[],
    cexDepositHeuristics: CexDepositHeuristicSummary,
    bridgeRouteAttribution: BridgeRouteAttribution,
  ): RiskConfidenceModel {
    let baseConfidence = 85
    if (steps.length < 3) {
      baseConfidence -= 10
    }
    if (steps.length > 120) {
      baseConfidence -= 6
    }
    baseConfidence = Math.max(45, Math.min(95, baseConfidence))

    const events: RiskConfidenceEvent[] = []

    const mixerSteps = steps.filter((step) => step.categories.includes('MIXER'))
    if (mixerSteps.length > 0) {
      const impact = Math.min(42, 18 + (mixerSteps.length - 1) * 8)
      events.push({
        boundary: 'MIXER',
        hop: mixerSteps[0].hop,
        signature: mixerSteps[0].signature,
        wallet: mixerSteps[0].to,
        impact,
        reason: `Mixer boundary crossed (${mixerSteps.length} mixer-tagged transfer(s))`,
      })
    }

    const exchangeSteps = steps.filter((step) => step.categories.includes('EXCHANGE'))
    if (exchangeSteps.length > 0) {
      const impact = Math.min(24, 8 + (exchangeSteps.length - 1) * 4)
      events.push({
        boundary: 'EXCHANGE',
        hop: exchangeSteps[0].hop,
        signature: exchangeSteps[0].signature,
        wallet: exchangeSteps[0].to,
        impact,
        reason: `Custodial exchange boundary crossed (${exchangeSteps.length} exchange-tagged transfer(s))`,
      })
    }

    if (cexDepositHeuristics.detected) {
      const heuristicImpact = Math.min(28, 8 + Math.round(cexDepositHeuristics.confidence * 0.2))
      const seed = cexDepositHeuristics.evidence[0]
      events.push({
        boundary: 'CEX_DEPOSIT',
        hop: 0,
        signature: seed?.signatures?.[0] || 'heuristic',
        wallet: seed?.wallets?.[0] || 'exchange_cluster',
        impact: heuristicImpact,
        reason: `CEX deposit pattern detected (heuristic confidence ${cexDepositHeuristics.confidence}/100)`,
      })
    }

    if (bridgeRouteAttribution.encountered && bridgeRouteAttribution.handoffs.length > 0) {
      const firstHandoff = bridgeRouteAttribution.handoffs[0]
      events.push({
        boundary: 'BRIDGE',
        hop: firstHandoff.hop,
        signature: firstHandoff.signature,
        wallet: firstHandoff.to,
        impact: 6,
        reason: `Bridge boundary crossed (${bridgeRouteAttribution.handoffs.length} bridge handoff(s))`,
      })
    }

    const attenuation = events.reduce((sum, event) => sum + event.impact, 0)
    const adjustedConfidence = Math.max(5, Math.min(100, baseConfidence - attenuation))

    let degradationLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW'
    if (attenuation >= 45) {
      degradationLevel = 'HIGH'
    } else if (attenuation >= 20) {
      degradationLevel = 'MEDIUM'
    }

    const boundariesCrossed = Array.from(new Set(events.map((event) => event.boundary)))

    const notes = [
      'Confidence degrades after privacy/custodial boundaries where deterministic tracing weakens.',
      'Post-mixer and CEX deposit boundaries carry the strongest attenuation weights.',
    ]

    return {
      modelVersion: FundFlowTracer.RISK_CONFIDENCE_MODEL_VERSION,
      baseConfidence,
      attenuation,
      adjustedConfidence,
      degradationLevel,
      boundariesCrossed,
      events,
      notes,
    }
  }

  private buildCrossChainContinuation(bridgeRouteAttribution: BridgeRouteAttribution): CrossChainContinuationSummary {
    if (!bridgeRouteAttribution.encountered || bridgeRouteAttribution.handoffs.length === 0) {
      return {
        encountered: false,
        bridgeFamilies: [],
        recommendedNextChains: [],
        continuationCandidates: [],
        unresolvedHandoffs: [],
        notes: ['No bridge handoff found for continuation scaffolding.'],
      }
    }

    const recommendedNextChains = new Set<string>()
    const bridgeFamilies = new Set<BridgeFamily>()

    const continuationCandidates: CrossChainContinuationCandidate[] = bridgeRouteAttribution.handoffs.map((handoff) => {
      const chainHints = FundFlowTracer.BRIDGE_FAMILY_CHAIN_HINTS[handoff.bridgeFamily] || ['unknown']
      for (const chain of chainHints) {
        if (chain !== 'unknown') {
          recommendedNextChains.add(chain)
        }
      }

      bridgeFamilies.add(handoff.bridgeFamily)

      const resolverHint =
        handoff.bridgeFamily === 'WORMHOLE'
          ? 'wormhole:vaa-search'
          : handoff.bridgeFamily === 'DEBRIDGE'
            ? 'debridge:tx-handoff-search'
            : 'bridge:manual-correlation'

      return {
        sourceWallet: handoff.from,
        bridgeWallet: handoff.to,
        signature: handoff.signature,
        hop: handoff.hop,
        bridgeFamily: handoff.bridgeFamily,
        bridgeLabel: handoff.bridgeLabel,
        candidateNextChains: chainHints,
        resolverHint,
        confidence: handoff.relayerHint ? 70 : 55,
        reason: handoff.relayerHint
          ? 'Bridge handoff includes relayer characteristics; prioritize resolver lookup.'
          : 'Bridge handoff detected; attempt next-chain resolver with family heuristics.',
        observedAt: handoff.timestamp,
      }
    })

    return {
      encountered: true,
      bridgeFamilies: Array.from(bridgeFamilies),
      recommendedNextChains: Array.from(recommendedNextChains),
      continuationCandidates: continuationCandidates.slice(0, 50),
      unresolvedHandoffs: bridgeRouteAttribution.handoffWallets,
      notes: [
        'Scaffold output only: requires dedicated next-chain resolver for deterministic continuation.',
        'Use resolverHint and signature to query bridge-specific message/event indexers.',
      ],
    }
  }

  private buildBridgeRouteAttribution(steps: FlowStep[]): BridgeRouteAttribution {
    const bridgeSteps = steps.filter((step) => step.categories.includes('BRIDGE'))
    if (bridgeSteps.length === 0) {
      return {
        encountered: false,
        canonicalFamilies: [],
        canonicalPrograms: [],
        relayerWallets: [],
        handoffWallets: [],
        handoffs: [],
      }
    }

    const canonicalFamilies = new Set<BridgeFamily>()
    const canonicalPrograms = new Set<string>()
    const relayerWallets = new Set<string>()
    const bridgeRecipientWallets = new Set<string>()

    const handoffs: BridgeHandoffRecord[] = bridgeSteps.map((step) => {
      const bridgeLabel = this.pickBridgeLabel(step.matchedPlatforms)
      const bridgeFamily = this.inferBridgeFamily(bridgeLabel)
      const relayerHint = this.hasRelayerHint(bridgeLabel)

      canonicalFamilies.add(bridgeFamily)
      canonicalPrograms.add(bridgeLabel)
      bridgeRecipientWallets.add(step.to)
      if (relayerHint) {
        relayerWallets.add(step.to)
      }

      return {
        signature: step.signature,
        hop: step.hop,
        from: step.from,
        to: step.to,
        amount: step.amount,
        asset: step.asset,
        timestamp: step.timestamp,
        bridgeFamily,
        bridgeLabel,
        relayerHint,
      }
    })

    const handoffWallets = new Set<string>()
    for (const step of steps) {
      if (bridgeRecipientWallets.has(step.from) && !bridgeRecipientWallets.has(step.to)) {
        handoffWallets.add(step.to)
      }
    }

    return {
      encountered: true,
      canonicalFamilies: Array.from(canonicalFamilies),
      canonicalPrograms: Array.from(canonicalPrograms),
      relayerWallets: Array.from(relayerWallets),
      handoffWallets: Array.from(handoffWallets),
      handoffs: handoffs.slice(0, 40),
    }
  }

  private pickBridgeLabel(matchedPlatforms: string[]): string {
    if (!Array.isArray(matchedPlatforms) || matchedPlatforms.length === 0) {
      return 'Unknown bridge route'
    }

    const preferred = matchedPlatforms.find((label) => this.isBridgeLabel(label))
    return preferred || matchedPlatforms[0]
  }

  private isBridgeLabel(label: string): boolean {
    const normalized = label.toLowerCase()
    return normalized.includes('bridge') || normalized.includes('wormhole') || normalized.includes('debridge')
  }

  private inferBridgeFamily(bridgeLabel: string): BridgeFamily {
    const normalized = bridgeLabel.toLowerCase()
    if (normalized.includes('wormhole')) {
      return 'WORMHOLE'
    }
    if (normalized.includes('debridge') || normalized.includes('de-bridge') || normalized.includes('de bridge')) {
      return 'DEBRIDGE'
    }
    return 'GENERIC_BRIDGE'
  }

  private hasRelayerHint(bridgeLabel: string): boolean {
    const normalized = bridgeLabel.toLowerCase()
    return FundFlowTracer.BRIDGE_RELAYER_KEYWORDS.some((keyword) => normalized.includes(keyword))
  }

  private upsertTerminalWallet(store: Map<string, TerminalWallet>, candidate: TerminalWallet): void {
    const existing = store.get(candidate.address)
    if (!existing) {
      store.set(candidate.address, candidate)
      return
    }

    if (candidate.hop < existing.hop) {
      store.set(candidate.address, candidate)
      return
    }

    if (candidate.reason !== 'CYCLE_OR_REVISIT' && existing.reason === 'CYCLE_OR_REVISIT') {
      store.set(candidate.address, candidate)
      return
    }

    if (candidate.path.length < existing.path.length) {
      store.set(candidate.address, candidate)
    }
  }

  private async getAddressSignatures(address: string, limit: number) {
    try {
      return await RpcConnectionManager.getRandomConnection().getSignaturesForAddress(new PublicKey(address), { limit })
    } catch (error) {
      console.log('FLOW_TRACE_SIGNATURE_FETCH_ERROR', error)
      return []
    }
  }

  private async getParsedTransaction(signature: string): Promise<ParsedTransactionWithMeta | null> {
    try {
      return await RpcConnectionManager.getRandomConnection().getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      })
    } catch (error) {
      console.log('FLOW_TRACE_TX_FETCH_ERROR', error)
      return null
    }
  }

  private extractFlowSteps(
    fromAddress: string,
    hop: number,
    signature: string,
    tx: ParsedTransactionWithMeta,
    blockTime?: number | null,
  ): FlowStep[] {
    const steps: FlowStep[] = []
    const memoHints = this.extractMemoHints(tx)
    const relevant = ValidTransactions.isRelevantTransaction({
      err: tx.meta?.err || null,
      logs: tx.meta?.logMessages || [],
      signature,
    })

    const allInstructions = [
      ...(tx.transaction.message.instructions || []),
      ...((tx.meta?.innerInstructions || []).flatMap((inner) => inner.instructions) as (
        | ParsedInstruction
        | PartiallyDecodedInstruction
      )[]),
    ]

    for (const instruction of allInstructions) {
      if (!('parsed' in instruction)) {
        continue
      }

      const parsedInstruction = instruction as ParsedInstruction
      const parsedData = parsedInstruction.parsed as {
        type?: string
        info?: {
          source?: string
          destination?: string
          authority?: string
          amount?: string
          lamports?: number
          mint?: string
          tokenAmount?: TokenAmount
        }
      }

      const type = parsedData.type
      const info = parsedData.info

      if (!type || !info) continue

      const source = info.source || info.authority
      const destination = info.destination
      if (!source || !destination) continue

      if (source !== fromAddress) continue

      const amountLamports = info.lamports ? Number(info.lamports) / 1e9 : undefined
      const amountRaw = info.amount
      const tokenAmount = info.tokenAmount?.uiAmountString || info.tokenAmount?.amount || amountRaw || ''

      const tokenMint = info.mint || this.findTokenMintByAccount(tx.meta?.postTokenBalances || [], destination)
      const isSolTransfer = type === 'transfer' && amountLamports !== undefined

      const classification = this.classifyDestination(destination, tx)

      steps.push({
        hop,
        from: source,
        to: destination,
        signature,
        blockTime: typeof blockTime === 'number' ? blockTime : undefined,
        timestamp: typeof blockTime === 'number' ? new Date(blockTime * 1000).toISOString() : undefined,
        asset: isSolTransfer ? 'SOL' : 'TOKEN',
        amount: isSolTransfer ? amountLamports!.toFixed(6) : tokenAmount,
        tokenMint,
        categories: classification.categories,
        matchedPlatforms: classification.matchedPlatforms,
        memoPresent: memoHints.hasMemo,
        memoPreview: memoHints.sample,
        linkedToLaunchPattern: relevant.swap === 'mint_pumpfun',
      })
    }

    return steps
  }

  private extractMemoHints(tx: ParsedTransactionWithMeta): { hasMemo: boolean; sample?: string } {
    const allInstructions = [
      ...(tx.transaction.message.instructions || []),
      ...((tx.meta?.innerInstructions || []).flatMap((inner) => inner.instructions) as (
        | ParsedInstruction
        | PartiallyDecodedInstruction
      )[]),
    ]

    const memoCandidates: string[] = []
    for (const instruction of allInstructions) {
      if ('parsed' in instruction) {
        const parsed = instruction.parsed as unknown
        if (typeof parsed === 'string' && parsed.trim().length > 0) {
          memoCandidates.push(parsed.trim())
          continue
        }

        if (parsed && typeof parsed === 'object') {
          const maybeMemo = parsed as { memo?: string; type?: string; info?: { memo?: string } }
          const memoText =
            (typeof maybeMemo.memo === 'string' && maybeMemo.memo) ||
            (typeof maybeMemo.info?.memo === 'string' && maybeMemo.info.memo) ||
            (typeof maybeMemo.type === 'string' && maybeMemo.type.toLowerCase().includes('memo') ? maybeMemo.type : '')

          if (memoText && memoText.trim().length > 0) {
            memoCandidates.push(memoText.trim())
            continue
          }
        }
      }

      const programId = 'programId' in instruction ? instruction.programId.toBase58() : ''
      if (programId === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') {
        memoCandidates.push('memo_program_instruction')
      }
    }

    if (memoCandidates.length === 0) {
      return { hasMemo: false }
    }

    return {
      hasMemo: true,
      sample: memoCandidates[0].slice(0, 120),
    }
  }

  private findTokenMintByAccount(balances: TokenBalance[], accountAddress: string): string | undefined {
    const match = balances.find((balance) => balance.owner === accountAddress)
    return match?.mint
  }

  private classifyDestination(
    destination: string,
    tx: ParsedTransactionWithMeta,
  ): {
    categories: PlatformCategory[]
    matchedPlatforms: string[]
  } {
    const categories = new Set<PlatformCategory>()
    const matchedPlatforms = new Set<string>()

    const walletPlatform = KNOWN_PLATFORM_WALLETS[destination]
    if (walletPlatform) {
      categories.add(walletPlatform.category)
      matchedPlatforms.add(walletPlatform.label)
    }

    if (KNOWN_SCAM_WALLETS.some((wallet) => wallet.address === destination)) {
      categories.add('SCAM')
      matchedPlatforms.add('Known scam wallet list')
    }

    const accountKeys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58())

    for (const accountKey of accountKeys) {
      const knownProgram = KNOWN_PLATFORM_PROGRAMS[accountKey]
      if (knownProgram) {
        categories.add(knownProgram.category)
        matchedPlatforms.add(knownProgram.label)
      }
    }

    const logs = tx.meta?.logMessages?.join(' ').toLowerCase() || ''
    if (MIXER_KEYWORDS.some((keyword) => logs.includes(keyword))) {
      categories.add('MIXER')
      matchedPlatforms.add('Mixer keyword match in logs')
    }

    if (logs.includes('wormhole')) {
      categories.add('BRIDGE')
      matchedPlatforms.add('Wormhole route hint (log match)')
    }

    if (logs.includes('debridge') || logs.includes('de-bridge') || logs.includes('de bridge')) {
      categories.add('BRIDGE')
      matchedPlatforms.add('deBridge route hint (log match)')
    }

    if (categories.size === 0) {
      categories.add('UNKNOWN')
    }

    return {
      categories: Array.from(categories),
      matchedPlatforms: Array.from(matchedPlatforms),
    }
  }

  private shouldContinueTracing(step: FlowStep, nextHop: number, options: FlowTraceOptions): boolean {
    // Full-recipient traversal mode: continue through every wallet-like destination.
    if (options.followAllRecipients) {
      return this.isLikelyTraceTarget(step.to)
    }

    // Always fan-out through first-hop recipients when explicitly requested.
    if (options.traceAllFirstHopRecipients && nextHop === 1) {
      return this.isLikelyTraceTarget(step.to)
    }

    // Continue only through wallet-like unknown/scam paths to avoid noisy program accounts.
    if (!(step.categories.includes('UNKNOWN') || step.categories.includes('SCAM'))) {
      return false
    }

    return this.isLikelyTraceTarget(step.to)
  }

  private isLikelyTraceTarget(address: string): boolean {
    if (!address) return false
    if (KNOWN_PLATFORM_PROGRAMS[address]) return false

    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
    return base58Regex.test(address)
  }

  private buildCexDepositHeuristics(steps: FlowStep[]): CexDepositHeuristicSummary {
    const exchangeSteps = steps.filter((step) => step.categories.includes('EXCHANGE'))
    if (exchangeSteps.length === 0) {
      return {
        detected: false,
        confidence: 0,
        exchangeWalletCount: 0,
        exchangeTransferCount: 0,
        totalExchangeOutflowSol: 0,
        exchangeClusters: [],
        memoSignals: {
          memoTransferCount: 0,
          memoSignatureCount: 0,
          memoSamples: [],
        },
        evidence: [],
      }
    }

    const evidence: CexDepositEvidence[] = []
    const uniqueExchangeWallets = new Set(exchangeSteps.map((step) => step.to))
    const exchangeSolSteps = exchangeSteps.filter((step) => step.asset === 'SOL')
    const totalExchangeOutflowSol = exchangeSolSteps.reduce((acc, step) => acc + this.parseAmount(step.amount), 0)

    const byWallet = new Map<string, FlowStep[]>()
    for (const step of exchangeSteps) {
      const list = byWallet.get(step.to) || []
      list.push(step)
      byWallet.set(step.to, list)
    }

    const clusterByLabel = new Map<string, { wallets: Set<string>; transferCount: number }>()
    for (const step of exchangeSteps) {
      const labels = step.matchedPlatforms.length > 0 ? step.matchedPlatforms : ['UNKNOWN_EXCHANGE_TARGET']
      for (const label of labels) {
        const existing = clusterByLabel.get(label) || { wallets: new Set<string>(), transferCount: 0 }
        existing.transferCount += 1
        existing.wallets.add(step.to)
        clusterByLabel.set(label, existing)
      }
    }

    const exchangeClusters: CexExchangeCluster[] = Array.from(clusterByLabel.entries())
      .map(([label, info]) => ({
        label,
        walletCount: info.wallets.size,
        transferCount: info.transferCount,
        wallets: Array.from(info.wallets).slice(0, 12),
      }))
      .sort((a, b) => b.transferCount - a.transferCount)
      .slice(0, 12)

    for (const [wallet, walletSteps] of byWallet.entries()) {
      if (walletSteps.length >= 3) {
        const score = Math.min(40, 14 + (walletSteps.length - 3) * 7)
        evidence.push({
          code: 'REPEATED_EXCHANGE_TARGET',
          score,
          summary: `Repeated transfers to exchange wallet ${wallet}`,
          signatures: walletSteps.map((step) => step.signature).slice(0, 12),
          wallets: [wallet],
          details: { transferCount: walletSteps.length },
        })
      }
    }

    const roundSolSteps = exchangeSolSteps.filter((step) => this.isRoundSolAmount(this.parseAmount(step.amount)))
    if (roundSolSteps.length >= 3) {
      const score = Math.min(30, 12 + (roundSolSteps.length - 3) * 4)
      evidence.push({
        code: 'ROUND_SOL_AMOUNTS',
        score,
        summary: 'Multiple round-number SOL transfers into exchange wallets',
        signatures: roundSolSteps.map((step) => step.signature).slice(0, 12),
        wallets: Array.from(new Set(roundSolSteps.map((step) => step.to))).slice(0, 8),
        details: { roundTransferCount: roundSolSteps.length },
      })
    }

    if (uniqueExchangeWallets.size >= 2) {
      const score = uniqueExchangeWallets.size >= 3 ? 28 : 16
      evidence.push({
        code: 'MULTI_EXCHANGE_SPLIT',
        score,
        summary: `Funds split across ${uniqueExchangeWallets.size} exchange wallet targets`,
        signatures: exchangeSteps.map((step) => step.signature).slice(0, 12),
        wallets: Array.from(uniqueExchangeWallets).slice(0, 12),
        details: { exchangeWalletCount: uniqueExchangeWallets.size },
      })
    }

    const burstEvidence = this.detectBurstExchangeActivity(exchangeSteps)
    if (burstEvidence) {
      evidence.push(burstEvidence)
    }

    const memoExchangeSteps = exchangeSteps.filter((step) => step.memoPresent)
    const memoSignatureSet = new Set(memoExchangeSteps.map((step) => step.signature))
    const memoSamples = Array.from(
      new Set(
        memoExchangeSteps
          .map((step) => step.memoPreview)
          .filter((sample): sample is string => typeof sample === 'string' && sample.length > 0),
      ),
    ).slice(0, 5)

    if (memoExchangeSteps.length >= 2) {
      const score = Math.min(24, 8 + (memoExchangeSteps.length - 2) * 4)
      evidence.push({
        code: 'DEPOSIT_MEMO_HINT',
        score,
        summary: `Exchange transfer memo hints detected (${memoExchangeSteps.length} transfers)`,
        signatures: Array.from(memoSignatureSet).slice(0, 12),
        wallets: Array.from(new Set(memoExchangeSteps.map((step) => step.to))).slice(0, 8),
        details: {
          memoTransferCount: memoExchangeSteps.length,
          memoSignatureCount: memoSignatureSet.size,
        },
      })
    }

    const confidence = Math.max(
      0,
      Math.min(
        100,
        evidence.reduce((sum, item) => sum + item.score, 0),
      ),
    )
    return {
      detected: confidence >= 25,
      confidence,
      exchangeWalletCount: uniqueExchangeWallets.size,
      exchangeTransferCount: exchangeSteps.length,
      totalExchangeOutflowSol: Number(totalExchangeOutflowSol.toFixed(6)),
      exchangeClusters,
      memoSignals: {
        memoTransferCount: memoExchangeSteps.length,
        memoSignatureCount: memoSignatureSet.size,
        memoSamples,
      },
      evidence,
    }
  }

  private detectBurstExchangeActivity(exchangeSteps: FlowStep[]): CexDepositEvidence | null {
    const timed = exchangeSteps
      .filter((step) => typeof step.blockTime === 'number')
      .sort((a, b) => (a.blockTime as number) - (b.blockTime as number))

    if (timed.length < 4) return null

    let bestCount = 1
    let bestStart = timed[0].blockTime as number
    let bestEnd = timed[0].blockTime as number
    const windowSeconds = 15 * 60

    for (let i = 0; i < timed.length; i++) {
      const start = timed[i].blockTime as number
      let count = 1
      let end = start
      for (let j = i + 1; j < timed.length; j++) {
        const ts = timed[j].blockTime as number
        if (ts - start > windowSeconds) break
        count += 1
        end = ts
      }
      if (count > bestCount) {
        bestCount = count
        bestStart = start
        bestEnd = end
      }
    }

    if (bestCount < 4) return null

    const signatures = timed
      .filter((step) => {
        const ts = step.blockTime as number
        return ts >= bestStart && ts <= bestEnd
      })
      .map((step) => step.signature)
      .slice(0, 12)

    const wallets = Array.from(
      new Set(
        timed
          .filter((step) => {
            const ts = step.blockTime as number
            return ts >= bestStart && ts <= bestEnd
          })
          .map((step) => step.to),
      ),
    ).slice(0, 12)

    return {
      code: 'BURST_EXCHANGE_ACTIVITY',
      score: Math.min(35, 14 + (bestCount - 4) * 5),
      summary: `Burst exchange transfers detected (${bestCount} transfers within 15 minutes)`,
      signatures,
      wallets,
      details: {
        transferCount: bestCount,
        windowStart: new Date(bestStart * 1000).toISOString(),
        windowEnd: new Date(bestEnd * 1000).toISOString(),
      },
    }
  }

  private parseAmount(raw: string): number {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : 0
  }

  private isRoundSolAmount(amount: number): boolean {
    if (!Number.isFinite(amount) || amount <= 0) return false
    const nearestInteger = Math.round(amount)
    const nearestTenth = Math.round(amount * 10) / 10
    const nearestQuarter = Math.round(amount * 4) / 4
    return (
      Math.abs(amount - nearestInteger) < 1e-6 ||
      Math.abs(amount - nearestTenth) < 1e-6 ||
      Math.abs(amount - nearestQuarter) < 1e-6
    )
  }
}
