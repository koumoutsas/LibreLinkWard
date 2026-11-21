/** One install allowed to record one patient; gets its own key and config blob. */
export type Pair = {
  install: string
  sid: string
  /** Bump to rotate this pair's access key. */
  serial?: number
}

const INSTALL = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,40}$/
const SID = /^(linkup:[^\s]+|nightscout:[^\s]+)$/

/** Reads the `pairs` context: an array, or a JSON string of one (from `-c pairs=...`). */
export function parsePairs(raw: unknown): Pair[] {
  const list = typeof raw === 'string' ? (raw.trim() ? JSON.parse(raw) : []) : (raw ?? [])
  if (!Array.isArray(list)) throw new Error('context "pairs" must be a list of {install, sid}')
  const seen = new Set<string>()
  return list.map((p: Pair) => {
    if (!INSTALL.test(p?.install ?? '')) throw new Error(`Invalid install name: ${JSON.stringify(p?.install)}`)
    if (!SID.test(p?.sid ?? '')) throw new Error(`Invalid sid for ${p.install}: ${JSON.stringify(p?.sid)}`)
    const key = pairKey(p)
    if (seen.has(key)) throw new Error(`Duplicate pair ${p.install} / ${p.sid}`)
    seen.add(key)
    return { install: p.install, sid: p.sid, serial: p.serial }
  })
}

/** Secrets Manager-safe identifier of a pair; scripts/blob.sh computes the same. */
export const pairKey = (p: Pair) => `${p.install}/${p.sid}`.replace(/[^A-Za-z0-9/_+=.@-]/g, '_')

export const secretName = (p: Pair) => `librelinkward/blob/${pairKey(p)}`
