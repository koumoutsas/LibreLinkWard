import { createAlarmStore, createPatientStore } from '../../shared/stores'
import { AlarmService, ActiveAlarm, AlarmNotification } from '../alarmService'

let now = Date.parse('2026-01-01T12:00:00Z')
const MIN = 60_000

const graph = (id: string, name: string, value: number) => {
  const ts = new Date(now).toISOString()
  const point = { Timestamp: ts, FactoryTimestamp: ts, ValueInMgPerDl: value }
  return {
    connection: { patientId: id, firstName: name, lastName: '', targetLow: 70, targetHigh: 180 },
    graphData: [],
    glucoseMeasurement: point,
  } as any
}

function setup() {
  const patients = createPatientStore()
  const alarms = createAlarmStore()
  const notes: AlarmNotification[] = []
  const actives: ActiveAlarm[][] = []
  const service = new AlarmService({
    patients,
    alarms,
    now: () => now,
    onNotify: (n) => notes.push(n),
    onActive: (a) => actives.push(a),
  })
  service.start()
  return { patients, alarms, notes, actives, service }
}

describe('AlarmService', () => {
  beforeEach(() => {
    now = Date.parse('2026-01-01T12:00:00Z')
    jest.useFakeTimers()
  })
  afterEach(() => jest.useRealTimers())

  it('raises distinct alarms per patient using per-patient thresholds', () => {
    const { patients, alarms, notes, service } = setup()
    alarms.getState().setConfig('b', { low: 100 })
    patients.getState().applyGraph('a', graph('a', 'Ann', 90), now)
    patients.getState().applyGraph('b', graph('b', 'Bob', 90), now)
    expect(notes).toEqual([
      expect.objectContaining({ patientId: 'b', name: 'Bob', kind: 'low', type: 'raise' }),
    ])
    expect(service.getActive().map((a) => a.patientId)).toEqual(['b'])
    service.stop()
  })

  it('acknowledge silences repeats for that patient only', () => {
    const { patients, notes, service } = setup()
    patients.getState().applyGraph('a', graph('a', 'Ann', 60), now)
    patients.getState().applyGraph('b', graph('b', 'Bob', 60), now)
    service.acknowledge('a')
    expect(service.getActive().find((a) => a.patientId === 'a')?.acknowledged).toBe(true)
    notes.length = 0
    now += 6 * MIN
    service.evaluate()
    expect(notes.map((n) => n.patientId)).toEqual(['b'])
    service.stop()
  })

  it('snooze suppresses notifications until it expires', () => {
    const { patients, notes, service } = setup()
    patients.getState().applyGraph('a', graph('a', 'Ann', 60), now)
    notes.length = 0
    service.snooze('a', 15)
    now += 6 * MIN
    service.evaluate()
    expect(notes).toEqual([])
    now += 10 * MIN
    service.evaluate()
    expect(notes).toEqual([expect.objectContaining({ patientId: 'a', type: 'repeat' })])
    service.stop()
  })

  it('timer raises signal loss when data stops and clears when it returns', () => {
    const { patients, notes, service } = setup()
    patients.getState().applyGraph('a', graph('a', 'Ann', 100), now)
    now += 25 * MIN
    jest.advanceTimersByTime(30_000)
    expect(notes).toEqual([expect.objectContaining({ kind: 'signal-loss', name: 'Ann' })])
    patients.getState().applyGraph('a', graph('a', 'Ann', 100), now)
    expect(service.getActive()).toEqual([])
    service.stop()
  })

  it('publishes active alarms only when they change', () => {
    const { patients, actives, service } = setup()
    patients.getState().applyGraph('a', graph('a', 'Ann', 60), now)
    const count = actives.length
    service.evaluate()
    expect(actives.length).toBe(count)
    service.stop()
  })
})
