import { PatientStore, pointTime } from '../../shared/stores'
import { readJson, writeJson } from '../persistence'
import type { RecordingTarget } from './blob'
import type { RecordingConfigs } from './configStore'
import { FirehosePublisher, Publisher, ReadingRecord, RecordingAuthError } from './publisher'

export type RecordingStatus = {
  /** Epoch ms of the last successful send. */
  lastSent?: number
  /** Records waiting to be sent (offline, errors, backoff). */
  queued: number
  lastError?: string
  /** Stopped because the key or stream was rejected; a new config restarts it. */
  halted?: boolean
}

/** What survives restarts, per view key. */
type Persisted = {
  /** Newest reading time already queued; only newer readings are recorded. */
  watermark: number
  /** The enabledAt the watermark belongs to; a newer one restarts from scratch. */
  enabledAt: number
  outbox: ReadingRecord[]
}

export type RecorderDeps = {
  patients: PatientStore
  /** Resolves a view key to its sid; undefined when the login is gone. */
  sidOf: (viewKey: string) => string | undefined
  /** JSON file holding watermarks and unsent records. */
  stateFile: string
  appVersion: string
  createPublisher?: (target: RecordingTarget) => Publisher
  now?: () => number
  baseBackoffMs?: number
  maxBackoffMs?: number
  /** Per patient; the oldest queued records are dropped beyond it. */
  maxQueue?: number
  onStatus?: () => void
}

type Runtime = {
  failures: number
  retryAt: number
  lastSent?: number
  lastError?: string
  halted?: boolean
  /** Target the runtime state belongs to; a new one clears the halt. */
  signature?: string
  running?: Promise<void>
  rerun: boolean
}

/** About a month of per-minute readings. */
const DEFAULT_MAX_QUEUE = 50_000

/**
 * Sends new readings of opted-in patients to their deployment's Firehose
 * stream. Each install dedupes its own records with a per-patient watermark;
 * duplicates across installs are folded by the table's upsert on (sid, t, origin).
 * Records that cannot be sent wait in a persisted outbox.
 */
export class Recorder {
  private configs: RecordingConfigs = {}
  private persisted: Record<string, Persisted>
  private runtime = new Map<string, Runtime>()
  private unsubscribe?: () => void
  private readonly now: () => number
  private readonly createPublisher: (t: RecordingTarget) => Publisher

  constructor(private readonly deps: RecorderDeps) {
    this.now = deps.now ?? Date.now
    this.createPublisher = deps.createPublisher ?? ((t) => new FirehosePublisher(t))
    this.persisted = readJson(deps.stateFile, {})
  }

  start(): void {
    this.unsubscribe = this.deps.patients.subscribe(() => void this.sync())
    void this.sync()
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }

  /**
   * Applies new settings. Patients that are no longer enabled lose their
   * queue and watermark: switching recording off must not leak the off period.
   */
  setConfigs(configs: RecordingConfigs): void {
    this.configs = configs
    let changed = false
    for (const key of Object.keys(this.persisted)) {
      if (!configs[key]?.enabled) {
        delete this.persisted[key]
        this.runtime.delete(key)
        changed = true
      }
    }
    for (const [key, c] of Object.entries(configs)) {
      if (!c.enabled) continue
      const p = this.persisted[key]
      const enabledAt = c.enabledAt ?? p?.enabledAt ?? this.now()
      if (!p || p.enabledAt !== enabledAt) {
        this.persisted[key] = { watermark: enabledAt, enabledAt, outbox: [] }
        changed = true
      }
    }
    if (changed) this.save()
    void this.sync()
  }

  getStatus(viewKey: string): RecordingStatus {
    const r = this.runtime.get(viewKey)
    return {
      lastSent: r?.lastSent,
      queued: this.persisted[viewKey]?.outbox.length ?? 0,
      lastError: r?.lastError,
      halted: r?.halted,
    }
  }

  /** Per enabled patient: recording normally, or with a problem (for the dashboard). */
  summary(): Record<string, 'on' | 'problem'> {
    return Object.fromEntries(
      Object.entries(this.configs)
        .filter(([, c]) => c.enabled)
        .map(([key]) => [key, this.runtime.get(key)?.lastError ? 'problem' : 'on']),
    )
  }

