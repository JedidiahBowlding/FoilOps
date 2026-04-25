import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { registerGraphRoutes } from '../src/http/graph-routes'

const VALID_WALLET = '11111111111111111111111111111111'

describe('graph retrace negative paths', () => {
  it('returns 500 when retrace tracer throws', async () => {
    const app = express()
    app.use(express.json())

    const traceWalletFlow = vi.fn().mockRejectedValue(new Error('rpc unavailable'))

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

    const response = await request(app).post('/api/graph/retrace').send({
      wallet: VALID_WALLET,
    })

    expect(response.status).toBe(500)
    expect(response.body).toEqual({ message: 'Failed to run deep retrace' })
    expect(traceWalletFlow).toHaveBeenCalledTimes(1)
  })

  it('passes through malformed primitive tracer payload without crashing', async () => {
    const app = express()
    app.use(express.json())

    const traceWalletFlow = vi.fn().mockResolvedValue('malformed-trace-payload')

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

    const response = await request(app).post('/api/graph/retrace').send({
      wallet: VALID_WALLET,
    })

    expect(response.status).toBe(200)
    expect(response.body.wallet).toBe(VALID_WALLET)
    expect(response.body.trace).toBe('malformed-trace-payload')
  })

  it('fails safely when tracer returns circular payload', async () => {
    const app = express()
    app.use(express.json())

    const circular: Record<string, unknown> = {}
    circular.self = circular
    const traceWalletFlow = vi.fn().mockResolvedValue(circular)

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

    const response = await request(app).post('/api/graph/retrace').send({
      wallet: VALID_WALLET,
    })

    expect(response.status).toBe(500)
    expect(response.body).toEqual({ message: 'Failed to run deep retrace' })
  })

  it('lets API auth middleware deny retrace and never invokes tracer', async () => {
    const app = express()
    app.use(express.json())

    const traceWalletFlow = vi.fn().mockResolvedValue({ ok: true })

    registerGraphRoutes(app, {
      apiAuthMiddleware: (_req, res, _next) => {
        res.status(403).json({ message: 'Forbidden by test auth middleware' })
      },
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

    const response = await request(app).post('/api/graph/retrace').send({
      wallet: VALID_WALLET,
    })

    expect(response.status).toBe(403)
    expect(response.body).toEqual({ message: 'Forbidden by test auth middleware' })
    expect(traceWalletFlow).not.toHaveBeenCalled()
  })

  it('handles auth middleware body mutation edge case (wallet removed)', async () => {
    const app = express()
    app.use(express.json())

    const traceWalletFlow = vi.fn().mockResolvedValue({ ok: true })

    registerGraphRoutes(app, {
      apiAuthMiddleware: (req, _res, next) => {
        if (req.body && typeof req.body === 'object') {
          delete (req.body as Record<string, unknown>).wallet
        }
        next()
      },
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

    const response = await request(app).post('/api/graph/retrace').send({
      wallet: VALID_WALLET,
    })

    expect(response.status).toBe(400)
    expect(response.body).toEqual({ message: 'wallet is required' })
    expect(traceWalletFlow).not.toHaveBeenCalled()
  })
})
