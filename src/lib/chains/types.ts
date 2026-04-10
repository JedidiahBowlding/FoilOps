export type SupportedChain = 'solana' | 'ethereum' | 'bnb'

export type NormalizedTransaction = {
  chain: SupportedChain
  hash: string
  from: string
  to: string
  amount: string
  asset: string
  timestamp?: string
}

export interface ChainAdapter {
  readonly chain: SupportedChain
  normalizeWallet(address: string): string
  getRecentTransactions(address: string, limit?: number): Promise<NormalizedTransaction[]>
}
