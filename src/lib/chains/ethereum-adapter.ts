import axios from 'axios'
import { ChainAdapter, NormalizedTransaction } from './types'

export class EthereumAdapter implements ChainAdapter {
  readonly chain = 'ethereum' as const

  normalizeWallet(address: string): string {
    return address.trim().toLowerCase()
  }

  async getRecentTransactions(address: string, limit = 10): Promise<NormalizedTransaction[]> {
    const apiKey = process.env.ETHERSCAN_API_KEY
    if (!apiKey) return []

    try {
      const response = await axios.get('https://api.etherscan.io/api', {
        params: {
          module: 'account',
          action: 'txlist',
          address,
          page: 1,
          offset: limit,
          sort: 'desc',
          apikey: apiKey,
        },
      })

      const items = Array.isArray(response.data?.result) ? response.data.result : []
      return items.map((item: Record<string, string>) => ({
        chain: this.chain,
        hash: item.hash,
        from: item.from,
        to: item.to,
        amount: item.value || '0',
        asset: 'ETH',
        timestamp: item.timeStamp ? new Date(Number(item.timeStamp) * 1000).toISOString() : undefined,
      }))
    } catch {
      return []
    }
  }
}
