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

  async load(): Promise<NightscoutConfigs> {
    try {
      if (!fs.existsSync(this.file) || !(await this.safe.isAvailable())) return {}
      return JSON.parse(await this.safe.decrypt(fs.readFileSync(this.file)))
    } catch {
      return {}
    }
  }

  async save(configs: NightscoutConfigs): Promise<void> {
    if (!(await this.safe.isAvailable())) {
      throw new Error('Secure storage is not available on this system')
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, await this.safe.encrypt(JSON.stringify(configs)), {
      mode: 0o600,
    })
  }
}
