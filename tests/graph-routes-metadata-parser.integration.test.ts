import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { registerGraphRoutes } from '../src/http/graph-routes'

describe('graph routes metadata parser resilience', () => {
  it('keeps /api/graph resilient when persisted metadata is a primitive', async () => {
    const app = express()

    registerGraphRoutes(app, {
      scamWalletRepository: {
        getLatestFlowTrace: vi.fn().mockResolvedValue({ metadata: 'corrupt-metadata' }),
        getMixerRouteAudit: vi.fn().mockResolvedValue([]),
      },
      walletClusterService: {
        getLatestCluster: vi.fn().mockResolvedValue(null),
      },
    })

    const response = await request(app).get('/api/graph/wallet-corrupt')

    expect(response.status).toBe(200)
    expect(response.body.wallet).toBe('wallet-corrupt')
    expect(response.body.trace).toEqual({
      alerts: [],
      terminalWallets: [],
      mixerTrace: null,
      platformTrace: null,
      bridgeRouteAttribution: null,
      crossChainContinuation: null,
      riskConfidenceModel: null,
      cexDepositHeuristics: null,
    })
    expect(response.body.edges).toEqual([])
    expect(response.body.nodes.some((node: { id: string }) => node.id === 'wallet-corrupt')).toBe(true)
  })

  it('sanitizes partial or malformed historical trace metadata fields', async () => {
    const app = express()

    registerGraphRoutes(app, {
      scamWalletRepository: {
        getLatestFlowTrace: vi.fn().mockResolvedValue({
          metadata: {
            steps: 'not-an-array',
            alerts: ['ok-alert', 123, null],
            terminalWallets: [
              {
                address: 'wallet-1',
                hop: 'bad-hop',
                reason: 999,
                reachedViaMixer: 'yes',
                firstMixerHop: 'nope',
              },
              {
                address: 42,
              },
            ],
            mixerTrace: {
              encountered: 'true',
              mixerWallets: ['mix-1', 123],
              downstreamWallets: ['down-1', false],
            },
            platformTrace: {
              exchange: {
                encountered: 'yes',
                wallets: ['ex-1', null],
                downstreamWallets: ['ex-down-1', 88],
              },
              bridge: {
                encountered: true,
                wallets: ['bridge-1', {}],
                downstreamWallets: ['bridge-down-1', []],
              },
            },
            bridgeRouteAttribution: {
              encountered: true,
              canonicalFamilies: ['WORMHOLE', 2],
              canonicalPrograms: ['Wormhole Token Bridge', false],
              relayerWallets: ['relayer-1', 55],
              handoffWallets: ['handoff-1', null],
              handoffs: [
                {
                  signature: 'bridge-sig-1',
                  hop: '2',
                  from: 'from-wallet',
                  to: 'to-wallet',
                  amount: 1.5,
                  asset: 99,
                  bridgeFamily: 7,
                  bridgeLabel: null,
                  relayerHint: 'true',
                },
                {
                  signature: 55,
                },
              ],
            },
            crossChainContinuation: {
              encountered: true,
              bridgeFamilies: ['WORMHOLE', 7],
              recommendedNextChains: ['ethereum', {}],
              continuationCandidates: [
                {
                  signature: 'candidate-sig-1',
                  sourceWallet: 'src-1',
                  bridgeWallet: 'bridge-1',
                  hop: '2',
                  bridgeFamily: 999,
                  bridgeLabel: false,
                  candidateNextChains: ['base', 1],
                  resolverHint: null,
                  confidence: '70',
                  reason: 77,
                  observedAt: 123,
                },
              ],
              unresolvedHandoffs: ['handoff-1', 8],
              notes: ['note-1', 10],
            },
            riskConfidenceModel: {
              modelVersion: 1,
              baseConfidence: '85',
              attenuation: null,
              adjustedConfidence: '50',
              degradationLevel: 12,
              boundariesCrossed: ['MIXER', 4],
              events: [
                {
                  boundary: 'MIXER',
                  hop: '1',
                  signature: 44,
                  wallet: null,
                  impact: '10',
                  reason: 7,
                },
              ],
              notes: ['note-a', 9],
            },
            cexDepositHeuristics: {
              detected: 'true',
              confidence: '66',
              exchangeWalletCount: '4',
              exchangeTransferCount: null,
              totalExchangeOutflowSol: '9.8',
              exchangeClusters: [
                {
                  label: 'Exchange Label',
                  walletCount: '2',
                  transferCount: '5',
                  wallets: ['ex-1', 2],
                },
              ],
              memoSignals: {
                memoTransferCount: '2',
                memoSignatureCount: null,
                memoSamples: ['memo-1', 2],
              },
              evidence: [
                {
                  code: 'REPEATED_EXCHANGE_TARGET',
                  score: '20',
                  summary: 777,
                  signatures: ['sig-1', 2],
                  wallets: ['w1', null],
                  details: {
                    k: 'v',
                  },
                },
              ],
            },
          },
        }),
        getMixerRouteAudit: vi.fn().mockResolvedValue([]),
      },
      walletClusterService: {
        getLatestCluster: vi.fn().mockResolvedValue(null),
      },
    })

    const response = await request(app).get('/api/graph/wallet-corrupt-nested')

    expect(response.status).toBe(200)
    expect(response.body.trace.alerts).toEqual(['ok-alert'])
    expect(response.body.trace.terminalWallets).toEqual([
      {
        address: 'wallet-1',
        hop: 0,
        reason: 'UNKNOWN',
        reachedViaMixer: false,
        firstMixerHop: null,
      },
    ])
    expect(response.body.trace.mixerTrace).toEqual({
      encountered: false,
      mixerWallets: ['mix-1'],
      downstreamWallets: ['down-1'],
    })
    expect(response.body.trace.platformTrace).toEqual({
      exchange: {
        encountered: false,
        wallets: ['ex-1'],
        downstreamWallets: ['ex-down-1'],
      },
      bridge: {
        encountered: true,
        wallets: ['bridge-1'],
        downstreamWallets: ['bridge-down-1'],
      },
    })
    expect(response.body.trace.bridgeRouteAttribution.handoffs[0]).toEqual({
      signature: 'bridge-sig-1',
      hop: 0,
      from: 'from-wallet',
      to: 'to-wallet',
      amount: '0',
      asset: 'UNKNOWN',
      bridgeFamily: 'GENERIC_BRIDGE',
      bridgeLabel: 'Unknown bridge route',
      relayerHint: false,
    })
    expect(response.body.trace.crossChainContinuation.continuationCandidates[0]).toEqual({
      sourceWallet: 'src-1',
      bridgeWallet: 'bridge-1',
      signature: 'candidate-sig-1',
      hop: 0,
      bridgeFamily: 'GENERIC_BRIDGE',
      bridgeLabel: 'Unknown bridge route',
      candidateNextChains: ['base'],
      resolverHint: 'bridge:manual-correlation',
      confidence: 0,
      reason: 'No reason provided',
    })
    expect(response.body.trace.riskConfidenceModel).toEqual({
      modelVersion: 'unknown',
      baseConfidence: 0,
      attenuation: 0,
      adjustedConfidence: 0,
      degradationLevel: 'LOW',
      boundariesCrossed: ['MIXER'],
      events: [
        {
          boundary: 'MIXER',
          hop: 0,
          signature: '',
          wallet: '',
          impact: 0,
          reason: '',
        },
      ],
      notes: ['note-a'],
    })
    expect(response.body.trace.cexDepositHeuristics).toEqual({
      detected: false,
      confidence: 0,
      exchangeWalletCount: 0,
      exchangeTransferCount: 0,
      totalExchangeOutflowSol: 0,
      exchangeClusters: [
        {
          label: 'Exchange Label',
          walletCount: 0,
          transferCount: 0,
          wallets: ['ex-1'],
        },
      ],
      memoSignals: {
        memoTransferCount: 0,
        memoSignatureCount: 0,
        memoSamples: ['memo-1'],
      },
      evidence: [
        {
          code: 'REPEATED_EXCHANGE_TARGET',
          score: 0,
          summary: '',
          signatures: ['sig-1'],
          wallets: ['w1'],
          details: {
            k: 'v',
          },
        },
      ],
    })
  })
})
