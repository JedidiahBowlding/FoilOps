import { Connection, PublicKey, LogsFilter, Logs, ParsedTransactionWithMeta } from '@solana/web3.js'
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
import { PrismaWalletRepository } from '../repositories/prisma/wallet'
import { WalletPool } from '../config/wallet-pool'
import TelegramBot from 'node-telegram-bot-api'
import { tradeSignalEmitter } from './trade-signal-emitter'

export class WatchTransaction extends EventEmitter {
  private walletTransactions: Map<string, { count: number; startTime: number }>

  private rateLimit: RateLimit

  private prismaUserRepository: PrismaUserRepository
  private prismaWalletRepository: PrismaWalletRepository
  private static readonly SOL_MINT = 'So11111111111111111111111111111111111111112'
  private static readonly userSendChains: Map<string, Promise<void>> = new Map()
  private static readonly telegramSendConcurrency = Math.max(1, Number(process.env.TELEGRAM_SEND_CONCURRENCY || 1))
  private static readonly telegramGlobalSendLimiter = pLimit(WatchTransaction.telegramSendConcurrency)
  private static readonly telegramMinSendIntervalMs = Math.max(
    0,
    Number(process.env.TELEGRAM_MIN_SEND_INTERVAL_MS || 700),
  )
  private static readonly telegramSendRetryAttempts = Math.max(1, Number(process.env.TELEGRAM_SEND_RETRY_ATTEMPTS || 4))
  private static readonly minTransferAlertSol = Math.max(0, Number(process.env.MIN_TRANSFER_ALERT_SOL || 0.001))
  private static readonly transferAlertCooldownMs = Math.max(0, Number(process.env.TRANSFER_ALERT_COOLDOWN_MS || 8000))
  private static readonly transferAlertLastSentByWallet: Map<string, number> = new Map()
  private static readonly watchlistRotateTransferThresholdPct = Math.min(
    0.99,
    Math.max(0.5, Number(process.env.WATCHLIST_ROTATE_TRANSFER_THRESHOLD_PCT || 0.75)),
  )
  private static readonly watchlistRotateCooldownMs = Math.max(
    0,
    Number(process.env.WATCHLIST_ROTATE_COOLDOWN_MS || 120000),
  )
  private static readonly watchlistRotateLastByWallet: Map<string, number> = new Map()

