/** @jest-environment node */
import { LinkUpError } from '../../../shared/linkup'
import { createPatientStore } from '../../../shared/stores'
import { NightscoutClient } from '../client'
import { NightscoutSource, NIGHTSCOUT_PATIENT_ID, entryToPoint } from '../source'
import { PollingService } from '../../pollingService'

const entry = (min: number, sgv: number, direction?: string) => ({
  type: 'sgv',
  sgv,
  direction,
  date: Date.UTC(2026, 0, 1, 0, min),
})

describe('entryToPoint', () => {
  it('maps an sgv entry and its direction', () => {
    expect(entryToPoint(entry(0, 120, 'FortyFiveUp'))).toEqual({
      Timestamp: '2026-01-01T00:00:00.000Z',
      FactoryTimestamp: '2026-01-01T00:00:00.000Z',
      ValueInMgPerDl: 120,
      Value: 120,
      TrendArrow: 4,
    })
    expect(entryToPoint(entry(0, 90, 'DoubleDown'))?.TrendArrow).toBe(1)
    expect(entryToPoint(entry(0, 90))?.TrendArrow).toBeUndefined()
  })

  it('skips entries without a usable time or value', () => {
    expect(entryToPoint({ sgv: 100 })).toBeNull()
    expect(entryToPoint({ date: 1, sgv: 0 })).toBeNull()
    expect(entryToPoint({ date: 1, mbg: 100 })).toBeNull()
    expect(entryToPoint(null)).toBeNull()
  })
})

describe('NightscoutSource', () => {
  const make = (entriesSince: jest.Mock) =>
    new NightscoutSource({ client: { entriesSince }, name: 'Ann', now: () => Date.UTC(2026, 0, 1, 1) })

  it('exposes one patient and returns readings oldest first', async () => {
    const entriesSince = jest.fn().mockResolvedValue([entry(10, 110), entry(0, 100), { junk: 1 }])
    const src = make(entriesSince)
    expect(await src.getConnections()).toEqual([{ patientId: NIGHTSCOUT_PATIENT_ID, firstName: 'Ann' }])
    const g = await src.getGraph(NIGHTSCOUT_PATIENT_ID)
    expect(g.graphData.map((p) => p.ValueInMgPerDl)).toEqual([100, 110])
    expect(g.glucoseMeasurement?.ValueInMgPerDl).toBe(110)
    // asks for the last 12 h only
    expect(entriesSince).toHaveBeenCalledWith(Date.UTC(2025, 11, 31, 13))
  })

  it('classifies failures so the poller can react', async () => {
    const fail = (status?: number) =>
      make(jest.fn().mockRejectedValue(Object.assign(new Error('x'), status ? { response: { status } } : {})))
        .getGraph('p')
        .catch((e) => e)
    expect(await fail(401)).toMatchObject({ kind: 'auth' })
    expect(await fail(403)).toMatchObject({ kind: 'auth' })
    expect(await fail(429)).toMatchObject({ kind: 'rate-limit' })
    expect(await fail()).toMatchObject({ kind: 'network' })
    expect(await fail()).toBeInstanceOf(LinkUpError)
  })
})

describe('Nightscout target range', () => {
  const clock = { t: Date.UTC(2026, 0, 1) }
  const make = (targetRange: jest.Mock) =>
    new NightscoutSource({
      client: { entriesSince: jest.fn().mockResolvedValue([]), targetRange },
      name: 'Ann',
      now: () => clock.t,
    })

  it('puts the site thresholds on the patient and refreshes hourly', async () => {
    const targetRange = jest.fn().mockResolvedValue({ low: 80, high: 180 })
    const src = make(targetRange)
    expect(await src.getConnections()).toEqual([
      { patientId: NIGHTSCOUT_PATIENT_ID, firstName: 'Ann', targetLow: 80, targetHigh: 180 },
    ])
    expect((await src.getGraph('nightscout')).connection).toMatchObject({ targetLow: 80, targetHigh: 180 })
    await src.getConnections()
    expect(targetRange).toHaveBeenCalledTimes(1)
    clock.t += 61 * 60 * 1000
    await src.getConnections()
    expect(targetRange).toHaveBeenCalledTimes(2)
  })

  it('keeps going without targets when the status read fails', async () => {
    const src = make(jest.fn().mockRejectedValue(new Error('boom')))
    const [c] = await src.getConnections()
    expect(c.targetLow).toBeUndefined()
    expect(c.targetHigh).toBeUndefined()
  })

  it('reads bgTargetBottom/bgTargetTop from status.json and ignores bad values', async () => {
    const ok = jest.fn().mockResolvedValue({
      data: { settings: { thresholds: { bgTargetBottom: 70, bgTargetTop: '160' } } },
    })
    expect(await new NightscoutClient({ url: 'https://ns.test', apiSecret: '' }, ok).targetRange()).toEqual({
      low: 70,
      high: 160,
    })
    const bad = jest.fn().mockResolvedValue({ data: { settings: {} } })
    expect(await new NightscoutClient({ url: 'https://ns.test', apiSecret: '' }, bad).targetRange()).toEqual({
      low: undefined,
      high: undefined,
    })
  })
})

