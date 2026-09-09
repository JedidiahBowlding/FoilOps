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
import { smartMoneyPortfolioStrategy } from './lib/smart-money-portfolio-strategy'
import { DashboardAuth } from './lib/dashboard-auth'
import { renderHomepageHtml } from './lib/homepage'
import { renderFuturisticPage } from './lib/site-theme'
import { PrismaWalletRepository } from './repositories/prisma/wallet'
import {
  fromStoredWalletAddress,
  isBlockedTrackingWallet,
  isSolanaWallet,
  parseWalletInput,
  parseSourceWalletInput,
  toStoredWalletAddress,
} from './lib/wallet-chain'
import {
  buildTradingSettingsOperations,
  getTradingBotBaseUrl,
  resolveTradingQuickActionPath,
} from './lib/web-control-utils'
import { registerFoilOpsRoutes } from './modules/foilops/api/foilOpsRoutes'
import { FoilOpsRepository } from './modules/foilops/repository/foilOpsRepository'
import { PrismaUserRepository } from './repositories/prisma/user'
import { renderExecutionWalletsDashboard } from './lib/execution-wallets-dashboard'
import { requireTelegramWebhookSecret } from './lib/telegram-webhook-auth'
import { NewLaunchIngestor } from './lib/new-launch-ingestor'
import { PrismaLaunchCandidateRepository } from './repositories/prisma/launch-candidate'
import { registerNewLaunchRoutes } from './http/new-launch-routes'
import { LaunchDiscoveryDashboard } from './lib/launch-discovery-dashboard'
import { DiscoveryCommand } from './bot/commands/discovery-command'
import { rateLimit, requireSameOrigin } from './lib/http-security'

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
  private prismaUserRepository: PrismaUserRepository
  private readonly tradingBotUrl: string
  private newLaunchIngestor: NewLaunchIngestor
  private launchCandidateRepository: PrismaLaunchCandidateRepository
  private launchDiscoveryDashboard: LaunchDiscoveryDashboard
  private discoveryCommand: DiscoveryCommand

  private isScamMonitorEnabled(): boolean {
    return process.env.SCAM_MONITOR_ENABLED === 'true'
  }

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
    this.prismaUserRepository = new PrismaUserRepository()
    this.launchCandidateRepository = new PrismaLaunchCandidateRepository()
    this.launchDiscoveryDashboard = new LaunchDiscoveryDashboard(this.launchCandidateRepository)
    this.newLaunchIngestor = new NewLaunchIngestor(undefined, undefined, this.launchCandidateRepository)
    this.discoveryCommand = new DiscoveryCommand(bot, this.newLaunchIngestor, this.launchCandidateRepository)
    this.tradingBotUrl = getTradingBotBaseUrl()

    // register routes after route dependencies are initialized
    this.setupRoutes()

    this.startServer()
  }

  private setupMiddleware(): void {
    this.app.disable('x-powered-by')
    this.app.use(express.json({ limit: '1mb' }))
    this.app.use(express.urlencoded({ extended: false, limit: '64kb' }))
    this.app.use('/showcase', express.static(path.resolve(process.cwd(), 'showcase')))
  }

  private setupRoutes() {
    this.dashboardAuth.registerRoutes(this.app)
    this.app.use(requireSameOrigin())
    this.app.use('/api', rateLimit({ windowMs: 60_000, max: 120, label: 'api' }))
    registerNewLaunchRoutes(
      this.app,
      this.dashboardAuth.requireApiAuth,
      this.newLaunchIngestor,
      this.launchCandidateRepository,
    )

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
    this.app.post(`/webhook/telegram`, requireTelegramWebhookSecret(), async (req, res) => {
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

    this.app.get('/dashboard/discovery', this.dashboardAuth.requirePageAuth, async (_req, res) => {
      try {
        const dashboard = await this.launchDiscoveryDashboard.renderHtmlDashboard()
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.status(200).send(dashboard)
      } catch (error) {
        console.error('Launch discovery dashboard error', error)
        res.status(500).send('Failed to render launch discovery dashboard')
      }
    })

    this.app.get('/dashboard/research', this.dashboardAuth.requirePageAuth, async (_req, res) => {
      try { res.type('html').status(200).send(await this.launchDiscoveryDashboard.renderHtmlDashboard('research')) }
      catch (error) { console.error('Research dashboard error', error); res.status(500).send('Failed to render research dashboard') }
    })

    this.app.get('/dashboard/execution', this.dashboardAuth.requirePageAuth, async (_req, res) => {
      try { res.type('html').status(200).send(await this.launchDiscoveryDashboard.renderHtmlDashboard('execution')) }
      catch (error) { console.error('Execution dashboard error', error); res.status(500).send('Failed to render execution dashboard') }
    })

    this.app.get('/dashboard/discovery/:chain/:tokenMint', this.dashboardAuth.requirePageAuth, async (req, res) => {
      try {
        const dashboard = await this.launchDiscoveryDashboard.renderEvidenceHistory(
          String(req.params.chain || '').toLowerCase(),
          String(req.params.tokenMint || ''),
        )
        if (!dashboard) {
          res.status(404).send('Discovery candidate not found')
          return
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.status(200).send(dashboard)
      } catch (error) {
        console.error('Launch evidence history dashboard error', error)
        res.status(500).send('Failed to render launch evidence history')
      }
    })

    this.app.get('/dashboard/wallet-profile/:wallet', this.dashboardAuth.requirePageAuth, async (req, res) => {
      try {
        const walletInput = decodeURIComponent(String(req.params.wallet || '')).trim()
        if (!isSolanaWallet(walletInput)) {
          res.status(400).send('Wallet profile currently supports Solana wallet addresses only.')
          return
        }

        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.status(200).send(this.renderWalletProfileDashboard(walletInput))
      } catch (error) {
        console.error('Wallet profile page error', error)
        res.status(500).send('Failed to render wallet profile dashboard')
      }
    })

    this.app.get('/api/wallet-profile/:wallet', this.dashboardAuth.requireApiAuth, async (req, res) => {
      try {
        const walletInput = decodeURIComponent(String(req.params.wallet || '')).trim()
        if (!isSolanaWallet(walletInput)) {
          res.status(400).json({ message: 'Wallet profile currently supports Solana wallet addresses only.' })
          return
        }

        const data = await this.fetchWalletProfileFromSolscan(walletInput)
        res.status(200).json(data)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load wallet profile'
        console.error('Wallet profile API error', error)
        res.status(500).json({ message })
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

    this.app.get('/api/trading/strategy', this.dashboardAuth.requireApiAuth, async (_req, res) => {
      try {
        res.status(200).json(smartMoneyPortfolioStrategy.getSummary())
      } catch (error) {
        console.error('Trading strategy API error', error)
        res.status(500).json({ message: 'Failed to load trading strategy state' })
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
        console.error('Token investigation form API error', error)
        const message = error instanceof Error ? error.message : 'Failed to investigate token contract'
        res.status(message === 'Unable to resolve developer wallet for token' ? 404 : 500).json({ message })
      }
    })

    this.app.get('/api/diagnostics/launch-delay', this.dashboardAuth.requireApiAuth, async (req, res) => {
      try {
        const tokenMint = typeof req.query?.tokenMint === 'string' ? req.query.tokenMint.trim() : ''
        const sourceWallet = typeof req.query?.sourceWallet === 'string' ? req.query.sourceWallet.trim() : ''
        const botWallet =
          typeof req.query?.botWallet === 'string'
            ? req.query.botWallet.trim()
            : process.env.FOILOPS_WALLET_ADDRESS?.trim() || ''
        const scanLimit = Math.min(Number(req.query?.scanLimit) || 200, 1000)

        if (!tokenMint) {
          res.status(400).json({ message: 'tokenMint query param is required' })
          return
        }

        const rpcUrl =
          process.env.QUICKNODE_RPC_URL || process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com'

        const rpcCall = async (method: string, params: unknown[]): Promise<unknown> => {
          const response = await axios.post(rpcUrl, { jsonrpc: '2.0', id: 1, method, params }, { timeout: 20_000 })
          const data = response.data as { result?: unknown; error?: { message?: string } }
          if (data.error) throw new Error(`RPC ${method}: ${data.error.message}`)
          return data.result
        }

        const getSignaturesPage = async (
          address: string,
          before?: string,
          limit = 1000,
        ): Promise<Array<{ signature: string; blockTime: number | null }>> => {
          const result = await rpcCall('getSignaturesForAddress', [address, { limit, ...(before ? { before } : {}) }])
          return Array.isArray(result) ? (result as Array<{ signature: string; blockTime: number | null }>) : []
        }

        const getEarliestSig = async (address: string) => {
          let before: string | undefined
          let oldest: { signature: string; blockTime: number | null } | null = null
          for (let i = 0; i < 10; i++) {
            const batch = await getSignaturesPage(address, before)
            if (!batch.length) break
            oldest = batch[batch.length - 1]
            before = oldest.signature
            if (batch.length < 1000) break
          }
          return oldest
        }

        const findFirstMintTx = async (walletAddress: string) => {
          if (!walletAddress) return null
          const sigs = await getSignaturesPage(walletAddress, undefined, scanLimit)
          for (const sig of [...sigs].reverse()) {
            let tx: unknown
            try {
              tx = await rpcCall('getTransaction', [
                sig.signature,
                { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
              ])
            } catch {
              continue
            }
            if (!tx) continue
            const meta =
              (
                tx as {
                  meta?: { preTokenBalances?: Array<{ mint: string }>; postTokenBalances?: Array<{ mint: string }> }
                }
              ).meta || {}
            const balances = [...(meta.preTokenBalances || []), ...(meta.postTokenBalances || [])]
            if (balances.some((b) => b.mint === tokenMint) || JSON.stringify(tx).includes(tokenMint)) {
              return {
                signature: sig.signature,
                blockTime: sig.blockTime,
                timestamp: sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : null,
              }
            }
          }
          return null
        }

        const [mintCreation, sourceBuy, botBuy] = await Promise.all([
          getEarliestSig(tokenMint).then((r) =>
            r
              ? {
                  signature: r.signature,
                  blockTime: r.blockTime,
                  timestamp: r.blockTime ? new Date(r.blockTime * 1000).toISOString() : null,
                }
              : null,
          ),
          sourceWallet ? findFirstMintTx(sourceWallet) : Promise.resolve(null),
          botWallet ? findFirstMintTx(botWallet) : Promise.resolve(null),
        ])

        const delaySeconds = (a: number | null | undefined, b: number | null | undefined) =>
          a != null && b != null ? b - a : null

        res.status(200).json({
          tokenMint,
          sourceWallet: sourceWallet || null,
          botWallet: botWallet || null,
          scanLimit,
          mintCreation,
          sourceBuy,
          botBuy,
          delays: {
            sourceVsLaunchSeconds: delaySeconds(mintCreation?.blockTime, sourceBuy?.blockTime),
            botVsLaunchSeconds: delaySeconds(mintCreation?.blockTime, botBuy?.blockTime),
            botVsSourceSeconds: delaySeconds(sourceBuy?.blockTime, botBuy?.blockTime),
          },
        })
      } catch (error) {
        console.error('Launch delay diagnostics error', error)
        const message = error instanceof Error ? error.message : 'Failed to run launch delay diagnostics'
        res.status(500).json({ message })
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

    this.app.post('/api/token-investigation', this.dashboardAuth.requireApiAuth, async (req, res) => {
      try {
        const tokenMint = typeof req.body?.tokenMint === 'string' ? req.body.tokenMint.trim() : ''
        if (!tokenMint) {
          res.status(400).json({ message: 'Token mint is required' })
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

        if (isBlockedTrackingWallet(parsedWallet.chain, parsedWallet.address)) {
          res.status(400).json({
            message: `Wallet ${walletInput} cannot be tracked because it is a reserved program address.`,
          })
          return
        }

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
        const parseAllowedDexes = (value: unknown): string[] | undefined => {
          if (Array.isArray(value)) return value.map(String).filter(Boolean)
          return undefined
        }
        const parseDenyAllowList = (value: unknown): string[] | undefined => {
          if (Array.isArray(value)) return value.map(String).filter(Boolean)
          if (typeof value === 'string')
            return value
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean)
          return undefined
        }
        const operations = buildTradingSettingsOperations({
          profile: typeof req.body?.profile === 'string' ? req.body.profile : undefined,
          mode: typeof req.body?.mode === 'string' ? req.body.mode : undefined,
          executionMode: typeof req.body?.executionMode === 'string' ? req.body.executionMode : undefined,
          buyAmountSol: this.parseOptionalNumber(req.body?.buyAmountSol),
          maxRiskScore: this.parseOptionalNumber(req.body?.maxRiskScore),
          slippage: this.parseOptionalNumber(req.body?.slippage),
          stopLossPercentage: this.parseOptionalNumber(req.body?.stopLossPercentage),
          takeProfitPercentage: this.parseOptionalNumber(req.body?.takeProfitPercentage),
          minAlertQualityScore: this.parseOptionalNumber(req.body?.minAlertQualityScore),
          minTraceAlerts: this.parseOptionalNumber(req.body?.minTraceAlerts),
          buyOncePerToken: this.parseOptionalBoolean(req.body?.buyOncePerToken),
          mevService: typeof req.body?.mevService === 'string' ? req.body.mevService : undefined,
          maxConcurrentTrades: this.parseOptionalNumber(req.body?.maxConcurrentTrades),
          maxPositionSizeSol: this.parseOptionalNumber(req.body?.maxPositionSizeSol),
          minLiquidityUsd: this.parseOptionalNumber(req.body?.minLiquidityUsd),
          allowedDexes: parseAllowedDexes(req.body?.allowedDexes),
          targetWallet: typeof req.body?.targetWallet === 'string' ? req.body.targetWallet : undefined,
          executionWalletPrivateKey:
            typeof req.body?.executionWalletPrivateKey === 'string' ? req.body.executionWalletPrivateKey : undefined,
          autoBlockSourceWalletAfterBuy: this.parseOptionalBoolean(req.body?.autoBlockSourceWalletAfterBuy),
          preBuyCheckSellRoute: this.parseOptionalBoolean(req.body?.preBuyCheckSellRoute),
          preBuyCheckFreezeAuthority: this.parseOptionalBoolean(req.body?.preBuyCheckFreezeAuthority),
          preBuyCheckToken2022Extensions: this.parseOptionalBoolean(req.body?.preBuyCheckToken2022Extensions),
          preBuyCheckHoneypot: this.parseOptionalBoolean(req.body?.preBuyCheckHoneypot),
          preBuyCheckSuspiciousTax: this.parseOptionalBoolean(req.body?.preBuyCheckSuspiciousTax),
          denylist: parseDenyAllowList(req.body?.denylist),
          allowlist: parseDenyAllowList(req.body?.allowlist),
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
        const parsedWallet = parseSourceWalletInput(walletInput)

        if (!['add', 'remove', 'cap', 'uncap', 'profile'].includes(action)) {
          res.status(400).json({ message: 'Unsupported source wallet action.' })
          return
        }

        if (!parsedWallet || parsedWallet.chain !== 'solana') {
          res.status(400).json({ message: 'Source wallet controls currently support Solana addresses only.' })
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

    // ── Execution wallet management ──────────────────────────────────────────

    this.app.get('/dashboard/execution-wallets', this.dashboardAuth.requirePageAuth, async (_req, res) => {
      try {
        const adminUserId = this.getDashboardAdminUserId()
        const wallets = await this.prismaUserRepository.listPersonalTradingWallets(adminUserId)
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.status(200).send(renderExecutionWalletsDashboard(wallets))
      } catch (error) {
        console.error('Execution wallets dashboard error', error)
        res.status(500).send('Failed to render execution wallets dashboard')
      }
    })

    this.app.get('/api/control/personal-wallets', this.dashboardAuth.requireApiAuth, async (_req, res) => {
      try {
        const adminUserId = this.getDashboardAdminUserId()
        const wallets = await this.prismaUserRepository.listPersonalTradingWallets(adminUserId)
        res.status(200).json({ wallets })
      } catch (error) {
        console.error('Personal wallets API error', error)
        res.status(500).json({ message: 'Failed to load execution wallets' })
      }
    })

    this.app.post('/api/control/personal-wallets', this.dashboardAuth.requireApiAuth, async (req, res) => {
      try {
        const adminUserId = this.getDashboardAdminUserId()
        const action = typeof req.body?.action === 'string' ? req.body.action.trim().toLowerCase() : ''
        const walletId = typeof req.body?.walletId === 'string' ? req.body.walletId.trim() : ''

        if (!walletId) {
          res.status(400).json({ message: 'walletId is required' })
          return
        }

        if (action === 'activate') {
          const weight = this.parseOptionalNumber(req.body?.weight)
          const result = await this.prismaUserRepository.enablePersonalTradingWalletExecution(
            adminUserId,
            walletId,
            weight,
          )
          if (!result) {
            res.status(404).json({ message: 'Wallet not found' })
            return
          }
          res.status(200).json({ message: `Wallet activated.` })
          return
        }

        if (action === 'deactivate') {
          const result = await this.prismaUserRepository.disablePersonalTradingWalletExecution(adminUserId, walletId)
          if (!result) {
            res.status(404).json({ message: 'Wallet not found' })
            return
          }
          if (result.disabled === false) {
            res.status(409).json({ message: 'Wallet is already inactive.' })
            return
          }
          res.status(200).json({ message: 'Wallet deactivated.' })
          return
        }

        if (action === 'set_weight') {
          const weight = this.parseOptionalNumber(req.body?.weight)
          if (typeof weight !== 'number') {
            res.status(400).json({ message: 'weight must be a valid number >= 0.01' })
            return
          }
          const result = await this.prismaUserRepository.updatePersonalTradingWalletAllocationWeight(
            adminUserId,
            walletId,
            weight,
          )
          if (!result) {
            res.status(404).json({ message: 'Wallet not found' })
            return
          }
          res.status(200).json({ message: `Weight updated to ${result.allocationWeight.toFixed(2)}.` })
          return
        }

        res.status(400).json({ message: 'Unsupported action. Use: activate, deactivate, set_weight' })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to update execution wallet'
        console.error('Personal wallet control error', error)
        if (message.startsWith('MAX_ACTIVE_WALLETS_REACHED')) {
          res.status(409).json({ message: `Maximum active wallets reached. Deactivate one first.` })
          return
        }
        if (message === 'CANNOT_DISABLE_LAST_ACTIVE_WALLET') {
          res.status(409).json({ message: 'Cannot deactivate the last active execution wallet.' })
          return
        }
        res.status(500).json({ message })
      }
    })

    // ── Graph + FoilOps routes ───────────────────────────────────────────────

    registerGraphRoutes(this.app, {
      scamWalletRepository: this.scamWalletRepository,
      walletClusterService: this.walletClusterService,
      fundFlowTracer: this.fundFlowTracer,
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

  private parseOptionalBoolean(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') {
      return value
    }

    if (typeof value !== 'string') {
      return undefined
    }

    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') {
      return true
    }

    if (normalized === 'false') {
      return false
    }

    return undefined
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
      smartMoneyActivePositions: smartMoneyPortfolioStrategy.getSummary().activePositions,
      smartMoneyWatchedTokens: smartMoneyPortfolioStrategy.getSummary().watchedTokens,
      smartMoneyConfirmedBuys: smartMoneyPortfolioStrategy.getSummary().confirmedBuys,
      smartMoneyConfirmedSells: smartMoneyPortfolioStrategy.getSummary().confirmedSells,
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

  private async fetchWalletProfileFromSolscan(walletAddress: string): Promise<Record<string, unknown>> {
    const [accountResult, transactionsResult, transfersResult, tokenAccountsResult] = await Promise.allSettled([
      this.fetchSolscanJson('/account/detail', { address: walletAddress }),
      this.fetchSolscanJson('/account/transactions', { address: walletAddress, limit: 30, offset: 0 }),
      this.fetchSolscanJson('/account/transfer', { address: walletAddress, limit: 30, offset: 0 }),
      this.fetchSolscanJson('/account/token-accounts', {
        address: walletAddress,
        type: 'token',
        hide_zero: 'true',
        page: 1,
        page_size: 50,
      }),
    ])

    const sectionOrNull = (result: PromiseSettledResult<Record<string, unknown>>) =>
      result.status === 'fulfilled' ? result.value : null
    const sectionError = (result: PromiseSettledResult<Record<string, unknown>>) =>
      result.status === 'rejected'
        ? String(result.reason instanceof Error ? result.reason.message : result.reason)
        : null

    return {
      wallet: walletAddress,
      source: 'solscan',
      fetchedAt: new Date().toISOString(),
      account: sectionOrNull(accountResult),
      transactions: sectionOrNull(transactionsResult),
      transfers: sectionOrNull(transfersResult),
      tokenAccounts: sectionOrNull(tokenAccountsResult),
      errors: {
        account: sectionError(accountResult),
        transactions: sectionError(transactionsResult),
        transfers: sectionError(transfersResult),
        tokenAccounts: sectionError(tokenAccountsResult),
      },
    }
  }

  private async fetchSolscanJson(path: string, params: Record<string, string | number>) {
    const baseUrl = (process.env.SOLSCAN_API_BASE_URL || 'https://pro-api.solscan.io/v2.0').trim().replace(/\/$/, '')
    const apiKey = process.env.SOLSCAN_API_KEY?.trim()

    const response = await axios.get(`${baseUrl}${path}`, {
      params,
      timeout: 10_000,
      headers: {
        Accept: 'application/json',
        ...(apiKey ? { token: apiKey } : {}),
      },
    })

    return (response.data || {}) as Record<string, unknown>
  }

  private renderWalletProfileDashboard(walletAddress: string): string {
    const escapedWallet = walletAddress
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')

    return renderFuturisticPage({
      title: `Wallet Profile ${escapedWallet}`,
      activeNav: 'trading',
      heroHtml: `
        <section class="hero">
          <div>
            <p class="fx-eyebrow">Wallet Intelligence</p>
            <h1>Wallet Profile</h1>
            <p class="fx-lead">On-site wallet profile powered by Solscan API data. Stay in your dashboard while reviewing activity, transfers, and token holdings.</p>
          </div>
          <div class="card" style="min-width:280px">
            <p class="eyebrow">Wallet</p>
            <div class="big" style="font-size:1rem;word-break:break-all">${escapedWallet}</div>
            <p id="wallet-profile-status">Loading profile...</p>
          </div>
        </section>
      `,
      contentHtml: `
        <section class="section">
          <div class="button-row">
            <a class="fx-button secondary" href="/dashboard/trading-ops">Back To Trading Ops</a>
            <a class="fx-button secondary" href="/graph/${encodeURIComponent(walletAddress)}">Open Graph View</a>
          </div>
        </section>

        <section class="section table-card">
          <div class="section-header"><div class="section-header-copy"><h2>Account Summary</h2></div></div>
          <pre id="wallet-account-json" style="white-space:pre-wrap;word-break:break-word;margin:0">Loading...</pre>
        </section>

        <section class="section table-card">
          <div class="section-header"><div class="section-header-copy"><h2>Recent Transactions</h2></div></div>
          <pre id="wallet-transactions-json" style="white-space:pre-wrap;word-break:break-word;margin:0">Loading...</pre>
        </section>

        <section class="section table-card">
          <div class="section-header"><div class="section-header-copy"><h2>Recent Transfers</h2></div></div>
          <pre id="wallet-transfers-json" style="white-space:pre-wrap;word-break:break-word;margin:0">Loading...</pre>
        </section>

        <section class="section table-card">
          <div class="section-header"><div class="section-header-copy"><h2>Token Accounts</h2></div></div>
          <pre id="wallet-token-accounts-json" style="white-space:pre-wrap;word-break:break-word;margin:0">Loading...</pre>
        </section>
      `,
      scriptHtml: `<script>
        const wallet = ${JSON.stringify(walletAddress)}
        const statusEl = document.getElementById('wallet-profile-status')
        const accountEl = document.getElementById('wallet-account-json')
        const transactionsEl = document.getElementById('wallet-transactions-json')
        const transfersEl = document.getElementById('wallet-transfers-json')
        const tokenAccountsEl = document.getElementById('wallet-token-accounts-json')

        function writeJson(target, value) {
          if (!target) return
          target.textContent = JSON.stringify(value ?? {}, null, 2)
        }

        async function loadProfile() {
          try {
            const response = await fetch('/api/wallet-profile/' + encodeURIComponent(wallet), {
              method: 'GET',
              headers: { 'Content-Type': 'application/json' },
            })
            const payload = await response.json().catch(() => ({ message: 'Invalid response' }))
            if (!response.ok) {
              throw new Error(payload.message || 'Failed to load wallet profile')
            }

            writeJson(accountEl, payload.account)
            writeJson(transactionsEl, payload.transactions)
            writeJson(transfersEl, payload.transfers)
            writeJson(tokenAccountsEl, payload.tokenAccounts)
            if (statusEl) {
              const hasErrors = Object.values(payload.errors || {}).some((value) => Boolean(value))
              statusEl.textContent = hasErrors
                ? 'Profile loaded with partial errors. Check section payloads below.'
                : 'Profile loaded successfully.'
            }
          } catch (error) {
            const message = error && error.message ? error.message : 'Failed to load wallet profile'
            if (statusEl) statusEl.textContent = message
            writeJson(accountEl, { error: message })
            writeJson(transactionsEl, { error: message })
            writeJson(transfersEl, { error: message })
            writeJson(tokenAccountsEl, { error: message })
          }
        }

        loadProfile()
      </script>`,
    })
  }

  private startServer(): void {
    const host = process.env.HOST?.trim() || '127.0.0.1'
    this.app.listen(Number(PORT), host, () =>
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
    this.discoveryCommand.registerHandlers()

    // cron jobs
    await this.cronJobs.monthlySubscriptionFee()
    await this.cronJobs.updateSolPrice()
    await this.cronJobs.sendRenewalReminder()
    this.newLaunchIngestor.start()

    // setup
    await this.trackWallets.setupWalletWatcher({ event: 'initial' })
    if (this.isScamMonitorEnabled()) {
      await this.scamWalletMonitor.init()
    } else {
      console.log('SCAM_MONITOR: disabled (set SCAM_MONITOR_ENABLED=true to enable)')
    }
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
