// Implements the AR2 algorithm as used in Nightscout (cgm-remote-monitor, AGPL-3.0).
// Written from the published equations, not copied from its source.
// An early, crude statistical extrapolation: not for medical decisions.

export type ForecastReading = { t: number; mgdl: number }
export type ForecastPoint = { t: number; mgdl: number; high: number; low: number }

const STEP_MS = 5 * 60 * 1000
const BASE = 140
const MIN_MGDL = 36
const MAX_MGDL = 400
const COEF_PREV = -0.723
const COEF_CURR = 1.716
const CONE_MULTIPLIERS = [0.02, 0.041, 0.061, 0.081, 0.099, 0.116, 0.132, 0.145, 0.159, 0.171, 0.182, 0.192, 0.201]
export const DEFAULT_CONE_FACTOR = 2

const clamp = (v: number) => Math.min(MAX_MGDL, Math.max(MIN_MGDL, Math.round(v)))

/** The reading closest to five minutes before the newest one, within half a step. */
function previousReading(readings: ForecastReading[], newest: ForecastReading): ForecastReading | undefined {
  const target = newest.t - STEP_MS
  let best: ForecastReading | undefined
  for (const r of readings) {
    if (r.t >= newest.t) continue
    if (Math.abs(r.t - target) > STEP_MS / 2) continue
    if (!best || Math.abs(r.t - target) < Math.abs(best.t - target)) best = r
  }
  return best
}

/**
 * Next ~65 minutes in 5-minute steps from time-ordered readings. A `coneFactor`
 * of 0 collapses the cone onto the line. Empty when there is not enough data.
 */
export function ar2Forecast(readings: ForecastReading[], coneFactor = DEFAULT_CONE_FACTOR): ForecastPoint[] {
  if (readings.length === 0) return []
  const newest = readings[readings.length - 1]
  const prior = previousReading(readings, newest)
  if (!prior || !(newest.mgdl >= MIN_MGDL) || !(prior.mgdl > 0)) return []

  let prev = Math.log(prior.mgdl / BASE)
  let curr = Math.log(newest.mgdl / BASE)
  return CONE_MULTIPLIERS.map((mult, i) => {
    const next = COEF_PREV * prev + COEF_CURR * curr
    prev = curr
    curr = next
    return {
      t: newest.t + (i + 1) * STEP_MS,
      mgdl: clamp(BASE * Math.exp(curr)),
      high: clamp(BASE * Math.exp(curr + coneFactor * mult)),
      low: clamp(BASE * Math.exp(curr - coneFactor * mult)),
    }
  })
}
