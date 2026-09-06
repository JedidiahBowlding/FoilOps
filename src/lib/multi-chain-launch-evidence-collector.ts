import { EvmLaunchEvidenceCollector } from './evm-launch-evidence-collector'
import { LaunchEvidenceCollector } from './launch-evidence-collector'
import { DetectedLaunch } from './new-launch-types'

export class MultiChainLaunchEvidenceCollector {
  constructor(
    private readonly solana = new LaunchEvidenceCollector(),
    private readonly evm = new EvmLaunchEvidenceCollector(),
  ) {}

  collect(launch: DetectedLaunch) {
    return launch.chain === 'robinhood' ? this.evm.collect(launch) : this.solana.collect(launch)
  }
}
