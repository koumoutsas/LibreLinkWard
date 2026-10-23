/** @jest-environment node */
import { LinkUpError } from '../../shared/linkup'
import { createPatientStore } from '../../shared/stores'
import { PollingService } from '../pollingService'

const creds = { country: 'eu', username: 'u', password: 'p' }
const point = { Timestamp: '2026-10-23T08:00:00Z', FactoryTimestamp: '2026-10-23T08:00:00Z', ValueInMgPerDl: 100 }

const setup = (client: any, stored: typeof creds | null = null) => {
  const credentials = {
    load: jest.fn(() => stored),
    save: jest.fn(),
    clear: jest.fn(),
  }
  const patients = createPatientStore()
  const onStatus = jest.fn()
  const service = new PollingService({
    credentials: credentials as any,
    patients,
    onStatus,
    createClient: () => client,
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
    const { service, patients } = setup(client, creds)
    expect(service.startIfConfigured()).toBe(true)
    await flush()
    expect(Object.keys(patients.getState().patients).sort()).toEqual(['p1', 'p2'])
    expect(patients.getState().patients.p1.latest?.ValueInMgPerDl).toBe(100)
    expect(service.getStatus()).toBe('running')
    service.stop()
  })

  it('signIn verifies, saves the resolved region, then polls', async () => {
    const client = okClient()
    const { service, credentials, patients } = setup(client)
    await expect(service.signIn({ ...creds, country: 'global' })).resolves.toEqual({ ok: true })
    expect(credentials.save).toHaveBeenCalledWith({ ...creds, country: 'de' })
    await flush()
    expect(Object.keys(patients.getState().patients)).toHaveLength(2)
    service.stop()
  })

  it('signIn failure saves nothing and does not poll', async () => {
    const client = { ...okClient(), login: jest.fn().mockRejectedValue(new LinkUpError('bad', 'auth', 2)) }
    const { service, credentials } = setup(client)
    await expect(service.signIn(creds)).resolves.toMatchObject({ ok: false, status: 2 })
    expect(credentials.save).not.toHaveBeenCalled()
    expect(client.getConnections).not.toHaveBeenCalled()
    expect(service.getStatus()).toBe('signed-out')
  })

  it('auth errors while polling halt the poller and flag auth-error', async () => {
    const client = { ...okClient(), getConnections: jest.fn().mockRejectedValue(new LinkUpError('no', 'auth', 401)) }
    const { service, onStatus } = setup(client, creds)
    service.startIfConfigured()
    await flush()
    expect(service.getStatus()).toBe('auth-error')
    expect(onStatus).toHaveBeenLastCalledWith('auth-error')
  })

  it('per-patient errors mark only that patient', async () => {
    const client = okClient()
    client.getGraph.mockImplementation(async (id: string) => {
      if (id === 'p2') throw new LinkUpError('down', 'network')
      return { connection: { patientId: id }, graphData: [point], glucoseMeasurement: point }
    })
    const { service, patients } = setup(client, creds)
    service.startIfConfigured()
    await flush()
    expect(patients.getState().patients.p1.status).toBe('ok')
    expect(patients.getState().patients.p2).toMatchObject({ status: 'error', lastError: 'down' })
    service.stop()
  })

  it('signOut clears credentials and patients', async () => {
    const { service, credentials, patients } = setup(okClient(), creds)
    service.startIfConfigured()
    await flush()
    service.signOut()
    expect(credentials.clear).toHaveBeenCalled()
    expect(patients.getState().patients).toEqual({})
    expect(service.getStatus()).toBe('signed-out')
  })
})
