import { Connection, PublicKey, LogsFilter, Logs } from '@solana/web3.js'
import { ValidTransactions } from './valid-transactions'
import EventEmitter from 'events'
import { TransactionParser } from '../parsers/transaction-parser'
import { SendTransactionMsgHandler } from '../bot/handlers/send-tx-msg-handler'
import { bot } from '../providers/telegram'
import { SwapType, WalletWithUsers } from '../types/swap-types'
import { RateLimit } from './rate-limit'
import chalk from 'chalk'
import { RpcConnectionManager } from '../providers/solana'
import pLimit from 'p-limit'
import { CronJobs } from './cron-jobs'
import { PrismaUserRepository } from '../repositories/prisma/user'
import { WalletPool } from '../config/wallet-pool'
import TelegramBot from 'node-telegram-bot-api'
import { tradeSignalEmitter } from './trade-signal-emitter'

export class WatchTransaction extends EventEmitter {
  private walletTransactions: Map<string, { count: number; startTime: number }>

  private rateLimit: RateLimit

  private prismaUserRepository: PrismaUserRepository
  private static readonly SOL_MINT = 'So11111111111111111111111111111111111111112'
  private static readonly userSendChains: Map<string, Promise<void>> = new Map()
  private static readonly telegramSendConcurrency = Math.max(1, Number(process.env.TELEGRAM_SEND_CONCURRENCY || 3))
  private static readonly telegramGlobalSendLimiter = pLimit(WatchTransaction.telegramSendConcurrency)
  private static readonly telegramMinSendIntervalMs = Math.max(
    0,
    Number(process.env.TELEGRAM_MIN_SEND_INTERVAL_MS || 700),
  )
  private static readonly telegramSendRetryAttempts = Math.max(1, Number(process.env.TELEGRAM_SEND_RETRY_ATTEMPTS || 4))

  constructor() {
    super()

    this.walletTransactions = new Map()

    // this.trackedWallets = new Set()

    this.rateLimit = new RateLimit(WalletPool.subscriptions)

    this.prismaUserRepository = new PrismaUserRepository()
  }

  public async watchSocket(wallets: WalletWithUsers[]): Promise<void> {
    try {
      for (const wallet of wallets) {
        const publicKey = new PublicKey(wallet.address)
        const walletAddress = publicKey.toBase58()

        // Check if a subscription already exists for this wallet address
        if (WalletPool.subscriptions.has(walletAddress)) {
          // console.log(`Already watching for: ${walletAddress}`)
          continue // Skip re-subscribing
        }

        console.log(chalk.greenBright(`Watching transactions for wallet: `) + chalk.yellowBright.bold(walletAddress))

        // Initialize transaction count and timestamp
        this.walletTransactions.set(walletAddress, { count: 0, startTime: Date.now() })

        // Start real-time log
        const subscriptionId = RpcConnectionManager.logConnection.onLogs(
          publicKey,
          async (logs, ctx) => {
            try {
              // Exclude wallets that have reached the limit
              if (WalletPool.bannedWallets.has(walletAddress)) {
                console.log(`Wallet ${walletAddress} is excluded from logging.`)

                return
              }

              // if (wallet.userWallets[0].status === 'SPAM_PAUSED') {
              //   console.log('PAUSED TRANSACTIONS FOR: ', walletAddress)
              //   return
              // }

              const { isRelevant, swap } = ValidTransactions.isRelevantTransaction(logs)

              if (!isRelevant) {
                // console.log('TRANSACTION IS NOT DEFI', logs.signature)
                return
              }
              // console.log('TRANSACTION IS DEFI', logs.signature)
              // check txs per second
              const walletData = this.walletTransactions.get(walletAddress)
              if (!walletData) {
                return
              }

              const isWalletRateLimited = await this.rateLimit.txPerSecondCap({
                wallet,
                bot,
                excludedWallets: WalletPool.bannedWallets,
                walletData,
              })

              if (isWalletRateLimited) {
                return
              }

              const transactionSignature = logs.signature

              const transactionDetails = await this.getParsedTransaction(transactionSignature)

              if (!transactionDetails || transactionDetails[0] === null) {
                return
              }

              // Parse transaction
              const solPriceUsd = CronJobs.getSolPrice()
              const transactionParser = new TransactionParser(transactionSignature)

              if (
                swap === 'raydium' ||
                swap === 'jupiter' ||
                swap === 'pumpfun' ||
                swap === 'mint_pumpfun' ||
                swap === 'pumpfun_amm'
              ) {
                const parsed = await transactionParser.parseDefiTransaction(
                  transactionDetails,
                  swap,
                  solPriceUsd,
                  walletAddress,
                )
                if (!parsed) {
                  return
                }
                console.log(parsed.description)

                await this.emitCopyTradeSignalFromParsedSwap(walletAddress, transactionSignature, parsed)

                // await this.sendTransactionMessageToUsers(wallet, parsed)S
                await this.sendMessageToUsers(wallet, parsed, (handler, parsedData, userId) =>
                  handler.sendTransactionMessage(parsedData, userId),
                )
              } else if (swap === 'sol_transfer') {
                const parsed = await transactionParser.parseSolTransfer(transactionDetails, solPriceUsd, walletAddress)
                if (!parsed) {
                  return
                }
                console.log(parsed.description)

                // await this.sendTransferMessageToUsers(wallet, parsed)
                await this.sendMessageToUsers(wallet, parsed, (handler, parsedData, userId) =>
                  handler.sendTransferMessage(parsedData, userId),
                )
              }
            } catch (error: unknown) {
              console.error(
                `WATCH_SOCKET_CALLBACK_ERROR wallet=${walletAddress} signature=${logs.signature}`,
                this.getRpcErrorReason(error),
              )
            }
          },
          'processed',
        )

        // Store subscription ID
        WalletPool.subscriptions.set(wallet.address, subscriptionId)
        console.log(
          chalk.greenBright(`Subscribed to logs with subscription ID: `) + chalk.yellowBright.bold(subscriptionId),
        )
      }
    } catch (error) {
      console.error('Error in watchSocket:', error)
    }
  }

