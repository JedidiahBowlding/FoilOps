import { FlowStep } from './fund-flow-tracer'

export type DetectedAnomaly = {
  type: 'SUDDEN_LARGE_TRANSFER' | 'RAPID_MULTI_HOP' | 'CIRCULAR_FLOW' | 'NEW_WALLET_FAN_OUT'
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
  message: string
  evidence: Record<string, unknown>
}

export class AnomalyDetector {
  detect(steps: FlowStep[]): DetectedAnomaly[] {
    const anomalies: DetectedAnomaly[] = []
    if (steps.length === 0) return anomalies

    const solTransfers = steps.filter((step) => step.asset === 'SOL').map((step) => Number(step.amount || '0'))
    const maxSolTransfer = solTransfers.length > 0 ? Math.max(...solTransfers) : 0

    if (maxSolTransfer >= 50) {
      anomalies.push({
        type: 'SUDDEN_LARGE_TRANSFER',
        severity: 'HIGH',
        message: `Detected sudden large SOL transfer (${maxSolTransfer.toFixed(2)} SOL)`,
        evidence: { maxSolTransfer },
      })
    }

    const rapidHopCount = steps.filter((step) => step.hop >= 2).length
    if (rapidHopCount >= 4) {
      anomalies.push({
        type: 'RAPID_MULTI_HOP',
        severity: 'MEDIUM',
        message: `Rapid multi-hop movement detected across ${rapidHopCount} hops`,
        evidence: { rapidHopCount },
      })
    }

    const circular = this.detectCircularFlow(steps)
    if (circular > 0) {
      anomalies.push({
        type: 'CIRCULAR_FLOW',
        severity: circular > 1 ? 'HIGH' : 'MEDIUM',
        message: `Circular flow pattern detected (${circular} loops)`,
        evidence: { loops: circular },
      })
    }

    const fanOut = this.detectFanOut(steps)
    if (fanOut >= 5) {
      anomalies.push({
        type: 'NEW_WALLET_FAN_OUT',
        severity: fanOut >= 8 ? 'HIGH' : 'MEDIUM',
        message: `New-wallet fan-out pattern detected (${fanOut} unique destinations)`,
        evidence: { uniqueDestinations: fanOut },
      })
    }

    return anomalies
  }

  private detectCircularFlow(steps: FlowStep[]): number {
    const edgeSet = new Set(steps.map((step) => `${step.from}->${step.to}`))
    let loops = 0

    for (const step of steps) {
      if (edgeSet.has(`${step.to}->${step.from}`)) {
        loops += 1
      }
    }

    return Math.floor(loops / 2)
  }

  private detectFanOut(steps: FlowStep[]): number {
    return new Set(steps.map((step) => step.to)).size
  }
}
