import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ScamWalletCommand } from '../src/bot/commands/scam-wallet-command'

type TextHandler = {
  regex: RegExp
  cb: (msg: any, match: RegExpMatchArray | null) => Promise<void>
}

class FakeTelegramBot {
  public textHandlers: TextHandler[] = []
  public messages: Array<{ chatId: number; text: string; options?: Record<string, unknown> }> = []

  onText(regex: RegExp, cb: (msg: any, match: RegExpMatchArray | null) => Promise<void>) {
    this.textHandlers.push({ regex, cb })
  }

  async sendMessage(chatId: number, text: string, options?: Record<string, unknown>) {
    this.messages.push({ chatId, text, options })
    return { message_id: this.messages.length }
  }

  async trigger(text: string, chatId = 999) {
    const handler = this.textHandlers.find((item) => item.regex.test(text))
    if (!handler) throw new Error(`No handler registered for: ${text}`)

    const match = text.match(handler.regex)
    await handler.cb(
      {
        chat: { id: chatId },
        from: { id: chatId },
      },
      match,
    )
  }
}

describe('scam wallet command integration', () => {
  beforeEach(() => {
    process.env.ADMIN_CHAT_ID = '999'
  })

  it('handles /cluster and records a cluster alert event', async () => {
    const bot = new FakeTelegramBot()
    const command = new ScamWalletCommand(bot as any, {} as any)

    const mockClusterService = {
      buildCluster: vi.fn().mockResolvedValue({
        linkedWallets: ['wallet-B', 'wallet-C'],
        clusterScore: 70,
        combinedRiskScore: 82,
        sharedBehaviors: {
          sharedFundingSources: ['fund-A'],
          repeatedInteractionPatterns: ['repeat-1'],
          flowOverlaps: ['flow-1'],
          deploymentRelationships: ['deploy-1'],
        },
      }),
    }

    const mockScamRepo = {
      recordEvent: vi.fn().mockResolvedValue({ id: 'evt-1' }),
      getRecentAlerts: vi.fn().mockResolvedValue([]),
      getLatestFlowTrace: vi.fn().mockResolvedValue(null),
      manualFlagWallet: vi.fn(),
      manualUnflagWallet: vi.fn(),
      saveFlowTrace: vi.fn(),
      saveTokenInvestigation: vi.fn(),
    }

    ;(command as any).walletClusterService = mockClusterService
    ;(command as any).scamWalletRepository = mockScamRepo

    command.registerHandlers()

    await bot.trigger('/cluster wallet-A')

    expect(mockClusterService.buildCluster).toHaveBeenCalledWith('wallet-A')
    expect(mockScamRepo.recordEvent).toHaveBeenCalled()
    expect(bot.messages.some((item) => item.text.includes('Wallet Cluster Report'))).toBe(true)
  })

  it('handles /set_alert, /view_alerts and /delete_alert flow', async () => {
    const bot = new FakeTelegramBot()
    const command = new ScamWalletCommand(bot as any, {} as any)

    const mockRuleRepo = {
      setRule: vi.fn().mockResolvedValue({
        id: 'rule-1',
        minRiskScore: 80,
        minTransactionSize: 1.2,
        eventTypes: ['ANOMALY_DETECTED'],
      }),
      listRules: vi.fn().mockResolvedValue([
        {
          id: 'rule-1',
          minRiskScore: 80,
          minTransactionSize: 1.2,
          eventTypes: ['ANOMALY_DETECTED'],
        },
      ]),
      deleteRule: vi.fn().mockResolvedValue({ id: 'rule-1' }),
    }

    ;(command as any).userAlertRuleRepository = mockRuleRepo

    command.registerHandlers()

    await bot.trigger('/set_alert 80 1.2 ANOMALY_DETECTED')
    await bot.trigger('/view_alerts')
    await bot.trigger('/delete_alert rule-1')

    expect(mockRuleRepo.setRule).toHaveBeenCalled()
    expect(mockRuleRepo.listRules).toHaveBeenCalledWith('999')
    expect(mockRuleRepo.deleteRule).toHaveBeenCalledWith('999', 'rule-1')
    expect(bot.messages.some((item) => item.text.includes('Alert rule saved'))).toBe(true)
    expect(bot.messages.some((item) => item.text.includes('Your Alert Rules'))).toBe(true)
    expect(bot.messages.some((item) => item.text.includes('Alert rule deleted'))).toBe(true)
  })
})
