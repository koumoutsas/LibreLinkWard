import fs from 'fs'
import path from 'path'
import { Credentials } from '../shared/linkup'

/** The subset of Electron's safeStorage we use; injectable for tests. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

/**
 * LibreLinkUp credentials encrypted with the OS keychain (safeStorage).
 * Refuses to write when encryption is unavailable instead of falling back
 * to plaintext.
 */
export class CredentialStore {
  constructor(
    private readonly file: string,
    private readonly safe: SafeStorageLike,
  ) {}

  save(credentials: Credentials): void {
    if (!this.safe.isEncryptionAvailable()) {
      throw new Error('Secure credential storage is not available on this system')
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, this.safe.encryptString(JSON.stringify(credentials)), {
      mode: 0o600,
    })
  }

  load(): Credentials | null {
    try {
      if (!fs.existsSync(this.file) || !this.safe.isEncryptionAvailable()) return null
      const parsed = JSON.parse(this.safe.decryptString(fs.readFileSync(this.file)))
      return parsed?.username && parsed?.password && parsed?.country ? parsed : null
    } catch {
      return null
    }
  }

  clear(): void {
    fs.rmSync(this.file, { force: true })
  }
}
