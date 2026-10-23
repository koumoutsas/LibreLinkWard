/** @jest-environment node */
import { LinkUpError } from '../../shared/linkup'
import { createPatientStore } from '../../shared/stores'
import { PollingService } from '../pollingService'

const creds = { country: 'eu', username: 'u', password: 'p' }
const point = { Timestamp: '2026-10-23T08:00:00Z', FactoryTimestamp: '2026-10-23T08:00:00Z', ValueInMgPerDl: 100 }

const stored1 = { ...creds, id: 'u' }

const setup = (client: any, stored: Array<typeof stored1> = [], createClient: (c: any) => any = () => client) => {
  const credentials = {
    loadAll: jest.fn(() => stored),
    saveAll: jest.fn(),
    clear: jest.fn(),
  }
  const patients = createPatientStore()
  const onStatus = jest.fn()
  const service = new PollingService({
    credentials: credentials as any,
    patients,
    onStatus,
    createClient,
    intervalMs: 3_600_000,
  })
  return { service, credentials, patients, onStatus }
}

const flush = () => new Promise((r) => setImmediate(r))

const okClient = (): any => ({
  login: jest.fn().mockResolvedValue({ token: 't', accountId: 'a', country: 'de' }),
  getSession: () => ({ token: 't', accountId: 'a', country: 'de' }),
  getConnections: jest.fn().mockResolvedValue([{ patientId: 'p1', firstName: 'Ann' }, { patientId: 'p2' }]),
  getGraph: jest.fn(async (id: string) => ({
    connection: { patientId: id, firstName: id === 'p1' ? 'Ann' : undefined },
    graphData: [point],
    glucoseMeasurement: point,
  })),
})

