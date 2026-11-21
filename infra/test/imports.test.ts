import { FirehoseClient } from '@aws-sdk/client-firehose'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { strToU8, zipSync } from 'fflate'
import { parseCsv } from '../lib/imports/csv'
import { sendAll } from '../lib/imports/firehose'
import { MMOL_TO_MGDL, parseGlookoZip, summarize } from '../lib/imports/glooko'
import { importIdOf, parseRawKey, rawKey, resultKey } from '../lib/imports/keys'
import { localToUtc } from '../lib/imports/time'

const NAME_LINE = '﻿Name:Jane Doe,Date Range:2026-11-01 - 2026-11-14'
const csv = (...lines: string[]) => strToU8([NAME_LINE, ...lines].join('\r\n') + '\r\n')
const ctx = { sid: 'linkup:p1', tz: 'Europe/Athens', importId: '0123456789abcdef', importedAt: 1_800_000_000_000 }
const iso = (t: number) => new Date(t).toISOString()

/** A small export shaped like a real Glooko "Export to CSV" zip. */
const sampleZip = (overrides: Record<string, Uint8Array> = {}) =>
  zipSync({
    'cgm_data_1.csv': csv('Timestamp,CGM Glucose Value (mg/dl),Serial Number', '2026-11-14 10:59,104.0,Abbott LibreView CSV', '2026-11-14 10:44,125.4,Abbott LibreView CSV'),
    'cgm_carbs_data_1.csv': csv('Timestamp,Carbs (g)'),
    'bg_data_1.csv': csv('Timestamp,Glucose Value (mg/dl),Manual Reading,Serial Number', '2026-11-14 08:23,81.0,M,SN1'),
    'alarms_data_1.csv': csv('Timestamp,Alarm/Event,Serial Number', '2026-11-14 07:56,Insulet Exp2,SN1', '2026-11-14 07:56,Insulet Exp2,SN1'),
    'Insulin data/bolus_data_1.csv': csv(
      'Timestamp,Insulin Type,Blood Glucose Input (mg/dl),Carbs Input (g),Carbs Ratio,Insulin Delivered (U),Initial Delivery (U),Extended Delivery (U),Serial Number',
      '2026-11-14 08:23,Normal,81.0,18.8,30.0,0.3,,,SN1',
      '2026-11-07 18:07,Normal,0.0,0.0,,0.5,,,SN1',
    ),
    'Insulin data/basal_data_1.csv': csv(
      'Timestamp,Insulin Type,Duration (minutes),Percentage (%),Rate,Insulin Delivered (U),Serial Number',
      '2026-11-14 09:11,Suspend,11,,0.0,,SN1',
      '2026-11-13 00:00,Scheduled,1440,,0.4,,SN1',
    ),
    'Insulin data/insulin_data_1.csv': csv('Timestamp,Total Bolus (U),Total Insulin (U),Total Basal (U),Serial Number', '2026-11-13 00:00,4.05,13.65,9.6,SN1'),
    'Manual data/food_data_1.csv': csv(
      'Timestamp,Name,Carbs (g),Fat,Protein,Calories,Serving Quantity,Number of Servings',
      '2026-11-09 11:00,"Chewy Bar, Peanut Butter",15.0,12.0,10.0,190.0,1.0,0',
    ),
    'Manual data/notes_data_1.csv': csv('Timestamp,Value'),
    ...overrides,
  })

describe('parseCsv', () => {
  it('handles BOM, quotes, doubled quotes, CRLF and blank lines', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n1,\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['1', '']])
  })
})

describe('localToUtc', () => {
  it('converts wall time in a zone, with and without seconds', () => {
    expect(iso(localToUtc('2026-11-14 10:59', 'Europe/Athens').t)).toBe('2026-11-14T08:59:00.000Z')
    expect(iso(localToUtc('2026-07-01 10:00:30', 'Europe/Athens').t)).toBe('2026-07-01T07:00:30.000Z')
    expect(iso(localToUtc('2026-07-01 10:00', 'UTC').t)).toBe('2026-07-01T10:00:00.000Z')
  })

  it('takes the earlier instant for a repeated hour and flags it', () => {
    // Athens: 2026-10-25 04:00 EEST -> 03:00 EET, so 03:30 happens twice.
    expect(localToUtc('2026-10-25 03:30', 'Europe/Athens')).toEqual({ t: Date.parse('2026-10-25T00:30:00Z'), ambiguous: true, skipped: false })
  })

  it('flags a wall time skipped by the spring change', () => {
    // Athens: 2026-03-29 03:00 EET -> 04:00 EEST.
    expect(localToUtc('2026-03-29 03:30', 'Europe/Athens')).toEqual({ t: Date.parse('2026-03-29T01:30:00Z'), ambiguous: false, skipped: true })
  })

  it('rejects other formats and impossible dates', () => {
    expect(() => localToUtc('11-14-2026 10:59', 'UTC')).toThrow('Unrecognised')
    expect(() => localToUtc('2026-02-30 10:00', 'UTC')).toThrow('Invalid')
  })
})

