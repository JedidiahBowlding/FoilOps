import { describe, expect, it } from 'vitest'
import { renderAlertTemplate, resolveAlertChatId, shouldDeliverAlert } from '../src/lib/scam-wallet-monitor'
import { AlertEventType } from '@prisma/client'

describe('alert delivery semantics', () => {
  it('applies threshold logic on risk and transaction size', () => {
    const rule = {
      id: 'rule-1',
      userId: '12345',
      minRiskScore: 70,
      minTransactionSize: 10,
      eventTypes: ['ANOMALY_DETECTED'] as AlertEventType[],
    }

    expect(
      shouldDeliverAlert(rule, {
        eventType: 'ANOMALY_DETECTED',
        walletAddress: 'wallet-A',
        riskScore: 75,
        transactionSize: 12,
      }),
    ).toBe(true)

    expect(
      shouldDeliverAlert(rule, {
        eventType: 'ANOMALY_DETECTED',
        walletAddress: 'wallet-A',
        riskScore: 65,
        transactionSize: 12,
      }),
    ).toBe(false)

    expect(
      shouldDeliverAlert(rule, {
        eventType: 'ANOMALY_DETECTED',
        walletAddress: 'wallet-A',
        riskScore: 75,
        transactionSize: 8,
      }),
    ).toBe(false)
  })

  it('resolves chat route using explicit env override and fallback user id', () => {
    process.env.ALERT_CHAT_ID_12345 = '-100777'
    expect(resolveAlertChatId('12345')).toBe(-100777)

    delete process.env.ALERT_CHAT_ID_12345
    expect(resolveAlertChatId('12345')).toBe(12345)
    expect(resolveAlertChatId('')).toBe(null)
  })

  it('renders event-specific templates', () => {
    const prelaunch = renderAlertTemplate({
      eventType: 'SUSPICIOUS_PRELAUNCH_SIGNAL',
      walletAddress: 'wallet-A',
      tokenMint: 'mint-A',
      riskScore: 88,
      details: 'cluster-linked wallet pattern',
    })

    const anomaly = renderAlertTemplate({
      eventType: 'ANOMALY_DETECTED',
      walletAddress: 'wallet-B',
      tokenMint: 'mint-B',
      riskScore: 79,
      details: 'rapid multi-hop',
    })

    expect(prelaunch).toContain('PRELAUNCH RISK SIGNAL')
    expect(prelaunch).toContain('cluster-linked wallet pattern')
    expect(anomaly).toContain('ANOMALY DETECTED')
    expect(anomaly).toContain('rapid multi-hop')
  })
})
