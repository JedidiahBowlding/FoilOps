import dotenv from 'dotenv'
import axios from 'axios'
import { bot } from './providers/telegram'
import { StartCommand } from './bot/commands/start-command'
import { AddCommand } from './bot/commands/add-command'
import { CallbackQueryHandler } from './bot/handlers/callback-query-handler'
import express, { Express } from 'express'
import path from 'path'
import { DeleteCommand } from './bot/commands/delete-command'
import { TrackWallets } from './lib/track-wallets'
import { CronJobs } from './lib/cron-jobs'
import { ASCII_TEXT } from './constants/foilops'
import chalk from 'chalk'
import gradient from 'gradient-string'
import { GroupsCommand } from './bot/commands/groups-command'
import { HelpCommand } from './bot/commands/help-command'
import { ManageCommand } from './bot/commands/manage-command'
import { UpgradePlanCommand } from './bot/commands/upgrade-plan-command'
import { AdminCommand } from './bot/commands/admin-command'
import { ScamWalletCommand } from './bot/commands/scam-wallet-command'
import { TradingCommand } from './bot/commands/trading-command'
import { ScamWalletMonitor } from './lib/scam-wallet-monitor'
import { ScamDashboard } from './lib/scam-dashboard'
import { TokenInvestigator } from './lib/token-investigator'
import { FundFlowTracer } from './lib/fund-flow-tracer'
import { PrismaScamWalletRepository } from './repositories/prisma/scam-wallet'
import { WalletClusterService } from './lib/wallet-cluster'
import { registerGraphRoutes } from './http/graph-routes'
import { AiAnalyzer } from './lib/ai-analyzer'
import { TradingOpsDashboard } from './lib/trading-ops-dashboard'
import { TradingAnalyticsStore, TradingAnalyticsSnapshot } from './lib/trading-analytics-store'
import { DashboardAuth } from './lib/dashboard-auth'
import { renderHomepageHtml } from './lib/homepage'
import { PrismaWalletRepository } from './repositories/prisma/wallet'
import { fromStoredWalletAddress, parseWalletInput, toStoredWalletAddress } from './lib/wallet-chain'
import {
  buildTradingSettingsOperations,
  getTradingBotBaseUrl,
  resolveTradingQuickActionPath,
} from './lib/web-control-utils'
import { registerFoilOpsRoutes } from './modules/foilops/api/foilOpsRoutes'
import { FoilOpsRepository } from './modules/foilops/repository/foilOpsRepository'

dotenv.config()

const PORT = process.env.PORT || 3001

class Main {
  private trackWallets: TrackWallets

  private cronJobs: CronJobs
  private callbackQueryHandler: CallbackQueryHandler
  private startCommand: StartCommand
  private addCommand: AddCommand
  private deleteCommand: DeleteCommand
  private groupsCommand: GroupsCommand
  private helpCommand: HelpCommand
  private manageCommand: ManageCommand
  private upgradePlanCommand: UpgradePlanCommand
  private adminCommand: AdminCommand
  private scamWalletCommand: ScamWalletCommand
  private tradingCommand: TradingCommand
  private scamWalletMonitor: ScamWalletMonitor
  private scamDashboard: ScamDashboard
  private tokenInvestigator: TokenInvestigator
  private fundFlowTracer: FundFlowTracer
  private scamWalletRepository: PrismaScamWalletRepository
  private walletClusterService: WalletClusterService
  private aiAnalyzer: AiAnalyzer
  private tradingOpsDashboard: TradingOpsDashboard
  private tradingAnalyticsStore: TradingAnalyticsStore
  private dashboardAuth: DashboardAuth
  private prismaWalletRepository: PrismaWalletRepository
  private foilOpsRepository: FoilOpsRepository
  private readonly tradingBotUrl: string
  constructor(private app: Express = express()) {
    this.setupMiddleware()

    // services
    this.cronJobs = new CronJobs()
    this.trackWallets = new TrackWallets()
    this.callbackQueryHandler = new CallbackQueryHandler(bot)
    this.startCommand = new StartCommand(bot)
    this.addCommand = new AddCommand(bot)
    this.deleteCommand = new DeleteCommand(bot)
    this.groupsCommand = new GroupsCommand(bot)
    this.helpCommand = new HelpCommand(bot)
    this.manageCommand = new ManageCommand(bot)
    this.upgradePlanCommand = new UpgradePlanCommand(bot)
    this.adminCommand = new AdminCommand(bot)
    this.scamWalletMonitor = new ScamWalletMonitor()
    this.scamWalletCommand = new ScamWalletCommand(bot, this.scamWalletMonitor)
    this.tradingCommand = new TradingCommand(bot)
    this.scamDashboard = new ScamDashboard()
    this.tokenInvestigator = new TokenInvestigator()
    this.fundFlowTracer = new FundFlowTracer()
    this.scamWalletRepository = new PrismaScamWalletRepository()
    this.walletClusterService = new WalletClusterService()
    this.aiAnalyzer = new AiAnalyzer()
    this.tradingOpsDashboard = new TradingOpsDashboard()
    this.tradingAnalyticsStore = new TradingAnalyticsStore()
    this.dashboardAuth = new DashboardAuth()
    this.prismaWalletRepository = new PrismaWalletRepository()
    this.foilOpsRepository = new FoilOpsRepository()
    this.tradingBotUrl = getTradingBotBaseUrl()

    // register routes after route dependencies are initialized
    this.setupRoutes()

    this.startServer()
  }

