import { afterEach, describe, expect, it } from 'vitest'
import {
  buildTradingSettingsOperations,
  getTradingBotBaseUrl,
  resolveTradingQuickActionPath,
} from '../src/lib/web-control-utils'

describe('web control utils', () => {
  const originalEnv = {
    TRADING_BOT_URL: process.env.TRADING_BOT_URL,
    SIGNAL_RECEIVER_BIND: process.env.SIGNAL_RECEIVER_BIND,
  }

  afterEach(() => {
    process.env.TRADING_BOT_URL = originalEnv.TRADING_BOT_URL
    process.env.SIGNAL_RECEIVER_BIND = originalEnv.SIGNAL_RECEIVER_BIND
  })

  it('resolves the expected trading quick action paths', () => {
    expect(resolveTradingQuickActionPath('enable')).toBe('/trading/enable')
    expect(resolveTradingQuickActionPath('kill-switch')).toBe('/trading/kill-switch')
    expect(resolveTradingQuickActionPath('missing')).toBeNull()
  })

  it('builds only the trading setting operations that were actually provided', () => {
    const operations = buildTradingSettingsOperations({
      profile: 'conservative',
      executionMode: 'paper',
      buyAmountSol: 0.01,
      minAlertQualityScore: 70,
    })

    expect(operations).toEqual([
      { path: '/trading/profile', body: { profile: 'conservative' } },
      { path: '/trading/size', body: { buy_amount_sol: 0.01 } },
      { path: '/trading/alert-quality', body: { min_alert_quality_score: 70 } },
      { path: '/trading/execution-mode', body: { mode: 'paper' } },
    ])
  })

  it('applies explicit mode after profile and all other settings', () => {
    const operations = buildTradingSettingsOperations({
      profile: 'conservative',
      mode: 'copy_trade',
      executionMode: 'live',
      buyAmountSol: 0.01,
      maxRiskScore: 90,
    })

    expect(operations[0]).toEqual({ path: '/trading/profile', body: { profile: 'conservative' } })
    expect(operations[operations.length - 2]).toEqual({ path: '/trading/execution-mode', body: { mode: 'live' } })
    expect(operations[operations.length - 1]).toEqual({ path: '/trading/mode', body: { mode: 'copy_trade' } })
  })

  it('prefers TRADING_BOT_URL and falls back to SIGNAL_RECEIVER_BIND', () => {
    process.env.TRADING_BOT_URL = 'http://127.0.0.1:9999/'
    process.env.SIGNAL_RECEIVER_BIND = '0.0.0.0:8787'
    expect(getTradingBotBaseUrl()).toBe('http://127.0.0.1:9999')

    delete process.env.TRADING_BOT_URL
    process.env.SIGNAL_RECEIVER_BIND = '0.0.0.0:8787'
    expect(getTradingBotBaseUrl()).toBe('http://127.0.0.1:8787')
  })
})
