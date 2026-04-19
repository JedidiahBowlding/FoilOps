import TelegramBot from 'node-telegram-bot-api'
import { AlertEventType } from '@prisma/client'
import { PublicKey } from '@solana/web3.js'
import { BotMiddleware } from '../../config/bot-middleware'
import { SCAM_INTEL_MENU, SUB_MENU } from '../../config/bot-menus'
import { PrismaScamWalletRepository } from '../../repositories/prisma/scam-wallet'
import { ScamWalletMonitor } from '../../lib/scam-wallet-monitor'
import { FundFlowTracer } from '../../lib/fund-flow-tracer'
import { TokenInvestigator } from '../../lib/token-investigator'
import { tradeSignalEmitter } from '../../lib/trade-signal-emitter'
import { WalletClusterService } from '../../lib/wallet-cluster'
import { AiAnalyzer } from '../../lib/ai-analyzer'
import { PrismaUserAlertRuleRepository } from '../../repositories/prisma/user-alert-rule'

export class ScamWalletCommand {
  private scamWalletRepository: PrismaScamWalletRepository
  private scamWalletMonitor: ScamWalletMonitor
  private fundFlowTracer: FundFlowTracer
  private tokenInvestigator: TokenInvestigator
  private walletClusterService: WalletClusterService
  private aiAnalyzer: AiAnalyzer
  private userAlertRuleRepository: PrismaUserAlertRuleRepository

  constructor(
    private bot: TelegramBot,
    scamWalletMonitor: ScamWalletMonitor,
  ) {
    this.bot = bot
    this.scamWalletRepository = new PrismaScamWalletRepository()
    this.scamWalletMonitor = scamWalletMonitor
    this.fundFlowTracer = new FundFlowTracer()
    this.tokenInvestigator = new TokenInvestigator()
    this.walletClusterService = new WalletClusterService()
    this.aiAnalyzer = new AiAnalyzer()
    this.userAlertRuleRepository = new PrismaUserAlertRuleRepository()
  }

  public registerHandlers() {
    this.scamIntelligenceHandler()
    this.flagWalletHandler()
    this.unflagWalletHandler()
    this.scamFeedHandler()
    this.flowMapHandler()
    this.traceTokenHandler()
    this.clusterHandler()
    this.analyzeHandler()
    this.graphWalletHandler()
    this.graphNeighborsHandler()
    this.setAlertHandler()
    this.viewAlertsHandler()
    this.deleteAlertHandler()
  }

  private scamIntelligenceHandler() {
    this.bot.onText(/^\/scam_intelligence(?:@\w+)?$/i, async (msg) => {
      const userId = String(msg.from?.id || '')
      if (!BotMiddleware.isUserBotAdmin(userId)) return

      await this.bot.sendMessage(
        msg.chat.id,
        [
          '🚨 <b>Scam Intelligence</b>',
          '',
          '🚩 <b>Flag Wallet</b> — reply with: <code>/flag_wallet &lt;address&gt; [reason]</code>',
          '🗺️ <b>Flow Map</b> — reply with: <code>/flow_map &lt;address&gt;</code>',
          '🔬 <b>Trace Token</b> — reply with: <code>/trace_token &lt;token_mint&gt;</code>',
          '📡 <b>Scam Feed</b> — reply with: <code>/scam_feed</code>',
          '',
          'Or use the buttons below to be prompted automatically.',
        ].join('\n'),
        {
          parse_mode: 'HTML',
          reply_markup: SCAM_INTEL_MENU,
        },
      )
    })
  }

  private graphWalletHandler() {
    this.bot.onText(/\/graph_wallet(?:\s+([^\s]+))?/, async (msg, match) => {
      const userId = String(msg.from?.id || '')
      if (!BotMiddleware.isUserBotAdmin(userId)) return

      const chatId = msg.chat.id
      const wallet = match?.[1]?.trim()

      if (!wallet) {
        await this.bot.sendMessage(chatId, 'Usage: <code>/graph_wallet &lt;wallet_address&gt;</code>', {
          parse_mode: 'HTML',
          reply_markup: SUB_MENU,
        })
        return
      }

      if (!this.isValidPublicKey(wallet)) {
        await this.bot.sendMessage(chatId, 'Invalid wallet address.', { reply_markup: SUB_MENU })
        return
      }

      const graphData = await this.getGraphData(wallet)
      const analysis = await this.aiAnalyzer.analyzeWallet(wallet)

      const lines = [
        '🕸️ <b>Graph Wallet Summary</b>',
        `Wallet: <code>${wallet}</code>`,
        `Nodes: <b>${graphData.nodes.length}</b>`,
        `Edges: <b>${graphData.edges.length}</b>`,
        `Cluster score: <b>${graphData.cluster?.score ?? 'n/a'}</b>`,
        `Cluster risk: <b>${graphData.cluster?.riskScore ?? 'n/a'}</b>`,
        '',
        '<b>Analysis</b>',
        ...analysis.split('\n').slice(0, 6),
      ]

      await this.bot.sendMessage(chatId, lines.join('\n'), {
        parse_mode: 'HTML',
        reply_markup: this.graphInlineMenu(wallet),
      })
    })
  }