  /** Resolves when every enabled patient has been attempted (for tests). */
  async sync(): Promise<void> {
    await Promise.all(Object.keys(this.configs).map((key) => this.syncPatient(key)))
  }

  private async syncPatient(key: string): Promise<void> {
    if (!this.configs[key]?.enabled) return
    const rt = this.runtimeFor(key)
    if (rt.running) {
      rt.rerun = true
      return rt.running
    }
    rt.running = this.attempt(key, rt).finally(() => {
      rt.running = undefined
      if (rt.rerun) {
        rt.rerun = false
        void this.syncPatient(key)
      }
    })
    return rt.running
  }

  private async attempt(key: string, rt: Runtime): Promise<void> {
    const config = this.configs[key]
    const p = this.persisted[key]
    if (!config?.enabled || !p) return
    const signature = JSON.stringify(config.target)
    if (rt.signature !== signature) {
      Object.assign(rt, { signature, halted: false, failures: 0, retryAt: 0, lastError: undefined })
    }
    const sid = this.deps.sidOf(key)
    if (sid !== config.target.sid) {
      rt.lastError = `This patient's id is ${sid ?? 'unknown'}, the config is for ${config.target.sid}`
      this.deps.onStatus?.()
      return
    }

    this.enqueue(key, p, config.target)
    if (rt.halted || this.now() < rt.retryAt || p.outbox.length === 0) {
      this.deps.onStatus?.()
      return
    }

    const sending = p.outbox
    try {
      const failed = await this.createPublisher(config.target).send(sending)
      // Turned off, or turned off and on again, while sending: that queue is gone.
      if (this.persisted[key] !== p) return
      const sent = new Set(sending)
      p.outbox = [...failed, ...p.outbox.filter((r) => !sent.has(r))]
      this.save()
      if (failed.length) throw new Error(`Firehose rejected ${failed.length} record(s); will retry`)
      rt.lastSent = this.now()
      rt.failures = 0
      rt.retryAt = 0
      rt.lastError = undefined
    } catch (e) {
      rt.lastError = e instanceof Error ? e.message : String(e)
      if (e instanceof RecordingAuthError) {
        rt.halted = true
      } else {
        rt.failures += 1
        const base = this.deps.baseBackoffMs ?? 30_000
        const max = this.deps.maxBackoffMs ?? 15 * 60_000
        rt.retryAt = this.now() + Math.min(max, base * 2 ** (rt.failures - 1))
      }
    } finally {
      this.deps.onStatus?.()
    }
  }

  /** Queues readings newer than the watermark and advances it. */
  private enqueue(key: string, p: Persisted, target: RecordingTarget): void {
    const patient = this.deps.patients.getState().patients[key]
    if (!patient) return
    const latestT = patient.latest ? pointTime(patient.latest) : NaN
    const now = this.now()
    const fresh: ReadingRecord[] = []
    for (const point of patient.history) {
      const t = pointTime(point)
      const mgdl = Math.round(point.ValueInMgPerDl)
      if (!(t > p.watermark) || !Number.isFinite(mgdl) || mgdl <= 0) continue
      fresh.push({
        sid: target.sid,
        t,
        origin: t === latestT ? 'latest' : 'graph',
        mgdl,
        trend: typeof point.TrendArrow === 'number' ? point.TrendArrow : null,
        install: target.install,
        received_at: now,
        app_version: this.deps.appVersion,
        schema_version: 1,
      })
    }
    if (fresh.length === 0) return
    p.watermark = Math.max(...fresh.map((r) => r.t))
    p.outbox.push(...fresh)
    const max = this.deps.maxQueue ?? DEFAULT_MAX_QUEUE
    if (p.outbox.length > max) {
      const dropped = p.outbox.length - max
      p.outbox = p.outbox.slice(dropped)
      console.warn(`Recording queue for ${key} is full; dropped the ${dropped} oldest record(s)`)
    }
    this.save()
  }

  private save(): void {
    try {
      writeJson(this.deps.stateFile, this.persisted)
    } catch (e) {
      console.error('Could not save the recording queue:', e)
    }
  }

  private runtimeFor(key: string): Runtime {
    let r = this.runtime.get(key)
    if (!r) {
      r = { failures: 0, retryAt: 0, rerun: false }
      this.runtime.set(key, r)
    }
    return r
  }
}
