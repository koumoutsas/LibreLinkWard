import { PatientStore } from '../../shared/stores'
import { NightscoutClient, NightscoutTarget } from './client'
import { DEFAULT_DEVICE_NAME, NightscoutConfig, NightscoutConfigs } from './configStore'
import { NightscoutEntry, toEntry } from './payload'

export type UploadStatus = {
  /** Epoch ms of the newest entry known to be in Nightscout. */
  lastUploaded?: number
  lastError?: string
}

export type UploaderDeps = {
  patients: PatientStore
  createClient?: (target: NightscoutTarget) => NightscoutClient
  now?: () => number
  /** First retry delay; doubles per failure up to maxBackoffMs. */
  baseBackoffMs?: number
  maxBackoffMs?: number
  onStatus?: () => void
}

type PatientState = UploadStatus & {
  /** Config the watermark was derived from; a change forces a re-sync. */
  syncedWith?: string
  failures: number
  retryAt: number
  /** In-flight attempt; a request arriving meanwhile is run after it. */
  running?: Promise<void>
  rerun: boolean
}

/**
 * Pushes new readings of opted-in patients to their Nightscout site.
 * Failed uploads are retried from the same watermark, so nothing is lost
 * while the history window (12 h) still covers the outage.
 */
export class NightscoutUploader {
  private configs: NightscoutConfigs = {}
  private state = new Map<string, PatientState>()
  private unsubscribe?: () => void
  private readonly now: () => number
  private readonly createClient: (t: NightscoutTarget) => NightscoutClient

  constructor(private readonly deps: UploaderDeps) {
    this.now = deps.now ?? Date.now
    this.createClient = deps.createClient ?? ((t) => new NightscoutClient(t))
  }

  start(): void {
    this.unsubscribe = this.deps.patients.subscribe(() => void this.sync())
    void this.sync()
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }

  setConfigs(configs: NightscoutConfigs): void {
    this.configs = configs
    void this.sync()
  }

  getStatus(patientId: string): UploadStatus {
    const s = this.state.get(patientId)
    return { lastUploaded: s?.lastUploaded, lastError: s?.lastError }
  }

  /** Resolves when every enabled patient has been attempted (for tests). */
  async sync(): Promise<void> {
    await Promise.all(Object.keys(this.configs).map((id) => this.syncPatient(id)))
  }

  private async syncPatient(patientId: string): Promise<void> {
    const config = this.configs[patientId]
    const patient = this.deps.patients.getState().patients[patientId]
    if (!config?.enabled || !config.url || !patient) return

    const st = this.stateFor(patientId)
    if (st.running) {
      st.rerun = true
      return st.running
    }
    if (this.now() < st.retryAt) return
    st.running = this.attempt(patientId, config, st).finally(() => {
      st.running = undefined
      if (st.rerun) {
        st.rerun = false
        void this.syncPatient(patientId)
      }
    })
    return st.running
  }

  private async attempt(
    patientId: string,
    config: NightscoutConfig,
    st: PatientState,
  ): Promise<void> {
    try {
      const client = this.createClient({ url: config.url, apiSecret: config.apiSecret })
      const signature = JSON.stringify([config.url, config.apiSecret])
      if (st.syncedWith !== signature) {
        // Resume after whatever Nightscout already has: avoids duplicates after restarts.
        st.lastUploaded = await client.latestEntryDate()
        st.syncedWith = signature
      }
      const device = config.deviceName || DEFAULT_DEVICE_NAME
      // The user may have disabled or retargeted it while we were waiting.
      if (!this.configs[patientId]?.enabled) return
      // Read at upload time so readings that arrived during the lookup are included.
      const history = this.deps.patients.getState().patients[patientId]?.history ?? []
      const entries = history
        .map((p) => toEntry(p, device))
        .filter((e): e is NightscoutEntry => !!e && e.date > (st.lastUploaded ?? 0))
        .sort((a, b) => a.date - b.date)
      if (entries.length > 0) {
        await client.upload(entries)
        st.lastUploaded = entries[entries.length - 1].date
      }
      st.failures = 0
      st.retryAt = 0
      st.lastError = undefined
    } catch (e) {
      st.failures += 1
      const base = this.deps.baseBackoffMs ?? 30_000
      const max = this.deps.maxBackoffMs ?? 15 * 60_000
      st.retryAt = this.now() + Math.min(max, base * 2 ** (st.failures - 1))
      st.lastError = e instanceof Error ? e.message : String(e)
    } finally {
      this.deps.onStatus?.()
    }
  }

  private stateFor(patientId: string): PatientState {
    let s = this.state.get(patientId)
    if (!s) {
      s = { failures: 0, retryAt: 0, rerun: false }
      this.state.set(patientId, s)
    }
    return s
  }
}
