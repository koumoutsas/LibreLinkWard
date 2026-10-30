/** @jest-environment node */
import axios from 'axios'
import { LinkUpClient, LinkUpError, getBaseUrl } from '..'

jest.mock('axios', () => ({ __esModule: true, default: jest.fn() }))

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

describe('LinkUpError', () => {
  it('carries its name, kind and status', () => {
    const e = new LinkUpError('m', 'auth', 7)
    expect(e).toBeInstanceOf(Error)
    expect(e).toMatchObject({ name: 'LinkUpError', message: 'm', kind: 'auth', status: 7 })
  })
})

describe('LinkUpClient requests', () => {
  const session = { token: 't1', accountId: 'acc-1', country: 'eu' }
  const apiHeaders = {
    product: 'llu.android',
    version: '4.16.0',
    Pragma: 'no-cache',
    'Cache-Control': 'no-cache',
  }

  it('posts the credentials to /auth/login with the app headers', async () => {
    const http = jest.fn().mockResolvedValue(loginOk('de'))
    await new LinkUpClient({ credentials: creds, http }).login()
    expect(http).toHaveBeenCalledWith({
      method: 'post',
      baseURL: 'https://api.libreview.io/llu',
      url: '/auth/login',
      data: { email: 'u', password: 'p' },
      headers: apiHeaders,
    })
  })

  it('gets with the app headers, bearer token and hashed account id', async () => {
    const http = jest.fn().mockResolvedValue(ok({ data: [] }))
    await new LinkUpClient({ credentials: creds, session, http }).getConnections()
    const call = http.mock.calls[0][0]
    expect(call).toMatchObject({ method: 'get', baseURL: 'https://api-eu.libreview.io/llu', url: '/connections' })
    expect(call.headers).toEqual({
      ...apiHeaders,
      Authorization: 'Bearer t1',
      'Account-Id': 'cf9df9b99fc0a24be13747e9ba144c730c889af804bc1abbb1be8918e5cd30e2',
    })
  })

  it('defaults to axios', async () => {
    ;(axios as unknown as jest.Mock).mockResolvedValue(ok({ data: [{ patientId: 'a' }] }))
    const res = await new LinkUpClient({ credentials: creds, session }).getConnections()
    expect(res).toEqual([{ patientId: 'a' }])
    expect(axios).toHaveBeenCalledWith(expect.objectContaining({ url: '/connections' }))
  })
})

describe('LinkUpClient login failures', () => {
  const login = (http: jest.Mock) => new LinkUpClient({ credentials: creds, http }).login()
  const redirect = ok({ status: 0, data: { redirect: true, region: 'fr' } })

  it('gives up after two regional redirects', async () => {
    const http = jest.fn().mockResolvedValue(redirect)
    await expect(login(http)).rejects.toMatchObject({
      kind: 'protocol',
      message: 'Too many regional redirects',
    })
    expect(http).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['no data', ok({ status: 0 })],
    ['no authTicket', ok({ status: 0, data: { user: { id: 'a' } } })],
    ['no token', ok({ status: 0, data: { user: { id: 'a' }, authTicket: {} } })],
    ['no user', ok({ status: 0, data: { authTicket: { token: 't' } } })],
    ['no account id', ok({ status: 0, data: { user: {}, authTicket: { token: 't' } } })],
  ])('rejects a response with %s', async (_n, res) => {
    await expect(login(jest.fn().mockResolvedValue(res))).rejects.toMatchObject({
      kind: 'protocol',
      message: 'Login response missing token',
    })
  })

  it('names the body status in the message', async () => {
    await expect(login(jest.fn().mockResolvedValue(ok({ status: 4 })))).rejects.toThrow('Login failed (status 4)')
  })

  it.each([
    ['a redirect flag without a region', { redirect: true }],
    ['a region without a redirect flag', { region: 'fr' }],
  ])('does not follow %s', async (_n, data) => {
    const http = jest.fn().mockResolvedValue(ok({ status: 0, data }))
    await expect(login(http)).rejects.toMatchObject({ message: 'Login response missing token' })
    expect(http).toHaveBeenCalledTimes(1)
  })

  it('reports status 999999 when the body has none', async () => {
    await expect(login(jest.fn().mockResolvedValue(ok(undefined)))).rejects.toMatchObject({
      kind: 'auth',
      status: 999999,
    })
  })

  it('falls back to the requested country when the user has none', async () => {
    const res = ok({ status: 0, data: { user: { id: 'a' }, authTicket: { token: 't' } } })
    expect((await login(jest.fn().mockResolvedValue(res))).country).toBe('global')
  })
})

describe('LinkUpClient response shapes', () => {
  const session = { token: 't1', accountId: 'acc-1', country: 'eu' }
  const client = (res: unknown) =>
    new LinkUpClient({ credentials: creds, session, http: jest.fn().mockResolvedValue(res) })

  it.each([[ok(undefined)], [ok({})], [ok({ data: null })]])('returns no connections for %j', async (res) => {
    expect(await client(res).getConnections()).toEqual([])
  })

  it.each([[ok(undefined)], [ok({})], [ok({ data: {} })]])('rejects a graph without a connection: %j', async (res) => {
    await expect(client(res).getGraph('a')).rejects.toMatchObject({
      kind: 'protocol',
      message: 'Graph response missing connection',
    })
  })

  it('defaults graphData to an empty list', async () => {
    const g = await client(ok({ data: { connection: { patientId: 'a' } } })).getGraph('a')
    expect(g.graphData).toEqual([])
    expect(g.glucoseMeasurement).toBeUndefined()
  })
})

describe('LinkUpClient error classification', () => {
  const session = { token: 't1', accountId: 'acc-1', country: 'eu' }
  const fail = (err: unknown) => {
    const http = jest.fn().mockRejectedValue(err)
    const p = new LinkUpClient({ credentials: creds, session, http }).getConnections()
    return { http, p }
  }

  it('does not log in again for other failures', async () => {
    const { http, p } = fail(httpError(429))
    await expect(p).rejects.toMatchObject({ kind: 'rate-limit', status: 429, message: 'Rate limited' })
    expect(http).toHaveBeenCalledTimes(1)
  })

  it('reports a 401 that survives the retry as an auth error', async () => {
    const { http, p } = fail(httpError(401))
    await expect(p).rejects.toMatchObject({ kind: 'auth', status: 401, message: 'Unauthorized' })
    expect(http).toHaveBeenCalledTimes(2)
  })

  it('maps an HTTP error status to a protocol error keeping the message', async () => {
    const { p } = fail(Object.assign(new Error('boom'), { response: { status: 500 } }))
    await expect(p).rejects.toMatchObject({ kind: 'protocol', status: 500, message: 'boom' })
  })

  it('maps a failure without a response to a network error', async () => {
    const { p } = fail(new Error('offline'))
    await expect(p).rejects.toMatchObject({ kind: 'network', status: undefined, message: 'offline' })
  })

  it('copes with a rejection that is not an error object', async () => {
    const { p } = fail(undefined)
    await expect(p).rejects.toMatchObject({ kind: 'network', message: 'Network error' })
  })
})
