import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { registerGraphRoutes } from '../src/http/graph-routes'

describe('graph routes integration', () => {
  it('returns graph payload with nodes, edges, and cluster data', async () => {
    const app = express()

    registerGraphRoutes(app, {
      scamWalletRepository: {
        getLatestFlowTrace: vi.fn().mockResolvedValue({
          metadata: {
            steps: [
              {
                from: 'wallet-A',
                to: 'wallet-B',
                signature: 'sig-1',
                amount: '12.3',
                asset: 'SOL',
                hop: 1,
              },
            ],
          },
        }),
        getMixerRouteAudit: vi.fn().mockResolvedValue([]),
      },
      walletClusterService: {
        getLatestCluster: vi.fn().mockResolvedValue({
          clusterScore: 66,
          riskScore: 77,
          wallets: ['wallet-A', 'wallet-B'],
        }),
      },
    })

    const response = await request(app).get('/api/graph/wallet-A')

    expect(response.status).toBe(200)
    expect(response.body.wallet).toBe('wallet-A')
    expect(response.body.edges).toHaveLength(1)
    expect(response.body.nodes.some((node: { id: string }) => node.id === 'wallet-A')).toBe(true)
    expect(response.body.cluster.score).toBe(66)
    expect(response.body.cluster.riskScore).toBe(77)
  })

  it('serves graph frontend that consumes graph API endpoint', async () => {
    const app = express()

    registerGraphRoutes(app, {
      scamWalletRepository: {
        getLatestFlowTrace: vi.fn().mockResolvedValue(null),
        getMixerRouteAudit: vi.fn().mockResolvedValue([]),
      },
      walletClusterService: {
        getLatestCluster: vi.fn().mockResolvedValue(null),
      },
    })

    const response = await request(app).get('/graph/wallet-abc')

    expect(response.status).toBe(200)
    expect(response.text).toContain('Wallet Graph')
    expect(response.text).toContain("fetch('/api/graph/' + encodeURIComponent(wallet))")
    expect(response.text).toContain('wallet-abc')
  })

  it('supports attaching an auth middleware to graph routes', async () => {
    const app = express()

    registerGraphRoutes(app, {
      pageAuthMiddleware: (_req, res, _next) => {
        res.redirect(302, '/login?next=%2Fgraph%2Fwallet-abc')
      },
      scamWalletRepository: {
        getLatestFlowTrace: vi.fn().mockResolvedValue(null),
        getMixerRouteAudit: vi.fn().mockResolvedValue([]),
      },
      walletClusterService: {
        getLatestCluster: vi.fn().mockResolvedValue(null),
      },
    })

    const response = await request(app).get('/graph/wallet-abc')

    expect(response.status).toBe(302)
    expect(response.headers.location).toBe('/login?next=%2Fgraph%2Fwallet-abc')
  })

  it('supports attaching a separate API auth middleware to graph data endpoints', async () => {
    const app = express()

    registerGraphRoutes(app, {
      apiAuthMiddleware: (_req, res, _next) => {
        res.status(401).json({ message: 'Dashboard authentication required' })
      },
      scamWalletRepository: {
        getLatestFlowTrace: vi.fn().mockResolvedValue(null),
        getMixerRouteAudit: vi.fn().mockResolvedValue([]),
      },
      walletClusterService: {
        getLatestCluster: vi.fn().mockResolvedValue(null),
      },
    })

    const response = await request(app).get('/api/graph/wallet-abc')

    expect(response.status).toBe(401)
    expect(response.body).toEqual({ message: 'Dashboard authentication required' })
  })

  it('returns 503 for retrace when tracer dependency is missing', async () => {
    const app = express()
    app.use(express.json())

    registerGraphRoutes(app, {
      scamWalletRepository: {
        getLatestFlowTrace: vi.fn().mockResolvedValue(null),
        getMixerRouteAudit: vi.fn().mockResolvedValue([]),
      },
      walletClusterService: {
        getLatestCluster: vi.fn().mockResolvedValue(null),
      },
    })

    const response = await request(app).post('/api/graph/retrace').send({
      wallet: '11111111111111111111111111111111',
    })

    expect(response.status).toBe(503)
    expect(response.body).toEqual({ message: 'Fund flow tracer is not configured' })
  })

  it('validates retrace wallet input', async () => {
    const app = express()
    app.use(express.json())

    registerGraphRoutes(app, {
      scamWalletRepository: {
        getLatestFlowTrace: vi.fn().mockResolvedValue(null),
        getMixerRouteAudit: vi.fn().mockResolvedValue([]),
      },
      walletClusterService: {
        getLatestCluster: vi.fn().mockResolvedValue(null),
      },
      fundFlowTracer: {
        traceWalletFlow: vi.fn().mockResolvedValue({}),
      },
    })

    const missingWallet = await request(app).post('/api/graph/retrace').send({
      wallet: '   ',
    })
    expect(missingWallet.status).toBe(400)
    expect(missingWallet.body).toEqual({ message: 'wallet is required' })

    const invalidWallet = await request(app).post('/api/graph/retrace').send({
      wallet: 'not-a-wallet',
    })
    expect(invalidWallet.status).toBe(400)
    expect(invalidWallet.body).toEqual({ message: 'Invalid wallet address' })
  })

  it('clamps retrace bounds and returns full intelligence blocks', async () => {
    const app = express()
    app.use(express.json())

    const tracePayload = {
      wallet: '11111111111111111111111111111111',
      tracedAt: '2026-04-24T00:00:00.000Z',
      maxHops: 12,
      steps: [],
      alerts: ['test alert'],
      terminalWallets: [],
      mixerTrace: {
        encountered: true,
        mixerWallets: ['mix-wallet-1'],
        downstreamWallets: ['mix-downstream-1'],
      },
      platformTrace: {
        exchange: {
          encountered: true,
          wallets: ['ex-wallet-1'],
          downstreamWallets: ['ex-downstream-1'],
        },
        bridge: {
          encountered: true,
          wallets: ['bridge-wallet-1'],
          downstreamWallets: ['bridge-downstream-1'],
        },
      },
      bridgeRouteAttribution: {
        encountered: true,
        canonicalFamilies: ['WORMHOLE'],
        canonicalPrograms: ['Wormhole Token Bridge'],
        relayerWallets: ['relayer-wallet-1'],
        handoffWallets: ['handoff-wallet-1'],
        handoffs: [
          {
            signature: 'bridge-sig-1',
            hop: 2,
            from: 'from-wallet',
            to: 'bridge-wallet-1',
            amount: '1.25',
            asset: 'SOL',
            bridgeFamily: 'WORMHOLE',
            bridgeLabel: 'Wormhole Token Bridge',
            relayerHint: true,
          },
        ],
      },
      crossChainContinuation: {
        encountered: true,
        bridgeFamilies: ['WORMHOLE'],
        recommendedNextChains: ['ethereum', 'base'],
        continuationCandidates: [
          {
            sourceWallet: 'from-wallet',
            bridgeWallet: 'bridge-wallet-1',
            signature: 'bridge-sig-1',
            hop: 2,
            bridgeFamily: 'WORMHOLE',
            bridgeLabel: 'Wormhole Token Bridge',
            candidateNextChains: ['ethereum', 'base'],
            resolverHint: 'wormhole:vaa-search',
            confidence: 70,
            reason: 'Bridge handoff includes relayer characteristics; prioritize resolver lookup.',
          },
        ],
        unresolvedHandoffs: ['handoff-wallet-1'],
        notes: ['Scaffold output only'],
      },
      riskConfidenceModel: {
        modelVersion: '1.0.0',
        baseConfidence: 85,
        attenuation: 30,
        adjustedConfidence: 55,
        degradationLevel: 'MEDIUM',
        boundariesCrossed: ['MIXER', 'EXCHANGE', 'CEX_DEPOSIT', 'BRIDGE'],
        events: [
          {
            boundary: 'MIXER',
            hop: 1,
            signature: 'sig-mixer',
            wallet: 'mix-wallet-1',
            impact: 18,
            reason: 'Mixer boundary crossed',
          },
        ],
        notes: ['Confidence degrades after privacy/custodial boundaries'],
      },
      cexDepositHeuristics: {
        detected: true,
        confidence: 62,
        exchangeWalletCount: 2,
        exchangeTransferCount: 5,
        totalExchangeOutflowSol: 13.4,
        exchangeClusters: [
          {
            label: 'Sample Exchange',
            walletCount: 2,
            transferCount: 5,
            wallets: ['ex-wallet-1', 'ex-wallet-2'],
          },
        ],
        memoSignals: {
          memoTransferCount: 2,
          memoSignatureCount: 2,
          memoSamples: ['memo-example'],
        },
        evidence: [
          {
            code: 'REPEATED_EXCHANGE_TARGET',
            score: 20,
            summary: 'Repeated transfers to exchange wallet',
            signatures: ['sig-1', 'sig-2'],
            wallets: ['ex-wallet-1'],
            details: {
              transferCount: 5,
            },
          },
        ],
      },
    }

    const traceWalletFlow = vi.fn().mockResolvedValue(tracePayload)

    registerGraphRoutes(app, {
      scamWalletRepository: {
        getLatestFlowTrace: vi.fn().mockResolvedValue(null),
        getMixerRouteAudit: vi.fn().mockResolvedValue([]),
      },
      walletClusterService: {
        getLatestCluster: vi.fn().mockResolvedValue(null),
      },
      fundFlowTracer: {
        traceWalletFlow,
      },
    })

    const wallet = '11111111111111111111111111111111'
    const response = await request(app).post('/api/graph/retrace').send({
      wallet,
      maxHops: 999,
      signaturesPerHop: -2,
      maxVisitedWallets: 99999,
      followAllRecipients: false,
      traceAllFirstHopRecipients: true,
    })

    expect(response.status).toBe(200)
    expect(traceWalletFlow).toHaveBeenCalledWith(wallet, 12, 1, {
      followAllRecipients: false,
      traceAllFirstHopRecipients: true,
      maxVisitedWallets: 2000,
    })

    expect(response.body.config).toEqual({
      maxHops: 12,
      signaturesPerHop: 1,
      maxVisitedWallets: 2000,
      followAllRecipients: false,
      traceAllFirstHopRecipients: true,
    })

    expect(response.body.trace.bridgeRouteAttribution).toBeDefined()
    expect(response.body.trace.crossChainContinuation).toBeDefined()
    expect(response.body.trace.riskConfidenceModel).toBeDefined()
    expect(response.body.trace.cexDepositHeuristics).toBeDefined()
    expect(response.body.trace.riskConfidenceModel.adjustedConfidence).toBeLessThan(
      response.body.trace.riskConfidenceModel.baseConfidence,
    )
    expect(response.body.trace.riskConfidenceModel.boundariesCrossed).toContain('MIXER')
    expect(response.body.trace.crossChainContinuation.continuationCandidates.length).toBeGreaterThan(0)
    expect(response.body.trace.bridgeRouteAttribution.handoffs.length).toBeGreaterThan(0)
  })
})
