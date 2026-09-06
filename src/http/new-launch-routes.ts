import type { Express, RequestHandler } from 'express'
import { NewLaunchIngestor } from '../lib/new-launch-ingestor'
import { PrismaLaunchCandidateRepository } from '../repositories/prisma/launch-candidate'

export function registerNewLaunchRoutes(
  app: Express,
  requireApiAuth: RequestHandler,
  ingestor: NewLaunchIngestor,
  repository: PrismaLaunchCandidateRepository,
): void {
  app.get('/api/discovery/status', requireApiAuth, (_req, res) => res.json(ingestor.getStatus()))

  app.post('/api/discovery/poll', requireApiAuth, async (_req, res) => {
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
}