  private graphNeighborsHandler() {
    this.bot.onText(/\/graph_neighbors(?:\s+([^\s]+))?/, async (msg, match) => {
      const userId = String(msg.from?.id || '')
      if (!BotMiddleware.isUserBotAdmin(userId)) return

      const chatId = msg.chat.id
      const wallet = match?.[1]?.trim()

      if (!wallet) {
        await this.bot.sendMessage(chatId, 'Usage: <code>/graph_neighbors &lt;wallet_address&gt;</code>', {
          parse_mode: 'HTML',
          reply_markup: SUB_MENU,
        })
        return
      }

      const graphData = await this.getGraphData(wallet)
      const neighbors = graphData.edges.filter((edge) => edge.from === wallet || edge.to === wallet).slice(0, 12)

      if (neighbors.length === 0) {
        await this.bot.sendMessage(chatId, 'No graph neighbors found yet for this wallet.', {
          reply_markup: this.graphInlineMenu(wallet),
        })
        return
      }

      const lines = ['🧭 <b>Graph Neighbors</b>', `Wallet: <code>${wallet}</code>`, '']

      for (const edge of neighbors) {
        const other = edge.from === wallet ? edge.to : edge.from
        lines.push(`• <code>${other}</code>`)
        lines.push(`  ${edge.label} | hop ${edge.hop}`)
        lines.push(`  <a href="https://solscan.io/tx/${edge.signature}">Tx</a>`)
      }

      await this.bot.sendMessage(chatId, lines.join('\n'), {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: this.graphInlineMenu(wallet),
      })
    })
  }

  private clusterHandler() {
    this.bot.onText(/\/cluster(?:\s+([^\s]+))?/, async (msg, match) => {
      const userId = String(msg.from?.id || '')
      if (!BotMiddleware.isUserBotAdmin(userId)) return

      const chatId = msg.chat.id
      const wallet = match?.[1]?.trim()

      if (!wallet) {
        await this.bot.sendMessage(chatId, 'Usage: <code>/cluster &lt;wallet_address&gt;</code>', {
          parse_mode: 'HTML',
          reply_markup: SUB_MENU,
        })
        return
      }

      const cluster = await this.walletClusterService.buildCluster(wallet)

      await this.scamWalletRepository.recordEvent({
        address: wallet,
        eventType: 'CLUSTER_ALERT',
        details: `Cluster recalculated with ${cluster.linkedWallets.length} linked wallets`,
        metadata: {
          linkedWallets: cluster.linkedWallets,
          clusterScore: cluster.clusterScore,
          combinedRiskScore: cluster.combinedRiskScore,
        },
      })

      await this.bot.sendMessage(
        chatId,
        [
          '🧬 <b>Wallet Cluster Report</b>',
          `Wallet: <code>${wallet}</code>`,
          `Linked wallets: <b>${cluster.linkedWallets.length}</b>`,
          `Cluster score: <b>${cluster.clusterScore}</b>`,
          `Combined risk: <b>${cluster.combinedRiskScore}/100</b>`,
          '',
          '<b>Shared behaviors:</b>',
          ...cluster.sharedBehaviors.sharedFundingSources.map((item) => `• ${item}`),
          ...cluster.sharedBehaviors.repeatedInteractionPatterns.map((item) => `• ${item}`),
          ...cluster.sharedBehaviors.flowOverlaps.map((item) => `• ${item}`),
          ...cluster.sharedBehaviors.deploymentRelationships.map((item) => `• ${item}`),
        ].join('\n'),
        {
          parse_mode: 'HTML',
          reply_markup: SUB_MENU,
        },
      )
    })
  }

  private analyzeHandler() {
    this.bot.onText(/\/analyze(?:\s+([^\s]+))?/, async (msg, match) => {
      const userId = String(msg.from?.id || '')
      if (!BotMiddleware.isUserBotAdmin(userId)) return

      const chatId = msg.chat.id
      const wallet = match?.[1]?.trim()

      if (!wallet) {
        await this.bot.sendMessage(chatId, 'Usage: <code>/analyze &lt;wallet_address&gt;</code>', {
          parse_mode: 'HTML',
          reply_markup: SUB_MENU,
        })
        return
      }

      const analysis = await this.aiAnalyzer.analyzeWallet(wallet)
      await this.bot.sendMessage(chatId, `<pre>${analysis}</pre>`, {
        parse_mode: 'HTML',
        reply_markup: SUB_MENU,
      })
    })
  }

