import type { GraphPoint } from '../linkup/types'
import { AlarmConfig, pointTime } from '../stores'

export type GlucoseLevel = 'urgent-low' | 'low' | 'in-range' | 'high' | 'urgent-high'
export type Thresholds = Pick<AlarmConfig, 'urgentLow' | 'low' | 'high' | 'urgentHigh'>
export type AlarmKind = Exclude<GlucoseLevel, 'in-range'> | 'signal-loss'

/** mg/dL a reading must move back inside a threshold before the alarm clears. */
export const HYSTERESIS_MGDL = 5
/** Minutes between repeat notifications while an alarm stays active and unacknowledged. */
export const REPEAT_MINUTES = 5

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

function currentKind(input: EvaluateInput, prev: AlarmEngineState): AlarmKind | undefined {
  const { latest, lastUpdated, config, now } = input
  const readingTime = latest ? pointTime(latest) : NaN
  const lastSeen = Number.isNaN(readingTime) ? lastUpdated : readingTime
  if (lastSeen !== undefined && now - lastSeen > config.signalLossMinutes * 60_000) {
    return 'signal-loss'
  }
  if (!latest) return undefined
  const prevLevel = prev.active === 'signal-loss' ? undefined : prev.active
  const level = glucoseLevel(latest.ValueInMgPerDl, withHysteresis(config, prevLevel))
  return level === 'in-range' ? undefined : level
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
