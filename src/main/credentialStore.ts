import fs from 'fs'
import path from 'path'
import { Credentials } from '../shared/linkup'

/** The subset of Electron's safeStorage we use; injectable for tests. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

/** One LibreLinkUp login. Each login is one view in the UI. */
export type StoredAccount = Credentials & { id: string }

/** Stable id for a login: the lower-cased username. */
export const accountIdFor = (username: string) => username.trim().toLowerCase()

const valid = (a: any): a is Credentials => !!(a?.username && a?.password && a?.country)

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

  saveAll(accounts: StoredAccount[]): void {
    if (!this.safe.isEncryptionAvailable()) {
      throw new Error('Secure credential storage is not available on this system')
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, this.safe.encryptString(JSON.stringify(accounts)), {
      mode: 0o600,
    })
  }

  /** Empty when nothing is stored. Reads the older single-login format too. */
  loadAll(): StoredAccount[] {
    try {
      if (!fs.existsSync(this.file) || !this.safe.isEncryptionAvailable()) return []
      const parsed = JSON.parse(this.safe.decryptString(fs.readFileSync(this.file)))
      const list: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
      return list.filter(valid).map((a) => ({ ...a, id: accountIdFor(a.username) }))
    } catch {
      return []
    }
  }

  clear(): void {
    fs.rmSync(this.file, { force: true })
  }
}
