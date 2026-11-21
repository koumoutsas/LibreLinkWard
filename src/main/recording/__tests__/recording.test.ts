/** @jest-environment node */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { PutRecordBatchCommand } from '@aws-sdk/client-firehose'
import { createPatientStore, PatientStore } from '../../../shared/stores'
import { encodeBlob, parseBlob, RecordingTarget } from '../blob'
import { RecordingConfigs, RecordingConfigStore } from '../configStore'
import { FirehosePublisher, Publisher, ReadingRecord, RecordingAuthError } from '../publisher'
import { Recorder } from '../recorder'
import { sidFor } from '../sid'

const KEY = 'login1~p1'
const SID = 'linkup:p1'
const target: RecordingTarget = {
  region: 'eu-west-1',
  stream: 'llw-readings',
  accessKeyId: 'AKIA',
  secretAccessKey: 'secret',
  sid: SID,
  install: 'desk',
}
const T0 = Date.parse('2026-11-21T10:00:00Z')
const MIN = 60_000
const point = (t: number, mgdl: number, trend?: number) => {
  const iso = new Date(t).toISOString()
  return { FactoryTimestamp: iso, Timestamp: iso, ValueInMgPerDl: mgdl, TrendArrow: trend }
}

/** Feeds one poll: graph points plus a latest reading. */
const poll = (store: PatientStore, graph: number[], latest: number, now = latest) =>
  store.getState().applyGraph(
    KEY,
    {
      connection: { patientId: 'p1' },
      graphData: graph.map((t) => point(t, 100)),
      glucoseMeasurement: point(latest, 120, 3),
    },
    now,
  )

class FakePublisher implements Publisher {
  sent: ReadingRecord[] = []
  fail?: Error
  reject = 0
  async send(records: ReadingRecord[]) {
    if (this.fail) throw this.fail
    const rejected = records.slice(0, this.reject)
    this.reject = 0
    this.sent.push(...records.slice(rejected.length))
    return rejected
  }
  async test() {}
}

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rec-')), 'state.json')

const setup = (opts: { now?: () => number; stateFile?: string; publisher?: FakePublisher; maxQueue?: number } = {}) => {
  const store = createPatientStore()
  const publisher = opts.publisher ?? new FakePublisher()
  const stateFile = opts.stateFile ?? tmpFile()
  const recorder = new Recorder({
    patients: store,
    sidOf: (k) => (k === KEY ? SID : undefined),
    stateFile,
    appVersion: '9.9.9',
    createPublisher: () => publisher,
    now: opts.now ?? (() => T0 + 60 * MIN),
    baseBackoffMs: 0,
    maxQueue: opts.maxQueue,
  })
  return { store, publisher, recorder, stateFile }
}

const enabled = (enabledAt: number): RecordingConfigs => ({ [KEY]: { target, enabled: true, enabledAt } })

describe('sidFor', () => {
  it('uses the LibreLinkUp patient id', () => {
    expect(sidFor({ id: 'a', username: 'u', password: 'p', country: 'de' }, 'abc-1')).toBe('linkup:abc-1')
  })

  it('uses the lower-case host and path of a Nightscout site', () => {
    const ns = { id: 'a', kind: 'nightscout' as const, url: 'https://My.Site:8443/NS/', apiSecret: '', name: 'n' }
    expect(sidFor(ns, 'nightscout')).toBe('nightscout:my.site:8443/ns')
  })
})

describe('parseBlob', () => {
  it('round-trips a config issued for this patient', () => {
    expect(parseBlob(` ${encodeBlob(target)}\n`, SID)).toEqual(target)
  })

  it('rejects garbage, other versions, missing fields and other patients', () => {
    expect(() => parseBlob('not base64 json', SID)).toThrow('not a recording config')
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64')
    expect(() => parseBlob(enc({ ...target, v: 2 }), SID)).toThrow('version')
    expect(() => parseBlob(enc({ ...target, v: 1, stream: '' }), SID)).toThrow('"stream"')
    expect(() => parseBlob(encodeBlob({ ...target, sid: 'linkup:other' }), SID)).toThrow('linkup:other')
  })
})

describe('RecordingConfigStore', () => {
  const safe = {
    isAvailable: async () => true,
    encrypt: async (s: string) => Buffer.from(`enc:${s}`),
    decrypt: async (b: Buffer) => b.toString().replace(/^enc:/, ''),
  }

  it('round-trips encrypted and refuses plaintext', async () => {
    const file = tmpFile()
    const cfg = enabled(T0)
    await new RecordingConfigStore(file, safe).save(cfg)
    expect(fs.readFileSync(file, 'utf8').startsWith('enc:')).toBe(true)
    expect(await new RecordingConfigStore(file, safe).load()).toEqual(cfg)
    await expect(new RecordingConfigStore(file, { ...safe, isAvailable: async () => false }).save(cfg)).rejects.toThrow()
    expect(await new RecordingConfigStore(`${file}.missing`, safe).load()).toEqual({})
  })
})

