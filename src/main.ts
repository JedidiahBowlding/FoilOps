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
import { PrismaScamWalletRepository } from './repositories/prisma/scam-wallet'
import { WalletClusterService } from './lib/wallet-cluster'
import { registerGraphRoutes } from './http/graph-routes'
import { AiAnalyzer } from './lib/ai-analyzer'
import { TradingOpsDashboard } from './lib/trading-ops-dashboard'
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
  private scamWalletRepository: PrismaScamWalletRepository
  private walletClusterService: WalletClusterService
  private aiAnalyzer: AiAnalyzer
  private tradingOpsDashboard: TradingOpsDashboard
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
    this.scamWalletRepository = new PrismaScamWalletRepository()
    this.walletClusterService = new WalletClusterService()
    this.aiAnalyzer = new AiAnalyzer()
    this.tradingOpsDashboard = new TradingOpsDashboard()
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
        const dashboard = await this.tradingOpsDashboard.renderHtmlDashboard()
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
        res.status(200).json(data)
      } catch (error) {
        console.error('Trading ops API error', error)
        res.status(500).json({ message: 'Failed to load trading ops data' })
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

    this.app.get('/api/control/tracked-wallets', this.dashboardAuth.requireApiAuth, async (_req, res) => {
      try {
        const adminUserId = this.getDashboardAdminUserId()
        const userWallets = (await this.prismaWalletRepository.getUserWallets(adminUserId)) || []
        const wallets = userWallets
          .map((userWallet) => {
            const storedAddress = userWallet.wallet.address
            const parsed = fromStoredWalletAddress(storedAddress)

            return {
              walletId: userWallet.walletId,
              storedAddress,
              displayAddress: parsed.chain === 'solana' ? parsed.address : `${parsed.chain}:${parsed.address}`,
              chain: parsed.chain,
              address: parsed.address,
              name: userWallet.name || '',
              status: userWallet.status,
            }
          })
          .sort((left, right) => left.displayAddress.localeCompare(right.displayAddress))

        res.status(200).json({ wallets })
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

          const createdWallet = await this.prismaWalletRepository.create(adminUserId, storedWalletAddress, walletName)
          if (!createdWallet?.id) {
            res.status(500).json({ message: 'Wallet could not be added.' })
            return
          }

          await this.trackWallets.setupWalletWatcher({ event: 'create', walletId: createdWallet.id })
          res.status(200).json({ message: `Wallet ${walletInput} has been added.` })
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
main.init()
