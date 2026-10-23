import axios, { AxiosRequestConfig, AxiosResponse } from 'axios'
import { NightscoutEntry, hashSecret } from './payload'

export type HttpFn = (config: AxiosRequestConfig) => Promise<AxiosResponse>

export type NightscoutTarget = {
  url: string
  apiSecret: string
}

/** Minimal Nightscout API v1 client (entries only). */
export class NightscoutClient {
  private readonly http: HttpFn

  constructor(
    private readonly target: NightscoutTarget,
    http?: HttpFn,
  ) {
    this.http = http ?? ((c) => axios({ timeout: 15000, ...c }))
  }

  private request(config: AxiosRequestConfig): Promise<AxiosResponse> {
    const base = this.target.url.replace(/\/+$/, '')
    return this.http({
      ...config,
      url: `${base}${config.url}`,
      headers: {
        'api-secret': hashSecret(this.target.apiSecret),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    })
  }

  /** Throws with a readable message when the site is unreachable or the secret is wrong. */
  async testConnection(): Promise<void> {
    // /status is public; /entries needs the secret for write-protected sites, and
    // an authorization check is the only way to catch a wrong secret.
    await this.request({ method: 'GET', url: '/api/v1/status.json' })
    await this.request({ method: 'GET', url: '/api/v1/verifyauth' })
  }

  /** Epoch ms of the newest stored entry, or undefined if there are none. */
  async latestEntryDate(): Promise<number | undefined> {
    const res = await this.request({ method: 'GET', url: '/api/v1/entries.json?count=1' })
    const date = Array.isArray(res.data) ? res.data[0]?.date : undefined
    return typeof date === 'number' ? date : undefined
  }

  async upload(entries: NightscoutEntry[]): Promise<void> {
    if (entries.length === 0) return
    await this.request({ method: 'POST', url: '/api/v1/entries', data: entries })
  }
}
