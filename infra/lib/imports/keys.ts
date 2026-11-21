import { createHash } from 'crypto'
import { checkSid } from './glooko'
import { checkZone } from './time'

/** Formats the imports pipeline understands; the raw object key starts with `raw/<format>/`. */
export const FORMATS = ['glooko'] as const
export type Format = (typeof FORMATS)[number]

/** An import is named by the content hash of its file, so uploading the same file twice is the same import. */
export const importIdOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex').slice(0, 16)

export const rawKey = (format: Format, importId: string) => `raw/${format}/${importId}.zip`
export const resultKey = (importId: string) => `results/${importId}.json`
/** Where a drop that could not be imported records why; separate so it never hides an import's own result. */
export const inboxErrorKey = (importId: string) => `results/inbox-${importId}.json`

/** S3 user metadata on a raw upload (sent as x-amz-meta-*). */
export type RawMetadata = { sid: string; tz: string }

export function parseRawKey(key: string): { format: Format; importId: string } {
  const m = /^raw\/([a-z]+)\/([0-9a-f]{16})\.zip$/.exec(key)
  if (!m || !(FORMATS as readonly string[]).includes(m[1])) throw new Error(`Unexpected import object ${key}`)
  return { format: m[1] as Format, importId: m[2] }
}

export const INBOX_PREFIX = 'inbox/'

/**
 * Drop-folder key: `inbox/<format>/<sid>/<IANA zone>/<any name>.zip`, e.g.
 * `inbox/glooko/linkup:<id>/Europe/Athens/export.zip`. The zone is written as
 * in the tz database, so it may span segments (`America/Argentina/Buenos_Aires`).
 * A Nightscout sid may contain `/` too, so the zone is the longest run of
 * trailing segments (before the file name) that is a valid zone; the sid is
 * what remains.
 */
export function parseInboxKey(key: string): { format: Format; sid: string; tz: string; name: string } {
  const usage = `use ${INBOX_PREFIX}<format>/<patient id>/<time zone>/<file>.zip, e.g. ${INBOX_PREFIX}glooko/linkup:<id>/Europe/Athens/export.zip`
  const parts = key.split('/')
  if (parts[0] !== 'inbox' || parts.length < 5) throw new Error(`Cannot import ${key}: ${usage}`)
  const format = parts[1]
  const name = parts[parts.length - 1]
  const middle = parts.slice(2, -1)
  if (!(FORMATS as readonly string[]).includes(format)) throw new Error(`Cannot import ${key}: unknown format "${format}"; known: ${FORMATS.join(', ')}`)
  if (!/\.zip$/i.test(name)) throw new Error(`Cannot import ${key}: expected a .zip file`)
  for (let n = middle.length - 1; n >= 1; n--) {
    const tz = middle.slice(-n).join('/')
    try {
      checkZone(tz)
    } catch {
      continue
    }
    const sid = middle.slice(0, -n).join('/')
    checkSid(sid)
    return { format: format as Format, sid, tz, name }
  }
  checkSid(middle.slice(0, -1).join('/'))
  throw new Error(`Cannot import ${key}: no valid time zone before the file name; ${usage}`)
}