  private async emitCopyTradeSignalFromParsedSwap(
    walletAddress: string,
    transactionSignature: string,
    parsed: {
      type: string | undefined
      tokenTransfers: {
        tokenInMint: string
        tokenOutMint: string
      }
      platform: SwapType
    },
  ): Promise<void> {
    const direction = parsed.type === 'sell' ? 'sell' : parsed.type === 'buy' ? 'buy' : null
    if (!direction) {
      return
    }

    const tokenMint =
      direction === 'buy'
        ? parsed.tokenTransfers.tokenInMint
        : direction === 'sell'
          ? parsed.tokenTransfers.tokenOutMint
          : ''

    if (!tokenMint || tokenMint === WatchTransaction.SOL_MINT) {
      return
    }

    const copyTradeRiskScore = Number(process.env.COPY_TRADE_RISK_SCORE || 35)

    try {
      await tradeSignalEmitter.emitCopyTradeSignal({
        tokenMint,
        riskScore: copyTradeRiskScore,
        direction,
        trackedWallet: walletAddress,
        copiedWallet: walletAddress,
        copiedTxSignature: transactionSignature,
        metadata: {
          source: 'wallet-watcher',
          platform: parsed.platform,
        },
      })
    } catch (error) {
      console.log('COPY_TRADE_SIGNAL_EMIT_ERROR', error)
    }
  }

  public async getParsedTransaction(transactionSignature: string, retries = 4) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      const { connection, endpointUrl } = RpcConnectionManager.getConnectionByAttempt(attempt - 1)

      try {
        const transactionDetails = await connection.getParsedTransactions([transactionSignature], {
          maxSupportedTransactionVersion: 0,
        })

        if (transactionDetails && transactionDetails[0] !== null) {
          return transactionDetails
        }

        console.log(
          `Attempt ${attempt}: No transaction details found for ${transactionSignature} via endpoint ${endpointUrl}`,
        )
      } catch (error: unknown) {
        if (this.shouldCooldownRpcEndpoint(error)) {
          RpcConnectionManager.markEndpointUnhealthy(endpointUrl, this.getRpcErrorReason(error))
        }

        console.error(`Attempt ${attempt}: Error fetching transaction details via endpoint ${endpointUrl}`, error)
      }

