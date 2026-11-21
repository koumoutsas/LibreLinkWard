import { createHash } from 'crypto'
import { FirehoseClient } from '@aws-sdk/client-firehose'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { S3Event } from 'aws-lambda'
import { sendAll } from '../lib/imports/firehose'
import { parseGlookoZip, summarize } from '../lib/imports/glooko'
import { parseRawKey, resultKey } from '../lib/imports/keys'

/**
 * Runs when an export lands under raw/ in the imports bucket: parses it with
 * the sid and time zone from the object's metadata, sends readings and
 * therapy events to their Firehose streams (both upsert, so re-running an
 * import is safe) and writes results/<importId>.json for the CLI.
 */

const s3 = new S3Client({})
const firehose = new FirehoseClient({})
const env = (name: string) => {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set`)
  return v
}

export async function handler(event: S3Event): Promise<void> {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '))
    await importObject(bucket, key)
  }
}

export async function importObject(bucket: string, key: string): Promise<void> {
  const { importId } = parseRawKey(key)
  const startedAt = Date.now()
  let result: Record<string, unknown>
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    const sid = obj.Metadata?.sid ?? ''
    const tz = obj.Metadata?.tz ?? ''
    if (!sid || !tz) throw new Error('The upload has no sid or tz metadata; upload it with scripts/import.ts')
    // A standalone copy: the SDK may hand back a view into a larger, pooled buffer.
    const bytes = new Uint8Array(await obj.Body!.transformToByteArray())
    let parsed
    try {
      parsed = parseGlookoZip(bytes, { sid, tz, importId, importedAt: startedAt })
    } catch (e) {
      const got = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
      console.error(`Parse failed on ${bytes.length} bytes (sha ${got}):`, e)
      throw e
    }
    await sendAll(firehose, env('READINGS_STREAM'), parsed.readings)
    await sendAll(firehose, env('EVENTS_STREAM'), parsed.events)
    result = { status: 'ok', importId, key, sid, tz, importedAt: new Date(startedAt).toISOString(), ...summarize(parsed) }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`Import ${key} failed: ${message}`)
    result = { status: 'error', importId, key, importedAt: new Date(startedAt).toISOString(), error: message }
  }
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: resultKey(importId),
      Body: JSON.stringify(result, null, 2),
      ContentType: 'application/json',
    }),
  )
}
