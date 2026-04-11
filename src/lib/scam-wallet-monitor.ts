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
import { WalletClusterService } from './wallet-cluster'
import { AlertRuleDeliveryShape, PrismaUserAlertRuleRepository } from '../repositories/prisma/user-alert-rule'
import { AlertEventType } from '@prisma/client'

type AlertDeliveryInput = {
  eventType: AlertEventType
  walletAddress: string
  tokenMint?: string
  riskScore: number
  transactionSize?: number
  details?: string
}

export function resolveAlertChatId(userId: string): string | number | null {
  const explicitRoute = process.env[`ALERT_CHAT_ID_${userId}`]
  const candidate = (explicitRoute || userId || '').trim()
  if (!candidate) return null

  if (/^-?\d+$/.test(candidate)) {
    return Number(candidate)
  }

  return candidate
}

export function shouldDeliverAlert(rule: AlertRuleDeliveryShape, input: AlertDeliveryInput): boolean {
  if (!rule.eventTypes.includes(input.eventType)) return false
  if (input.riskScore < rule.minRiskScore) return false

  const txSize = input.transactionSize ?? 0
  if (txSize < rule.minTransactionSize) return false

  return true
}

export function renderAlertTemplate(input: AlertDeliveryInput): string {
  const token = input.tokenMint || 'unknown'
  const risk = `${input.riskScore}/100`
  const txSizeText = (input.transactionSize || 0) > 0 ? `\nTx Size: ${input.transactionSize}` : ''

  if (input.eventType === 'SUSPICIOUS_PRELAUNCH_SIGNAL') {
    return [
      '🚨 PRELAUNCH RISK SIGNAL',
      `Wallet: ${input.walletAddress}`,
      `Token: ${token}`,
      `Risk: ${risk}`,
      `${txSizeText}`,
      input.details ? `Details: ${input.details}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  if (input.eventType === 'ANOMALY_DETECTED') {
    return [
      '⚠️ ANOMALY DETECTED',
      `Wallet: ${input.walletAddress}`,
      `Token: ${token}`,
      `Risk: ${risk}`,
      `${txSizeText}`,
      input.details ? `Details: ${input.details}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  if (input.eventType === 'CLUSTER_ALERT') {
    return [
      '🧬 CLUSTER ALERT',
      `Wallet: ${input.walletAddress}`,
      `Token: ${token}`,
      `Risk: ${risk}`,
      `${txSizeText}`,
      input.details ? `Details: ${input.details}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  return [
    '📡 SCAM INTEL ALERT',
    `Event: ${input.eventType}`,
    `Wallet: ${input.walletAddress}`,
    `Token: ${token}`,
    `Risk: ${risk}`,
    `${txSizeText}`,
    input.details ? `Details: ${input.details}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export class ScamWalletMonitor {
  private scamWalletRepository: PrismaScamWalletRepository
  private subscriptions: Map<string, number>
  private fundFlowTracer: FundFlowTracer
  private walletClusterService: WalletClusterService
  private userAlertRuleRepository: PrismaUserAlertRuleRepository

  constructor() {
    this.scamWalletRepository = new PrismaScamWalletRepository()
    this.subscriptions = new Map()
    this.fundFlowTracer = new FundFlowTracer()
    this.walletClusterService = new WalletClusterService()
    this.userAlertRuleRepository = new PrismaUserAlertRuleRepository()
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

    const trace = await this.fundFlowTracer.traceWalletFlow(walletAddress, 6, 15, {
      followAllRecipients: true,
      maxVisitedWallets: 350,
    })
    await this.scamWalletRepository.saveFlowTrace(walletAddress, trace, 'SUSPICIOUS_LAUNCH')

    const cluster = await this.walletClusterService.buildCluster(walletAddress)

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

    const prelaunchRiskScore = Math.min(100, event.riskScoreSnapshot + Math.round(cluster.combinedRiskScore / 5))
    const prelaunchSignal = tradeSignalEmitter.createSignal({
      signalType: 'SUSPICIOUS_PRELAUNCH_SIGNAL',
      riskScore: prelaunchRiskScore,
      trackedWallet: walletAddress,
      developerWallet: walletAddress,
      tokenMint,
      traceAlerts: trace.alerts,
      metadata: {
        txSignature: logs.signature,
        clusterScore: cluster.clusterScore,
        linkedWallets: cluster.linkedWallets,
        priorRugsEstimate: cluster.linkedWallets.length,
      },
    })
    await tradeSignalEmitter.emit(prelaunchSignal)

    await this.scamWalletRepository.recordEvent({
      address: walletAddress,
      eventType: 'SUSPICIOUS_PRELAUNCH_SIGNAL',
      txSignature: logs.signature,
      tokenMint,
      platform: swap,
      details: 'Prelaunch suspicion signal generated',
      metadata: {
        clusterScore: cluster.clusterScore,
        linkedWallets: cluster.linkedWallets,
      },
    })

    for (const anomaly of trace.alerts.filter((alert) => alert.includes('[ANOMALY_DETECTED]'))) {
      await this.scamWalletRepository.recordEvent({
        address: walletAddress,
        eventType: 'ANOMALY_DETECTED',
        txSignature: logs.signature,
        tokenMint,
        platform: swap,
        details: anomaly,
        metadata: {
          anomaly,
        },
      })
    }

    if (prelaunchRiskScore >= 85) {
      await tradeSignalEmitter.emitAutoActionSignal({
        signalType: 'AUTO_AVOID',
        actionHint: 'AUTO_AVOID',
        tokenMint,
        trackedWallet: walletAddress,
        developerWallet: walletAddress,
        riskScore: prelaunchRiskScore,
        traceAlerts: trace.alerts,
        metadata: {
          trigger: 'high_prelaunch_risk',
          clusterScore: cluster.clusterScore,
        },
      })
    }

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
        `Prelaunch score: <b>${prelaunchRiskScore}/100</b>`,
        `Flow hops traced: <b>${trace.steps.length}</b>`,
        `Cluster linked wallets: <b>${cluster.linkedWallets.length}</b>`,
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

    await this.dispatchUserAlertRules({
      eventType: 'SUSPICIOUS_PRELAUNCH_SIGNAL',
      walletAddress,
      tokenMint,
      riskScore: prelaunchRiskScore,
      transactionSize: 0,
      details: 'Prelaunch suspicion signal generated',
    })

    for (const anomaly of trace.alerts.filter((alert) => alert.includes('[ANOMALY_DETECTED]'))) {
      await this.dispatchUserAlertRules({
        eventType: 'ANOMALY_DETECTED',
        walletAddress,
        tokenMint,
        riskScore: prelaunchRiskScore,
        transactionSize: 0,
        details: anomaly,
      })
    }
  }

  private async dispatchUserAlertRules(input: AlertDeliveryInput) {
    const rules = await this.userAlertRuleRepository.listAllRulesForDelivery()
    const message = renderAlertTemplate(input)

    for (const rule of rules) {
      if (!shouldDeliverAlert(rule, input)) continue

      const chatId = resolveAlertChatId(rule.userId)
      if (chatId === null) continue

      await bot.sendMessage(chatId, message)
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
