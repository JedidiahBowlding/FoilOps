import { BnbAdapter } from './bnb-adapter'
import { EthereumAdapter } from './ethereum-adapter'
import { SolanaAdapter } from './solana-adapter'
import { ChainAdapter, SupportedChain } from './types'

export class ChainRegistry {
  private adapters: Record<SupportedChain, ChainAdapter>

  constructor() {
    this.adapters = {
      solana: new SolanaAdapter(),
      ethereum: new EthereumAdapter(),
      bnb: new BnbAdapter(),
    }
  }

  getAdapter(chain: SupportedChain): ChainAdapter {
    return this.adapters[chain]
  }
}
