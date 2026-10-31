import http from 'http'
import { AddressInfo } from 'net'
import { AxiosRequestConfig } from 'axios'
import axios from 'axios'
import { hashSecret } from '../../main/nightscout/payload'

type Handler = (req: http.IncomingMessage, body: string) => { status: number; body?: unknown }

const listen = (handler: Handler): Promise<{ server: http.Server; url: string }> =>
  new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        const out = handler(req, raw)
        res.writeHead(out.status, { 'Content-Type': 'application/json' })
        res.end(out.body === undefined ? '' : JSON.stringify(out.body))
      })
    })
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }),
    )
  })

const close = (server: http.Server) => new Promise<void>((r) => server.close(() => r()))

export type MockPatient = {
  patientId: string
  firstName: string
  lastName?: string
  targetLow?: number
  targetHigh?: number
  /** Newest last. */
  readings: Array<{ iso: string; value: number; trend?: number }>
}

const toPoint = (r: MockPatient['readings'][number]) => ({
  FactoryTimestamp: r.iso,
  Timestamp: r.iso,
  ValueInMgPerDl: r.value,
  Value: r.value,
  TrendArrow: r.trend ?? 3,
})

/** Fake LibreLinkUp API: login, connections, graph. Mutate `patients` between ticks. */
export async function startMockLibreLinkUp() {
  const state = {
    patients: [] as MockPatient[],
    password: 'pw',
    token: 'token-1',
    /** Number of upcoming authed requests to answer with 401. */
    reject401: 0,
    requests: [] as Array<{ method?: string; url?: string; auth?: string }>,
  }
  const { server, url } = await listen((req, raw) => {
    state.requests.push({ method: req.method, url: req.url, auth: req.headers.authorization })
    if (req.url === '/llu/auth/login') {
      const { password } = JSON.parse(raw || '{}')
      if (password !== state.password) return { status: 200, body: { status: 2 } }
      return {
        status: 200,
        body: {
          status: 0,
          data: { authTicket: { token: state.token }, user: { id: 'user-1', country: 'DE' } },
        },
      }
    }
    if (req.headers.authorization !== `Bearer ${state.token}` || state.reject401 > 0) {
      if (state.reject401 > 0) state.reject401 -= 1
      return { status: 401 }
    }
    if (req.url === '/llu/connections') {
      return {
        status: 200,
        body: {
          status: 0,
          data: state.patients.map((p) => ({
            patientId: p.patientId,
            firstName: p.firstName,
            lastName: p.lastName ?? '',
            targetLow: p.targetLow ?? 70,
            targetHigh: p.targetHigh ?? 180,
            glucoseMeasurement: toPoint(p.readings[p.readings.length - 1]),
          })),
        },
      }
    }
    const m = /^\/llu\/connections\/([^/]+)\/graph$/.exec(req.url ?? '')
    const p = m && state.patients.find((x) => x.patientId === m[1])
    if (p) {
      const last = toPoint(p.readings[p.readings.length - 1])
      return {
        status: 200,
        body: {
          status: 0,
          data: {
            connection: {
              patientId: p.patientId,
              firstName: p.firstName,
              lastName: p.lastName ?? '',
              targetLow: p.targetLow ?? 70,
              targetHigh: p.targetHigh ?? 180,
              glucoseMeasurement: last,
            },
            graphData: p.readings.map(toPoint),
          },
        },
      }
    }
    return { status: 404 }
  })

  /** HttpFn for LinkUpClient that sends every request to the mock instead of libreview.io. */
  const httpFn = (config: AxiosRequestConfig) => {
    const path = new URL(config.baseURL ?? '').pathname
    return axios({ ...config, baseURL: `${url}${path}`, validateStatus: (s) => s >= 200 && s < 300 })
  }

  return { state, url, http: httpFn, stop: () => close(server) }
}

/** Fake Nightscout v1: entries + auth check. */
export async function startMockNightscout(secret = 'ns-secret') {
  const state = {
    entries: [] as Array<{ date: number; sgv: number; [k: string]: unknown }>,
    /** Number of upcoming POSTs to fail with 500. */
    failPosts: 0,
    posts: 0,
  }
  const { server, url } = await listen((req, raw) => {
    if (req.url === '/api/v1/status.json') return { status: 200, body: { status: 'ok' } }
    if (req.headers['api-secret'] !== hashSecret(secret)) return { status: 401 }
    if (req.url === '/api/v1/verifyauth') return { status: 200, body: { message: 'OK' } }
    if (req.url?.startsWith('/api/v1/entries/sgv.json') && req.method === 'GET') {
      const since = Number(/\[\$gte\]=(\d+)/.exec(req.url)?.[1] ?? 0)
      return { status: 200, body: state.entries.filter((e) => e.date >= since).sort((x, y) => y.date - x.date) }
    }
    if (req.url?.startsWith('/api/v1/entries.json') && req.method === 'GET') {
      const newest = [...state.entries].sort((a, b) => b.date - a.date).slice(0, 1)
      return { status: 200, body: newest }
    }
    if (req.url === '/api/v1/entries' && req.method === 'POST') {
      state.posts += 1
      if (state.failPosts > 0) {
        state.failPosts -= 1
        return { status: 500 }
      }
      state.entries.push(...JSON.parse(raw))
      return { status: 200, body: [] }
    }
    return { status: 404 }
  })
  return { state, url, secret, stop: () => close(server) }
}