      // Delay before retrying
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
    }

    console.error(`Failed to fetch transaction details after ${retries} retries for signature:`, transactionSignature)
    return null
  }

  private shouldCooldownRpcEndpoint(error: unknown): boolean {
    const reason = this.getRpcErrorReason(error).toLowerCase()
    return (
      reason.includes('econnreset') ||
      reason.includes('fetch failed') ||
      reason.includes('tls') ||
      reason.includes('client network socket disconnected') ||
      reason.includes('etimedout') ||
      reason.includes('socket hang up')
    )
  }

  private getRpcErrorReason(error: unknown): string {
    if (!error || typeof error !== 'object') {
      return String(error)
    }

    const maybeError = error as {
      message?: string
      code?: string
      cause?: { message?: string; code?: string }
    }

    return [maybeError.code, maybeError.message, maybeError.cause?.code, maybeError.cause?.message]
      .filter(Boolean)
      .join(' | ')
  }

  private async sendMessageToUsers<T>(
    wallet: WalletWithUsers,
    parsed: T,
    sendMessageFn: (
      handler: SendTransactionMsgHandler,
      parsed: T,
      userId: string,
    ) => Promise<TelegramBot.Message | undefined>,
  ) {
    const sendMessageHandler = new SendTransactionMsgHandler(bot)

    const pausedUsers = (await this.prismaUserRepository.getPausedUsers(wallet.userWallets.map((w) => w.userId))) || []

    const activeUsers = wallet.userWallets.filter((w) => !pausedUsers || !pausedUsers.includes(w.userId))

    // Remove duplicate users
    const uniqueActiveUsers = Array.from(new Set(activeUsers.map((user) => user.userId))).map((userId) =>
      activeUsers.find((user) => user.userId === userId),
    )

    const tasks = uniqueActiveUsers.map((user) =>
      WatchTransaction.telegramGlobalSendLimiter(async () => {
        if (user) {
          try {
            await this.enqueueUserMessage(user.userId, async () => {
              await this.sendWithTelegramRetry(
                () => sendMessageFn(sendMessageHandler, parsed, user.userId),
                user.userId,
              )
            })
          } catch (error: unknown) {
            console.log(`Error sending message to user ${user.userId}`, this.getRpcErrorReason(error))
          }
        }
      }),
    )

    await Promise.all(tasks)
  }

  private async enqueueUserMessage(userId: string, task: () => Promise<void>) {
    const currentChain = WatchTransaction.userSendChains.get(userId) || Promise.resolve()

    const nextChain = currentChain
      .catch(() => {
        return
      })
      .then(async () => {
        if (WatchTransaction.telegramMinSendIntervalMs > 0) {
          await this.delay(WatchTransaction.telegramMinSendIntervalMs)
        }
        await task()
      })
      .finally(() => {
        if (WatchTransaction.userSendChains.get(userId) === nextChain) {
          WatchTransaction.userSendChains.delete(userId)
        }
      })

    WatchTransaction.userSendChains.set(userId, nextChain)
    await nextChain
  }

  private async sendWithTelegramRetry(sendFn: () => Promise<TelegramBot.Message | undefined>, userId: string) {
    for (let attempt = 1; attempt <= WatchTransaction.telegramSendRetryAttempts; attempt++) {
      try {
        await sendFn()
        return
      } catch (error: unknown) {
        if (!this.isTelegram429(error) || attempt >= WatchTransaction.telegramSendRetryAttempts) {
          throw error
        }

        const retryDelayMs = this.getTelegramRetryAfterMs(error) || attempt * 1000
        console.log(`Telegram 429 for user ${userId}. Retry ${attempt} after ${retryDelayMs}ms`)
        await this.delay(retryDelayMs)
      }
    }
  }

  private isTelegram429(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false
    }

    const maybeError = error as {
      response?: {
        statusCode?: number
        body?: { error_code?: number }
      }
      message?: string
    }

    return (
      maybeError.response?.statusCode === 429 ||
      maybeError.response?.body?.error_code === 429 ||
      String(maybeError.message || '').includes('Too Many Requests')
    )
  }

  private getTelegramRetryAfterMs(error: unknown): number | null {
    if (!error || typeof error !== 'object') {
      return null
    }

    const maybeError = error as {
      response?: {
        body?: {
          parameters?: {
            retry_after?: number
          }
        }
      }
    }

    const retryAfterSeconds = Number(maybeError.response?.body?.parameters?.retry_after)
    if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
      return null
    }

    return Math.ceil(retryAfterSeconds * 1000)
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
  }
}