  private setupMiddleware(): void {
    this.app.use(express.json({ limit: '50mb' }))
    this.app.use(express.urlencoded({ extended: false }))
    this.app.use('/showcase', express.static(path.resolve(process.cwd(), 'showcase')))
  }

  private setupRoutes() {
    this.dashboardAuth.registerRoutes(this.app)

    // Default endpoint
    this.app.get('/', async (req, res) => {
      try {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.status(200).send(renderHomepageHtml())
      } catch (error) {
        console.error('Default route error', error)
        res.status(500).send('Error processing default route')
      }
    })
    this.app.post(`/webhook/telegram`, async (req, res) => {
      try {
        bot.processUpdate(req.body)

        res.status(200).send('Update received')
      } catch (error) {
        console.log('Error processing update:', error)
        res.status(500).send('Error processing update')
      }
    })

    this.app.get('/dashboard/scam-wallets', this.dashboardAuth.requirePageAuth, async (req, res) => {
      try {
        const dashboard = await this.scamDashboard.renderHtmlDashboard()
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.status(200).send(dashboard)
      } catch (error) {
        console.error('Scam dashboard error', error)
        res.status(500).send('Failed to render scam wallet dashboard')
      }
    })

    this.app.get('/api/scam-wallets', this.dashboardAuth.requireApiAuth, async (req, res) => {
      try {
        const data = await this.scamDashboard.getDashboardData()
        res.status(200).json(data)
      } catch (error) {
        console.error('Scam dashboard API error', error)
        res.status(500).json({ message: 'Failed to load scam wallet data' })
      }
    })

    this.app.get('/dashboard/trading-ops', this.dashboardAuth.requirePageAuth, async (req, res) => {
      try {
        const data = await this.tradingOpsDashboard.getDashboardData()
        await this.captureTradingAnalyticsSnapshot(data)
        const dashboard = await this.tradingOpsDashboard.renderHtmlDashboard(data)
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.status(200).send(dashboard)
      } catch (error) {
        console.error('Trading ops dashboard error', error)
        res.status(500).send('Failed to render trading ops dashboard')
      }
    })

    this.app.get('/api/trading-ops', this.dashboardAuth.requireApiAuth, async (req, res) => {
      try {
        const data = await this.tradingOpsDashboard.getDashboardData()
        await this.captureTradingAnalyticsSnapshot(data)
        res.status(200).json(data)
      } catch (error) {
        console.error('Trading ops API error', error)
        res.status(500).json({ message: 'Failed to load trading ops data' })
      }
    })

    this.app.get('/api/analytics/trends', this.dashboardAuth.requireApiAuth, async (req, res) => {
      try {
        const hoursRaw = typeof req.query.hours === 'string' ? Number(req.query.hours) : Number(req.query.hours ?? 168)
        const hours = Number.isFinite(hoursRaw) ? Math.max(1, Math.min(24 * 30, Math.round(hoursRaw))) : 168
        const trends = this.tradingAnalyticsStore.getTrends(hours)
        res.status(200).json({ hours, ...trends })
      } catch (error) {
        console.error('Trading analytics trends API error', error)
        res.status(500).json({ message: 'Failed to load trading analytics trends' })
      }
    })

    this.app.post('/api/analytics/snapshot', this.dashboardAuth.requireApiAuth, async (_req, res) => {
      try {
        const data = await this.tradingOpsDashboard.getDashboardData()
        const result = await this.captureTradingAnalyticsSnapshot(data, 0)
        res.status(200).json({ message: 'Analytics snapshot captured', result })
      } catch (error) {
        console.error('Trading analytics snapshot API error', error)
        res.status(500).json({ message: 'Failed to capture trading analytics snapshot' })
      }
    })

    this.app.get('/api/graph/followed-wallets', this.dashboardAuth.requireApiAuth, async (_req, res) => {
      try {
        const followed = new Map<string, { wallet: string; sources: string[] }>()

        try {
          const adminUserId = this.getDashboardAdminUserId()
          const tracked = (await this.prismaWalletRepository.getUserWallets(adminUserId)) || []
          for (const row of tracked) {
            const parsed = fromStoredWalletAddress(row.wallet.address)
            if (parsed.chain !== 'solana') {
              continue
            }
            const existing = followed.get(parsed.address)
            if (existing) {
              if (!existing.sources.includes('tracked')) {
                existing.sources.push('tracked')
              }
            } else {
              followed.set(parsed.address, { wallet: parsed.address, sources: ['tracked'] })
            }
          }
        } catch {
          // If ADMIN_CHAT_ID is not configured, keep this endpoint usable via source-wallet fallback.
        }

        const sourceResponse = await axios.get(`${this.tradingBotUrl}/trading/source-wallets`).catch(() => null)
        const sourcePayload = (sourceResponse?.data || {}) as Record<string, unknown>
        const watchlist = Array.isArray(sourcePayload.watchlist) ? sourcePayload.watchlist : []
        for (const item of watchlist) {
          const wallet = typeof item === 'string' ? item.trim() : ''
          if (!wallet) {
            continue
          }
          const existing = followed.get(wallet)
          if (existing) {
            if (!existing.sources.includes('source')) {
              existing.sources.push('source')
            }
          } else {
            followed.set(wallet, { wallet, sources: ['source'] })
          }
        }

        const wallets = Array.from(followed.values()).sort((left, right) => left.wallet.localeCompare(right.wallet))
        res.status(200).json({ wallets })
      } catch (error) {
        console.error('Followed wallets API error', error)
        res.status(500).json({ message: 'Failed to load followed wallets' })
      }
    })

    this.app.get('/api/trading-ops/export', this.dashboardAuth.requireApiAuth, async (req, res) => {
      try {
        const format = req.query.format === 'csv' ? 'csv' : 'json'
        const exportPayload = await this.tradingOpsDashboard.exportSnapshot(format)
        res.setHeader('Content-Type', exportPayload.contentType)
        res.status(200).send(exportPayload.body)
      } catch (error) {
        console.error('Trading ops export error', error)
        res.status(500).json({ message: 'Failed to export trading ops snapshot' })
      }
    })

    this.app.get('/api/token-investigation/:tokenMint', this.dashboardAuth.requireApiAuth, async (req, res) => {
      try {
        const investigation = await this.runTokenInvestigation(req.params.tokenMint)
        res.status(200).json(investigation)
      } catch (error) {
        console.error('Token investigation API error', error)
        const message = error instanceof Error ? error.message : 'Failed to investigate token contract'
        res.status(message === 'Unable to resolve developer wallet for token' ? 404 : 500).json({ message })
      }
    })

    this.app.post('/api/token-investigation', this.dashboardAuth.requireApiAuth, async (req, res) => {
      try {
        const tokenMint = typeof req.body?.tokenMint === 'string' ? req.body.tokenMint.trim() : ''
        if (!tokenMint) {
          res.status(400).json({ message: 'tokenMint is required' })
          return
        }

        const investigation = await this.runTokenInvestigation(tokenMint)
        res.status(200).json(investigation)
      } catch (error) {
        console.error('Token investigation form API error', error)
        const message = error instanceof Error ? error.message : 'Failed to investigate token contract'
        res.status(message === 'Unable to resolve developer wallet for token' ? 404 : 500).json({ message })
      }
    })

    this.app.get('/api/token-investigations', this.dashboardAuth.requireApiAuth, async (_req, res) => {
      try {
        const investigations = await this.scamWalletRepository.getTokenInvestigationRows()
        res.status(200).json({ investigations, count: investigations.length })
      } catch (error) {
        console.error('Token investigations list API error', error)
        res.status(500).json({ message: 'Failed to load token investigations' })
      }
    })

    this.app.get('/api/control/tracked-wallets', this.dashboardAuth.requireApiAuth, async (_req, res) => {
      try {
        const adminUserId = this.getDashboardAdminUserId()
        const userWallets = (await this.prismaWalletRepository.getUserWallets(adminUserId)) || []
        const wallets = await Promise.all(
          userWallets.map(async (userWallet) => {
            const storedAddress = userWallet.wallet.address
            const parsed = fromStoredWalletAddress(storedAddress)
            const scamWallet =
              parsed.chain === 'solana' ? await this.scamWalletRepository.getScamWalletByAddress(parsed.address) : null
            const rapidDumper = this.isRapidDumperPattern(scamWallet?.reason, scamWallet?.events)
            const isFlagged = scamWallet?.isFlagged === true
            const doNotTrack = isFlagged && rapidDumper
            const badges = this.buildTrackedWalletBadges({
              status: userWallet.status,
              isFlagged,
              rapidDumper,
              doNotTrack,
            })

            return {
              walletId: userWallet.walletId,
              storedAddress,
              displayAddress: parsed.chain === 'solana' ? parsed.address : `${parsed.chain}:${parsed.address}`,
              chain: parsed.chain,
              address: parsed.address,
              name: userWallet.name || '',
              status: userWallet.status,
              badges,
              doNotTrack,
              scamReason: scamWallet?.reason || null,
            }
          }),
        )
        const sortedWallets = wallets.sort((left, right) => left.displayAddress.localeCompare(right.displayAddress))

        res.status(200).json({ wallets: sortedWallets })
      } catch (error) {
        console.error('Tracked wallets API error', error)
        res.status(500).json({ message: 'Failed to load tracked wallets' })
      }
    })

    this.app.post('/api/control/tracked-wallets', this.dashboardAuth.requireApiAuth, async (req, res) => {
      try {
        const adminUserId = this.getDashboardAdminUserId()
        const action = typeof req.body?.action === 'string' ? req.body.action.trim().toLowerCase() : ''
        const walletInput = typeof req.body?.wallet === 'string' ? req.body.wallet.trim() : ''
        const walletName = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
        const parsedWallet = parseWalletInput(walletInput)

        if (!parsedWallet) {
          res.status(400).json({
            message: 'Invalid wallet format. Use Solana base58 or prefixed EVM input such as eth:0x... or bnb:0x...',
          })
          return
        }

        const storedWalletAddress = toStoredWalletAddress(parsedWallet.chain, parsedWallet.address)

        if (action === 'add') {
          const existingWallet = await this.prismaWalletRepository.getUserWalletById(adminUserId, storedWalletAddress)
          if (existingWallet) {
            res.status(409).json({ message: `Wallet ${walletInput} is already being tracked.` })
            return
          }

          const scamWallet =
            parsedWallet.chain === 'solana'
              ? await this.scamWalletRepository.getScamWalletByAddress(parsedWallet.address)
              : null
          const shouldDoNotTrack =
            scamWallet?.isFlagged === true && this.isRapidDumperPattern(scamWallet?.reason, scamWallet?.events)
          const initialStatus = shouldDoNotTrack ? 'BANNED' : 'ACTIVE'

          const createdWallet = await this.prismaWalletRepository.create(
            adminUserId,
            storedWalletAddress,
            walletName,
            initialStatus,
          )
          if (!createdWallet?.id) {
            res.status(500).json({ message: 'Wallet could not be added.' })
            return
          }

          await this.trackWallets.setupWalletWatcher({ event: 'create', walletId: createdWallet.id })
          res.status(200).json({
            message: shouldDoNotTrack
              ? `Wallet ${walletInput} has been stored as DO_NOT_TRACK (flagged rapid-dumper pattern).`
              : `Wallet ${walletInput} has been added.`,
            doNotTrack: shouldDoNotTrack,
            status: initialStatus,
          })
          return
        }

        if (action === 'remove') {
          const deletedWallet = await this.prismaWalletRepository.deleteWallet(adminUserId, storedWalletAddress)
          if (!deletedWallet?.walletId) {
            res.status(404).json({ message: `Wallet ${walletInput} is not currently being tracked.` })
            return
          }

          await this.trackWallets.setupWalletWatcher({ event: 'delete', walletId: deletedWallet.walletId })
          res.status(200).json({ message: `Wallet ${walletInput} has been removed.` })
          return
        }

        res.status(400).json({ message: 'Unsupported tracked wallet action.' })
      } catch (error) {
        console.error('Tracked wallet control error', error)
        res.status(500).json({ message: 'Failed to update tracked wallets' })
      }
    })

    this.app.post('/api/control/trading/action', this.dashboardAuth.requireApiAuth, async (req, res) => {
      try {
        const action = typeof req.body?.action === 'string' ? req.body.action.trim().toLowerCase() : ''
        const path = resolveTradingQuickActionPath(action)

        if (!path) {
          res.status(400).json({ message: 'Unsupported trading action.' })
          return
        }

        if (action === 'enable' || action === 'resume') {
          const sourceResponse = await axios.get(`${this.tradingBotUrl}/trading/source-wallets`).catch(() => null)
          const sourcePayload = (sourceResponse?.data || {}) as Record<string, unknown>
          const watchlist = Array.isArray(sourcePayload.watchlist) ? sourcePayload.watchlist : []

          const blockedWallets: string[] = []
          for (const item of watchlist) {
            const walletAddress = typeof item === 'string' ? item.trim() : ''
            if (!walletAddress) {
              continue
            }

            const scamWallet = await this.scamWalletRepository.getScamWalletByAddress(walletAddress)
            const blocked =
              scamWallet?.isFlagged === true && this.isRapidDumperPattern(scamWallet.reason, scamWallet.events)
            if (blocked) {
              blockedWallets.push(walletAddress)
            }
          }

          if (blockedWallets.length > 0) {
            res.status(403).json({
              message: `Refusing ${action}. Remove flagged rapid-dumper wallets from source watchlist first.`,
              blockedWallets,
            })
            return
          }
        }

        const payload = action === 'retry-failed' ? { limit: Number(req.body?.limit) || 10 } : {}
        const response = await axios.post(`${this.tradingBotUrl}${path}`, payload)
        res.status(200).json(response.data)
      } catch (error) {
        console.error('Trading quick action API error', error)
        res.status(500).json({ message: 'Failed to update trading state' })
      }
    })

    this.app.post('/api/control/trading/settings', this.dashboardAuth.requireApiAuth, async (req, res) => {
      try {
        const operations = buildTradingSettingsOperations({
          profile: typeof req.body?.profile === 'string' ? req.body.profile : undefined,
          mode: typeof req.body?.mode === 'string' ? req.body.mode : undefined,
          executionMode: typeof req.body?.executionMode === 'string' ? req.body.executionMode : undefined,
          buyAmountSol: this.parseOptionalNumber(req.body?.buyAmountSol),
          maxRiskScore: this.parseOptionalNumber(req.body?.maxRiskScore),
          slippage: this.parseOptionalNumber(req.body?.slippage),
          minAlertQualityScore: this.parseOptionalNumber(req.body?.minAlertQualityScore),
          minTraceAlerts: this.parseOptionalNumber(req.body?.minTraceAlerts),
        })

        if (operations.length === 0) {
          res.status(400).json({ message: 'No valid trading settings were provided.' })
          return
        }

        const results = []
        for (const operation of operations) {
          const response = await axios.post(`${this.tradingBotUrl}${operation.path}`, operation.body)
          results.push({ path: operation.path, result: response.data })
        }

        res.status(200).json({ message: 'Trading settings updated.', results })
      } catch (error) {
        console.error('Trading settings API error', error)
        res.status(500).json({ message: 'Failed to update trading settings' })
      }
    })

    this.app.post('/api/control/trading/source-wallets', this.dashboardAuth.requireApiAuth, async (req, res) => {
      try {
        const action = typeof req.body?.action === 'string' ? req.body.action.trim().toLowerCase() : ''
        const walletInput = typeof req.body?.wallet === 'string' ? req.body.wallet.trim() : ''
        const parsedWallet = parseWalletInput(walletInput)

        if (!['add', 'remove', 'cap', 'uncap', 'profile'].includes(action)) {
          res.status(400).json({ message: 'Unsupported source wallet action.' })
          return
        }

        if (!parsedWallet || parsedWallet.chain !== 'solana') {
          res.status(400).json({ message: 'Source wallet controls currently support Solana wallet addresses only.' })
          return
        }

        if (action !== 'remove') {
          const scamWallet = await this.scamWalletRepository.getScamWalletByAddress(parsedWallet.address)
          const doNotTrack =
            scamWallet?.isFlagged === true && this.isRapidDumperPattern(scamWallet.reason, scamWallet.events)
          if (doNotTrack) {
            res.status(403).json({
              message: 'Source wallet is flagged with rapid-dumper pattern and is enforced as DO_NOT_TRACK.',
              wallet: parsedWallet.address,
            })
            return
          }
        }

        const payload: Record<string, unknown> = {
          action,
          wallet: parsedWallet.address,
        }

        const maxPositionSizeSol = this.parseOptionalNumber(req.body?.maxPositionSizeSol)
        if (action === 'cap' && typeof maxPositionSizeSol === 'number' && maxPositionSizeSol > 0) {
          payload.max_position_size_sol = maxPositionSizeSol
        }

        if (action === 'profile' && typeof req.body?.preset === 'string' && req.body.preset.trim()) {
          payload.preset = req.body.preset.trim().toLowerCase()
        }

        if (typeof req.body?.notes === 'string' && req.body.notes.trim()) {
          payload.notes = req.body.notes.trim()
        }

        const response = await axios.post(`${this.tradingBotUrl}/trading/source-wallets`, payload)
        res.status(200).json(response.data)
      } catch (error) {
        console.error('Source wallet control API error', error)
        res.status(500).json({ message: 'Failed to update source wallet controls' })
      }
    })

    registerGraphRoutes(this.app, {
      scamWalletRepository: this.scamWalletRepository,
      walletClusterService: this.walletClusterService,
      aiAnalyzer: this.aiAnalyzer,
      apiAuthMiddleware: this.dashboardAuth.requireApiAuth,
      pageAuthMiddleware: this.dashboardAuth.requirePageAuth,
    })

    registerFoilOpsRoutes(this.app, {
      requireApiAuth: this.dashboardAuth.requireApiAuth,
      requirePageAuth: this.dashboardAuth.requirePageAuth,
      repository: this.foilOpsRepository,
    })
  }

