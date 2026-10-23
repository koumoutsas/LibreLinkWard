/** @jest-environment node */
import {
  createAlarmStore,
  createPatientStore,
  defaultAlarmConfig,
  isSnoozed,
  mergeHistory,
  resolveAlarmConfig,
} from '..'

const pt = (ts: string, v = 100) => ({ Timestamp: ts, FactoryTimestamp: ts, ValueInMgPerDl: v })
const graph = (points: ReturnType<typeof pt>[], extra = {}) => ({
  connection: { patientId: 'p1', firstName: 'Ann', lastName: 'Lee', targetLow: 80, targetHigh: 160, ...extra },
  graphData: points,
  glucoseMeasurement: points[points.length - 1],
})

describe('patientStore', () => {
  it('stores latest reading, name, targets and lastUpdated', () => {
    const s = createPatientStore()
    s.getState().applyGraph('p1', graph([pt('2026-10-23T08:00:00Z', 90), pt('2026-10-23T08:15:00Z', 95)]), 42)
    const p = s.getState().patients.p1
    expect(p).toMatchObject({ name: 'Ann Lee', targetLow: 80, targetHigh: 160, lastUpdated: 42, status: 'ok' })
    expect(p.latest?.ValueInMgPerDl).toBe(95)
    expect(p.history).toHaveLength(2)
  })

  it('dedupes overlapping history and keeps it sorted', () => {
    const s = createPatientStore()
    s.getState().applyGraph('p1', graph([pt('2026-10-23T08:00:00Z'), pt('2026-10-23T08:15:00Z')]))
    s.getState().applyGraph('p1', graph([pt('2026-10-23T08:15:00Z'), pt('2026-10-23T08:30:00Z')]))
    expect(s.getState().patients.p1.history.map((p) => p.Timestamp)).toEqual([
      '2026-10-23T08:00:00Z',
      '2026-10-23T08:15:00Z',
      '2026-10-23T08:30:00Z',
    ])
  })

  it('trims history to 12h before the newest reading', () => {
    const merged = mergeHistory([pt('2026-10-22T10:00:00Z')], [pt('2026-10-23T08:00:00Z'), pt('2026-10-23T00:00:00Z')])
    expect(merged.map((p) => p.Timestamp)).toEqual(['2026-10-23T00:00:00Z', '2026-10-23T08:00:00Z'])
  })

  it('applyConnections adds, keeps history, and drops removed patients', () => {
    const s = createPatientStore()
    s.getState().applyGraph('p1', graph([pt('2026-10-23T08:00:00Z')]))
    s.getState().applyConnections([{ patientId: 'p1', firstName: 'Ann' }, { patientId: 'p2' }])
    expect(Object.keys(s.getState().patients).sort()).toEqual(['p1', 'p2'])
    expect(s.getState().patients.p1.history).toHaveLength(1)
    expect(s.getState().patients.p2.name).toBe('p2')
    s.getState().applyConnections([{ patientId: 'p2' }])
    expect(Object.keys(s.getState().patients)).toEqual(['p2'])
  })

  it('setError marks status without losing data; next success clears it', () => {
    const s = createPatientStore()
    s.getState().applyGraph('p1', graph([pt('2026-10-23T08:00:00Z')]))
    s.getState().setError('p1', 'boom')
    expect(s.getState().patients.p1).toMatchObject({ status: 'error', lastError: 'boom' })
    expect(s.getState().patients.p1.latest).toBeDefined()
    s.getState().applyGraph('p1', graph([pt('2026-10-23T08:15:00Z')]))
    expect(s.getState().patients.p1).toMatchObject({ status: 'ok', lastError: undefined })
    s.getState().setError('nope', 'x')
    expect(s.getState().patients.nope).toBeUndefined()
  })
})

describe('alarmStore', () => {
  it('defaults track sensor targets, with fallbacks', () => {
    expect(defaultAlarmConfig({ targetLow: 80, targetHigh: 160 })).toMatchObject({ low: 80, high: 160, urgentLow: 55 })
    expect(defaultAlarmConfig()).toMatchObject({ low: 70, high: 180, urgentHigh: 250 })
  })

  it('overrides are per patient and layered over defaults', () => {
    const s = createAlarmStore()
    s.getState().setConfig('p1', { low: 90 })
    s.getState().setConfig('p1', { sound: false })
    expect(resolveAlarmConfig(s.getState(), 'p1', { targetLow: 80, targetHigh: 160 })).toMatchObject({ low: 90, high: 160, sound: false })
    expect(resolveAlarmConfig(s.getState(), 'p2', { targetLow: 80 }).low).toBe(80)
    s.getState().resetConfig('p1')
    expect(resolveAlarmConfig(s.getState(), 'p1', { targetLow: 80 }).low).toBe(80)
  })

  it('snooze expires and can be cleared', () => {
    const s = createAlarmStore()
    s.getState().snooze('p1', 1000)
    expect(isSnoozed(s.getState(), 'p1', 999)).toBe(true)
    expect(isSnoozed(s.getState(), 'p1', 1000)).toBe(false)
    s.getState().clearSnooze('p1')
    expect(isSnoozed(s.getState(), 'p1', 0)).toBe(false)
  })
})
