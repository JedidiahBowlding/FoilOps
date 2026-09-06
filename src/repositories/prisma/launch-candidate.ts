import { Prisma } from '@prisma/client'
import prisma from '../../providers/prisma'
import { ScoredLaunchCandidate } from '../../lib/new-launch-types'

export class PrismaLaunchCandidateRepository {
  async getCursor(source: string): Promise<string | null> {
    const checkpoint = await prisma.launchIngestionCheckpoint.findUnique({ where: { source } })
    return checkpoint?.cursor || null
  }

  async setCursor(source: string, cursor: string): Promise<void> {
    await prisma.launchIngestionCheckpoint.upsert({
      where: { source },
      create: { source, cursor },
      update: { cursor },
    })
  }

  async save(candidate: ScoredLaunchCandidate): Promise<void> {
    const data = {
      signature: candidate.signature,
      chain: candidate.chain,
      creatorWallet: candidate.creatorWallet,
      source: candidate.source,
      slot: BigInt(candidate.slot),
      detectedAt: candidate.detectedAt,
      status: candidate.status,
      opportunityScore: candidate.opportunityScore,
      riskScore: candidate.riskScore,
      classification: candidate.classification,
      evidence: { ...candidate.evidence, rationale: candidate.rationale } as unknown as Prisma.InputJsonValue,
      scoredAt: new Date(candidate.evidence.collectedAt),
    }
    await prisma.$transaction(async (tx) => {
      const saved = await tx.launchCandidate.upsert({
        where: { chain_tokenMint: { chain: candidate.chain, tokenMint: candidate.tokenMint } },
        create: { tokenMint: candidate.tokenMint, ...data },
        update: data,
      })
      await tx.launchCandidateObservation.create({
        data: {
          candidateId: saved.id,
          opportunityScore: candidate.opportunityScore,
          riskScore: candidate.riskScore,
          classification: candidate.classification,
          evidence: data.evidence,
          observedAt: new Date(candidate.evidence.collectedAt),
        },
      })
    })
  }

  async getDueForRescore(limit: number, olderThan: Date, maxAge: Date) {
    const rows = await prisma.launchCandidate.findMany({
      where: { scoredAt: { lt: olderThan }, detectedAt: { gte: maxAge }, classification: { not: 'OFFICIAL_STOCK_TOKEN' } },
      orderBy: { scoredAt: 'asc' },
      take: limit,
    })
    return rows.map((row) => ({
      chain: row.chain as 'solana' | 'robinhood',
      tokenMint: row.tokenMint,
      signature: row.signature,
      creatorWallet: row.creatorWallet,
      source: row.source,
      slot: Number(row.slot),
      detectedAt: row.detectedAt,
    }))
  }

  async getHistory(chain: string, tokenMint: string, limit: number) {
    const candidate = await prisma.launchCandidate.findUnique({ where: { chain_tokenMint: { chain, tokenMint } } })
    if (!candidate) return null
    const observations = await prisma.launchCandidateObservation.findMany({
      where: { candidateId: candidate.id },
      orderBy: { observedAt: 'desc' },
      take: limit,
    })
    return { candidate: { ...candidate, slot: Number(candidate.slot) }, observations }
  }

  async list(input: { limit: number; chain?: string; classification?: string; maxRisk?: number; minOpportunity?: number }) {
    const rows = await prisma.launchCandidate.findMany({
      where: {
        ...(input.chain ? { chain: input.chain } : {}),
        ...(input.classification ? { classification: input.classification } : {}),
        ...(input.maxRisk !== undefined ? { riskScore: { lte: input.maxRisk } } : {}),
        ...(input.minOpportunity !== undefined ? { opportunityScore: { gte: input.minOpportunity } } : {}),
      },
      orderBy: [{ opportunityScore: 'desc' }, { detectedAt: 'desc' }],
      take: input.limit,
    })
    return rows.map((row) => ({ ...row, slot: Number(row.slot) }))
  }
}
