import axios, { AxiosRequestConfig, AxiosResponse } from 'axios'
import {
  Connection,
  Credentials,
  GlucoseMeasurement,
  GraphResult,
  LinkUpError,
  Session,
} from './types'
import { normaliseMeasurement } from './timestamps'

export type HttpFn = (config: AxiosRequestConfig) => Promise<AxiosResponse>

export type ClientOptions = {
  credentials: Credentials
  /** Resume an existing session instead of logging in on first call. */
  session?: Session
  http?: HttpFn
}

const HEADERS = {
  product: 'llu.android',
  version: '4.16.0',
  Pragma: 'no-cache',
  'Cache-Control': 'no-cache',
}

export const getBaseUrl = (country: string): string =>
  country === 'global'
    ? 'https://api.libreview.io/llu'
    : `https://api-${country}.libreview.io/llu`

const normaliseCountry = (c: string): string => {
  const lower = c.toLowerCase()
  return lower === 'ch' ? 'eu' : lower
}

// WebCrypto: shared by the renderer and main, so no node:crypto or extra dependency.
const hash256 = async (s: string): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export class LinkUpClient {
  private session?: Session
  private readonly http: HttpFn
  private readonly credentials: Credentials

  constructor(opts: ClientOptions) {
    this.credentials = opts.credentials
    this.session = opts.session
    this.http = opts.http ?? ((c) => axios(c))
  }

  getSession(): Session | undefined {
    return this.session
  }

  /** Logs in, following the regional redirect if the server asks for one. */
  async login(): Promise<Session> {
    const { username, password } = this.credentials
    let country = this.credentials.country
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.request({
        method: 'post',
        baseURL: getBaseUrl(country),
        url: '/auth/login',
        data: { email: username, password },
        headers: HEADERS,
      })
      const body = res.data
      if (body?.status !== 0) {
        throw new LinkUpError(
          `Login failed (status ${body?.status})`,
          'auth',
          body?.status ?? 999999,
        )
      }
      if (body.data?.redirect && body.data?.region) {
        country = normaliseCountry(body.data.region)
        continue
      }
      const token = body.data?.authTicket?.token
      const accountId = body.data?.user?.id
      if (!token || !accountId) {
        throw new LinkUpError('Login response missing token', 'protocol')
      }
      this.session = {
        token,
        accountId,
        country: normaliseCountry(body.data.user.country ?? country),
      }
      return this.session
    }
    throw new LinkUpError('Too many regional redirects', 'protocol')
  }

  async getConnections(): Promise<Connection[]> {
    const res = await this.authed('/connections')
    const connections: Connection[] = res.data?.data ?? []
    return connections.map((c) => ({ ...c, glucoseMeasurement: normaliseMeasurement(c.glucoseMeasurement) }))
  }

  async getGraph(patientId: string): Promise<GraphResult> {
    const res = await this.authed(`/connections/${patientId}/graph`)
    const data = res.data?.data
    if (!data?.connection) {
      throw new LinkUpError('Graph response missing connection', 'protocol')
    }
    return {
      connection: data.connection,
      graphData: ((data.graphData ?? []) as GlucoseMeasurement[]).map(normaliseMeasurement),
      glucoseMeasurement: normaliseMeasurement(data.connection.glucoseMeasurement),
    }
  }

  /** GET with bearer auth; on 401 logs in again and retries once. */
  private async authed(url: string): Promise<AxiosResponse> {
    if (!this.session) await this.login()
    try {
      return await this.get(url)
    } catch (e) {
      if (e instanceof LinkUpError && e.status === 401) {
        await this.login()
        return this.get(url)
      }
      throw e
    }
  }

  private async get(url: string): Promise<AxiosResponse> {
    const s = this.session!
    return this.request({
      method: 'get',
      baseURL: getBaseUrl(s.country),
      url,
      headers: {
        ...HEADERS,
        Authorization: `Bearer ${s.token}`,
        'Account-Id': await hash256(s.accountId),
      },
    })
  }

  private async request(config: AxiosRequestConfig): Promise<AxiosResponse> {
    try {
      return await this.http(config)
    } catch (e: any) {
      const status: number | undefined = e?.response?.status
      if (status === 429) throw new LinkUpError('Rate limited', 'rate-limit', status)
      if (status === 401) throw new LinkUpError('Unauthorized', 'auth', status)
      throw new LinkUpError(
        e?.message ?? 'Network error',
        status ? 'protocol' : 'network',
        status,
      )
    }
  }
}