  constructor() {
    super()

    this.walletTransactions = new Map()

    // this.trackedWallets = new Set()

    this.rateLimit = new RateLimit(WalletPool.subscriptions)

    this.prismaUserRepository = new PrismaUserRepository()
    this.prismaWalletRepository = new PrismaWalletRepository()
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

                await this.autoRotateWatchlistFromLargeTransfer(walletAddress, parsed, transactionDetails, wallet)

                if (parsed.solAmount < WatchTransaction.minTransferAlertSol) {
                  return
                }

                if (this.isTransferAlertCoolingDown(walletAddress)) {
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
    const isDeployEvent = parsed.platform === 'mint_pumpfun'
    const direction = parsed.type === 'sell' ? 'sell' : parsed.type === 'buy' ? 'buy' : isDeployEvent ? 'buy' : null
    if (!direction) {
      return
    }

    let tokenMint =
      direction === 'buy'
        ? parsed.tokenTransfers.tokenInMint
        : direction === 'sell'
          ? parsed.tokenTransfers.tokenOutMint
          : ''

    // Some deploy transactions report the new mint on tokenOutMint. Fall back to keep auto-buy reliable.
    if (direction === 'buy' && (!tokenMint || tokenMint === WatchTransaction.SOL_MINT)) {
      tokenMint = parsed.tokenTransfers.tokenOutMint
    }

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
          autoBuyOnDeploy: isDeployEvent,
        },
      })
    } catch (error) {
      console.log('COPY_TRADE_SIGNAL_EMIT_ERROR', error)
    }
  }

  private async autoRotateWatchlistFromLargeTransfer(
    trackedWallet: string,
    parsed: {
      fromAddress: string
      toAddress: string
      lamportsAmount: number
      solAmount: number
      signature: string
    },
    transactionDetails: (ParsedTransactionWithMeta | null)[],
    trackedWalletRecord: WalletWithUsers,
  ): Promise<void> {
    if (parsed.fromAddress !== trackedWallet) {
      return
    }

    const destinationWallet = parsed.toAddress.trim()
    if (!destinationWallet || destinationWallet === trackedWallet) {
      return
    }

    if (!this.isValidSolanaAddress(destinationWallet)) {
      return
    }

    const sourcePreTransferLamports = this.getWalletPreTransferLamports(transactionDetails, trackedWallet)
    if (!sourcePreTransferLamports || sourcePreTransferLamports <= 0) {
      return
    }

    const transferRatio = parsed.lamportsAmount / sourcePreTransferLamports
    if (transferRatio < WatchTransaction.watchlistRotateTransferThresholdPct) {
      return
    }

    if (this.isWatchlistRotationCoolingDown(trackedWallet)) {
      return
    }

    const sourceWatchlistRotated = await this.rotateSourceWatchlistWallet(trackedWallet, destinationWallet)
    const dbTrackedWalletsRotated = await this.rotateDbTrackedWallets(
      trackedWallet,
      destinationWallet,
      trackedWalletRecord,
    )

    if (!sourceWatchlistRotated && !dbTrackedWalletsRotated) {
      return
    }

    console.log(
      `SOURCE_WALLET_ROTATED from=${trackedWallet} to=${destinationWallet} ratio=${(transferRatio * 100).toFixed(
        2,
      )}% sig=${parsed.signature} amount=${parsed.solAmount}`,
    )
  }

  private async rotateDbTrackedWallets(
    fromWallet: string,
    toWallet: string,
    trackedWalletRecord: WalletWithUsers,
  ): Promise<boolean> {
    const userWallets = trackedWalletRecord.userWallets || []
    if (userWallets.length === 0) {
      return false
    }

    const createdWalletIds = new Set<string>()
    let changed = false

    for (const userWallet of userWallets) {
      const created = await this.prismaWalletRepository.create(
        userWallet.userId,
        toWallet,
        userWallet.name || '',
        userWallet.status,
      )

      if (created?.id) {
        createdWalletIds.add(created.id)
      }

      const deleted = await this.prismaWalletRepository.deleteWallet(userWallet.userId, fromWallet)
      if (deleted?.walletId) {
        changed = true
      }
    }

    if (!changed) {
      return false
    }

    const oldSubscriptionId = WalletPool.subscriptions.get(fromWallet)
    if (typeof oldSubscriptionId === 'number') {
      try {
        await RpcConnectionManager.logConnection.removeOnLogsListener(oldSubscriptionId)
      } catch {
        // Listener may already be removed; continue cleanup.
      }
      WalletPool.subscriptions.delete(fromWallet)
    }

    WalletPool.wallets = WalletPool.wallets.filter((wallet) => wallet.address !== fromWallet)
    this.walletTransactions.delete(fromWallet)

    const walletsToSubscribe: WalletWithUsers[] = []
    for (const walletId of createdWalletIds) {
      const refetchedWallet = await this.prismaWalletRepository.getWalletByIdForArray(walletId)
      if (!refetchedWallet) {
        continue
      }

      const existingWalletIndex = WalletPool.wallets.findIndex((wallet) => wallet.address === refetchedWallet.address)
      if (existingWalletIndex >= 0) {
        WalletPool.wallets[existingWalletIndex] = refetchedWallet
      } else {
        WalletPool.wallets.push(refetchedWallet)
      }

      walletsToSubscribe.push(refetchedWallet)
    }

    if (walletsToSubscribe.length > 0) {
      await this.watchSocket(walletsToSubscribe)
    }

    return true
  }

  private getWalletPreTransferLamports(
    transactionDetails: (ParsedTransactionWithMeta | null)[],
    walletAddress: string,
  ): number | null {
    const tx = transactionDetails?.[0]
    if (!tx) {
      return null
    }

    const keys = tx.transaction.message.accountKeys
    const keyIndex = keys.findIndex((entry) => entry.pubkey.toString() === walletAddress)
    if (keyIndex < 0) {
      return null
    }

    const preBalances = tx.meta?.preBalances
    const pre = preBalances?.[keyIndex]
    return typeof pre === 'number' ? pre : null
  }

  private isValidSolanaAddress(address: string): boolean {
    try {
      return new PublicKey(address).toBase58() === address
    } catch {
      return false
    }
  }

  private isWatchlistRotationCoolingDown(walletAddress: string): boolean {
    if (WatchTransaction.watchlistRotateCooldownMs <= 0) {
      return false
    }

    const now = Date.now()
    const last = WatchTransaction.watchlistRotateLastByWallet.get(walletAddress) || 0
    if (now - last < WatchTransaction.watchlistRotateCooldownMs) {
      return true
    }

    WatchTransaction.watchlistRotateLastByWallet.set(walletAddress, now)
    return false
  }

  private resolveTradingControlBaseUrl(): string {
    const signalEndpoint = process.env.TRADE_SIGNAL_ENDPOINT || 'http://127.0.0.1:8787/signals'
    try {
      const parsed = new URL(signalEndpoint)
      return parsed.origin
    } catch {
      return 'http://127.0.0.1:8787'
    }
  }

  private async postSourceWalletControl(payload: Record<string, unknown>): Promise<boolean> {
    const baseUrl = this.resolveTradingControlBaseUrl()
    try {
      const response = await fetch(`${baseUrl}/trading/source-wallets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      return response.ok
    } catch {
      return false
    }
  }

  private async rotateSourceWatchlistWallet(fromWallet: string, toWallet: string): Promise<boolean> {
    const baseUrl = this.resolveTradingControlBaseUrl()
    let sourceCap: number | undefined
    let sourceProfile: { preset?: string; notes?: string } | undefined

    try {
      const controlsResponse = await fetch(`${baseUrl}/trading/source-wallets`)
      if (controlsResponse.ok) {
        const controls = (await controlsResponse.json()) as {
          caps?: Record<string, number>
          profiles?: Record<string, { preset?: string; notes?: string }>
        }
        sourceCap = controls.caps?.[fromWallet]
        sourceProfile = controls.profiles?.[fromWallet]
      }
    } catch {
      // Continue without cap/profile carry-over.
    }

    const addOk = await this.postSourceWalletControl({ action: 'add', wallet: toWallet })
    if (!addOk) {
      return false
    }

    if (typeof sourceCap === 'number' && sourceCap > 0) {
      await this.postSourceWalletControl({ action: 'cap', wallet: toWallet, max_position_size_sol: sourceCap })
    }

    if (sourceProfile?.preset) {
      await this.postSourceWalletControl({
        action: 'profile',
        wallet: toWallet,
        preset: sourceProfile.preset,
        notes: sourceProfile.notes || `Auto-migrated from ${fromWallet}`,
      })
    }

    const removeOk = await this.postSourceWalletControl({ action: 'remove', wallet: fromWallet })
    return removeOk
  }

  public async getParsedTransaction(transactionSignature: string, retries = 4) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      const { connection, endpointUrl } = RpcConnectionManager.getConnectionByAttempt(attempt - 1)
      let lastErrorReason = ''

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
        lastErrorReason = this.getRpcErrorReason(error)
        if (this.shouldCooldownRpcEndpoint(error)) {
          RpcConnectionManager.markEndpointUnhealthy(endpointUrl, lastErrorReason)
        }

        console.error(`Attempt ${attempt}: Error fetching transaction details via endpoint ${endpointUrl}`, error)
      }

      // Delay before retrying
      const reason = lastErrorReason.toLowerCase()
      const retryDelayMs =
        reason.includes('429') || reason.includes('too many requests') ? 2500 * attempt : 1000 * attempt
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
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
      reason.includes('socket hang up') ||
      reason.includes('429') ||
      reason.includes('too many requests')
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

  private isTransferAlertCoolingDown(walletAddress: string): boolean {
    if (WatchTransaction.transferAlertCooldownMs <= 0) {
      return false
    }

    const now = Date.now()
    const lastSent = WatchTransaction.transferAlertLastSentByWallet.get(walletAddress) || 0
    if (now - lastSent < WatchTransaction.transferAlertCooldownMs) {
      return true
    }

    WatchTransaction.transferAlertLastSentByWallet.set(walletAddress, now)
    return false
  }
}