describe('Recorder', () => {
  it('sends nothing until the patient is enabled', async () => {
    const { store, publisher, recorder } = setup()
    poll(store, [T0 + MIN], T0 + 2 * MIN)
    recorder.setConfigs({ [KEY]: { target, enabled: false } })
    await recorder.sync()
    expect(publisher.sent).toEqual([])
    expect(recorder.summary()).toEqual({})
  })

  it('sends only readings after enabledAt, labels origin, and never resends', async () => {
    const { store, publisher, recorder } = setup()
    poll(store, [T0 - 10 * MIN, T0 + MIN, T0 + 2 * MIN], T0 + 3 * MIN)
    recorder.setConfigs(enabled(T0))
    await recorder.sync()
    expect(publisher.sent.map((r) => [r.t - T0, r.origin])).toEqual([
      [MIN, 'graph'],
      [2 * MIN, 'graph'],
      [3 * MIN, 'latest'],
    ])
    expect(publisher.sent[2]).toMatchObject({
      sid: SID,
      mgdl: 120,
      trend: 3,
      install: 'desk',
      app_version: '9.9.9',
      schema_version: 1,
      received_at: T0 + 60 * MIN,
    })
    expect(publisher.sent[0].trend).toBeNull()

    poll(store, [T0 + 2 * MIN], T0 + 4 * MIN)
    await recorder.sync()
    expect(publisher.sent.map((r) => r.t - T0)).toEqual([MIN, 2 * MIN, 3 * MIN, 4 * MIN])
    expect(recorder.getStatus(KEY)).toMatchObject({ queued: 0, lastSent: T0 + 60 * MIN })
    expect(recorder.summary()).toEqual({ [KEY]: 'on' })
  })

  it('back-fills a gap from graph points', async () => {
    const { store, publisher, recorder } = setup()
    recorder.setConfigs(enabled(T0))
    poll(store, [], T0 + MIN)
    await recorder.sync()
    // Polls failed for a while; the next graph covers the gap.
    poll(store, [T0 + 5 * MIN, T0 + 10 * MIN], T0 + 15 * MIN)
    await recorder.sync()
    expect(publisher.sent.map((r) => [r.t - T0, r.origin])).toEqual([
      [MIN, 'latest'],
      [5 * MIN, 'graph'],
      [10 * MIN, 'graph'],
      [15 * MIN, 'latest'],
    ])
  })

  it('keeps failed records in a persisted outbox and sends them after a restart', async () => {
    const failing = new FakePublisher()
    failing.fail = new Error('offline')
    const first = setup({ publisher: failing })
    first.recorder.setConfigs(enabled(T0))
    poll(first.store, [], T0 + MIN)
    await first.recorder.sync()
    expect(first.recorder.getStatus(KEY)).toMatchObject({ queued: 1, lastError: 'offline' })
    expect(first.recorder.summary()).toEqual({ [KEY]: 'problem' })

    const second = setup({ stateFile: first.stateFile })
    second.recorder.setConfigs(enabled(T0))
    poll(second.store, [], T0 + 2 * MIN)
    await second.recorder.sync()
    expect(second.publisher.sent.map((r) => r.t - T0)).toEqual([MIN, 2 * MIN])
    expect(second.recorder.getStatus(KEY).queued).toBe(0)
  })

  it('retries records Firehose rejected individually', async () => {
    const { store, publisher, recorder } = setup()
    recorder.setConfigs(enabled(T0))
    publisher.reject = 1
    poll(store, [T0 + MIN], T0 + 2 * MIN)
    await recorder.sync()
    expect(publisher.sent.map((r) => r.t - T0)).toEqual([2 * MIN])
    expect(recorder.getStatus(KEY)).toMatchObject({ queued: 1, lastError: expect.stringContaining('rejected 1') })
    poll(store, [], T0 + 3 * MIN)
    await recorder.sync()
    expect(publisher.sent.map((r) => r.t - T0).sort((a, b) => a - b)).toEqual([MIN, 2 * MIN, 3 * MIN])
  })

  it('backs off after a failure', async () => {
    let now = T0 + 60 * MIN
    const publisher = new FakePublisher()
    const store = createPatientStore()
    const recorder = new Recorder({
      patients: store,
      sidOf: () => SID,
      stateFile: tmpFile(),
      appVersion: '1',
      createPublisher: () => publisher,
      now: () => now,
      baseBackoffMs: 60_000,
    })
    recorder.setConfigs(enabled(T0))
    publisher.fail = new Error('down')
    poll(store, [], T0 + MIN)
    await recorder.sync()
    publisher.fail = undefined
    poll(store, [], T0 + 2 * MIN)
    await recorder.sync()
    expect(publisher.sent).toEqual([])
    expect(recorder.getStatus(KEY).queued).toBe(2)
    now += 60_000
    await recorder.sync()
    expect(publisher.sent).toHaveLength(2)
  })

  it('stops on a rejected key until a new config arrives', async () => {
    const { store, publisher, recorder } = setup()
    recorder.setConfigs(enabled(T0))
    publisher.fail = new RecordingAuthError('AccessDeniedException: no')
    poll(store, [], T0 + MIN)
    await recorder.sync()
    publisher.fail = undefined
    poll(store, [], T0 + 2 * MIN)
    await recorder.sync()
    expect(publisher.sent).toEqual([])
    expect(recorder.getStatus(KEY)).toMatchObject({ halted: true, queued: 2 })

    recorder.setConfigs({ [KEY]: { target: { ...target, accessKeyId: 'NEW' }, enabled: true, enabledAt: T0 } })
    await recorder.sync()
    expect(publisher.sent).toHaveLength(2)
    expect(recorder.getStatus(KEY).halted).toBe(false)
  })

  it('turning off drops the queue and turning on again starts fresh', async () => {
    const failing = new FakePublisher()
    failing.fail = new Error('offline')
    const { store, recorder, publisher } = setup({ publisher: failing })
    recorder.setConfigs(enabled(T0))
    poll(store, [], T0 + MIN)
    await recorder.sync()
    expect(recorder.getStatus(KEY).queued).toBe(1)

    recorder.setConfigs({ [KEY]: { target, enabled: false } })
    expect(recorder.getStatus(KEY).queued).toBe(0)
    poll(store, [T0 + 2 * MIN], T0 + 3 * MIN)

    publisher.fail = undefined
    recorder.setConfigs(enabled(T0 + 3 * MIN))
    poll(store, [], T0 + 4 * MIN)
    await recorder.sync()
    expect(publisher.sent.map((r) => r.t - T0)).toEqual([4 * MIN])
  })

  it('refuses to send when the patient no longer matches the config', async () => {
    const { store, publisher, recorder } = setup()
    recorder.setConfigs({ 'other~p2': { target, enabled: true, enabledAt: T0 } })
    store.getState().applyGraph('other~p2', { connection: { patientId: 'p2' }, graphData: [point(T0 + MIN, 90)] })
    await recorder.sync()
    expect(publisher.sent).toEqual([])
    expect(recorder.getStatus('other~p2').lastError).toContain('unknown')
  })

  it('caps the queue by dropping the oldest records', async () => {
    const failing = new FakePublisher()
    failing.fail = new Error('offline')
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const { store, recorder } = setup({ publisher: failing, maxQueue: 2 })
    recorder.setConfigs(enabled(T0))
    poll(store, [T0 + MIN, T0 + 2 * MIN], T0 + 3 * MIN)
    await recorder.sync()
    expect(recorder.getStatus(KEY).queued).toBe(2)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('FirehosePublisher', () => {
  const record = (t: number): ReadingRecord => ({
    sid: SID,
    t,
    origin: 'latest',
    mgdl: 100,
    trend: null,
    install: 'desk',
    received_at: t,
    app_version: '1',
    schema_version: 1,
  })

  it('sends one JSON object per record in batches of at most 500', async () => {
    const send = jest.fn().mockResolvedValue({ FailedPutCount: 0 })
    const failed = await new FirehosePublisher(target, { send } as never).send(
      Array.from({ length: 501 }, (_, i) => record(i)),
    )
    expect(failed).toEqual([])
    expect(send).toHaveBeenCalledTimes(2)
    const cmd = send.mock.calls[0][0] as PutRecordBatchCommand
    expect(cmd.input.DeliveryStreamName).toBe('llw-readings')
    expect(cmd.input.Records).toHaveLength(500)
    expect(JSON.parse(Buffer.from(cmd.input.Records![0].Data!).toString())).toEqual(record(0))
  })

  it('returns the records Firehose rejected', async () => {
    const send = jest.fn().mockResolvedValue({
      FailedPutCount: 1,
      RequestResponses: [{ RecordId: 'a' }, { ErrorCode: 'ServiceUnavailableException' }],
    })
    const failed = await new FirehosePublisher(target, { send } as never).send([record(1), record(2)])
    expect(failed).toEqual([record(2)])
  })

  it('turns access errors into RecordingAuthError and keeps others retryable', async () => {
    const denied = Object.assign(new Error('nope'), { name: 'AccessDeniedException' })
    const p = new FirehosePublisher(target, { send: jest.fn().mockRejectedValue(denied) } as never)
    await expect(p.send([record(1)])).rejects.toBeInstanceOf(RecordingAuthError)
    await expect(p.test()).rejects.toBeInstanceOf(RecordingAuthError)
    const flaky = new FirehosePublisher(target, { send: jest.fn().mockRejectedValue(new Error('timeout')) } as never)
    await expect(flaky.send([record(1)])).rejects.not.toBeInstanceOf(RecordingAuthError)
  })

  it('tests that the stream is active', async () => {
    const send = jest.fn().mockResolvedValue({ DeliveryStreamDescription: { DeliveryStreamStatus: 'ACTIVE' } })
    await expect(new FirehosePublisher(target, { send } as never).test()).resolves.toBeUndefined()
    send.mockResolvedValue({ DeliveryStreamDescription: { DeliveryStreamStatus: 'CREATING' } })
    await expect(new FirehosePublisher(target, { send } as never).test()).rejects.toThrow('CREATING')
  })
})
