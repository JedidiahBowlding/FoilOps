import { scoreLaunchCandidate } from './launch-candidate-scorer'
import { PumpFunLaunchSource } from './new-launch-source'
import { PrismaLaunchCandidateRepository } from '../repositories/prisma/launch-candidate'
import { RobinhoodChainLaunchSource } from './evm-contract-launch-source'
import { MultiChainLaunchEvidenceCollector } from './multi-chain-launch-evidence-collector'
import { DetectedLaunch } from './new-launch-types'

type LaunchSource = {
  name: string
  fetchSince(cursor: string | null, limit: number): Promise<{ launches: DetectedLaunch[]; cursor: string | null }>
}

export class NewLaunchIngestor {
  private timer?: NodeJS.Timeout
  private running = false
  private lastPollAt: string | null = null
  private lastError: string | null = null
  private processedTotal = 0
  private rescoredTotal = 0

  constructor(
    private readonly sources: LaunchSource[] = [new PumpFunLaunchSource(), new RobinhoodChainLaunchSource()],
    private readonly collector = new MultiChainLaunchEvidenceCollector(),
    private readonly repository = new PrismaLaunchCandidateRepository(),
  ) {}

  isEnabled(): boolean {
    return process.env.NEW_LAUNCH_INGESTION_ENABLED === 'true'
  }

  start(): void {
    if (!this.isEnabled() || this.timer) {
      console.log('NEW_LAUNCH_INGESTOR: disabled (set NEW_LAUNCH_INGESTION_ENABLED=true to enable)')
      return
    }

    const intervalMs = Math.max(15_000, Number(process.env.NEW_LAUNCH_POLL_INTERVAL_MS || 15_000))
    void this.pollOnce()
    this.timer = setInterval(() => void this.pollOnce(), intervalMs)
    this.timer.unref?.()
    console.log(`NEW_LAUNCH_INGESTOR: started interval=${intervalMs}ms`)
  }

  async pollOnce(): Promise<{ detected: number; processed: number }> {
    if (this.running) return { detected: 0, processed: 0 }
    this.running = true
    try {
      const limit = Math.max(1, Math.min(250, Number(process.env.NEW_LAUNCH_SIGNATURE_LIMIT || 100)))
      let detected = 0
      let processed = 0
      for (const source of this.sources) {
        const cursor = await this.repository.getCursor(source.name)
        const batch = await source.fetchSince(cursor, limit)
        detected += batch.launches.length
        for (const launch of batch.launches) {
          const evidence = await this.collector.collect(launch)
          if (evidence.collectionErrors.includes('contract-not-verified-as-erc20')) continue
          await this.repository.save(scoreLaunchCandidate(launch, evidence))
          processed += 1
        }
        if (batch.cursor) await this.repository.setCursor(source.name, batch.cursor)
      }
      const rescoreMinutes = Math.max(1, Number(process.env.NEW_LAUNCH_RESCORE_INTERVAL_MINUTES || 5))
      const maxAgeHours = Math.max(1, Number(process.env.NEW_LAUNCH_RESCORE_MAX_AGE_HOURS || 24))
      const rescoreLimit = Math.max(1, Math.min(50, Number(process.env.NEW_LAUNCH_RESCORE_LIMIT || 10)))
      const due = await this.repository.getDueForRescore(
        rescoreLimit,
        new Date(Date.now() - rescoreMinutes * 60_000),
        new Date(Date.now() - maxAgeHours * 60 * 60_000),
      )
      for (const launch of due) {
        const evidence = await this.collector.collect(launch)
        if (evidence.collectionErrors.includes('contract-not-verified-as-erc20')) continue
        await this.repository.save(scoreLaunchCandidate(launch, evidence))
        this.rescoredTotal += 1
      }
      this.processedTotal += processed
      this.lastPollAt = new Date().toISOString()
      this.lastError = null
      return { detected, processed }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      console.error('NEW_LAUNCH_INGESTOR_ERROR', this.lastError)
      return { detected: 0, processed: 0 }
    } finally {
      this.running = false
    }
  }

  getStatus() {
    return {
      enabled: this.isEnabled(),
      running: this.running,
      sources: this.sources.map((source) => source.name),
      lastPollAt: this.lastPollAt,
      lastError: this.lastError,
      processedTotal: this.processedTotal,
      rescoredTotal: this.rescoredTotal,
    }
  }
}
