import {
  ParsedInstruction,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  PublicKey,
  TokenBalance,
  TokenAmount,
} from '@solana/web3.js'
import { RpcConnectionManager } from '../providers/solana'
import {
  KNOWN_PLATFORM_PROGRAMS,
  KNOWN_PLATFORM_WALLETS,
  MIXER_KEYWORDS,
  PlatformCategory,
} from '../constants/trace-platforms'
import { KNOWN_SCAM_WALLETS } from '../constants/known-scam-wallets'
import { ValidTransactions } from './valid-transactions'

export type FlowStep = {
  hop: number
  from: string
  to: string
  signature: string
  asset: 'SOL' | 'TOKEN'
  amount: string
  tokenMint?: string
  categories: PlatformCategory[]
  matchedPlatforms: string[]
  linkedToLaunchPattern: boolean
}

export type FlowTraceResult = {
  wallet: string
  tracedAt: string
  maxHops: number
  steps: FlowStep[]
  alerts: string[]
}

type QueueNode = {
  address: string
  hop: number
}

export class FundFlowTracer {
  async traceWalletFlow(walletAddress: string, maxHops = 3, signaturesPerHop = 12): Promise<FlowTraceResult> {
    const visited = new Set<string>()
    const queue: QueueNode[] = [{ address: walletAddress, hop: 0 }]
    const steps: FlowStep[] = []
    const alerts: string[] = []

    while (queue.length > 0) {
      const current = queue.shift()!

      if (visited.has(current.address) || current.hop >= maxHops) {
        continue
      }

      visited.add(current.address)

      const signatures = await this.getAddressSignatures(current.address, signaturesPerHop)

      for (const signatureInfo of signatures) {
        const tx = await this.getParsedTransaction(signatureInfo.signature)
        if (!tx) continue

        const txSteps = this.extractFlowSteps(current.address, current.hop + 1, signatureInfo.signature, tx)

        for (const step of txSteps) {
          steps.push(step)

          if (step.linkedToLaunchPattern) {
            alerts.push(`Launch pattern seen at hop ${step.hop} via ${step.signature}`)
          }

          if (
            step.categories.some((category) => category === 'MIXER' || category === 'EXCHANGE' || category === 'SCAM')
          ) {
            alerts.push(
              `Known platform interaction: ${step.categories.join(', ')} at ${step.to} (hop ${step.hop}, tx ${step.signature})`,
            )
          }

          if (!visited.has(step.to) && this.shouldContinueTracing(step)) {
            queue.push({ address: step.to, hop: current.hop + 1 })
          }
        }
      }
    }

    return {
      wallet: walletAddress,
      tracedAt: new Date().toISOString(),
      maxHops,
      steps,
      alerts: Array.from(new Set(alerts)),
    }
  }

  private async getAddressSignatures(address: string, limit: number) {
    try {
      return await RpcConnectionManager.getRandomConnection().getSignaturesForAddress(new PublicKey(address), { limit })
    } catch (error) {
      console.log('FLOW_TRACE_SIGNATURE_FETCH_ERROR', error)
      return []
    }
  }

  private async getParsedTransaction(signature: string): Promise<ParsedTransactionWithMeta | null> {
    try {
      return await RpcConnectionManager.getRandomConnection().getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      })
    } catch (error) {
      console.log('FLOW_TRACE_TX_FETCH_ERROR', error)
      return null
    }
  }

  private extractFlowSteps(
    fromAddress: string,
    hop: number,
    signature: string,
    tx: ParsedTransactionWithMeta,
  ): FlowStep[] {
    const steps: FlowStep[] = []
    const relevant = ValidTransactions.isRelevantTransaction({
      err: tx.meta?.err || null,
      logs: tx.meta?.logMessages || [],
      signature,
    })

    const allInstructions = [
      ...(tx.transaction.message.instructions || []),
      ...((tx.meta?.innerInstructions || []).flatMap((inner) => inner.instructions) as (
        | ParsedInstruction
        | PartiallyDecodedInstruction
      )[]),
    ]

    for (const instruction of allInstructions) {
      if (!('parsed' in instruction)) {
        continue
      }

      const parsedInstruction = instruction as ParsedInstruction
      const parsedData = parsedInstruction.parsed as {
        type?: string
        info?: {
          source?: string
          destination?: string
          authority?: string
          amount?: string
          lamports?: number
          mint?: string
          tokenAmount?: TokenAmount
        }
      }

      const type = parsedData.type
      const info = parsedData.info

      if (!type || !info) continue

      const source = info.source || info.authority
      const destination = info.destination
      if (!source || !destination) continue

      if (source !== fromAddress) continue

      const amountLamports = info.lamports ? Number(info.lamports) / 1e9 : undefined
      const amountRaw = info.amount
      const tokenAmount = info.tokenAmount?.uiAmountString || info.tokenAmount?.amount || amountRaw || ''

      const tokenMint = info.mint || this.findTokenMintByAccount(tx.meta?.postTokenBalances || [], destination)
      const isSolTransfer = type === 'transfer' && amountLamports !== undefined

      const classification = this.classifyDestination(destination, tx)

      steps.push({
        hop,
        from: source,
        to: destination,
        signature,
        asset: isSolTransfer ? 'SOL' : 'TOKEN',
        amount: isSolTransfer ? amountLamports!.toFixed(6) : tokenAmount,
        tokenMint,
        categories: classification.categories,
        matchedPlatforms: classification.matchedPlatforms,
        linkedToLaunchPattern: relevant.swap === 'mint_pumpfun',
      })
    }

    return steps
  }

  private findTokenMintByAccount(balances: TokenBalance[], accountAddress: string): string | undefined {
    const match = balances.find((balance) => balance.owner === accountAddress)
    return match?.mint
  }

  private classifyDestination(
    destination: string,
    tx: ParsedTransactionWithMeta,
  ): {
    categories: PlatformCategory[]
    matchedPlatforms: string[]
  } {
    const categories = new Set<PlatformCategory>()
    const matchedPlatforms = new Set<string>()

    const walletPlatform = KNOWN_PLATFORM_WALLETS[destination]
    if (walletPlatform) {
      categories.add(walletPlatform.category)
      matchedPlatforms.add(walletPlatform.label)
    }

    if (KNOWN_SCAM_WALLETS.some((wallet) => wallet.address === destination)) {
      categories.add('SCAM')
      matchedPlatforms.add('Known scam wallet list')
    }

    const accountKeys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58())

    for (const accountKey of accountKeys) {
      const knownProgram = KNOWN_PLATFORM_PROGRAMS[accountKey]
      if (knownProgram) {
        categories.add(knownProgram.category)
        matchedPlatforms.add(knownProgram.label)
      }
    }

    const logs = tx.meta?.logMessages?.join(' ').toLowerCase() || ''
    if (MIXER_KEYWORDS.some((keyword) => logs.includes(keyword))) {
      categories.add('MIXER')
      matchedPlatforms.add('Mixer keyword match in logs')
    }

    if (categories.size === 0) {
      categories.add('UNKNOWN')
    }

    return {
      categories: Array.from(categories),
      matchedPlatforms: Array.from(matchedPlatforms),
    }
  }

  private shouldContinueTracing(step: FlowStep): boolean {
    // Continue only through wallet-like unknown/scam paths to avoid noisy program accounts.
    return step.categories.includes('UNKNOWN') || step.categories.includes('SCAM')
  }
}
