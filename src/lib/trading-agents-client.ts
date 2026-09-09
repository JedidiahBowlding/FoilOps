export type TradingAgentsStatus = { enabled: boolean; reachable: boolean; configured: boolean; message?: string }

export class TradingAgentsClient {
  private readonly enabled = process.env.TRADINGAGENTS_ENABLED === 'true'
  private readonly baseUrl = (process.env.TRADINGAGENTS_BRIDGE_URL || 'http://127.0.0.1:8790').replace(/\/$/, '')
  private readonly token = process.env.TRADINGAGENTS_BRIDGE_TOKEN?.trim() || ''

  async status(): Promise<TradingAgentsStatus> {
    if (!this.enabled) return { enabled: false, reachable: false, configured: Boolean(this.token), message: 'Disabled by server configuration' }
    try {
      const response = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(2_000) })
      const body = await response.json() as { configured?: boolean }
      return { enabled: true, reachable: response.ok, configured: body.configured === true }
    } catch { return { enabled: true, reachable: false, configured: Boolean(this.token), message: 'Python research service is unavailable' } }
  }

  async analyzeTicker(input: { ticker: string; date?: string }): Promise<unknown> {
    if (!this.enabled) throw new Error('TradingAgents is disabled')
    if (!this.token) throw new Error('TradingAgents bridge token is not configured')
    const response = await fetch(`${this.baseUrl}/v1/analyze/ticker`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify(input), signal: AbortSignal.timeout(15 * 60_000),
    })
    const body = await response.json() as { message?: string }
    if (!response.ok) throw new Error(body.message || `TradingAgents returned HTTP ${response.status}`)
    return body
  }

  async analyzeContract(input: { chain: string; address: string; evidence: unknown }): Promise<unknown> {
    return this.post('/v1/analyze/contract', input)
  }

  private async post(path: string, input: unknown): Promise<unknown> {
    if (!this.enabled) throw new Error('TradingAgents is disabled')
    if (!this.token) throw new Error('TradingAgents bridge token is not configured')
    const response = await fetch(`${this.baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` }, body: JSON.stringify(input), signal: AbortSignal.timeout(15 * 60_000) })
    const body = await response.json() as { message?: string }
    if (!response.ok) throw new Error(body.message || `TradingAgents returned HTTP ${response.status}`)
    return body
  }
}
