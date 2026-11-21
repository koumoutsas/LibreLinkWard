import fs from 'fs'
import path from 'path'
import type { SafeStorageLike } from '../credentialStore'
import type { RecordingTarget } from './blob'

export type RecordingConfig = {
  target: RecordingTarget
  /** Off until the operator turns it on. */
  enabled: boolean
  /** Epoch ms recording was last turned on; nothing older is ever sent. */
  enabledAt?: number
}

/** Keyed by view key (`<loginId>~<patientId>`). */
export type RecordingConfigs = Record<string, RecordingConfig>

/**
 * Per-patient recording settings, encrypted with safeStorage because they
 * contain AWS keys. Refuses to write plaintext.
 */
export class RecordingConfigStore {
  constructor(
    private readonly file: string,
    private readonly safe: SafeStorageLike,
  ) {}

  async load(): Promise<RecordingConfigs> {
    try {
      if (!fs.existsSync(this.file) || !(await this.safe.isAvailable())) return {}
      return JSON.parse(await this.safe.decrypt(fs.readFileSync(this.file)))
    } catch {
      return {}
    }
  }

  async save(configs: RecordingConfigs): Promise<void> {
    if (!(await this.safe.isAvailable())) {
      throw new Error('Secure storage is not available on this system')
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, await this.safe.encrypt(JSON.stringify(configs)), { mode: 0o600 })
  }
}
