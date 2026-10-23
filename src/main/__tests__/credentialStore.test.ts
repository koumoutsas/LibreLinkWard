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

  it('round-trips several logins and never writes a password in plaintext', () => {
    const store = new CredentialStore(file, fakeSafe())
    const second = { country: 'us', username: 'Pat@Example.com', password: 'other-pw', id: 'pat@example.com' }
    store.saveAll([{ ...creds, id: 'nurse@example.com' }, second])
    const raw = fs.readFileSync(file).toString()
    expect(raw).not.toContain('secret-pw')
    expect(raw).not.toContain('other-pw')
    expect(store.loadAll()).toEqual([{ ...creds, id: 'nurse@example.com' }, second])
  })

  it('reads the older single-login file format', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, fakeSafe().encryptString(JSON.stringify(creds)))
    expect(new CredentialStore(file, fakeSafe()).loadAll()).toEqual([{ ...creds, id: 'nurse@example.com' }])
  })

  it('refuses to save when encryption is unavailable', () => {
    const store = new CredentialStore(file, fakeSafe(false))
    expect(() => store.saveAll([{ ...creds, id: 'x' }])).toThrow(/not available/)
    expect(fs.existsSync(file)).toBe(false)
  })

  it('loadAll returns [] when missing, corrupt, or encryption unavailable', () => {
    expect(new CredentialStore(file, fakeSafe()).loadAll()).toEqual([])
    new CredentialStore(file, fakeSafe()).saveAll([{ ...creds, id: 'x' }])
    expect(new CredentialStore(file, fakeSafe(false)).loadAll()).toEqual([])
    fs.writeFileSync(file, 'garbage')
    expect(new CredentialStore(file, fakeSafe()).loadAll()).toEqual([])
  })

  it('drops incomplete entries', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, fakeSafe().encryptString(JSON.stringify([creds, { username: 'x' }])))
    expect(new CredentialStore(file, fakeSafe()).loadAll()).toHaveLength(1)
  })

  it('clear removes the file', () => {
    const store = new CredentialStore(file, fakeSafe())
    store.saveAll([{ ...creds, id: 'x' }])
    store.clear()
    expect(store.loadAll()).toEqual([])
  })
})
