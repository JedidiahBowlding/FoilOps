import { PublicKey } from '@solana/web3.js'
import { TokenUtils } from './token-utils'
import { RpcConnectionManager } from '../providers/solana'

type SignatureInfo = {
  signature: string
}

type AccountKeyEntry = {
  pubkey?: string
}

export class WhaleWalletSelector {
  private static readonly DEFAULT_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'

  private isEnabled(): boolean {
    return process.env.WHALE_AUTO_TRACK_ENABLED !== 'false'
  }

  private getMinBalanceUsd(): number {
    const parsed = Number(process.env.WHALE_MIN_BALANCE_USD || '1000000')
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000000
  }

  private getTopWalletCount(): number {
    const parsed = Number(process.env.WHALE_TOP_ACTIVE_WALLETS || '5')
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5
  }

  private getSignatureLookback(): number {
    const parsed = Number(process.env.WHALE_ACTIVITY_SIGNATURE_LIMIT || '120')
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 120
  }

  private getMinActivityHits(): number {
    const parsed = Number(process.env.WHALE_MIN_ACTIVITY_HITS || '2')
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 2
  }

  private getMaxBalanceChecks(): number {
    const parsed = Number(process.env.WHALE_MAX_BALANCE_CHECKS || '40')
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 40
  }

  private getProgramId(): string {
    return process.env.WHALE_ACTIVITY_PROGRAM_ID || WhaleWalletSelector.DEFAULT_PROGRAM_ID
  }

  private parseSigner(accountKey: string | AccountKeyEntry | undefined): string | null {
    if (!accountKey) {
      return null
    }
    if (typeof accountKey === 'string') {
      return accountKey
    }
    if (accountKey.pubkey) {
      return accountKey.pubkey
    }
    return null
  }

  private async getSolPriceUsd(): Promise<number | null> {
    const price = await TokenUtils.getSolPriceGecko()
    if (!price) {
      return null
    }
    const parsed = Number(price)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null
    }
    return parsed
  }

  public async selectTopActiveWhales(): Promise<string[]> {
    if (!this.isEnabled()) {
      return []
    }

    try {
      const connection = RpcConnectionManager.getRandomConnection()
      const solPriceUsd = await this.getSolPriceUsd()
      if (!solPriceUsd) {
        console.log('WHALE_SELECTOR: failed to resolve SOL price, skipping auto-track wallet discovery')
        return []
      }

      const signatures = (await connection.getSignaturesForAddress(new PublicKey(this.getProgramId()), {
        limit: this.getSignatureLookback(),
      })) as SignatureInfo[]

      const activityCounts = new Map<string, number>()

      for (const signatureInfo of signatures) {
        const tx = await connection.getParsedTransaction(signatureInfo.signature, {
          maxSupportedTransactionVersion: 0,
        })

        const signer = this.parseSigner(
          tx?.transaction.message.accountKeys?.[0] as string | AccountKeyEntry | undefined,
        )
        if (!signer) {
          continue
        }

        activityCounts.set(signer, (activityCounts.get(signer) || 0) + 1)
      }

      const sortedByActivity = Array.from(activityCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, this.getMaxBalanceChecks())

      const selected: string[] = []
      const minUsd = this.getMinBalanceUsd()
      const minHits = this.getMinActivityHits()

      for (const [wallet, hits] of sortedByActivity) {
        if (hits < minHits) {
          continue
        }

        const lamports = await connection.getBalance(new PublicKey(wallet))
        const balanceUsd = (lamports / 1_000_000_000) * solPriceUsd

        if (balanceUsd >= minUsd) {
          selected.push(wallet)
        }

        if (selected.length >= this.getTopWalletCount()) {
          break
        }
      }

      console.log(
        `WHALE_SELECTOR: selected ${selected.length} high-balance active wallets (threshold=$${minUsd.toLocaleString()})`,
      )

      return selected
    } catch (error) {
      console.log('WHALE_SELECTOR_ERROR', error)
      return []
    }
  }
}
