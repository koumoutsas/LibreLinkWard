import { pointTime } from '../../shared/stores'
import { glucoseLevel } from '../../shared/alarms'
import type { GlucoseLevel, Thresholds } from '../../shared/alarms'
import type { GraphPoint } from '../../shared/linkup'

export type GlucoseUnit = 'mg/dL' | 'mmol/L'
export { glucoseLevel }
export type { GlucoseLevel, Thresholds }

const MGDL_PER_MMOL = 18.0182

export const toUnit = (mgdl: number, unit: string): number =>
  unit === 'mmol/L' ? parseFloat((mgdl / MGDL_PER_MMOL).toFixed(1)) : Math.round(mgdl)

export const fromUnit = (value: number, unit: string): number =>
  unit === 'mmol/L' ? Math.round(value * MGDL_PER_MMOL) : Math.round(value)

export const formatGlucose = (mgdl: number | undefined, unit: string): string =>
  mgdl === undefined || Number.isNaN(mgdl) ? '--' : String(toUnit(mgdl, unit))

export const LEVEL_CLASS: Record<GlucoseLevel, string> = {
  'urgent-low': 'bg-red-600',
  low: 'bg-orange-500',
  'in-range': 'bg-green-600',
  high: 'bg-yellow-500',
  'urgent-high': 'bg-red-600',
}

export type ChartPoint = {
  t: number
  mgdl: number
  value: number
  /** True for forecast steps, false/absent for readings. */
  projected?: boolean
  forecast?: number
  forecastHigh?: number
  forecastLow?: number
}

/** Points within the last `windowMs` of the newest reading, converted to `unit`. */
export function toChartData(history: GraphPoint[], unit: string, windowMs: number): ChartPoint[] {
  if (history.length === 0) return []
  const newest = pointTime(history[history.length - 1])
  return history
    .filter((p) => pointTime(p) >= newest - windowMs)
    .map((p) => ({ t: pointTime(p), mgdl: p.ValueInMgPerDl, value: toUnit(p.ValueInMgPerDl, unit) }))
}

/** "3 min ago" style age; undefined when never updated. */
export function minutesSince(epochMs: number | undefined, now = Date.now()): number | undefined {
  return epochMs === undefined ? undefined : Math.max(0, Math.floor((now - epochMs) / 60000))
}