describe('parseGlookoZip', () => {
  const res = parseGlookoZip(sampleZip(), ctx)

  it('turns CGM data into import readings', () => {
    expect(res.readings).toEqual([
      { sid: 'linkup:p1', t: Date.parse('2026-11-14T08:59:00Z'), origin: 'import', mgdl: 104, trend: null, install: 'import:0123456789abcdef', received_at: ctx.importedAt, app_version: 'importer-1', schema_version: 1 },
      expect.objectContaining({ t: Date.parse('2026-11-14T08:44:00Z'), mgdl: 125 }),
    ])
  })

  it('maps pump files to therapy events', () => {
    const bolus = res.events.filter((e) => e.kind === 'bolus')
    expect(bolus[0]).toMatchObject({ subtype: 'Normal', units: 0.3, bg_mgdl: 81, carbs_g: 18.8, carb_ratio: 30, device: 'SN1', source: 'glooko', import_id: ctx.importId, initial_units: null })
    // 0 BG and an empty ratio mean "not entered".
    expect(bolus[1]).toMatchObject({ bg_mgdl: null, carb_ratio: null, carbs_g: 0, units: 0.5 })
    expect(res.events.find((e) => e.subtype === 'Suspend')).toMatchObject({ kind: 'basal', rate_uh: 0, duration_ms: 11 * 60_000, units: null })
    expect(res.events.find((e) => e.subtype === 'Scheduled')).toMatchObject({ rate_uh: 0.4, duration_ms: 86_400_000, t: Date.parse('2026-11-12T22:00:00Z') })
    expect(res.events.find((e) => e.kind === 'daily_total')).toMatchObject({ units: 13.65, detail: '{"total_bolus_u":4.05,"total_basal_u":9.6}' })
    expect(res.events.find((e) => e.kind === 'bg')).toMatchObject({ bg_mgdl: 81, detail: '{"manual":"M"}' })
    expect(res.events.find((e) => e.kind === 'food')).toMatchObject({ subtype: 'Chewy Bar, Peanut Butter', carbs_g: 15, device: null })
    expect(JSON.parse(res.events.find((e) => e.kind === 'food')!.detail!)).toEqual({ fat_g: 12, protein_g: 10, kcal: 190, serving_quantity: 1, servings: 0 })
  })

  it('keeps identical events at the same minute apart', () => {
    expect(res.events.filter((e) => e.kind === 'alarm').map((e) => e.subtype)).toEqual(['Insulet Exp2', 'Insulet Exp2#2'])
  })

  it('never carries the patient name', () => {
    expect(JSON.stringify(res)).not.toContain('Jane')
    expect(res.dateRange).toBe('2026-11-01 - 2026-11-14')
  })

  it('summarizes counts per table and kind', () => {
    const s = summarize(res)
    expect(s.readings.count).toBe(2)
    expect(s.events.byKind).toEqual({ alarm: 2, basal: 2, bg: 1, bolus: 2, daily_total: 1, food: 1 })
    expect(s.files.find((f) => f.name === 'cgm_data_1.csv')).toEqual({ name: 'cgm_data_1.csv', table: 'readings', rows: 2 })
  })

  it('converts mmol/L', () => {
    const r = parseGlookoZip(sampleZip({ 'cgm_data_1.csv': csv('Timestamp,CGM Glucose Value (mmol/l),Serial Number', '2026-11-14 10:59,5.5,X') }), ctx)
    expect(r.readings[0].mgdl).toBe(Math.round(5.5 * MMOL_TO_MGDL))
  })

  it('keeps unknown columns in detail and skips unknown files with a warning', () => {
    const r = parseGlookoZip(
      sampleZip({
        'alarms_data_1.csv': csv('Timestamp,Alarm/Event,Serial Number,Severity', '2026-11-14 07:56,Occlusion,SN1,high'),
        'pump_settings_1.csv': csv('Timestamp,Whatever'),
      }),
      ctx,
    )
    expect(r.events.find((e) => e.kind === 'alarm')!.detail).toBe('{"Severity":"high"}')
    expect(r.warnings).toContain('pump_settings_1.csv: unknown file, skipped')
  })

  it('skips bad rows with warnings', () => {
    const r = parseGlookoZip(
      sampleZip({ 'cgm_data_1.csv': csv('Timestamp,CGM Glucose Value (mg/dl),Serial Number', 'yesterday,100,X', '2026-11-14 10:59,,X', '2026-11-14 11:14,abc,X') }),
      ctx,
    )
    expect(r.readings).toHaveLength(0)
    expect(r.warnings).toHaveLength(4)
  })

  it('fails loudly on unrecognised headers, bad input and bad parameters', () => {
    expect(() => parseGlookoZip(sampleZip({ 'Insulin data/bolus_data_1.csv': csv('Timestamp,Type,Units') }), ctx)).toThrow('missing column "Insulin Type"')
    expect(() => parseGlookoZip(sampleZip({ 'bg_data_1.csv': csv('Date,Glucose Value (mg/dl)') }), ctx)).toThrow('Timestamp column')
    expect(() => parseGlookoZip(sampleZip({ 'bg_data_1.csv': csv('Timestamp,Glucose Value,Manual Reading') }), ctx)).toThrow('unit')
    expect(() => parseGlookoZip(strToU8('not a zip'), ctx)).toThrow('zip')
    expect(() => parseGlookoZip(zipSync({ 'readme.txt': strToU8('x') }), ctx)).toThrow('no Glooko CSV')
    expect(() => parseGlookoZip(sampleZip(), { ...ctx, sid: 'p1' })).toThrow('patient id')
    expect(() => parseGlookoZip(sampleZip(), { ...ctx, sid: 'linkup:p1/extra' })).toThrow('patient id')
    expect(parseGlookoZip(sampleZip(), { ...ctx, sid: 'nightscout:my.site/ns' }).readings[0].sid).toBe('nightscout:my.site/ns')
    expect(() => parseGlookoZip(sampleZip(), { ...ctx, tz: 'Mars/Olympus' })).toThrow('time zone')
    expect(() => parseGlookoZip(sampleZip(), { ...ctx, tz: 'EET' })).toThrow('IANA')
  })
})