  private getDashboardAdminUserId(): string {
    const adminUserId = process.env.ADMIN_CHAT_ID?.trim()
    if (!adminUserId) {
      throw new Error('ADMIN_CHAT_ID is required for web-side wallet management')
    }

    return adminUserId
  }

  private async runTokenInvestigation(tokenMint: string) {
    const investigation = await this.tokenInvestigator.investigateToken(tokenMint)

    if (!investigation) {
      throw new Error('Unable to resolve developer wallet for token')
    }

    await this.scamWalletRepository.manualFlagWallet(
      investigation.developerWallet,
      `Developer wallet identified from token ${tokenMint}`,
      82,
    )
    await this.scamWalletRepository.saveTokenInvestigation(
      investigation.developerWallet,
      tokenMint,
      investigation.resolutionSource,
      investigation.relatedTokens,
    )
    await this.scamWalletRepository.saveFlowTrace(
      investigation.developerWallet,
      investigation.trace,
      'TOKEN_INVESTIGATION',
    )
    await this.scamWalletMonitor.refreshSubscriptions()

    return investigation
  }

  private parseOptionalNumber(value: unknown): number | undefined {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : undefined
    }

    if (typeof value !== 'string') {
      return undefined
    }

    const normalized = value.trim()
    if (!normalized) {
      return undefined
    }

    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  private async captureTradingAnalyticsSnapshot(data: Record<string, unknown>, minIntervalMinutes = 10) {
    const metrics = (data.metrics as Record<string, unknown>) || {}
    const metricValues = (metrics.metrics as Record<string, unknown>) || {}
    const safety = (data.safety as Record<string, unknown>) || {}
    const sources = (data.sources as Record<string, unknown>) || {}
    const watchlist = Array.isArray(sources.watchlist) ? sources.watchlist : []
    const journal = Array.isArray(data.journal) ? (data.journal as Array<Record<string, unknown>>) : []
    const decisions = Array.isArray(data.decisions) ? (data.decisions as Array<Record<string, unknown>>) : []
    const attributionMetrics = this.buildAttributionSnapshotMetrics(journal, decisions)
    const trackedWalletCount = await this.getTrackedWalletCount()

    const toNumber = (value: unknown): number => {
      if (typeof value === 'number' && Number.isFinite(value)) return value
      if (typeof value === 'string') {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : 0
      }
      return 0
    }

    const snapshot: TradingAnalyticsSnapshot = {
      timestamp: new Date().toISOString(),
      executionEnabled: Boolean((data.status as Record<string, unknown>)?.enabled),
      maxRiskScore:
        typeof safety.maxRiskScore === 'number'
          ? safety.maxRiskScore
          : typeof safety.max_risk_score === 'number'
            ? safety.max_risk_score
            : null,
      deadLetterCount: toNumber(metrics.deadLetterCount),
      receivedTotal: toNumber(metricValues.receivedTotal),
      executedTotal: toNumber(metricValues.executedTotal),
      blockedTotal: toNumber(metricValues.blockedTotal),
      failedTotal: toNumber(metricValues.failedTotal),
      watchlistSize: watchlist.length,
      trackedWalletCount,
      avgWalletWinRate: attributionMetrics.avgWalletWinRate,
      avgWalletPnl: attributionMetrics.avgWalletPnl,
    }

    return this.tradingAnalyticsStore.appendSnapshot(snapshot, minIntervalMinutes)
  }

