import { createHash } from 'crypto'

/** Formats the imports pipeline understands; the raw object key starts with `raw/<format>/`. */
export const FORMATS = ['glooko'] as const
export type Format = (typeof FORMATS)[number]

/** An import is named by the content hash of its file, so uploading the same file twice is the same import. */
export const importIdOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex').slice(0, 16)

export const rawKey = (format: Format, importId: string) => `raw/${format}/${importId}.zip`
export const resultKey = (importId: string) => `results/${importId}.json`

/** S3 user metadata on a raw upload (sent as x-amz-meta-*). */
export type RawMetadata = { sid: string; tz: string }

export function parseRawKey(key: string): { format: Format; importId: string } {
  const m = /^raw\/([a-z]+)\/([0-9a-f]{16})\.zip$/.exec(key)
  if (!m || !(FORMATS as readonly string[]).includes(m[1])) throw new Error(`Unexpected import object ${key}`)
  return { format: m[1] as Format, importId: m[2] }
}