  private setAlertHandler() {
    this.bot.onText(/\/set_alert(?:\s+(\d+))?(?:\s+(\d+(?:\.\d+)?))?(?:\s+(.+))?/, async (msg, match) => {
      const userId = String(msg.from?.id || '')
      const chatId = msg.chat.id

      const minRiskScore = Number(match?.[1] || 70)
      const minTransactionSize = Number(match?.[2] || 0)
      const rawEventTypes = match?.[3] || 'SUSPICIOUS_TOKEN_LAUNCH,ANOMALY_DETECTED,SUSPICIOUS_PRELAUNCH_SIGNAL'

      const eventTypes = rawEventTypes
        .split(',')
        .map((part) => part.trim().toUpperCase())
        .filter((part): part is AlertEventType => {
          return [
            'SUSPICIOUS_TOKEN_LAUNCH',
            'SUSPICIOUS_PRELAUNCH_SIGNAL',
            'ANOMALY_DETECTED',
            'PLATFORM_INTERACTION',
            'FLOW_TO_NEW_LAUNCH',
            'TOKEN_INVESTIGATION',
            'CLUSTER_ALERT',
          ].includes(part)
        })

      const rule = await this.userAlertRuleRepository.setRule(userId, {
        minRiskScore: Math.max(0, Math.min(100, minRiskScore)),
        minTransactionSize: Math.max(0, minTransactionSize),
        eventTypes: eventTypes.length > 0 ? eventTypes : ['SUSPICIOUS_TOKEN_LAUNCH', 'ANOMALY_DETECTED'],
      })

      await this.bot.sendMessage(
        chatId,
        [
          '✅ <b>Alert rule saved</b>',
          `Rule ID: <code>${rule.id}</code>`,
          `Min risk score: <b>${rule.minRiskScore}</b>`,
          `Min transaction size: <b>${rule.minTransactionSize}</b>`,
          `Event types: <b>${rule.eventTypes.join(', ')}</b>`,
          '',
          'Usage: /set_alert [minRiskScore] [minTransactionSize] [event1,event2,...]',
        ].join('\n'),
        {
          parse_mode: 'HTML',
          reply_markup: SUB_MENU,
        },
      )
    })
  }

  private viewAlertsHandler() {
    this.bot.onText(/\/view_alerts/, async (msg) => {
      const userId = String(msg.from?.id || '')
      const chatId = msg.chat.id

      const rules = await this.userAlertRuleRepository.listRules(userId)
      if (rules.length === 0) {
        await this.bot.sendMessage(chatId, 'No alert rules found. Use /set_alert to create one.', {
          reply_markup: SUB_MENU,
        })
        return
      }

      const lines = ['📡 <b>Your Alert Rules</b>', '']
      for (const rule of rules) {
        lines.push(`• ID: <code>${rule.id}</code>`)
        lines.push(`  Min risk: <b>${rule.minRiskScore}</b> | Min tx size: <b>${rule.minTransactionSize}</b>`)
        lines.push(`  Events: ${rule.eventTypes.join(', ')}`)
        lines.push('')
      }

      await this.bot.sendMessage(chatId, lines.join('\n'), {
        parse_mode: 'HTML',
        reply_markup: SUB_MENU,
      })
    })
  }

  private deleteAlertHandler() {
    this.bot.onText(/\/delete_alert(?:\s+([^\s]+))?/, async (msg, match) => {
      const userId = String(msg.from?.id || '')
      const chatId = msg.chat.id
      const ruleId = match?.[1]?.trim()

      if (!ruleId) {
        await this.bot.sendMessage(chatId, 'Usage: <code>/delete_alert &lt;rule_id&gt;</code>', {
          parse_mode: 'HTML',
          reply_markup: SUB_MENU,
        })
        return
      }

      const deleted = await this.userAlertRuleRepository.deleteRule(userId, ruleId)
      if (!deleted) {
        await this.bot.sendMessage(chatId, 'Rule not found for your user.', { reply_markup: SUB_MENU })
        return
      }

      await this.bot.sendMessage(chatId, `🗑️ Alert rule deleted: <code>${ruleId}</code>`, {
        parse_mode: 'HTML',
        reply_markup: SUB_MENU,
      })
    })
  }

  private flagWalletHandler() {
    this.bot.onText(/\/flag_wallet(?:\s+([^\s]+))?(?:\s+(.+))?/, async (msg, match) => {
      const userId = String(msg.from?.id || '')
      if (!BotMiddleware.isUserBotAdmin(userId)) return

      const chatId = msg.chat.id
      const providedAddress = match?.[1]?.trim()
      const providedReason = match?.[2]?.trim()

      if (!providedAddress) {
        await this.bot.sendMessage(chatId, 'Usage: <code>/flag_wallet &lt;wallet_address&gt; [reason]</code>', {
          parse_mode: 'HTML',
          reply_markup: SUB_MENU,
        })
        return
      }

      const isValidAddress = this.isValidWalletAddress(providedAddress)
      if (!isValidAddress) {
        await this.bot.sendMessage(chatId, 'Invalid Solana wallet address.', { reply_markup: SUB_MENU })
        return
      }

      const reason = providedReason || 'Flagged manually by admin'
      const flagged = await this.scamWalletRepository.manualFlagWallet(providedAddress, reason)

      const trace = await this.fundFlowTracer.traceWalletFlow(providedAddress, 8, 20, {
        followAllRecipients: true,
        maxVisitedWallets: 500,
      })
      await this.scamWalletRepository.saveFlowTrace(providedAddress, trace, 'MANUAL_FLAG')

      await this.scamWalletMonitor.refreshSubscriptions()

      await this.bot.sendMessage(
        chatId,
        [
          '✅ Wallet flagged as suspicious.',
          `Wallet: <code>${flagged.address}</code>`,
          `Reason: ${flagged.reason}`,
          `Base risk score: <b>${flagged.baseRiskScore}</b>`,
          `Flow hops traced: <b>${trace.steps.length}</b>`,
        ].join('\n'),
        {
          parse_mode: 'HTML',
          reply_markup: SUB_MENU,
        },
      )

      if (trace.alerts.length > 0) {
        await this.bot.sendMessage(
          chatId,
          ['🧭 <b>Trace Alerts</b>', '', ...trace.alerts.slice(0, 6).map((alert) => `• ${alert}`)].join('\n'),
          {
            parse_mode: 'HTML',
            reply_markup: SUB_MENU,
          },
        )
      }
    })
  }

