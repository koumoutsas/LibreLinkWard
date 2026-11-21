import { createHash } from 'crypto'
import { FirehoseClient } from '@aws-sdk/client-firehose'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { S3Event } from 'aws-lambda'
import { sendAll } from '../lib/imports/firehose'
import { parseGlookoZip, summarize } from '../lib/imports/glooko'
import { importIdOf, INBOX_PREFIX, inboxErrorKey, parseInboxKey, parseRawKey, rawKey, resultKey } from '../lib/imports/keys'

/**
 * Runs when a file lands in the imports bucket.
 *
 * inbox/<format>/<sid>/<tz>/<name>.zip (the drop folder, for any S3 client):
 * moved to raw/ with sid and tz as metadata, which starts the import below.
 * A drop that cannot be imported stays in inbox/ and its error is written to
 * results/<importId>.json.
 *
 * raw/<format>/<importId>.zip (written by scripts/import.ts or the inbox): parses it with
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
    // "Create folder" in the S3 console writes an empty object ending in /.
    if (key.endsWith('/')) continue
    if (key.startsWith(INBOX_PREFIX)) await promoteInboxObject(bucket, key)
    else await importObject(bucket, key)
  }
}

export async function promoteInboxObject(bucket: string, key: string): Promise<void> {
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const bytes = await obj.Body!.transformToByteArray()
  const importId = importIdOf(bytes)
  let target
  try {
    target = parseInboxKey(key)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(message)
    await writeJson(bucket, inboxErrorKey(importId), { status: 'error', importId, key, importedAt: new Date().toISOString(), error: message })
    return
  }
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: rawKey(target.format, importId),
      Body: bytes,
      ContentType: 'application/zip',
      // Metadata must be ASCII; file names need not be.
      Metadata: { sid: target.sid, tz: target.tz, from: encodeURIComponent(key).slice(0, 1024) },
    }),
  )
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  // Clears the error of an earlier, misplaced drop of the same file.
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: inboxErrorKey(importId) }))
  console.log(`Moved ${key} to ${rawKey(target.format, importId)}`)
}

const writeJson = (bucket: string, key: string, result: Record<string, unknown>) =>
  s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(result, null, 2),
      ContentType: 'application/json',
    }),
  )

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
  await writeJson(bucket, resultKey(importId), result)
}
