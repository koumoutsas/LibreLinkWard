import fs from 'fs'
import path from 'path'
import { Credentials } from '../shared/linkup'

/** The subset of Electron's safeStorage we use; injectable for tests. */
export interface SafeStorageLike {
  isAvailable(): Promise<boolean>
  encrypt(plain: string): Promise<Buffer>
  decrypt(encrypted: Buffer): Promise<string>
}

/** Adapts Electron's safeStorage (async API) to SafeStorageLike. */
export const toSafeStorage = (s: {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptStringAsync(plain: string): Promise<Buffer>
  decryptStringAsync(encrypted: Buffer): Promise<{ result: string }>
}): SafeStorageLike => ({
  isAvailable: () => s.isAsyncEncryptionAvailable(),
  encrypt: (plain) => s.encryptStringAsync(plain),
  decrypt: async (encrypted) => (await s.decryptStringAsync(encrypted)).result,
})

/** One LibreLinkUp login. Each login is one view in the UI. */
export type LinkUpAccount = Credentials & { id: string; kind?: 'linkup' }

/** A Nightscout site read as a reading source; one patient per site. */
export type NightscoutAccount = {
  id: string
  kind: 'nightscout'
  url: string
  /** Empty for sites that allow public reads. */
  apiSecret: string
  /** Shown as the patient's name. */
  name: string
}

export type StoredAccount = LinkUpAccount | NightscoutAccount

/** Id for a stored login without one (older files): the lower-cased username. */
const legacyId = (username: string) => username.trim().toLowerCase()

const valid = (a: any): a is StoredAccount =>
  a?.kind === 'nightscout' ? !!a.url : !!(a?.username && a?.password && a?.country)

/**
 * LibreLinkUp credentials (any number of logins) encrypted with the OS
 * keychain (safeStorage). Refuses to write when encryption is unavailable
 * instead of falling back to plaintext.
 */
export class CredentialStore {
  constructor(
    private readonly file: string,
    private readonly safe: SafeStorageLike,
  ) {}

  async saveAll(accounts: StoredAccount[]): Promise<void> {
    if (!(await this.safe.isAvailable())) {
      throw new Error('Secure credential storage is not available on this system')
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, await this.safe.encrypt(JSON.stringify(accounts)), {
      mode: 0o600,
    })
  }

  /** Empty when nothing is stored. Reads the older single-login format too. */
  async loadAll(): Promise<StoredAccount[]> {
    try {
      if (!fs.existsSync(this.file) || !(await this.safe.isAvailable())) return []
      const parsed = JSON.parse(await this.safe.decrypt(fs.readFileSync(this.file)))
      const list: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
      return list
        .filter(valid)
        .map((a) => ({ ...a, id: a.id || legacyId((a as Credentials).username) }) as StoredAccount)
    } catch (err) {
      console.error('Could not read stored credentials:', err)
      return []
    }
  }

  clear(): void {
    fs.rmSync(this.file, { force: true })
  }
}
