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
        // Public sites need no secret; a wrong one is rejected even for reads.
        ...(this.target.apiSecret ? { 'api-secret': hashSecret(this.target.apiSecret) } : {}),
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
    if (this.target.apiSecret) await this.request({ method: 'GET', url: '/api/v1/verifyauth' })
  }

  /** The site's target range in mg/dL (Nightscout normalizes its thresholds to mg/dL). */
  async targetRange(): Promise<{ low?: number; high?: number }> {
    const res = await this.request({ method: 'GET', url: '/api/v1/status.json' })
    const t = res.data?.settings?.thresholds
    const low = Number(t?.bgTargetBottom)
    const high = Number(t?.bgTargetTop)
    return {
      low: Number.isFinite(low) && low > 0 ? low : undefined,
      high: Number.isFinite(high) && high > 0 ? high : undefined,
    }
  }

  /** Raw sgv entries from `sinceMs` on, newest first. */
  async entriesSince(sinceMs: number, count = 300): Promise<unknown[]> {
    const res = await this.request({
      method: 'GET',
      url: `/api/v1/entries/sgv.json?count=${count}&find[date][$gte]=${Math.floor(sinceMs)}`,
    })
    return Array.isArray(res.data) ? res.data : []
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
