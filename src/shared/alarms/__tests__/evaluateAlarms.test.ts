import { defaultAlarmConfig } from '../../stores'
import {
  AlarmEngineState,
  REPEAT_MINUTES,
  acknowledge,
  evaluateAlarms,
} from '../evaluateAlarms'

const NOW = Date.parse('2026-01-01T12:00:00Z')
const MIN = 60_000
const config = defaultAlarmConfig({ targetLow: 70, targetHigh: 180 })
const reading = (v: number, minsAgo = 0) => {
  const ts = new Date(NOW - minsAgo * MIN).toISOString()
  return { Timestamp: ts, FactoryTimestamp: ts, ValueInMgPerDl: v }
}
const run = (v: number, state?: AlarmEngineState, extra: object = {}, at = NOW) =>
  evaluateAlarms({ latest: reading(v), config, now: at, ...extra }, state)

describe('evaluateAlarms', () => {
  it('stays silent in range', () => {
    expect(run(100)).toEqual({ state: {}, events: [] })
  })

  it.each([
    [60, 'low'],
    [50, 'urgent-low'],
    [200, 'high'],
    [260, 'urgent-high'],
  ])('raises %i as %s', (value, kind) => {
    const { state, events } = run(value)
    expect(events).toEqual([{ type: 'raise', kind, value }])
    expect(state).toMatchObject({ active: kind, since: NOW, lastNotified: NOW, acknowledged: false })
  })

  it('escalates low to urgent-low but treats a same-severity change as a new raise', () => {
    const low = run(65).state
    expect(run(50, low).events[0]).toMatchObject({ type: 'escalate', kind: 'urgent-low' })
    const high = run(200).state
    expect(run(60, high).events[0]).toMatchObject({ type: 'raise', kind: 'low' })
  })

  it('does not repeat before the interval and repeats after it', () => {
    const first = run(60).state
    expect(run(60, first, {}, NOW + (REPEAT_MINUTES - 1) * MIN).events).toEqual([])
    const again = run(60, first, {}, NOW + REPEAT_MINUTES * MIN)
    expect(again.events[0]).toMatchObject({ type: 'repeat', kind: 'low' })
    expect(again.state.lastNotified).toBe(NOW + REPEAT_MINUTES * MIN)
  })

  it('stops repeating once acknowledged, but escalation notifies again', () => {
    const acked = acknowledge(run(60).state)
    expect(run(60, acked, {}, NOW + 10 * MIN).events).toEqual([])
    expect(run(50, acked).events[0]).toMatchObject({ type: 'escalate' })
  })

  it('applies hysteresis before clearing', () => {
    const low = run(65).state
    // 72 is above the low threshold (70) but within the 5 mg/dL margin
    expect(run(72, low).state.active).toBe('low')
    const cleared = run(76, low)
    expect(cleared.state).toEqual({})
    expect(cleared.events).toEqual([{ type: 'clear', kind: 'low' }])
    const high = run(190).state
    expect(run(177, high).state.active).toBe('high')
    expect(run(170, high).state).toEqual({})
  })

  it('does not notify while snoozed, then notifies when the snooze ends', () => {
    const snoozed = run(60, undefined, { snoozed: true })
    expect(snoozed.events).toEqual([])
    expect(snoozed.state.active).toBe('low')
    const after = run(60, snoozed.state, { snoozed: false }, NOW + MIN)
    expect(after.events[0]).toMatchObject({ type: 'repeat', kind: 'low' })
  })

  it('raises signal loss when the reading is older than the configured timeout', () => {
    const stale = evaluateAlarms({ latest: reading(100, 30), config, now: NOW })
    expect(stale.events).toEqual([{ type: 'raise', kind: 'signal-loss', value: undefined }])
    const fresh = evaluateAlarms({ latest: reading(100, 10), config, now: NOW })
    expect(fresh.events).toEqual([])
  })

  it('raises signal loss with no reading at all once the last update is stale', () => {
    const r = evaluateAlarms({ lastUpdated: NOW - 30 * MIN, config, now: NOW })
    expect(r.state.active).toBe('signal-loss')
  })

  it('is silent when disabled and clears an existing alarm', () => {
    const off = { ...config, enabled: false }
    const active = run(60).state
    expect(evaluateAlarms({ latest: reading(60), config: off, now: NOW }).events).toEqual([])
    const r = evaluateAlarms({ latest: reading(60), config: off, now: NOW }, active)
    expect(r.events).toEqual([{ type: 'clear', kind: 'low' }])
  })

  it('uses per-patient thresholds', () => {
    const strict = { ...config, low: 90 }
    expect(evaluateAlarms({ latest: reading(85), config: strict, now: NOW }).state.active).toBe('low')
  })
})
