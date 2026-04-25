import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { registerGraphRoutes } from '../src/http/graph-routes'

describe('mixer route dashboard', () => {
  it('renders configurable bulk controls and source export actions', async () => {
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

    const response = await request(app).get('/dashboard/mixer-routes')

    expect(response.status).toBe(200)
    expect(response.text).toContain('id="mixer-route-bulk-tab-cap"')
    expect(response.text).toContain('id="mixer-route-source-export-json"')
    expect(response.text).toContain('id="mixer-route-source-export-csv"')
    expect(response.text).toContain('DEFAULT_BULK_OPEN_CAP = 25')
    expect(response.text).toContain("params.get('tabCap')")
    expect(response.text).toContain("walletType: 'source'")
    expect(response.text).toContain('function getBulkOpenCap()')
  })

  it('renders view export and capped bulk-open controls in the dashboard script', async () => {
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

    const response = await request(app).get('/dashboard/mixer-routes?view=mixer&tabCap=12')

    expect(response.status).toBe(200)
    expect(response.text).toContain('id="mixer-route-bulk-export-json"')
    expect(response.text).toContain('id="mixer-route-bulk-export-csv"')
    expect(response.text).toContain('id="mixer-route-bulk-open"')
    expect(response.text).toContain('This action targets ')
    expect(response.text).toContain('bulk graph open is capped at ')
    expect(response.text).toContain('function getBulkExportBaseName()')
    expect(response.text).toContain(
      "return 'mixer-route-' + getSubviewKey() + '-wallets-page-' + currentPage + '-' + dateStamp",
    )
  })
})
