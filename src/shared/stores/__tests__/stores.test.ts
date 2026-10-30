/** @jest-environment node */
import {
  createAlarmStore,
  createPatientStore,
  defaultAlarmConfig,
  isSnoozed,
  mergeHistory,
  pointTime,
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
    expect(defaultAlarmConfig()).toMatchObject({ enabled: false, sound: false })
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

describe('patientStore with several logins', () => {
  it('keeps other logins\' patients when one login refreshes its connections', () => {
    const store = createPatientStore()
    store.getState().applyConnections([{ patientId: 'a', firstName: 'Ann' }] as any, 'ann')
    store.getState().applyConnections([{ patientId: 'b', firstName: 'Bob' }] as any, 'bob')
    store.getState().applyConnections([{ patientId: 'a2', firstName: 'Ann' }] as any, 'ann')
    expect(Object.keys(store.getState().patients).sort()).toEqual(['a2', 'b'])
    expect(store.getState().patients.b.accountId).toBe('bob')
  })

  it('removeAccount drops only that login\'s patients', () => {
    const store = createPatientStore()
    store.getState().applyConnections([{ patientId: 'a' }] as any, 'ann')
    store.getState().applyConnections([{ patientId: 'b' }] as any, 'bob')
    store.getState().removeAccount('ann')
    expect(Object.keys(store.getState().patients)).toEqual(['b'])
  })
})

describe('pointTime', () => {
  const utc = Date.UTC(2026, 9, 28, 12, 15, 30)

  it('reads the Timestamp when there is no FactoryTimestamp', () => {
    expect(pointTime({ Timestamp: '2026-10-28T12:15:30Z', ValueInMgPerDl: 1 })).toBe(utc)
  })

  it('prefers the FactoryTimestamp', () => {
    const p = { Timestamp: '2026-01-01T00:00:00Z', FactoryTimestamp: '2026-10-28T12:15:30Z', ValueInMgPerDl: 1 }
    expect(pointTime(p)).toBe(utc)
  })

  it.each([
    ['Z', '2026-10-28T12:15:30Z', utc],
    ['a +hh:mm offset', '2026-10-28T14:15:30+02:00', utc],
    ['a -hh:mm offset', '2026-10-28T07:15:30-05:00', utc],
    ['a +hhmm offset', '2026-10-28T14:15:30+0200', utc],
  ])('keeps an explicit zone: %s', (_n, ts, expected) => {
    expect(pointTime({ Timestamp: ts, FactoryTimestamp: ts, ValueInMgPerDl: 1 })).toBe(expected)
  })

  describe('in a zone away from UTC', () => {
    const tz = process.env.TZ
    beforeAll(() => {
      process.env.TZ = 'America/New_York'
    })
    afterAll(() => {
      if (tz === undefined) delete process.env.TZ
      else process.env.TZ = tz
    })

    it('reads a zoneless ISO FactoryTimestamp as UTC', () => {
      const ts = '2026-10-28T12:15:30'
      expect(pointTime({ Timestamp: ts, FactoryTimestamp: ts, ValueInMgPerDl: 1 })).toBe(utc)
    })

    it('reads a zoneless "M/D/YYYY h:mm:ss PM" FactoryTimestamp as UTC', () => {
      const ts = '10/28/2026 12:15:30 PM'
      expect(pointTime({ Timestamp: ts, FactoryTimestamp: ts, ValueInMgPerDl: 1 })).toBe(utc)
    })
  })
})

describe('mergeHistory edge cases', () => {
  const bare = (ts: string) => ({ Timestamp: ts, ValueInMgPerDl: 100 })

  it('keeps distinct points that only have a Timestamp', () => {
    const merged = mergeHistory([], [bare('2026-10-23T08:00:00Z'), bare('2026-10-23T08:05:00Z')])
    expect(merged).toHaveLength(2)
  })

  it('drops points with an unparseable timestamp, and is empty when none parse', () => {
    const good = pt('2026-10-23T08:00:00Z')
    expect(mergeHistory([], [good, pt('garbage')])).toEqual([good])
    expect(mergeHistory([], [pt('garbage')])).toEqual([])
  })

  it('keeps a point exactly on the window edge', () => {
    const edge = pt('2026-10-23T00:00:00Z')
    const newest = pt('2026-10-23T12:00:00Z')
    expect(mergeHistory([edge], [newest])).toEqual([edge, newest])
    expect(mergeHistory([pt('2026-10-22T23:59:59Z')], [newest])).toEqual([newest])
  })
})

describe('patientStore fallbacks', () => {
  it('applyConnections starts a new patient ok with empty history', () => {
    const s = createPatientStore()
    s.getState().applyConnections([{ patientId: 'p1' }])
    expect(s.getState().patients.p1).toMatchObject({ status: 'ok', history: [], name: 'p1' })
  })

  it('applyConnections keeps an existing error status and targets, but takes new targets', () => {
    const s = createPatientStore()
    s.getState().applyConnections([{ patientId: 'p1', targetLow: 80, targetHigh: 160 }])
    s.getState().setError('p1', 'boom')
    s.getState().applyConnections([{ patientId: 'p1' }])
    expect(s.getState().patients.p1).toMatchObject({ status: 'error', targetLow: 80, targetHigh: 160 })
    s.getState().applyConnections([{ patientId: 'p1', targetLow: 90, targetHigh: 170 }])
    expect(s.getState().patients.p1).toMatchObject({ targetLow: 90, targetHigh: 170 })
  })

  it('applyGraph copes with a first graph that has no targets, then keeps them', () => {
    const s = createPatientStore()
    const bare = { connection: { patientId: 'p1' }, graphData: [pt('2026-10-23T08:00:00Z')] }
    s.getState().applyGraph('p1', bare, 1)
    expect(s.getState().patients.p1.targetLow).toBeUndefined()
    s.getState().applyConnections([{ patientId: 'p1', targetLow: 80, targetHigh: 160 }])
    s.getState().applyGraph('p1', bare, 2)
    expect(s.getState().patients.p1).toMatchObject({ targetLow: 80, targetHigh: 160 })
  })
})