describe('keys', () => {
  it('names imports by content and round-trips raw keys', () => {
    const id = importIdOf(strToU8('abc'))
    expect(id).toMatch(/^[0-9a-f]{16}$/)
    expect(parseRawKey(rawKey('glooko', id))).toEqual({ format: 'glooko', importId: id })
    expect(resultKey(id)).toBe(`results/${id}.json`)
    expect(() => parseRawKey('raw/other/0123456789abcdef.zip')).toThrow()
    expect(() => parseRawKey('results/x.json')).toThrow()
  })
})

describe('sendAll', () => {
  it('batches by 500 and retries only rejected records', async () => {
    const sent: number[][] = []
    let first = true
    const client = {
      send: jest.fn(async (cmd: any) => {
        const ids = cmd.input.Records.map((r: any) => JSON.parse(Buffer.from(r.Data).toString()).i)
        sent.push(ids)
        if (first) {
          first = false
          return { FailedPutCount: 1, RequestResponses: ids.map((_: number, i: number) => (i === 3 ? { ErrorCode: 'ServiceUnavailable' } : {})) }
        }
        return { FailedPutCount: 0, RequestResponses: [] }
      }),
    }
    await sendAll(client as any, 's', Array.from({ length: 1200 }, (_, i) => ({ i })), { baseDelayMs: 0 })
    expect(sent.map((b) => b.length)).toEqual([500, 500, 200, 1])
    expect(sent[3]).toEqual([3])
  })

  it('gives up after the last attempt', async () => {
    const client = { send: jest.fn(async () => ({ FailedPutCount: 1, RequestResponses: [{ ErrorCode: 'x' }] })) }
    await expect(sendAll(client as any, 's', [{ a: 1 }], { attempts: 2, baseDelayMs: 0 })).rejects.toThrow('after 2 attempts')
    expect(client.send).toHaveBeenCalledTimes(2)
  })
})

describe('import function', () => {
  process.env.AWS_REGION = 'eu-central-1'
  process.env.READINGS_STREAM = 'readings-stream'
  process.env.EVENTS_STREAM = 'events-stream'
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { handler } = require('../lambda/import') as typeof import('../lambda/import')

  const run = async (metadata: Record<string, string>, body = sampleZip()) => {
    const puts: any[] = []
    const streams: Record<string, number> = {}
    jest.spyOn(S3Client.prototype, 'send').mockImplementation(async (cmd: any) => {
      if (cmd instanceof GetObjectCommand) return { Metadata: metadata, Body: { transformToByteArray: async () => body } }
      if (cmd instanceof PutObjectCommand) puts.push(cmd.input)
      return {}
    })
    jest.spyOn(FirehoseClient.prototype, 'send').mockImplementation(async (cmd: any) => {
      streams[cmd.input.DeliveryStreamName] = (streams[cmd.input.DeliveryStreamName] ?? 0) + cmd.input.Records.length
      return { FailedPutCount: 0 }
    })
    await handler({ Records: [{ s3: { bucket: { name: 'b' }, object: { key: 'raw/glooko/0123456789abcdef.zip' } } }] } as any)
    jest.restoreAllMocks()
    return { puts, streams, result: JSON.parse(puts[0].Body) }
  }

  it('sends readings and events to their streams and records the result', async () => {
    const { puts, streams, result } = await run({ sid: 'linkup:p1', tz: 'Europe/Athens' })
    expect(streams).toEqual({ 'readings-stream': 2, 'events-stream': 9 })
    expect(puts[0].Key).toBe('results/0123456789abcdef.json')
    expect(result).toMatchObject({ status: 'ok', importId: '0123456789abcdef', sid: 'linkup:p1', readings: { count: 2 }, events: { count: 9 } })
  })

  it('records a failure instead of throwing', async () => {
    const { streams, result } = await run({})
    expect(streams).toEqual({})
    expect(result).toMatchObject({ status: 'error', error: expect.stringContaining('metadata') })
  })
})
