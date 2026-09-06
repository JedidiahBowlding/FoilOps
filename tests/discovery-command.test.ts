import { describe, expect, it, vi } from 'vitest'
import { DiscoveryCommand } from '../src/bot/commands/discovery-command'
import { TELEGRAM_COMMANDS } from '../src/config/telegram-commands'

describe('DiscoveryCommand', () => {
  it('registers every discovery slash command', () => {
    const patterns: RegExp[] = []
    const bot = {
      onText: vi.fn((pattern: RegExp) => patterns.push(pattern)),
      sendMessage: vi.fn(),
    }
    const ingestor = { getStatus: vi.fn(), pollOnce: vi.fn() }
    const repository = { list: vi.fn(), getHistory: vi.fn() }

    new DiscoveryCommand(bot as never, ingestor as never, repository as never).registerHandlers()

    const registered = patterns.map((pattern) => pattern.source).join('\n')
    for (const command of [
      'discovery',
      'discovery_status',
      'discoveries',
      'robinhood',
      'candidate',
      'discovery_scan',
    ]) {
      expect(registered).toContain(command)
      expect(TELEGRAM_COMMANDS.some((entry) => entry.command === command)).toBe(true)
    }
  })

  it('keeps the Telegram command menu within API limits', () => {
    expect(TELEGRAM_COMMANDS.length).toBeLessThanOrEqual(100)
    for (const entry of TELEGRAM_COMMANDS) {
      expect(entry.command).toMatch(/^[a-z0-9_]{1,32}$/)
      expect(entry.description.length).toBeLessThanOrEqual(256)
    }
  })
})
