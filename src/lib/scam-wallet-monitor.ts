import {
  Logs,
  ParsedInstruction,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  PublicKey,
} from '@solana/web3.js'
import { RpcConnectionManager } from '../providers/solana'
import { ValidTransactions } from './valid-transactions'
import { PrismaScamWalletRepository } from '../repositories/prisma/scam-wallet'
import { bot } from '../providers/telegram'
import { FundFlowTracer } from './fund-flow-tracer'
import { tradeSignalEmitter } from './trade-signal-emitter'

export class ScamWalletMonitor {
  private scamWalletRepository: PrismaScamWalletRepository
  private subscriptions: Map<string, number>
  private fundFlowTracer: FundFlowTracer

  constructor() {
    this.scamWalletRepository = new PrismaScamWalletRepository()
    this.subscriptions = new Map()
    this.fundFlowTracer = new FundFlowTracer()
  }

  async init() {
    await this.scamWalletRepository.syncKnownScamWallets()
    await this.refreshSubscriptions()
  }

  async refreshSubscriptions() {
    const flaggedWallets = await this.scamWalletRepository.getFlaggedWallets()

    const flaggedAddressSet = new Set(flaggedWallets.map((wallet) => wallet.address))

    for (const [address, subscriptionId] of this.subscriptions.entries()) {
      if (!flaggedAddressSet.has(address)) {
        await RpcConnectionManager.logConnection.removeOnLogsListener(subscriptionId)
        this.subscriptions.delete(address)
      }
    }

    for (const wallet of flaggedWallets) {
      if (this.subscriptions.has(wallet.address)) continue

      const publicKey = new PublicKey(wallet.address)

      const subscriptionId = RpcConnectionManager.logConnection.onLogs(
        publicKey,
        async (logs) => {
          await this.handleLogs(wallet.address, logs)
        },
        'processed',
      )

      this.subscriptions.set(wallet.address, subscriptionId)
    }
  }

  private async handleLogs(walletAddress: string, logs: Logs) {
    const { isRelevant, swap } = ValidTransactions.isRelevantTransaction(logs)

    if (!isRelevant || swap !== 'mint_pumpfun') {
      return
    }

    const transaction = await this.getParsedTransaction(logs.signature)

    if (!transaction) {
      return
    }

    const tokenMint = this.extractTokenMint(transaction)

    const event = await this.scamWalletRepository.recordEvent({
      address: walletAddress,
      eventType: 'SUSPICIOUS_TOKEN_LAUNCH',
      txSignature: logs.signature,
      tokenMint,
      platform: swap,
      details: 'Flagged wallet triggered a token mint deployment pattern',
      metadata: {
        logsCount: logs.logs.length,
      },
    })

    if (!event) {
      return
    }

    const trace = await this.fundFlowTracer.traceWalletFlow(walletAddress, 3, 10)
    await this.scamWalletRepository.saveFlowTrace(walletAddress, trace, 'SUSPICIOUS_LAUNCH')

    const signal = tradeSignalEmitter.createSignal({
      signalType: 'SUSPICIOUS_TOKEN_LAUNCH',
      riskScore: event.riskScoreSnapshot,
      trackedWallet: walletAddress,
      tokenMint,
      traceAlerts: trace.alerts,
      metadata: {
        txSignature: logs.signature,
        flowHopCount: trace.steps.length,
      },
    })
    await tradeSignalEmitter.emit(signal)

    const adminId = process.env.ADMIN_CHAT_ID ?? ''

    if (!adminId) {
      return
    }

    const tokenLabel = tokenMint ? `<code>${tokenMint}</code>` : '<i>unknown token mint</i>'

    await bot.sendMessage(
      adminId,
      [
        '🚨 <b>Suspicious Token Launch Detected</b>',
        '',
        `Wallet: <code>${walletAddress}</code>`,
        `Token: ${tokenLabel}`,
        `Tx: <code>${logs.signature}</code>`,
        `Risk score: <b>${event.riskScoreSnapshot}/100</b>`,
        `Flow hops traced: <b>${trace.steps.length}</b>`,
      ].join('\n'),
      {
        parse_mode: 'HTML',
      },
    )

    if (trace.alerts.length > 0) {
      await bot.sendMessage(
        adminId,
        ['🧭 <b>Flow Trace Alerts</b>', '', ...trace.alerts.slice(0, 8).map((alert) => `• ${alert}`)].join('\n'),
        {
          parse_mode: 'HTML',
        },
      )
    }
  }

  private async getParsedTransaction(signature: string): Promise<ParsedTransactionWithMeta | null> {
    try {
      const tx = await RpcConnectionManager.getRandomConnection().getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      })

      return tx
    } catch (error) {
      console.log('SCAM_MONITOR_TX_FETCH_ERROR', error)
      return null
    }
  }

  private extractTokenMint(transaction: ParsedTransactionWithMeta): string | undefined {
    const tokenBalanceMint = transaction.meta?.postTokenBalances?.find(
      (balance) => balance.mint !== 'So11111111111111111111111111111111111111112',
    )?.mint

    if (tokenBalanceMint) {
      return tokenBalanceMint
    }

    const instructions = transaction.transaction.message.instructions

    for (const instruction of instructions) {
      if ('parsed' in instruction) {
        const parsedInstruction = instruction as ParsedInstruction
        const mint = (parsedInstruction.parsed as { info?: { mint?: string } })?.info?.mint

        if (mint) {
          return mint
        }
      }

      if ('programId' in instruction) {
        const decoded = instruction as PartiallyDecodedInstruction
        if (decoded.accounts.length > 0) {
          const mintCandidate = decoded.accounts[0]
          if (mintCandidate instanceof PublicKey) {
            return mintCandidate.toBase58()
          }
        }
      }
    }

    return undefined
  }
}
