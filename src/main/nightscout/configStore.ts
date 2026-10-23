import fs from 'fs'
import path from 'path'
import type { SafeStorageLike } from '../credentialStore'

export type NightscoutConfig = {
  enabled: boolean
  url: string
  apiSecret: string
  deviceName: string
}

export const DEFAULT_DEVICE_NAME = 'LibreLinkWard'

export type NightscoutConfigs = Record<string, NightscoutConfig>

/**
 * Per-patient Nightscout settings, encrypted with safeStorage because they
 * contain API secrets. Refuses to write plaintext.
 */
export class NightscoutConfigStore {
  constructor(
    private readonly file: string,
    private readonly safe: SafeStorageLike,
  ) {}

  load(): NightscoutConfigs {
    try {
      if (!fs.existsSync(this.file) || !this.safe.isEncryptionAvailable()) return {}
      return JSON.parse(this.safe.decryptString(fs.readFileSync(this.file)))
    } catch {
      return {}
    }
  }

  save(configs: NightscoutConfigs): void {
    if (!this.safe.isEncryptionAvailable()) {
      throw new Error('Secure storage is not available on this system')
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, this.safe.encryptString(JSON.stringify(configs)), {
      mode: 0o600,
    })
  }
}
