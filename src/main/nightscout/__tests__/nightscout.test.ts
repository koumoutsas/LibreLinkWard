/** @jest-environment node */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createPatientStore } from '../../../shared/stores'
import { NightscoutClient } from '../client'
import { NightscoutConfigStore } from '../configStore'
import { hashSecret, toEntry } from '../payload'
import { NightscoutUploader } from '../uploader'

const point = (iso: string, value: number, trend = 3) => ({
  FactoryTimestamp: iso,
  Timestamp: iso,
  ValueInMgPerDl: value,
  TrendArrow: trend,
})

describe('payload', () => {
  it('hashes the secret with SHA1', () => {
    expect(hashSecret('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
  })

  it('maps a reading to an sgv entry', () => {
    const e = toEntry(point('2026-01-02T03:04:05Z', 110.4, 5), 'dev')
    expect(e).toEqual({
      type: 'sgv',
      sgv: 110,
      date: Date.parse('2026-01-02T03:04:05Z'),
      dateString: '2026-01-02T03:04:05.000Z',
      direction: 'SingleUp',
      device: 'dev',
    })
  })

  it('skips readings without usable time or value', () => {
    expect(toEntry({ Timestamp: 'nope', ValueInMgPerDl: 100 }, 'd')).toBeNull()
    expect(toEntry({ Timestamp: '2026-01-02T03:04:05Z', ValueInMgPerDl: NaN }, 'd')).toBeNull()
  })
})

describe('NightscoutClient', () => {
  it('sends the hashed secret and strips trailing slashes', async () => {
    const http = jest.fn().mockResolvedValue({ data: [] })
    await new NightscoutClient({ url: 'https://ns.test/', apiSecret: 's3cret' }, http).upload([
      toEntry(point('2026-01-02T03:04:05Z', 100), 'd')!,
    ])
    const cfg = http.mock.calls[0][0]
    expect(cfg.url).toBe('https://ns.test/api/v1/entries')
    expect(cfg.method).toBe('POST')
    expect(cfg.headers['api-secret']).toBe(hashSecret('s3cret'))
  })

  it('does not post an empty batch', async () => {
    const http = jest.fn()
    await new NightscoutClient({ url: 'https://ns.test', apiSecret: 'x' }, http).upload([])
    expect(http).not.toHaveBeenCalled()
  })

  it('reads the newest entry date', async () => {
    const http = jest.fn().mockResolvedValue({ data: [{ date: 123 }] })
    const c = new NightscoutClient({ url: 'https://ns.test', apiSecret: 'x' }, http)
    expect(await c.latestEntryDate()).toBe(123)
  })
})

describe('NightscoutConfigStore', () => {
  const safe = {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ''),
  }

  it('round-trips encrypted and refuses plaintext fallback', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ns-')), 'ns.bin')
    const cfg = { p1: { enabled: true, url: 'u', apiSecret: 's', deviceName: 'd' } }
    new NightscoutConfigStore(file, safe).save(cfg)
    expect(fs.readFileSync(file, 'utf8').startsWith('enc:')).toBe(true)
    expect(new NightscoutConfigStore(file, safe).load()).toEqual(cfg)
    expect(() =>
      new NightscoutConfigStore(file, { ...safe, isEncryptionAvailable: () => false }).save(cfg),
    ).toThrow()
  })
})

describe('NightscoutUploader', () => {
  const setup = (existing?: number) => {
    const patients = createPatientStore()
    patients.getState().applyConnections([{ patientId: 'p1', firstName: 'A' }])
    let clock = 1_000_000
    const posted: number[][] = []
    const client = {
      latestEntryDate: jest.fn().mockResolvedValue(existing),
      upload: jest.fn(async (e: { date: number }[]) => {
        posted.push(e.map((x) => x.date))
      }),
    }
    const uploader = new NightscoutUploader({
      patients,
      now: () => clock,
      baseBackoffMs: 1000,
      createClient: () => client as unknown as NightscoutClient,
    })
    uploader.setConfigs({
      p1: { enabled: true, url: 'https://ns.test', apiSecret: 's', deviceName: 'd' },
    })
    const feed = (...pts: ReturnType<typeof point>[]) =>
      patients.getState().applyGraph('p1', {
        connection: { patientId: 'p1' },
        graphData: pts,
      })
    return { uploader, client, posted, feed, advance: (ms: number) => (clock += ms) }
  }

  const t = (min: number) => new Date(Date.UTC(2026, 0, 1, 0, min)).toISOString()
  const d = (min: number) => Date.UTC(2026, 0, 1, 0, min)

  it('uploads only readings newer than what Nightscout has, then only new ones', async () => {
    const { uploader, posted, feed } = setup(d(5))
    feed(point(t(0), 100), point(t(5), 101), point(t(10), 102), point(t(15), 103))
    await uploader.sync()
    expect(posted).toEqual([[d(10), d(15)]])

    feed(point(t(15), 103), point(t(20), 104))
    await uploader.sync()
    expect(posted).toEqual([[d(10), d(15)], [d(20)]])
  })

  it('does nothing when disabled', async () => {
    const { uploader, client, feed } = setup()
    uploader.setConfigs({ p1: { enabled: false, url: 'u', apiSecret: 's', deviceName: 'd' } })
    feed(point(t(0), 100))
    await uploader.sync()
    expect(client.upload).not.toHaveBeenCalled()
  })

  it('retries failed uploads with backoff without losing readings', async () => {
    const { uploader, client, posted, feed, advance } = setup()
    client.upload.mockRejectedValueOnce(new Error('503'))
    feed(point(t(0), 100), point(t(5), 101))
    await uploader.sync()
    expect(uploader.getStatus('p1').lastError).toBe('503')

    await uploader.sync() // still backing off
    expect(client.upload).toHaveBeenCalledTimes(1)

    advance(1000)
    await uploader.sync()
    expect(posted).toEqual([[d(0), d(5)]])
    expect(uploader.getStatus('p1')).toEqual({ lastUploaded: d(5), lastError: undefined })
  })

  it('re-syncs from Nightscout when the target changes', async () => {
    const { uploader, client, feed } = setup()
    feed(point(t(0), 100))
    await uploader.sync()
    uploader.setConfigs({ p1: { enabled: true, url: 'https://other', apiSecret: 's', deviceName: 'd' } })
    await uploader.sync()
    expect(client.latestEntryDate).toHaveBeenCalledTimes(2)
  })
})