  private async getTrackedWalletCount(): Promise<number | null> {
    try {
      const adminUserId = this.getDashboardAdminUserId()
      const wallets = await this.prismaWalletRepository.getUserWallets(adminUserId)
      return Array.isArray(wallets) ? wallets.length : 0
    } catch {
      return null
    }
  }

  private buildAttributionSnapshotMetrics(
    journal: Array<Record<string, unknown>>,
    decisions: Array<Record<string, unknown>>,
  ): { avgWalletWinRate: number | null; avgWalletPnl: number | null } {
    const perWallet = new Map<string, { trades: number; wins: number; realizedPnl: number; rapidDumpCount: number }>()

    const ensure = (wallet: string) => {
      const existing = perWallet.get(wallet)
      if (existing) {
        return existing
      }
      const next = { trades: 0, wins: 0, realizedPnl: 0, rapidDumpCount: 0 }
      perWallet.set(wallet, next)
      return next
    }

    const toNumberOrNull = (value: unknown): number | null => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value
      }
      if (typeof value === 'string') {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : null
      }
      return null
    }

    for (const row of journal) {
      const wallet = String(row.sourceWallet || '').trim()
      if (!wallet) {
        continue
      }

      const target = ensure(wallet)
      target.trades += 1
      const pnl = toNumberOrNull(row.pnlPct) ?? toNumberOrNull(row.gainLossPct)
      if (pnl != null) {
        target.realizedPnl += pnl
        if (pnl > 0) {
          target.wins += 1
        }
      }

      const reason = String(row.reason || '').toLowerCase()
      if (/rapid[-\s]?dump|aggressive[-\s]?dump/.test(reason)) {
        target.rapidDumpCount += 1
      }
    }

    for (const row of decisions) {
      const wallet = String(row.sourceWallet || '').trim()
      if (!wallet) {
        continue
      }

      const target = ensure(wallet)
      const safetyReasons = Array.isArray(row.safetyReasons)
        ? row.safetyReasons.map((reason) => String(reason).toLowerCase())
        : []
      if (safetyReasons.some((reason) => reason.includes('rapid') && reason.includes('dump'))) {
        target.rapidDumpCount += 1
      }
    }

    const withTrades = Array.from(perWallet.values()).filter((row) => row.trades > 0)
    if (withTrades.length === 0) {
      return { avgWalletWinRate: null, avgWalletPnl: null }
    }

    const avgWalletWinRate = Math.round(
      withTrades.reduce((sum, row) => sum + (row.wins / row.trades) * 100, 0) / withTrades.length,
    )
    const avgWalletPnl = Number(
      (withTrades.reduce((sum, row) => sum + row.realizedPnl, 0) / withTrades.length).toFixed(2),
    )

    return {
      avgWalletWinRate,
      avgWalletPnl,
    }
  }

  private isRapidDumperPattern(
    reason?: string | null,
    events?: Array<{ details?: string | null; eventType?: string | null }>,
  ): boolean {
    const signal = /rapid[-\s]?dumper|aggressive[-\s]?dumper|rapid\s+dump/i
    if (reason && signal.test(reason)) {
      return true
    }

    return (events || []).some((event) => {
      if (event.details && signal.test(event.details)) {
        return true
      }

      return typeof event.eventType === 'string' && /dump/i.test(event.eventType)
    })
  }

  private buildTrackedWalletBadges(input: {
    status: string
    isFlagged: boolean
    rapidDumper: boolean
    doNotTrack: boolean
  }): string[] {
    const badges = [input.status]

    if (input.isFlagged) {
      badges.push('FLAGGED')
    }
    if (input.rapidDumper) {
      badges.push('RAPID_DUMPER')
    }
    if (input.doNotTrack) {
      badges.push('DO_NOT_TRACK')
    }

    return badges
  }

  private startServer(): void {
    this.app.listen(PORT, () =>
      console.log(`${chalk.bold.white.bgMagenta(`Server running on http://localhost:${PORT}`)}`),
    )
  }

  public async init(): Promise<void> {
    const gradientText = gradient.retro
    console.log(gradientText(ASCII_TEXT))

    // bot
    this.callbackQueryHandler.call()
    this.startCommand.start()
    this.tradingCommand.start()
    this.addCommand.addCommandHandler()
    this.deleteCommand.deleteCommandHandler()
    this.groupsCommand.activateGroupCommandHandler()
    this.manageCommand.manageCommandHandler()
    this.upgradePlanCommand.upgradePlanCommandHandler()
    this.helpCommand.groupHelpCommandHandler()
    this.helpCommand.notifyHelpCommandHander()
    this.adminCommand.banWalletCommandHandler()
    this.scamWalletCommand.registerHandlers()

    // cron jobs
    await this.cronJobs.monthlySubscriptionFee()
    await this.cronJobs.updateSolPrice()
    await this.cronJobs.sendRenewalReminder()

    // setup
    await this.trackWallets.setupWalletWatcher({ event: 'initial' })
    await this.scamWalletMonitor.init()
  }
}

const main = new Main()

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED_REJECTION', reason)
})

process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT_EXCEPTION', error)
})

main.init().catch((error) => {
  console.error('MAIN_INIT_ERROR', error)
})