  private unflagWalletHandler() {
    this.bot.onText(/\/unflag_wallet(?:\s+([^\s]+))?(?:\s+(.+))?/, async (msg, match) => {
      const userId = String(msg.from?.id || '')
      if (!BotMiddleware.isUserBotAdmin(userId)) return

      const chatId = msg.chat.id
      const providedAddress = match?.[1]?.trim()
      const providedReason = match?.[2]?.trim()

      if (!providedAddress) {
        await this.bot.sendMessage(chatId, 'Usage: <code>/unflag_wallet &lt;wallet_address&gt; [reason]</code>', {
          parse_mode: 'HTML',
          reply_markup: SUB_MENU,
        })
        return
      }

      const reason = providedReason || 'Unflagged manually by admin'
      const unflagged = await this.scamWalletRepository.manualUnflagWallet(providedAddress, reason)

      if (!unflagged) {
        await this.bot.sendMessage(chatId, 'Wallet was not found in scam intelligence records.', {
          reply_markup: SUB_MENU,
        })
        return
      }

      await this.scamWalletMonitor.refreshSubscriptions()

      await this.bot.sendMessage(
        chatId,
        ['✅ Wallet unflagged.', `Wallet: <code>${unflagged.address}</code>`, `Reason: ${unflagged.reason}`].join('\n'),
        {
          parse_mode: 'HTML',
          reply_markup: SUB_MENU,
        },
      )
    })
  }

