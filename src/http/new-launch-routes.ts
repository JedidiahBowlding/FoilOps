import type { Express, RequestHandler } from 'express'
import { NewLaunchIngestor } from '../lib/new-launch-ingestor'
import { PrismaLaunchCandidateRepository } from '../repositories/prisma/launch-candidate'
import { TokenDeepResearchService } from '../lib/token-deep-research'
import { BaseTokenDeepResearchService } from '../lib/base-token-deep-research'
import { BaseSwapService } from '../lib/base-swap-service'
import { BaseLaunchWatchService } from '../lib/base-launch-watch'
import { rateLimit } from '../lib/http-security'

export function registerNewLaunchRoutes(
  app: Express,
  requireApiAuth: RequestHandler,
  ingestor: NewLaunchIngestor,
  repository: PrismaLaunchCandidateRepository,
): void {
  const deepResearch = new TokenDeepResearchService()
  const baseDeepResearch = new BaseTokenDeepResearchService()
  const baseSwap = new BaseSwapService()
  const baseLaunchWatch = new BaseLaunchWatchService(baseSwap)
  const expensiveRequestLimit = rateLimit({ windowMs: 60_000, max: 20, label: 'discovery-expensive' })
  void baseLaunchWatch.start().catch((error) => console.error('Base launch watch failed to start', error))
  app.get('/api/discovery/status', requireApiAuth, (_req, res) => res.json(ingestor.getStatus()))

  app.post('/api/discovery/poll', requireApiAuth, expensiveRequestLimit, async (_req, res) => {
    res.json(await ingestor.pollOnce())
  })

  app.get('/api/discovery/candidates', requireApiAuth, async (req, res) => {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50))
    const maxRisk = req.query.maxRisk === undefined ? undefined : Number(req.query.maxRisk)
    const minOpportunity = req.query.minOpportunity === undefined ? undefined : Number(req.query.minOpportunity)
    const classification = typeof req.query.classification === 'string' ? req.query.classification.toUpperCase() : undefined
    const chain = typeof req.query.chain === 'string' ? req.query.chain.toLowerCase() : undefined
    const candidates = await repository.list({
      limit,
      chain,
      classification,
      maxRisk: Number.isFinite(maxRisk) ? maxRisk : undefined,
      minOpportunity: Number.isFinite(minOpportunity) ? minOpportunity : undefined,
    })
    res.json({ candidates, count: candidates.length })
  })

  app.get('/api/discovery/candidates/:chain/:tokenMint/history', requireApiAuth, async (req, res) => {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 25))
    const history = await repository.getHistory(req.params.chain.toLowerCase(), req.params.tokenMint, limit)
    if (!history) {
      res.status(404).json({ message: 'Discovery candidate not found' })
      return
    }
    res.json(history)
  })

  app.post('/api/discovery/research', requireApiAuth, expensiveRequestLimit, async (req, res) => {
    try {
      const mint = typeof req.body?.mint === 'string' ? req.body.mint.trim() : ''
      const chain = typeof req.body?.chain === 'string' ? req.body.chain.toLowerCase() : 'solana'
      if (!mint) return void res.status(400).json({ message: 'mint is required' })
      if (!['solana', 'base'].includes(chain)) return void res.status(400).json({ message: 'chain must be solana or base' })
      res.json(chain === 'base' ? await baseDeepResearch.research(mint) : await deepResearch.research(mint))
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : 'Token research failed' })
    }
  })

  app.get('/api/base-swap/status', requireApiAuth, (_req, res) => res.json(baseSwap.status()))
  app.post('/api/base-swap/quote', requireApiAuth, expensiveRequestLimit, async (req, res) => {
    try { res.json(await baseSwap.quote(req.body || {})) }
    catch (error) { res.status(400).json({ message: error instanceof Error ? error.message : 'Base quote failed' }) }
  })
  app.post('/api/base-swap/execute', requireApiAuth, async (req, res) => {
    try { res.json(await baseSwap.execute(String(req.body?.confirmationId || ''))) }
    catch (error) { res.status(400).json({ message: error instanceof Error ? error.message : 'Base swap failed' }) }
  })
  app.get('/api/base-swap/watches', requireApiAuth, (_req, res) => res.json({ watches: baseLaunchWatch.list() }))
  app.post('/api/base-swap/watches', requireApiAuth, async (req, res) => {
    try { res.status(201).json(await baseLaunchWatch.create(req.body || {})) }
    catch (error) { res.status(400).json({ message: error instanceof Error ? error.message : 'Could not create launch watch' }) }
  })
  app.post('/api/base-swap/watches/:id/cancel', requireApiAuth, async (req, res) => {
    try { res.json(await baseLaunchWatch.cancel(req.params.id)) }
    catch (error) { res.status(404).json({ message: error instanceof Error ? error.message : 'Launch watch not found' }) }
  })
}
