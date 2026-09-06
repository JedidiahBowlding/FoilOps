import { ParsedInstruction, ParsedTransactionWithMeta, PublicKey } from '@solana/web3.js'
import { RpcConnectionManager } from '../providers/solana'
import { DetectedLaunch } from './new-launch-types'

const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112'

export class PumpFunLaunchSource {
  readonly name = 'pump-fun'

  async fetchSince(cursor: string | null, limit: number): Promise<{ launches: DetectedLaunch[]; cursor: string | null }> {
    const connection = RpcConnectionManager.getRandomConnection()
    const signatures = await connection.getSignaturesForAddress(new PublicKey(PUMP_FUN_PROGRAM), {
      limit,
      ...(cursor ? { until: cursor } : {}),
    })

    const launches: DetectedLaunch[] = []
    for (const row of [...signatures].reverse()) {
      if (row.err) continue
      const transaction = await connection.getParsedTransaction(row.signature, { maxSupportedTransactionVersion: 0 })
      if (!transaction) continue

      const tokenMint = this.extractCreatedMint(transaction)
      if (!tokenMint) continue

      launches.push({
        chain: 'solana',
        tokenMint,
        signature: row.signature,
        creatorWallet: transaction.transaction.message.accountKeys.find((key) => key.signer)?.pubkey.toBase58() || null,
        source: this.name,
        slot: row.slot,
        detectedAt: new Date((row.blockTime || Math.floor(Date.now() / 1000)) * 1000),
      })
    }

    return { launches, cursor: signatures[0]?.signature || cursor }
  }

  private extractCreatedMint(transaction: ParsedTransactionWithMeta): string | null {
    const instructions = [
      ...transaction.transaction.message.instructions,
      ...(transaction.meta?.innerInstructions || []).flatMap((group) => group.instructions),
    ]
    for (const instruction of instructions) {
      if (!('parsed' in instruction)) continue
      const parsed = instruction as ParsedInstruction
      if (parsed.parsed?.type !== 'initializeMint' && parsed.parsed?.type !== 'initializeMint2') continue
      const mint = parsed.parsed?.info?.mint
      if (typeof mint === 'string') return mint
    }

    const preMints = new Set((transaction.meta?.preTokenBalances || []).map((row) => row.mint))
    const candidate = (transaction.meta?.postTokenBalances || []).find(
      (row) => row.mint !== WRAPPED_SOL_MINT && !preMints.has(row.mint),
    )
    return candidate?.mint || null
  }
}