  private scamFeedHandler() {
    this.bot.onText(/\/scam_feed(?:\s+(\d+))?/, async (msg, match) => {
      const userId = String(msg.from?.id || '')
      if (!BotMiddleware.isUserBotAdmin(userId)) return

      const chatId = msg.chat.id
      const requestedLimit = Number(match?.[1] || 8)
      const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(25, requestedLimit)) : 8

      const alerts = await this.scamWalletRepository.getRecentAlerts(limit)

      if (alerts.length === 0) {
        await this.bot.sendMessage(chatId, 'No intelligence alerts yet.', { reply_markup: SUB_MENU })
        return
      }

      const messageLines = ['🚨 <b>Intelligence Feed</b>', '']

      for (const alert of alerts) {
        messageLines.push(`• Wallet: <code>${alert.scamWallet.address}</code>`)
        messageLines.push(`  Token: <code>${alert.tokenMint || 'unknown'}</code>`)
        messageLines.push(`  Risk: <b>${alert.riskScoreSnapshot}/100</b>`)
        messageLines.push(`  Tx: <code>${alert.txSignature || 'n/a'}</code>`)
        messageLines.push(`  Type: ${alert.eventType}`)
        messageLines.push(`  Time: ${alert.createdAt.toISOString()}`)
        messageLines.push('')
      }

      await this.bot.sendMessage(chatId, messageLines.join('\n'), {
        parse_mode: 'HTML',
        reply_markup: SUB_MENU,
      })

      await this.bot.sendMessage(chatId, 'Intelligence feed actions:', {
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Track Dev', callback_data: 'track_dev' },
              { text: 'View Flow', callback_data: 'view_flow' },
              { text: 'View Cluster', callback_data: 'view_cluster' },
            ],
          ],
        },
      })
    })
  }

  private flowMapHandler() {
    this.bot.onText(/\/flow_map(?:\s+([^\s]+))?/, async (msg, match) => {
      const userId = String(msg.from?.id || '')
      if (!BotMiddleware.isUserBotAdmin(userId)) return

      const chatId = msg.chat.id
      const providedAddress = match?.[1]?.trim()

      if (!providedAddress) {
        await this.bot.sendMessage(chatId, 'Usage: <code>/flow_map &lt;wallet_address&gt;</code>', {
          parse_mode: 'HTML',
          reply_markup: SUB_MENU,
        })
        return
      }

      const latestFlow = await this.scamWalletRepository.getLatestFlowTrace(providedAddress)

      if (!latestFlow?.metadata || typeof latestFlow.metadata !== 'object') {
        await this.bot.sendMessage(chatId, 'No flow map found for this wallet yet. Try /flag_wallet first.', {
          reply_markup: SUB_MENU,
        })
        return
      }

      const metadata = latestFlow.metadata as {
        steps?: Array<{
          hop: number
          from: string
          to: string
          amount: string
          asset: string
          signature: string
          matchedPlatforms: string[]
          linkedToLaunchPattern: boolean
        }>
      }

      const steps = metadata.steps || []
      if (steps.length === 0) {
        await this.bot.sendMessage(chatId, 'Flow map exists but has no extracted movement steps.', {
          reply_markup: SUB_MENU,
        })
        return
      }

      const messageLines = ['🗺️ <b>Fund Flow Map</b>', `Wallet: <code>${providedAddress}</code>`, '']

      for (const step of steps.slice(0, 20)) {
        const launchTag = step.linkedToLaunchPattern ? 'launch-pattern' : 'no-launch-pattern'
        const platformTag = step.matchedPlatforms.length > 0 ? step.matchedPlatforms.join(', ') : 'unknown platform'
        messageLines.push(
          `Hop ${step.hop}: <code>${step.from}</code> → <code>${step.to}</code> | ${step.amount} ${step.asset} | ${platformTag} | ${launchTag}`,
        )
      }

      await this.bot.sendMessage(chatId, messageLines.join('\n'), {
        parse_mode: 'HTML',
        reply_markup: SUB_MENU,
      })
    })
  }

  private traceTokenHandler() {
    this.bot.onText(/\/trace_token(?:\s+([^\s]+))?/, async (msg, match) => {
      const userId = String(msg.from?.id || '')
      if (!BotMiddleware.isUserBotAdmin(userId)) return

      const chatId = msg.chat.id
      const tokenMint = match?.[1]?.trim()

      try {
        if (!tokenMint) {
          await this.bot.sendMessage(chatId, 'Usage: <code>/trace_token &lt;token_contract_address&gt;</code>', {
            parse_mode: 'HTML',
            reply_markup: SUB_MENU,
          })
          return
        }

        if (!this.isValidPublicKey(tokenMint)) {
          await this.bot.sendMessage(chatId, 'Invalid token contract address.', { reply_markup: SUB_MENU })
          return
        }

        await this.bot.sendMessage(chatId, `🔎 Investigating token <code>${tokenMint}</code> ...`, {
          parse_mode: 'HTML',
          reply_markup: SUB_MENU,
        })

        const slowNoticeTimer = setTimeout(() => {
          this.bot
            .sendMessage(chatId, 'Still investigating this token. RPC/indexer calls are taking longer than usual.', {
              reply_markup: SUB_MENU,
            })
            .catch(() => {})
        }, 20_000)
        slowNoticeTimer.unref?.()

        const investigation = await this.withTimeout(
          this.tokenInvestigator.investigateToken(tokenMint),
          90_000,
          'Token investigation timed out',
        ).finally(() => clearTimeout(slowNoticeTimer))

        if (!investigation) {
          await this.bot.sendMessage(chatId, 'Unable to resolve the developer wallet for that token.', {
            reply_markup: SUB_MENU,
          })
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
          investigation.initialFundingSource,
        )
        await this.scamWalletRepository.saveFlowTrace(
          investigation.developerWallet,
          investigation.trace,
          'TOKEN_INVESTIGATION',
        )

        const signal = tradeSignalEmitter.createSignal({
          signalType: 'TOKEN_INVESTIGATION',
          riskScore: 82,
          developerWallet: investigation.developerWallet,
          trackedWallet: investigation.developerWallet,
          tokenMint,
          traceAlerts: investigation.alerts,
          metadata: {
            resolutionSource: investigation.resolutionSource,
            relatedTokensCount: investigation.relatedTokens.length,
            flowHopCount: investigation.trace.steps.length,
          },
        })
        await tradeSignalEmitter.emit(signal)

        await this.scamWalletMonitor.refreshSubscriptions()

        // ── local helpers ─────────────────────────────────────────────────────
        const short = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`
        const explorerWallet = (addr: string) => `https://solscan.io/account/${addr}`
        const explorerToken = (mint: string) => `https://solscan.io/token/${mint}`
        const explorerTx = (sig: string) => `https://solscan.io/tx/${sig}`
        const usd = (n: number) =>
          n >= 1_000_000
            ? `$${(n / 1_000_000).toFixed(2)}M`
            : n >= 1_000
              ? `$${(n / 1_000).toFixed(1)}K`
              : `$${n.toFixed(2)}`

        const e = investigation.enrichment
        const funding = investigation.initialFundingSource
        const riskScore = 82 + Math.min(15, investigation.relatedTokens.length * 3)

        // ── Message 1: Token Identity ─────────────────────────────────────────
        const idLines = [
          '🕵️ <b>Rug Pull Investigation Report</b>',
          '',
          e.name ? `🪙 <b>${e.name} (${e.symbol})</b>` : `🪙 <b>Token</b>`,
          `<code>${tokenMint}</code>`,
          `<a href="${explorerToken(tokenMint)}">Solscan</a> | <a href="https://dexscreener.com/solana/${tokenMint}">DexScreener</a> | <a href="https://gmgn.ai/sol/token/${tokenMint}">GMGN</a>`,
          '',
          e.description ? `📝 ${e.description.slice(0, 120)}${e.description.length > 120 ? '…' : ''}` : '',
          [
            e.twitter ? `<a href="${e.twitter}">Twitter</a>` : '',
            e.telegram ? `<a href="${e.telegram}">Telegram</a>` : '',
            e.website ? `<a href="${e.website}">Website</a>` : '',
          ]
            .filter(Boolean)
            .join(' | '),
          '',
          `⏱ Launched: <b>${e.createdTimestamp ? new Date(e.createdTimestamp * 1000).toUTCString() : 'unknown'}</b>`,
          `🏷 Platform: <b>${e.launchpad || 'unknown'}</b>`,
          `🎓 Graduated to Raydium: <b>${e.graduated ? '✅ Yes' : '❌ No (rug on bonding curve)'}</b>`,
        ].filter((l) => l !== '')

        await this.bot.sendMessage(chatId, idLines.join('\n'), {
          parse_mode: 'HTML',
          reply_markup: SUB_MENU,
          disable_web_page_preview: true,
        })

        // ── Message 2: Risk & Market Data ────────────────────────────────────
        const marketLines = [
          '📊 <b>Risk & Market Data</b>',
          '',
          `🎯 Risk Score: <b>${riskScore}/100</b> ${riskScore >= 80 ? '🔴 HIGH RISK' : '🟡 MEDIUM'}`,
          e.isHoneypot ? '🍯 <b>HONEYPOT DETECTED</b>' : '',
          e.renounced !== null && e.renounced !== undefined
            ? `🔑 Mint renounced: <b>${e.renounced ? '✅ Yes' : '❌ No'}</b>`
            : '',
          e.burnStatus ? `🔥 Token burn status: <b>${e.burnStatus}</b>` : '',
          '',
          e.currentMarketCapUsd ? `💰 Current market cap: <b>${usd(e.currentMarketCapUsd)}</b>` : '',
          e.liquidityUsd ? `💧 Current liquidity: <b>${usd(e.liquidityUsd)}</b>` : '',
          e.top10HolderRate !== undefined
            ? `🐳 Top 10 holders own: <b>${(e.top10HolderRate * 100).toFixed(1)}%</b>`
            : '',
          '',
          e.rugRatio !== undefined ? `☠️ Rug ratio: <b>${(e.rugRatio * 100).toFixed(1)}%</b> of holders rugged` : '',
          e.holderRuggedNum
            ? `👥 Holders rugged by this dev: <b>${e.holderRuggedNum}</b> of ${e.holderTokenNum || '?'}`
            : '',
          '',
          `👤 <b>Developer Wallet</b>`,
          `<code>${investigation.developerWallet}</code>`,
          `<a href="${explorerWallet(investigation.developerWallet)}">Solscan</a>`,
          '',
          '🏦 <b>Initial Funding Source</b>',
          funding ? `<code>${funding.funderWallet}</code>` : 'Not resolved from earliest inbound transactions',
          funding ? `<a href="${explorerWallet(funding.funderWallet)}">Solscan</a>` : '',
          funding?.label ? `  Label: <b>${funding.label}</b>` : '',
          funding ? `  Amount: <b>${funding.amount} ${funding.asset}</b>` : '',
          funding?.tokenMint ? `  Token mint: <code>${funding.tokenMint}</code>` : '',
          funding ? `  Tx: <a href="${explorerTx(funding.signature)}">${short(funding.signature)}</a>` : '',
          funding?.fundedAt ? `  Time: <b>${new Date(funding.fundedAt).toUTCString()}</b>` : '',
          '',
          e.creatorBalance !== undefined ? `  Current balance: <b>${e.creatorBalance.toFixed(4)} SOL</b>` : '',
          e.creatorPercentage ? `  Creator token %: <b>${e.creatorPercentage}</b>` : '',
          e.creatorTokenStatus ? `  Creator token status: <b>${e.creatorTokenStatus}</b>` : '',
          `  Resolution method: <b>${investigation.resolutionSource}</b>`,
          `  Token deployments found: <b>${investigation.relatedTokens.length}</b>`,
          `📡 Dev wallet now under active monitoring.`,
        ].filter((l) => l !== '')

        await this.bot.sendMessage(chatId, marketLines.join('\n'), {
          parse_mode: 'HTML',
          reply_markup: SUB_MENU,
          disable_web_page_preview: true,
        })

        // ── Message 3: Prior Rugs by Same Dev ────────────────────────────────
        if (e.ruggedTokens && e.ruggedTokens.length > 0) {
          const rugLines = ['☠️ <b>Prior Rugs by This Developer</b>', '']
          for (const rug of e.ruggedTokens.slice(0, 8)) {
            rugLines.push(`• <b>${rug.symbol}</b> — <code>${rug.address}</code>`)
            rugLines.push(
              `  <a href="${explorerToken(rug.address)}">Solscan</a> | <a href="https://gmgn.ai/sol/token/${rug.address}">GMGN</a>`,
            )
          }
          if (e.ruggedTokens.length > 8) rugLines.push(`… and ${e.ruggedTokens.length - 8} more rugs`)
          await this.bot.sendMessage(chatId, rugLines.join('\n'), {
            parse_mode: 'HTML',
            reply_markup: SUB_MENU,
            disable_web_page_preview: true,
          })
        } else if (investigation.relatedTokens.length > 1) {
          const tokenLines = ['🗂️ <b>Known Tokens Deployed by This Dev</b>', '']
          for (const mint of investigation.relatedTokens.slice(0, 8)) {
            const tag = mint === tokenMint ? ' ← <i>this token</i>' : ''
            tokenLines.push(`• <code>${mint}</code>${tag}`)
            tokenLines.push(`  <a href="${explorerToken(mint)}">Solscan</a>`)
          }
          await this.bot.sendMessage(chatId, tokenLines.join('\n'), {
            parse_mode: 'HTML',
            reply_markup: SUB_MENU,
            disable_web_page_preview: true,
          })
        }

        // ── Message 4: Pool/Bonding Curve Info ───────────────────────────────
        if (e.bondingCurve || e.raydiumPool) {
          const poolLines = ['🏊 <b>Liquidity Pool / Bonding Curve</b>', '']
          if (e.bondingCurve) {
            poolLines.push(`Pump.fun bonding curve: <code>${e.bondingCurve}</code>`)
            poolLines.push(`<a href="${explorerWallet(e.bondingCurve)}">View on Solscan</a>`)
          }
          if (e.raydiumPool) {
            poolLines.push(`Raydium pool: <code>${e.raydiumPool}</code>`)
            poolLines.push(`<a href="${explorerWallet(e.raydiumPool)}">View on Solscan</a>`)
          }
          if (investigation.poolTrace && investigation.poolTrace.steps.length > 0) {
            const poolSol = investigation.poolTrace.steps
              .filter((s) => s.asset === 'SOL')
              .reduce((acc, s) => acc + parseFloat(s.amount || '0'), 0)
            poolLines.push('')
            poolLines.push(`Pool outflows traced: <b>${investigation.poolTrace.steps.length} hops</b>`)
            poolLines.push(`Pool SOL moved: <b>${poolSol.toFixed(4)} SOL</b>`)
            for (const step of investigation.poolTrace.steps.slice(0, 6)) {
              const platform = step.matchedPlatforms[0] || 'Unknown'
              poolLines.push(`• <code>${short(step.to)}</code> — ${step.amount} ${step.asset} via ${platform}`)
              poolLines.push(`  <a href="${explorerTx(step.signature)}">Tx</a>`)
            }
          }
          await this.bot.sendMessage(chatId, poolLines.join('\n'), {
            parse_mode: 'HTML',
            reply_markup: SUB_MENU,
            disable_web_page_preview: true,
          })
        }

        // ── Message 5: Dev Wallet Fund Flow ──────────────────────────────────
        const allSteps = investigation.trace.steps
        const totalSol = allSteps
          .filter((s) => s.asset === 'SOL')
          .reduce((acc, s) => acc + parseFloat(s.amount || '0'), 0)
        const destSummary = new Map<string, { platform: string; totalSol: number; count: number }>()
        for (const step of allSteps) {
          const platform = step.matchedPlatforms[0] || 'Unknown'
          const prev = destSummary.get(step.to) || { platform, totalSol: 0, count: 0 }
          destSummary.set(step.to, {
            platform,
            totalSol: prev.totalSol + parseFloat(step.amount || '0'),
            count: prev.count + 1,
          })
        }
        const sorted = Array.from(destSummary.entries()).sort((a, b) => b[1].totalSol - a[1].totalSol)

        const flowLines = [
          '💸 <b>Developer Fund Flow</b>',
          `Total SOL extracted from dev wallet: <b>${totalSol.toFixed(4)} SOL</b>`,
          `Hops traced: <b>${allSteps.length}</b> across <b>${destSummary.size}</b> destinations`,
          '',
          '<b>Top destinations:</b>',
        ]
        for (const [addr, info] of sorted.slice(0, 10)) {
          flowLines.push(
            `• <code>${short(addr)}</code> — <b>${info.totalSol.toFixed(4)} SOL</b> (${info.count}x) → ${info.platform}`,
          )
          flowLines.push(`  <a href="${explorerWallet(addr)}">Solscan</a>`)
        }
        await this.bot.sendMessage(chatId, flowLines.join('\n'), {
          parse_mode: 'HTML',
          reply_markup: SUB_MENU,
          disable_web_page_preview: true,
        })

        // ── Message 5b: Main Wallet (top non-platform destination) ────────────
        const mainWalletEntry = sorted.find(([, info]) => info.platform === 'Unknown')
        if (mainWalletEntry) {
          const [mainAddr, mainInfo] = mainWalletEntry
          const mainLines = [
            '🏦 <b>Main Wallet — Largest Fund Destination</b>',
            '',
            `<code>${mainAddr}</code>`,
            '',
            `💰 Received: <b>${mainInfo.totalSol.toFixed(4)} SOL</b> across <b>${mainInfo.count}</b> hop(s)`,
            `🔗 <a href="${explorerWallet(mainAddr)}">View on Solscan</a>`,
            '',
            'Tap a button below to track this wallet or start copy trading it.',
          ]
          await this.bot.sendMessage(chatId, mainLines.join('\n'), {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '➕ Track wallet', callback_data: `tw:${mainAddr}` },
                  { text: '🔁 Copy trade', callback_data: `ct:${mainAddr}` },
                ],
              ],
            },
          })
        }

        // ── Message 6: Individual Hops ────────────────────────────────────────
        const hopLines = ['📋 <b>Dev Wallet Hops (newest first)</b>', '']
        for (const step of allSteps.slice(0, 15)) {
          const platform = step.matchedPlatforms[0] || 'Unknown'
          const launchTag = step.linkedToLaunchPattern ? ' 🚨' : ''
          hopLines.push(
            `Hop ${step.hop}: <code>${short(step.from)}</code> → <code>${short(step.to)}</code>${launchTag}`,
          )
          hopLines.push(`  ${step.amount} ${step.asset} | ${platform}`)
          hopLines.push(`  <a href="${explorerTx(step.signature)}">Tx on Solscan</a>`)
        }
        if (allSteps.length > 15) hopLines.push(`\n… ${allSteps.length - 15} more hops not shown`)
        await this.bot.sendMessage(chatId, hopLines.join('\n'), {
          parse_mode: 'HTML',
          reply_markup: SUB_MENU,
          disable_web_page_preview: true,
        })

        // ── Message 7: Alerts ─────────────────────────────────────────────────
        if (investigation.alerts.length > 0) {
          await this.bot.sendMessage(
            chatId,
            ['🚨 <b>Investigation Alerts</b>', '', ...investigation.alerts.slice(0, 10).map((a) => `• ${a}`)].join(
              '\n',
            ),
            { parse_mode: 'HTML', reply_markup: SUB_MENU },
          )
        }
      } catch (error) {
        console.error('TRACE_TOKEN_COMMAND_ERROR', error)
        const isTimeout = error instanceof Error && error.message === 'Token investigation timed out'
        await this.bot.sendMessage(
          chatId,
          isTimeout
            ? 'Token investigation timed out after 90 seconds. Please retry shortly.'
            : 'Token investigation failed. Please try again in a moment.',
          {
            reply_markup: SUB_MENU,
          },
        )
      }
    })
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined

    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), timeoutMs)
          timer.unref?.()
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private isValidWalletAddress(walletAddress: string): boolean {
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

    try {
      return base58Regex.test(walletAddress) && PublicKey.isOnCurve(new PublicKey(walletAddress).toBytes())
    } catch {
      return false
    }
  }

  private isValidPublicKey(address: string): boolean {
    try {
      new PublicKey(address)
      return true
    } catch {
      return false
    }
  }

  private async getGraphData(wallet: string) {
    const latestFlow = await this.scamWalletRepository.getLatestFlowTrace(wallet)
    const cluster = await this.walletClusterService.getLatestCluster(wallet)

    const flowMetadata = latestFlow?.metadata as
      | {
          steps?: Array<{ from: string; to: string; signature: string; amount: string; asset: string; hop: number }>
        }
      | undefined

    const steps = flowMetadata?.steps || []
    const nodeSet = new Set<string>([wallet])
    const edges = steps.map((step) => {
      nodeSet.add(step.from)
      nodeSet.add(step.to)
      return {
        from: step.from,
        to: step.to,
        label: `${step.amount} ${step.asset}`,
        signature: step.signature,
        hop: step.hop,
      }
    })

    const clusterWallets = Array.isArray(cluster?.wallets) ? cluster.wallets : []
    for (const clusterWallet of clusterWallets) {
      nodeSet.add(clusterWallet)
    }

    const nodes = Array.from(nodeSet).map((address) => ({
      id: address,
      label: address,
      inCluster: clusterWallets.includes(address),
    }))

    return {
      wallet,
      nodes,
      edges,
      cluster: cluster
        ? {
            score: cluster.clusterScore,
            riskScore: cluster.riskScore,
            wallets: cluster.wallets,
          }
        : null,
    }
  }

  private graphInlineMenu(wallet: string) {
    const appUrl = (process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || 3001}`).replace(/\/$/, '')

    return {
      inline_keyboard: [
        [
          { text: 'Analyze', callback_data: `ga:${wallet}` },
          { text: 'Neighbors', callback_data: `gn:${wallet}` },
        ],
        [
          { text: 'Trace', callback_data: `gt:${wallet}` },
          { text: 'Summary', callback_data: `gw:${wallet}` },
        ],
        [{ text: 'Open Web Graph', url: `${appUrl}/graph/${wallet}` }],
      ],
    }
  }
}
