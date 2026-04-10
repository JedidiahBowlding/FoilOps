import { ChainAdapter, NormalizedTransaction } from './types'

export class SolanaAdapter implements ChainAdapter {
  readonly chain = 'solana' as const

  normalizeWallet(address: string): string {
    return address.trim()
  }

  async getRecentTransactions(_address: string, _limit = 10): Promise<NormalizedTransaction[]> {
    return []
  }
}