describe('NightscoutClient reads', () => {
  it('queries sgv entries since a time and omits the header without a secret', async () => {
    const http = jest.fn().mockResolvedValue({ data: [entry(0, 100)] })
    const c = new NightscoutClient({ url: 'https://ns.test/', apiSecret: '' }, http)
    expect(await c.entriesSince(1000, 5)).toHaveLength(1)
    const cfg = http.mock.calls[0][0]
    expect(cfg.url).toBe('https://ns.test/api/v1/entries/sgv.json?count=5&find[date][$gte]=1000')
    expect(cfg.headers['api-secret']).toBeUndefined()
  })

  it('skips the auth check for public sites', async () => {
    const http = jest.fn().mockResolvedValue({ data: {} })
    await new NightscoutClient({ url: 'https://ns.test', apiSecret: '' }, http).testConnection()
    expect(http).toHaveBeenCalledTimes(1)
  })
})

describe('PollingService with a Nightscout source', () => {
  const setup = (check: () => Promise<void> = async () => {}) => {
    const credentials = { loadAll: jest.fn(() => []), saveAll: jest.fn(), clear: jest.fn() }
    const patients = createPatientStore()
    const source = {
      getConnections: jest.fn().mockResolvedValue([{ patientId: 'nightscout', firstName: 'Ann' }]),
      getGraph: jest.fn().mockResolvedValue({
        connection: { patientId: 'nightscout', firstName: 'Ann' },
        graphData: [entryToPoint(entry(0, 105))],
        glucoseMeasurement: entryToPoint(entry(0, 105)),
      }),
    }
    const service = new PollingService({
      credentials: credentials as any,
      patients,
      createNightscout: () => source as any,
      newId: () => 'ns1',
      intervalMs: 3_600_000,
    })
    return { service, credentials, patients, source, check }
  }
  const flush = () => new Promise((r) => setImmediate(r))

  it('rejects a non-http URL without storing anything', async () => {
    const { service, credentials } = setup()
    const res = await service.addNightscout({ url: 'ns.test' })
    expect(res.ok).toBe(false)
    expect(credentials.saveAll).not.toHaveBeenCalled()
  })

  it('reports an unreachable site and stores nothing', async () => {
    const { service, credentials } = setup()
    const spy = jest.spyOn(NightscoutClient.prototype, 'testConnection').mockRejectedValue(new Error('ECONNREFUSED'))
    expect(await service.addNightscout({ url: 'https://ns.test' })).toEqual({ ok: false, error: 'ECONNREFUSED' })
    expect(credentials.saveAll).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('stores a verified site and fills the patient store', async () => {
    const { service, credentials, patients } = setup()
    const spy = jest.spyOn(NightscoutClient.prototype, 'testConnection').mockResolvedValue()
    expect(await service.addNightscout({ url: 'https://ns.test/', apiSecret: 's', name: ' Ann ' })).toEqual({ ok: true })
    expect(credentials.saveAll).toHaveBeenCalledWith([
      { id: 'ns1', kind: 'nightscout', url: 'https://ns.test', apiSecret: 's', name: 'Ann' },
    ])
    await flush()
    expect(service.getAccounts()).toEqual([{ id: 'ns1', username: 'Ann', kind: 'nightscout', status: 'running' }])
    expect(patients.getState().patients['ns1~nightscout']).toMatchObject({ name: 'Ann', accountId: 'ns1' })
    expect(patients.getState().patients['ns1~nightscout'].latest?.ValueInMgPerDl).toBe(105)
    service.stop()
    spy.mockRestore()
  })

  it('defaults the name to the host', async () => {
    const { service, credentials } = setup()
    const spy = jest.spyOn(NightscoutClient.prototype, 'testConnection').mockResolvedValue()
    await service.addNightscout({ url: 'https://ns.test:8443' })
    expect(credentials.saveAll.mock.calls[0][0][0].name).toBe('ns.test:8443')
    service.stop()
    spy.mockRestore()
  })
})
