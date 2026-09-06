import { DetectedLaunch } from './new-launch-types'

type JsonRpcResponse<T> = { id?: number; result?: T; error?: { message?: string } }
type EvmTransaction = { hash: string; from: string; to: string | null }
type EvmBlock = { number: string; timestamp: string; transactions: EvmTransaction[] }

export class RobinhoodChainLaunchSource {
  readonly name = 'robinhood-chain'
  private readonly officialMainnetRpc = 'https://rpc.mainnet.chain.robinhood.com/'

  isEnabled(): boolean {
    return process.env.ROBINHOOD_CHAIN_INGESTION_ENABLED === 'true'
  }

  async fetchSince(cursor: string | null, limit: number): Promise<{ launches: DetectedLaunch[]; cursor: string | null }> {
    if (!this.isEnabled()) return { launches: [], cursor }
    const actualChainId = Number.parseInt(await this.rpc<string>('eth_chainId', []), 16)
    const expectedChainId = Number(process.env.ROBINHOOD_CHAIN_ID || 4663)
    if (actualChainId !== expectedChainId) {
      throw new Error(`Robinhood RPC chain ID mismatch: expected ${expectedChainId}, received ${actualChainId}`)
    }
    const latestHex = await this.rpc<string>('eth_blockNumber', [])
    const latest = Number.parseInt(latestHex, 16)
    const configuredStart = Number(process.env.ROBINHOOD_CHAIN_START_BLOCK || latest)
    const previous = cursor ? Number(cursor) : configuredStart - 1
    const maxBlocks = Math.max(1, Math.min(2_000, Number(process.env.ROBINHOOD_CHAIN_MAX_BLOCKS_PER_POLL || 500)))
    const end = Math.min(latest, previous + maxBlocks)
    const launches: DetectedLaunch[] = []

    const blockNumbers = Array.from({ length: Math.max(0, end - previous) }, (_, index) => previous + index + 1)
    const blocks = blockNumbers.length === 1
      ? [await this.rpc<EvmBlock>('eth_getBlockByNumber', [`0x${blockNumbers[0].toString(16)}`, true])]
      : await this.rpcBatchChunked<EvmBlock>(blockNumbers.map((blockNumber) => ({
          method: 'eth_getBlockByNumber',
          params: [`0x${blockNumber.toString(16)}`, true],
        })))
    const deployments = blocks.flatMap((block) =>
      (block.transactions || []).filter((transaction) => transaction.to === null).map((transaction) => ({ block, transaction })),
    )
    const receiptCalls = deployments.map(({ transaction }) => ({
      method: 'eth_getTransactionReceipt',
      params: [transaction.hash],
    }))
    const receipts = receiptCalls.length === 1
      ? [await this.rpc<{ status?: string; contractAddress?: string }>(receiptCalls[0].method, receiptCalls[0].params)]
      : await this.rpcBatchChunked<{ status?: string; contractAddress?: string }>(receiptCalls)

    for (let index = 0; index < deployments.length && launches.length < limit; index += 1) {
      const { block, transaction } = deployments[index]
      const receipt = receipts[index]
      const blockNumber = Number.parseInt(block.number, 16)
      if (receipt.status !== '0x1' || !receipt.contractAddress) continue
      launches.push({
        chain: 'robinhood',
        tokenMint: receipt.contractAddress.toLowerCase(),
        signature: transaction.hash,
        creatorWallet: transaction.from?.toLowerCase() || null,
        source: this.name,
        slot: blockNumber,
        detectedAt: new Date(Number.parseInt(block.timestamp, 16) * 1000),
      })
    }
    return { launches, cursor: String(end) }
  }

  private async rpcBatch<T>(calls: Array<{ method: string; params: unknown[] }>): Promise<T[]> {
    if (calls.length === 0) return []
    let response: Response | null = null
    for (let attempt = 0; attempt < 4; attempt += 1) {
      response = await fetch(process.env.ROBINHOOD_CHAIN_RPC_URL || this.officialMainnetRpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(calls.map((call, index) => ({ jsonrpc: '2.0', id: index + 1, ...call }))),
        signal: AbortSignal.timeout(30_000),
      })
      if (response.status !== 429) break
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
    }
    if (!response) throw new Error('Robinhood RPC batch returned no response')
    if (!response.ok) throw new Error(`Robinhood RPC batch HTTP ${response.status}`)
    const payload = (await response.json()) as Array<JsonRpcResponse<T>>
    if (!Array.isArray(payload)) throw new Error('Robinhood RPC batch returned an invalid response')
    const byId = new Map(payload.map((item) => [item.id, item]))
    return calls.map((_, index) => {
      const item = byId.get(index + 1)
      if (!item || item.error || item.result === undefined) {
        throw new Error(item?.error?.message || 'Robinhood RPC batch call failed')
      }
      return item.result
    })
  }

  private async rpcBatchChunked<T>(calls: Array<{ method: string; params: unknown[] }>): Promise<T[]> {
    const results: T[] = []
    const chunkSize = 5
    for (let offset = 0; offset < calls.length; offset += chunkSize) {
      const chunk = calls.slice(offset, offset + chunkSize)
      let completed = false
      for (let attempt = 0; attempt < 5 && !completed; attempt += 1) {
        try {
          results.push(...await this.rpcBatch<T>(chunk))
          completed = true
        } catch (error) {
          if (attempt === 4) throw error
          await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)))
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    return results
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const response = await fetch(process.env.ROBINHOOD_CHAIN_RPC_URL || this.officialMainnetRpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`Robinhood RPC HTTP ${response.status}`)
    const payload = (await response.json()) as JsonRpcResponse<T>
    if (payload.error || payload.result === undefined) throw new Error(payload.error?.message || `Robinhood RPC ${method} failed`)
    return payload.result
  }
}
