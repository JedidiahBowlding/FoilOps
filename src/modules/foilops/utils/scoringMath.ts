// ─── Scoring Math Utilities ────────────────────────────────────────────────────
// Pure functions used by all scoring services. No side effects.

/**
 * Clamp value to [0, 100].
 */
export function clamp100(v: number): number {
  return Math.min(100, Math.max(0, Math.round(v)))
}

/**
 * Clamp value to [0, 1].
 */
export function clamp1(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/**
 * Weighted mean of an array of [value, weight] pairs.
 * Weights must be positive; they will be normalised automatically.
 */
export function weightedMean(pairs: [number, number][]): number {
  if (pairs.length === 0) return 0
  let sumWeighted = 0
  let sumWeights = 0
  for (const [value, weight] of pairs) {
    if (weight <= 0) continue
    sumWeighted += value * weight
    sumWeights += weight
  }
  return sumWeights === 0 ? 0 : sumWeighted / sumWeights
}

/**
 * Linear interpolation from `from` to `to` by fraction `t` (0–1).
 */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp1(t)
}

/**
 * Map a raw duration in seconds to a 0–100 score.
 * The closer to 0 seconds the better.  Values above `maxSeconds` score 0.
 */
export function earlyEntryScore(
  entryDelaySeconds: number,
  veryEarlySeconds: number,
  earlySeconds: number,
  lateSeconds: number,
): number {
  if (entryDelaySeconds <= veryEarlySeconds) return 100
  if (entryDelaySeconds <= earlySeconds) {
    return Math.round(lerp(100, 70, (entryDelaySeconds - veryEarlySeconds) / (earlySeconds - veryEarlySeconds)))
  }
  if (entryDelaySeconds <= lateSeconds) {
    return Math.round(lerp(70, 30, (entryDelaySeconds - earlySeconds) / (lateSeconds - earlySeconds)))
  }
  return 0
}

/**
 * Median of a numeric array.  Returns 0 for empty arrays.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Participation rate score.
 * Converts a [0, 1] participation fraction into a [0, 100] score.
 */
export function participationScore(rate: number, highThreshold: number, medThreshold: number): number {
  if (rate >= highThreshold) return 100
  if (rate >= medThreshold) return Math.round(lerp(60, 100, (rate - medThreshold) / (highThreshold - medThreshold)))
  return Math.round(lerp(0, 60, rate / medThreshold))
}

/**
 * Compute a risk score cap so that individual risk components never exceed
 * 100 even when multiple sources are all maxed.
 */
export function additiveCap(contributions: number[]): number {
  return clamp100(contributions.reduce((acc, v) => acc + v, 0))
}

/**
 * Decay a score over time.  After `halfLifeDays` the score drops by 50%.
 * Useful for penalising stale data.
 */
export function timeDecay(score: number, ageMs: number, halfLifeDays: number): number {
  if (halfLifeDays <= 0) return score
  const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000
  const decayFactor = Math.pow(0.5, ageMs / halfLifeMs)
  return Math.round(score * decayFactor)
}
