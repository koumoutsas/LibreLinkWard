/** @jest-environment node */
import { LinkUpClient } from '../shared/linkup'
import { createAlarmStore, createPatientStore } from '../shared/stores'
import { AlarmService, AlarmNotification } from '../main/alarmService'
import { PollingService } from '../main/pollingService'
import { NightscoutUploader } from '../main/nightscout/uploader'
import { startMockLibreLinkUp, startMockNightscout } from './helpers/mockServers'

const MIN = 60_000
const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * MIN).toISOString()
const creds = { country: 'global', username: 'nurse@example.com', password: 'pw' }

const waitFor = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('polling -> store -> alarm -> Nightscout (mock servers)', () => {
  let llu: Awaited<ReturnType<typeof startMockLibreLinkUp>>
  let ns: Awaited<ReturnType<typeof startMockNightscout>>
  let stops: Array<() => void> = []

  beforeEach(async () => {
    llu = await startMockLibreLinkUp()
    ns = await startMockNightscout()
    llu.state.patients = [
      { patientId: 'ann', firstName: 'Ann', readings: [{ iso: iso(10), value: 110 }, { iso: iso(5), value: 100 }, { iso: iso(0), value: 95 }] },
      { patientId: 'bob', firstName: 'Bob', readings: [{ iso: iso(5), value: 90 }, { iso: iso(0), value: 60 }] },
      { patientId: 'cy', firstName: 'Cy', targetHigh: 150, readings: [{ iso: iso(0), value: 200 }] },
    ]
  })
  afterEach(async () => {
    stops.forEach((s) => s())
    stops = []
    await Promise.all([llu.stop(), ns.stop()])
  })

  const build = () => {
    const patients = createPatientStore()
    const alarms = createAlarmStore({ overrides: Object.fromEntries(['v~ann', 'v~bob', 'v~cy'].map((id) => [id, { enabled: true, sound: true }])) })
    const notes: AlarmNotification[] = []
    const alarmService = new AlarmService({ patients, alarms, onActive: () => {}, onNotify: (n) => notes.push(n) })
    const credentials = { loadAll: () => [], saveAll: jest.fn(), clear: jest.fn() }
    const polling = new PollingService({
      credentials: credentials as any,
      patients,
      createClient: (c) => new LinkUpClient({ credentials: c, http: llu.http }),
      intervalMs: 3_600_000,
      newId: () => 'v',
    })
    alarmService.start()
    stops.push(() => alarmService.stop(), () => polling.stop())
    return { patients, alarms, notes, alarmService, polling, credentials }
  }

  it('signs in, loads every patient and raises per-patient alarms', async () => {
    const { patients, notes, alarmService, polling, credentials } = build()
    await expect(polling.signIn(creds)).resolves.toEqual({ ok: true })
    expect(credentials.saveAll).toHaveBeenCalledWith([{ ...creds, country: 'de', id: 'v' }])
    await waitFor(() => {
      const all = Object.values(patients.getState().patients)
      return all.length === 3 && all.every((p) => p.latest)
    })

    const state = patients.getState().patients
    expect(Object.keys(state).sort()).toEqual(['v~ann', 'v~bob', 'v~cy'])
    expect(state['v~ann'].history).toHaveLength(3)
    expect(state['v~ann'].name).toContain('Ann')

    const byPatient = Object.fromEntries(notes.map((n) => [n.patientId, n.kind]))
    expect(byPatient).toEqual({ 'v~bob': 'low', 'v~cy': 'high' })
    expect(alarmService.getActive().map((a) => a.patientId).sort()).toEqual(['v~bob', 'v~cy'])
  })

  it('wrong password fails sign-in without polling', async () => {
    const { polling, patients } = build()
    const res = await polling.signIn({ ...creds, password: 'nope' })
    expect(res).toMatchObject({ ok: false, status: 2 })
    expect(Object.keys(patients.getState().patients)).toHaveLength(0)
  })

  it('re-logs in transparently after a 401', async () => {
    const { patients, polling } = build()
    await polling.signIn(creds)
    await waitFor(() => !!patients.getState().patients['v~ann']?.latest)
    // Stop the background poller so only the client below talks to the mock.
    polling.stop()
    // Let any request already in flight finish before counting logins.
    await new Promise((r) => setTimeout(r, 300))
    llu.state.requests.length = 0
    llu.state.reject401 = 1
    llu.state.token = 'token-2'
    const client = new LinkUpClient({ credentials: creds, http: llu.http, session: { token: 'token-1', accountId: 'user-1', country: 'de' } })
    const list = await client.getConnections()
    expect(list).toHaveLength(3)
    expect(llu.state.requests.filter((r) => r.url === '/llu/auth/login')).toHaveLength(1)
    expect(client.getSession()?.token).toBe('token-2')
  })

  it('uploads each patient history to Nightscout once, with no duplicates on repeat sync', async () => {
    const { patients, polling } = build()
    const uploader = new NightscoutUploader({ patients, baseBackoffMs: 1, maxBackoffMs: 1 })
    uploader.setConfigs({
      'v~ann': { enabled: true, url: ns.url, apiSecret: ns.secret, deviceName: 'ward' },
    })
    uploader.start()
    stops.push(() => uploader.stop())
    await polling.signIn(creds)
    await waitFor(() => ns.state.entries.length === 3)
    await uploader.sync()
    await uploader.sync()
    expect(ns.state.entries).toHaveLength(3)
    expect(ns.state.entries.every((e) => e.device === 'ward')).toBe(true)
    // Only the opted-in patient was uploaded.
    expect(ns.state.entries.map((e) => e.sgv).sort((a, b) => a - b)).toEqual([95, 100, 110])
  })

  it('retries after a Nightscout outage and resumes after the stored newest entry', async () => {
    const { patients, polling } = build()
    ns.state.failPosts = 1
    const uploader = new NightscoutUploader({ patients, baseBackoffMs: 1, maxBackoffMs: 1 })
    uploader.setConfigs({ 'v~ann': { enabled: true, url: ns.url, apiSecret: ns.secret, deviceName: 'ward' } })
    uploader.start()
    stops.push(() => uploader.stop())
    await polling.signIn(creds)
    // The first POST fails; the next poll (simulated by sync) retries from the same watermark.
    await waitFor(() => ns.state.posts >= 1)
    await new Promise((r) => setTimeout(r, 10))
    await uploader.sync()
    expect(ns.state.posts).toBeGreaterThanOrEqual(2)
    expect(ns.state.entries.map((e) => e.sgv).sort((a, b) => a - b)).toEqual([95, 100, 110])
    expect(uploader.getStatus('v~ann').lastError).toBeUndefined()
  })

  it('reports a wrong Nightscout secret as an error', async () => {
    const { patients, polling } = build()
    const uploader = new NightscoutUploader({ patients })
    uploader.setConfigs({ 'v~ann': { enabled: true, url: ns.url, apiSecret: 'wrong', deviceName: 'd' } })
    uploader.start()
    stops.push(() => uploader.stop())
    await polling.signIn(creds)
    await waitFor(() => !!uploader.getStatus('v~ann').lastError)
    expect(ns.state.entries).toHaveLength(0)
  })
})
