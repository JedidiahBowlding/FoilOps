import dotenv from 'dotenv'
import { bot } from './providers/telegram'
import { StartCommand } from './bot/commands/start-command'
import { AddCommand } from './bot/commands/add-command'
import { CallbackQueryHandler } from './bot/handlers/callback-query-handler'
import express, { Express } from 'express'
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

    // register routes after route dependencies are initialized
    this.setupRoutes()

    this.startServer()
  }

  private setupMiddleware(): void {
    this.app.use(express.json({ limit: '50mb' }))
  }

  private setupRoutes() {
    // Default endpoint
    this.app.get('/', async (req, res) => {
      try {
        res.status(200).send('Hello world')
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

    this.app.get('/dashboard/scam-wallets', async (req, res) => {
      try {
        const dashboard = await this.scamDashboard.renderHtmlDashboard()
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.status(200).send(dashboard)
      } catch (error) {
        console.error('Scam dashboard error', error)
        res.status(500).send('Failed to render scam wallet dashboard')
      }
    })

    this.app.get('/api/scam-wallets', async (req, res) => {
      try {
        const data = await this.scamDashboard.getDashboardData()
        res.status(200).json(data)
      } catch (error) {
        console.error('Scam dashboard API error', error)
        res.status(500).json({ message: 'Failed to load scam wallet data' })
      }
    })

    this.app.get('/dashboard/trading-ops', async (req, res) => {
      try {
        const dashboard = await this.tradingOpsDashboard.renderHtmlDashboard()
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.status(200).send(dashboard)
      } catch (error) {
        console.error('Trading ops dashboard error', error)
        res.status(500).send('Failed to render trading ops dashboard')
      }
    })

    this.app.get('/api/trading-ops', async (req, res) => {
      try {
        const data = await this.tradingOpsDashboard.getDashboardData()
        res.status(200).json(data)
      } catch (error) {
        console.error('Trading ops API error', error)
        res.status(500).json({ message: 'Failed to load trading ops data' })
      }
    })

    this.app.get('/api/trading-ops/export', async (req, res) => {
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

    this.app.get('/api/token-investigation/:tokenMint', async (req, res) => {
      try {
        const tokenMint = req.params.tokenMint
        const investigation = await this.tokenInvestigator.investigateToken(tokenMint)

        if (!investigation) {
          res.status(404).json({ message: 'Unable to resolve developer wallet for token' })
          return
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

        res.status(200).json(investigation)
      } catch (error) {
        console.error('Token investigation API error', error)
        res.status(500).json({ message: 'Failed to investigate token contract' })
      }
    })

    registerGraphRoutes(this.app, {
      scamWalletRepository: this.scamWalletRepository,
      walletClusterService: this.walletClusterService,
      aiAnalyzer: this.aiAnalyzer,
    })
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
