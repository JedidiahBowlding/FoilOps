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
      },
      walletClusterService: {
        getLatestCluster: vi.fn().mockResolvedValue(null),
      },
    })

    const response = await request(app).get('/api/graph/wallet-abc')

    expect(response.status).toBe(401)
    expect(response.body).toEqual({ message: 'Dashboard authentication required' })
  })
})
