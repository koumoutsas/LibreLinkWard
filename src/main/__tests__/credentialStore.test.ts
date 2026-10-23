/** @jest-environment node */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { CredentialStore, SafeStorageLike } from '../credentialStore'

const fakeSafe = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(s, 'utf8').reverse(),
  decryptString: (b) => Buffer.from(b).reverse().toString('utf8'),
})
const creds = { country: 'eu', username: 'nurse@example.com', password: 'secret-pw' }

describe('CredentialStore', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llw-'))
    file = path.join(dir, 'sub', 'credentials.bin')
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('round-trips and never writes the password in plaintext', () => {
    const store = new CredentialStore(file, fakeSafe())
    store.save(creds)
    expect(fs.readFileSync(file).toString()).not.toContain('secret-pw')
    expect(store.load()).toEqual(creds)
  })

  it('refuses to save when encryption is unavailable', () => {
    const store = new CredentialStore(file, fakeSafe(false))
    expect(() => store.save(creds)).toThrow(/not available/)
    expect(fs.existsSync(file)).toBe(false)
  })

  it('load returns null when missing, corrupt, or encryption unavailable', () => {
    expect(new CredentialStore(file, fakeSafe()).load()).toBeNull()
    new CredentialStore(file, fakeSafe()).save(creds)
    expect(new CredentialStore(file, fakeSafe(false)).load()).toBeNull()
    fs.writeFileSync(file, 'garbage')
    expect(new CredentialStore(file, fakeSafe()).load()).toBeNull()
  })

  it('clear removes the file', () => {
    const store = new CredentialStore(file, fakeSafe())
    store.save(creds)
    store.clear()
    expect(store.load()).toBeNull()
  })
})
