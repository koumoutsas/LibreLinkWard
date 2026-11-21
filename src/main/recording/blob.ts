/** What a deployment hands out per (install, patient) pair; pasted into the client. */
export type RecordingTarget = {
  region: string
  stream: string
  accessKeyId: string
  secretAccessKey: string
  sid: string
  install: string
}

const FIELDS = ['region', 'stream', 'accessKeyId', 'secretAccessKey', 'sid', 'install'] as const

/**
 * Parses a pasted config blob (base64 of JSON, version 1). Throws a readable
 * error when it is malformed or was issued for another patient.
 */
export function parseBlob(text: string, expectedSid: string): RecordingTarget {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(Buffer.from(text.trim(), 'base64').toString('utf8'))
  } catch {
    throw new Error('This is not a recording config. Paste the whole text you were given.')
  }
  if (raw?.v !== 1) throw new Error('Unsupported recording config version')
  for (const f of FIELDS) {
    if (typeof raw[f] !== 'string' || !(raw[f] as string).trim()) {
      throw new Error(`The recording config is missing "${f}"`)
    }
  }
  const target = Object.fromEntries(FIELDS.map((f) => [f, (raw[f] as string).trim()])) as RecordingTarget
  if (target.sid !== expectedSid) {
    throw new Error(`This config was issued for ${target.sid}, not for this patient (${expectedSid})`)
  }
  return target
}

/** Inverse of parseBlob; used by tests and mirrored by infra/scripts/blob.sh. */
export const encodeBlob = (t: RecordingTarget): string =>
  Buffer.from(JSON.stringify({ v: 1, ...t })).toString('base64')
