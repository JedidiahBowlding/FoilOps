import { ChainRegistry } from './chains'
import { SupportedChain } from './chains/types'
import { WalletWithUsers } from '../types/swap-types'
import { fromStoredWalletAddress } from './wallet-chain'

export class EvmWalletMonitor {
  private chainRegistry: ChainRegistry
  private seenTxHashes: Map<string, Set<string>>
  private pollers: NodeJS.Timeout[]
  private activeWalletsByChain: Record<Extract<SupportedChain, 'ethereum' | 'bnb'>, string[]>

  constructor() {
    this.chainRegistry = new ChainRegistry()
    this.seenTxHashes = new Map()
    this.pollers = []
    this.activeWalletsByChain = { ethereum: [], bnb: [] }
  }

  public async refreshFromWalletPool(wallets: WalletWithUsers[]): Promise<void> {
    const ethWallets = new Set<string>()
    const bnbWallets = new Set<string>()

    for (const wallet of wallets) {
      const parsed = fromStoredWalletAddress(wallet.address)
      if (parsed.chain === 'ethereum') {
        ethWallets.add(parsed.address)
      } else if (parsed.chain === 'bnb') {
        bnbWallets.add(parsed.address)
      }
    }

    this.activeWalletsByChain = {
      ethereum: Array.from(ethWallets),
      bnb: Array.from(bnbWallets),
    }

    await this.restartPollers()
  }

  private async restartPollers(): Promise<void> {
    this.stop()

    const ethWallets = this.activeWalletsByChain.ethereum
    const bnbWallets = this.activeWalletsByChain.bnb

    if (ethWallets.length === 0 && bnbWallets.length === 0) {
      console.log('EVM_MONITOR: no Telegram-managed EVM wallets found, monitor is idle')
      return
    }

    const pollMs = this.parsePositiveInt(process.env.EVM_WALLET_POLL_INTERVAL_MS, 20000)
    const txLimit = this.parsePositiveInt(process.env.EVM_WALLET_TX_LIMIT, 15)

    if (ethWallets.length > 0) {
      await this.startChainPolling('ethereum', ethWallets, pollMs, txLimit)
    }

    if (bnbWallets.length > 0) {
      await this.startChainPolling('bnb', bnbWallets, pollMs, txLimit)
    }
  }

  public stop(): void {
    for (const timer of this.pollers) {
      clearInterval(timer)
    }
    this.pollers = []
  }

  private async startChainPolling(
    chain: Extract<SupportedChain, 'ethereum' | 'bnb'>,
    wallets: string[],
    pollMs: number,
    txLimit: number,
  ): Promise<void> {
    for (const wallet of wallets) {
      await this.primeSeenTransactions(chain, wallet, txLimit)
    }

    const runPoll = async () => {
      for (const wallet of wallets) {
        await this.pollWallet(chain, wallet, txLimit)
      }
    }

    const timer = setInterval(() => {
      void runPoll()
    }, pollMs)

    this.pollers.push(timer)

    console.log(
      `EVM_MONITOR: tracking ${wallets.length} ${chain.toUpperCase()} wallet(s), interval=${pollMs}ms, txLimit=${txLimit}`,
    )
  }

  private async primeSeenTransactions(
    chain: Extract<SupportedChain, 'ethereum' | 'bnb'>,
    wallet: string,
    txLimit: number,
  ): Promise<void> {
    try {
      const adapter = this.chainRegistry.getAdapter(chain)
      const txs = await adapter.getRecentTransactions(wallet, txLimit)
      const seen = new Set<string>()

      for (const tx of txs) {
        if (tx.hash) {
          seen.add(tx.hash.toLowerCase())
        }
      }

      this.seenTxHashes.set(this.walletKey(chain, wallet), seen)
      console.log(`EVM_MONITOR: primed ${chain.toUpperCase()} wallet ${wallet} with ${seen.size} recent tx hash(es)`)
    } catch (error) {
      console.log(`EVM_MONITOR_PRIME_ERROR (${chain}:${wallet})`, error)
    }
  }

  private async pollWallet(
    chain: Extract<SupportedChain, 'ethereum' | 'bnb'>,
    wallet: string,
    txLimit: number,
  ): Promise<void> {
    try {
      const adapter = this.chainRegistry.getAdapter(chain)
      const txs = await adapter.getRecentTransactions(wallet, txLimit)
      const key = this.walletKey(chain, wallet)
      const seen = this.seenTxHashes.get(key) || new Set<string>()

      // API responses are newest-first; reverse so logs are chronological.
      for (const tx of [...txs].reverse()) {
        const hash = tx.hash?.toLowerCase()
        if (!hash || seen.has(hash)) {
          continue
        }

        seen.add(hash)

        console.log(
          `EVM_MONITOR_NEW_TX: chain=${chain} wallet=${wallet} hash=${tx.hash} from=${tx.from} to=${tx.to} amount=${tx.amount} asset=${tx.asset}`,
        )
      }

      // Keep memory bounded while still retaining enough history to avoid duplicates.
      if (seen.size > 5000) {
        const recent = Array.from(seen).slice(-2000)
        this.seenTxHashes.set(key, new Set(recent))
      } else {
        this.seenTxHashes.set(key, seen)
      }
    } catch (error) {
      console.log(`EVM_MONITOR_POLL_ERROR (${chain}:${wallet})`, error)
    }
  }

  private parsePositiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback
    }
    return Math.floor(parsed)
  }

  private walletKey(chain: SupportedChain, wallet: string): string {
    return `${chain}:${wallet.toLowerCase()}`
  }
}

export const evmWalletMonitor = new EvmWalletMonitor()
