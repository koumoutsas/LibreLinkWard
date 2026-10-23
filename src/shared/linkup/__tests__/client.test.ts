/** @jest-environment node */
import { LinkUpClient, LinkUpError, getBaseUrl } from '..'

const ok = (data: unknown) => ({ data, status: 200 }) as any
const loginOk = (country = 'de') =>
  ok({
    status: 0,
    data: {
      user: { id: 'acc-1', country: country.toUpperCase() },
      authTicket: { token: 'tok' },
    },
  })
const creds = { country: 'global', username: 'u', password: 'p' }
const httpError = (status: number) => Object.assign(new Error('x'), { response: { status } })

describe('getBaseUrl', () => {
  it('maps global and regional', () => {
    expect(getBaseUrl('global')).toBe('https://api.libreview.io/llu')
    expect(getBaseUrl('eu')).toBe('https://api-eu.libreview.io/llu')
  })
})

describe('LinkUpClient.login', () => {
  it('follows regional redirect', async () => {
    const http = jest
      .fn()
      .mockResolvedValueOnce(ok({ status: 0, data: { redirect: true, region: 'fr' } }))
      .mockResolvedValueOnce(loginOk('fr'))
    const s = await new LinkUpClient({ credentials: creds, http }).login()
    expect(http.mock.calls[1][0].baseURL).toBe('https://api-fr.libreview.io/llu')
    expect(s).toEqual({ token: 'tok', accountId: 'acc-1', country: 'fr' })
  })

  it('maps ch to eu', async () => {
    const http = jest.fn().mockResolvedValue(loginOk('ch'))
    const s = await new LinkUpClient({ credentials: creds, http }).login()
    expect(s.country).toBe('eu')
  })

  it('throws auth error with body status', async () => {
    const http = jest.fn().mockResolvedValue(ok({ status: 2 }))
    await expect(new LinkUpClient({ credentials: creds, http }).login()).rejects.toMatchObject({
      kind: 'auth',
      status: 2,
    })
  })
})

describe('LinkUpClient data calls', () => {
  const session = { token: 't1', accountId: 'acc-1', country: 'eu' }

  it('returns all connections with auth headers', async () => {
    const http = jest.fn().mockResolvedValue(ok({ data: [{ patientId: 'a' }, { patientId: 'b' }] }))
    const c = new LinkUpClient({ credentials: creds, session, http })
    expect(await c.getConnections()).toHaveLength(2)
    const h = http.mock.calls[0][0].headers
    expect(h.Authorization).toBe('Bearer t1')
    expect(h['Account-Id']).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns graphData and glucoseMeasurement', async () => {
    const gm = { Timestamp: 't', ValueInMgPerDl: 100 }
    const http = jest.fn().mockResolvedValue(
      ok({ data: { connection: { patientId: 'a', glucoseMeasurement: gm }, graphData: [gm] } }),
    )
    const g = await new LinkUpClient({ credentials: creds, session, http }).getGraph('a')
    expect(g.graphData).toEqual([gm])
    expect(g.glucoseMeasurement).toEqual(gm)
    expect(http.mock.calls[0][0].url).toBe('/connections/a/graph')
  })

  it('re-logs in once on 401 and retries', async () => {
    const http = jest
      .fn()
      .mockRejectedValueOnce(httpError(401))
      .mockResolvedValueOnce(loginOk('eu'))
      .mockResolvedValueOnce(ok({ data: [] }))
    const c = new LinkUpClient({ credentials: creds, session, http })
    expect(await c.getConnections()).toEqual([])
    expect(http).toHaveBeenCalledTimes(3)
  })

  it('logs in lazily without a session', async () => {
    const http = jest.fn().mockResolvedValueOnce(loginOk()).mockResolvedValueOnce(ok({ data: [] }))
    await new LinkUpClient({ credentials: creds, http }).getConnections()
    expect(http.mock.calls[0][0].url).toBe('/auth/login')
  })

  it('classifies 429 as rate-limit', async () => {
    const http = jest.fn().mockRejectedValue(httpError(429))
    const p = new LinkUpClient({ credentials: creds, session, http }).getConnections()
    await expect(p).rejects.toBeInstanceOf(LinkUpError)
    await expect(p).rejects.toMatchObject({ kind: 'rate-limit' })
  })
})