describe('PollingService', () => {
  it('does nothing without stored credentials', () => {
    const { service } = setup(okClient())
    expect(service.startIfConfigured()).toBe(false)
    expect(service.getStatus()).toBe('signed-out')
  })

  it('starts with stored credentials and fills the patient store for every patient', async () => {
    const client = okClient()
    const { service, patients } = setup(client, [stored1])
    expect(service.startIfConfigured()).toBe(true)
    await flush()
    expect(Object.keys(patients.getState().patients).sort()).toEqual(['u~p1', 'u~p2'])
    expect(patients.getState().patients['u~p1'].latest?.ValueInMgPerDl).toBe(100)
    expect(service.getStatus()).toBe('running')
    service.stop()
  })

  it('signIn verifies, saves the resolved region, then polls', async () => {
    const client = okClient()
    const { service, credentials, patients } = setup(client)
    await expect(service.signIn({ ...creds, country: 'global' })).resolves.toEqual({ ok: true })
    expect(credentials.saveAll).toHaveBeenCalledWith([{ ...creds, country: 'de', id: expect.any(String) }])
    await flush()
    expect(Object.keys(patients.getState().patients)).toHaveLength(2)
    service.stop()
  })

  it('signIn failure saves nothing and does not poll', async () => {
    const client = { ...okClient(), login: jest.fn().mockRejectedValue(new LinkUpError('bad', 'auth', 2)) }
    const { service, credentials } = setup(client)
    await expect(service.signIn(creds)).resolves.toMatchObject({ ok: false, status: 2 })
    expect(credentials.saveAll).not.toHaveBeenCalled()
    expect(client.getConnections).not.toHaveBeenCalled()
    expect(service.getStatus()).toBe('signed-out')
  })

  it('auth errors while polling halt the poller and flag auth-error', async () => {
    const client = { ...okClient(), getConnections: jest.fn().mockRejectedValue(new LinkUpError('no', 'auth', 401)) }
    const { service, onStatus } = setup(client, [stored1])
    service.startIfConfigured()
    await flush()
    expect(service.getStatus()).toBe('auth-error')
    expect(onStatus).toHaveBeenLastCalledWith('auth-error')
    expect(service.getAccounts()).toEqual([{ id: 'u', username: 'u', status: 'auth-error' }])
  })

  it('per-patient errors mark only that patient', async () => {
    const client = okClient()
    client.getGraph.mockImplementation(async (id: string) => {
      if (id === 'p2') throw new LinkUpError('down', 'network')
      return { connection: { patientId: id }, graphData: [point], glucoseMeasurement: point }
    })
    const { service, patients } = setup(client, [stored1])
    service.startIfConfigured()
    await flush()
    expect(patients.getState().patients['u~p1'].status).toBe('ok')
    expect(patients.getState().patients['u~p2']).toMatchObject({ status: 'error', lastError: 'down' })
    service.stop()
  })

  it('signOut clears credentials and patients', async () => {
    const { service, credentials, patients } = setup(okClient(), [stored1])
    service.startIfConfigured()
    await flush()
    service.signOut()
    expect(credentials.clear).toHaveBeenCalled()
    expect(patients.getState().patients).toEqual({})
    expect(service.getStatus()).toBe('signed-out')
  })

  describe('several logins', () => {
    // Each login is its own patient (a patient's own credentials).
    const clientFor = (patientId: string, first: string): any => ({
      login: jest.fn().mockResolvedValue({ token: 't', accountId: 'a', country: 'de' }),
      getSession: () => ({ token: 't', accountId: 'a', country: 'de' }),
      getConnections: jest.fn().mockResolvedValue([{ patientId, firstName: first }]),
      getGraph: jest.fn(async (id: string) => ({ connection: { patientId: id, firstName: first }, graphData: [point], glucoseMeasurement: point })),
    })
    const clients: Record<string, any> = { ann: clientFor('pa', 'Ann'), bob: clientFor('pb', 'Bob') }
    const byUser = (c: any) => clients[c.username]
    const add = (service: PollingService, username: string, password = 'p') =>
      service.signIn({ country: 'eu', username, password })
    const idOf = (service: PollingService, username: string) =>
      service.getAccounts().find((a) => a.username === username)!.id

    it('keeps each login\'s patients side by side', async () => {
      const { service, patients } = setup(null, [], byUser)
      await add(service, 'ann')
      await add(service, 'bob')
      await flush()
      const [ann, bob] = [idOf(service, 'ann'), idOf(service, 'bob')]
      expect(Object.keys(patients.getState().patients).sort()).toEqual([`${ann}~pa`, `${bob}~pb`].sort())
      expect(patients.getState().patients[`${ann}~pa`].accountId).toBe(ann)
      service.stop()
    })

    it('adding the same credentials twice makes two independent views', async () => {
      const { service, credentials, patients } = setup(null, [], byUser)
      await add(service, 'ann')
      await add(service, 'ann')
      await flush()
      const accounts = service.getAccounts()
      expect(accounts).toHaveLength(2)
      expect(accounts[0].id).not.toBe(accounts[1].id)
      expect(credentials.saveAll).toHaveBeenLastCalledWith([
        expect.objectContaining({ username: 'ann' }),
        expect.objectContaining({ username: 'ann' }),
      ])
      expect(Object.keys(patients.getState().patients)).toHaveLength(2)
      service.stop()
    })

    it('removeAccount drops only that view and its patients', async () => {
      const { service, credentials, patients } = setup(null, [], byUser)
      await add(service, 'ann')
      await add(service, 'ann')
      await add(service, 'bob')
      await flush()
      const first = service.getAccounts()[0].id
      service.removeAccount(first)
      expect(service.getAccounts()).toHaveLength(2)
      expect(Object.keys(patients.getState().patients)).toHaveLength(2)
      expect(Object.keys(patients.getState().patients).some((k) => k.startsWith(first))).toBe(false)
      expect(credentials.saveAll).toHaveBeenLastCalledWith([
        expect.objectContaining({ username: 'ann' }),
        expect.objectContaining({ username: 'bob' }),
      ])
      expect(service.getStatus()).toBe('running')
      service.stop()
    })

    it('removing the last view signs out', async () => {
      const { service } = setup(null, [], byUser)
      await add(service, 'ann')
      service.removeAccount(service.getAccounts()[0].id)
      expect(service.getStatus()).toBe('signed-out')
    })

    it('a failing login does not stop the other one', async () => {
      clients.bad = { ...clientFor('pc', 'Cy'), getConnections: jest.fn().mockRejectedValue(new LinkUpError('no', 'auth', 401)) }
      const { service, patients } = setup(null, [], byUser)
      await add(service, 'ann')
      await add(service, 'bad')
      await flush()
      expect(service.getAccounts().find((a) => a.username === 'bad')?.status).toBe('auth-error')
      expect(service.getAccounts().find((a) => a.username === 'ann')?.status).toBe('running')
      expect(Object.keys(patients.getState().patients)).toHaveLength(1)
      service.stop()
    })
  })
})
