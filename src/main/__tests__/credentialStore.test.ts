/** @jest-environment node */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { CredentialStore, SafeStorageLike } from '../credentialStore'

const fakeSafe = (available = true): SafeStorageLike => ({
  isAvailable: async () => available,
  encrypt: async (s) => Buffer.from(s, 'utf8').reverse(),
  decrypt: async (b) => Buffer.from(b).reverse().toString('utf8'),
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

  it('round-trips several logins and never writes a password in plaintext', async () => {
    const store = new CredentialStore(file, fakeSafe())
    const second = { country: 'us', username: 'Pat@Example.com', password: 'other-pw', id: 'uuid-2' }
    await store.saveAll([{ ...creds, id: 'uuid-1' }, second])
    const raw = fs.readFileSync(file).toString()
    expect(raw).not.toContain('secret-pw')
    expect(raw).not.toContain('other-pw')
    expect(await store.loadAll()).toEqual([{ ...creds, id: 'uuid-1' }, second])
  })

  it('reads the older single-login file format', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, await fakeSafe().encrypt(JSON.stringify(creds)))
    expect(await new CredentialStore(file, fakeSafe()).loadAll()).toEqual([{ ...creds, id: 'nurse@example.com' }])
  })

  it('refuses to save when encryption is unavailable', async () => {
    const store = new CredentialStore(file, fakeSafe(false))
    await expect(store.saveAll([{ ...creds, id: 'x' }])).rejects.toThrow(/not available/)
    expect(fs.existsSync(file)).toBe(false)
  })

  it('loadAll returns [] when missing, corrupt, or encryption unavailable', async () => {
    expect(await new CredentialStore(file, fakeSafe()).loadAll()).toEqual([])
    await new CredentialStore(file, fakeSafe()).saveAll([{ ...creds, id: 'x' }])
    expect(await new CredentialStore(file, fakeSafe(false)).loadAll()).toEqual([])
    fs.writeFileSync(file, 'garbage')
    expect(await new CredentialStore(file, fakeSafe()).loadAll()).toEqual([])
  })

  it('drops incomplete entries', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, await fakeSafe().encrypt(JSON.stringify([creds, { username: 'x' }])))
    expect(await new CredentialStore(file, fakeSafe()).loadAll()).toHaveLength(1)
  })

  it('clear removes the file', async () => {
    const store = new CredentialStore(file, fakeSafe())
    await store.saveAll([{ ...creds, id: 'x' }])
    store.clear()
    expect(await store.loadAll()).toEqual([])
  })
})
