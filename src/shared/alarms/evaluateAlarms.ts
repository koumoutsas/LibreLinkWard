import type { GraphPoint } from '../linkup/types'
import { AlarmConfig, pointTime } from '../stores'
import { ar2Forecast } from '../forecast'

export type GlucoseLevel = 'urgent-low' | 'low' | 'in-range' | 'high' | 'urgent-high'
export type Thresholds = Pick<AlarmConfig, 'urgentLow' | 'low' | 'high' | 'urgentHigh'>
export type AlarmKind = Exclude<GlucoseLevel, 'in-range'> | 'signal-loss' | 'predicted-low' | 'predicted-high'

/** mg/dL a reading must move back inside a threshold before the alarm clears. */
export const HYSTERESIS_MGDL = 5
/** Minutes between repeat notifications while an alarm stays active and unacknowledged. */
export const REPEAT_MINUTES = 5
/** How far ahead the AR2 forecast is checked for predicted alarms. */
export const PREDICTION_MINUTES = 30

export function glucoseLevel(mgdl: number, t: Thresholds): GlucoseLevel {
  if (mgdl < t.urgentLow) return 'urgent-low'
  if (mgdl < t.low) return 'low'
  if (mgdl > t.urgentHigh) return 'urgent-high'
  if (mgdl > t.high) return 'high'
  return 'in-range'
}

const SEVERITY: Record<AlarmKind, number> = {
  low: 1,
  high: 1,
  'urgent-low': 2,
  'urgent-high': 2,
  'signal-loss': 1,
  // Below every real alarm, so the real low/high that follows escalates.
  'predicted-low': 0,
  'predicted-high': 0,
}

/** Per-patient engine state. Plain data so it can be kept in a map and tested. */
export type AlarmEngineState = {
  active?: AlarmKind
  /** Epoch ms the current alarm started. */
  since?: number
  /** Epoch ms of the last notification for the current alarm. */
  lastNotified?: number
  acknowledged?: boolean
}

export type AlarmEventType = 'raise' | 'escalate' | 'repeat' | 'clear'

export type AlarmEvent = {
  type: AlarmEventType
  kind: AlarmKind
  /** mg/dL of the triggering reading, absent for signal loss. */
  value?: number
}

export type EvaluateInput = {
  latest?: GraphPoint
  /** Recent readings, oldest first; only needed for predicted alarms. */
  history?: GraphPoint[]
  /** Epoch ms of the last successful poll; used when the reading time is unusable. */
  lastUpdated?: number
  config: AlarmConfig
  now: number
  snoozed?: boolean
}

export type EvaluateResult = {
  state: AlarmEngineState
  /** Events to notify about. Empty while snoozed or acknowledged. `clear` is always reported. */
  events: AlarmEvent[]
}

/** Thresholds shifted so an active alarm only clears once the value is clearly back in range. */
function withHysteresis(t: Thresholds, active: AlarmKind | undefined): Thresholds {
  const h = HYSTERESIS_MGDL
  switch (active) {
    case 'urgent-low':
      return { ...t, urgentLow: t.urgentLow + h, low: t.low + h }
    case 'low':
      return { ...t, low: t.low + h }
    case 'urgent-high':
      return { ...t, urgentHigh: t.urgentHigh - h, high: t.high - h }
    case 'high':
      return { ...t, high: t.high - h }
    default:
      return t
  }
}

/** Whether the AR2 line leaves the low/high thresholds within PREDICTION_MINUTES. */
function predictedKind(
  history: GraphPoint[],
  t: Thresholds,
  active: AlarmKind | undefined,
): 'predicted-low' | 'predicted-high' | undefined {
  const readings = history
    .map((p) => ({ t: pointTime(p), mgdl: p.ValueInMgPerDl }))
    .filter((r) => !Number.isNaN(r.t))
  const steps = ar2Forecast(readings).slice(0, PREDICTION_MINUTES / 5)
  if (steps.length === 0) return undefined
  // An active predicted alarm needs the line to move clearly back before it clears.
  const h = HYSTERESIS_MGDL
  const low = t.low + (active === 'predicted-low' ? h : 0)
  const high = t.high - (active === 'predicted-high' ? h : 0)
  const min = Math.min(...steps.map((s) => s.mgdl))
  const max = Math.max(...steps.map((s) => s.mgdl))
  const lowGap = min < low ? low - min : 0
  const highGap = max > high ? max - high : 0
  if (lowGap === 0 && highGap === 0) return undefined
  return lowGap >= highGap ? 'predicted-low' : 'predicted-high'
}

function currentKind(input: EvaluateInput, prev: AlarmEngineState): AlarmKind | undefined {
  const { latest, lastUpdated, config, now } = input
  const readingTime = latest ? pointTime(latest) : NaN
  const lastSeen = Number.isNaN(readingTime) ? lastUpdated : readingTime
  if (lastSeen !== undefined && now - lastSeen > config.signalLossMinutes * 60_000) {
    return 'signal-loss'
  }
  if (!latest) return undefined
  const prevLevel = prev.active === 'signal-loss' || prev.active?.startsWith('predicted') ? undefined : prev.active
  const level = glucoseLevel(latest.ValueInMgPerDl, withHysteresis(config, prevLevel))
  if (level !== 'in-range') return level
  return config.predictive ? predictedKind(input.history ?? [], config, prev.active) : undefined
}

/**
 * Pure alarm evaluation for one patient. Call on every new reading and on a
 * timer (signal loss and repeats need time to pass without new data).
 */
export function evaluateAlarms(input: EvaluateInput, prev: AlarmEngineState = {}): EvaluateResult {
  const { config, now, latest } = input
  const kind = config.enabled ? currentKind(input, prev) : undefined

  if (!kind) {
    const events: AlarmEvent[] = prev.active ? [{ type: 'clear', kind: prev.active }] : []
    return { state: {}, events }
  }

  const value = kind === 'signal-loss' ? undefined : latest?.ValueInMgPerDl
  const notify = (type: AlarmEventType): AlarmEvent[] => (input.snoozed ? [] : [{ type, kind, value }])

  if (prev.active !== kind) {
    // A different or more severe alarm always needs fresh attention.
    const escalated = prev.active !== undefined && SEVERITY[kind] > SEVERITY[prev.active]
    const events = notify(escalated ? 'escalate' : 'raise')
    return {
      state: {
        active: kind,
        since: now,
        lastNotified: events.length ? now : undefined,
        acknowledged: false,
      },
      events,
    }
  }

  const due = prev.lastNotified === undefined || now - prev.lastNotified >= REPEAT_MINUTES * 60_000
  if (!prev.acknowledged && due) {
    const events = notify('repeat')
    return {
      state: { ...prev, lastNotified: events.length ? now : prev.lastNotified },
      events,
    }
  }
  return { state: prev, events: [] }
}

export const acknowledge = (state: AlarmEngineState): AlarmEngineState =>
  state.active ? { ...state, acknowledged: true } : state
