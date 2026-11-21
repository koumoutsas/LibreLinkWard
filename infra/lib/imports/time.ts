/** Offset of `tz` from UTC at instant `ms`, in ms (positive east of Greenwich). */
export function offsetAt(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms))
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  const local = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'))
  return local - Math.floor(ms / 1000) * 1000
}

/** Throws unless `tz` is an IANA time zone this runtime knows. */
export function checkZone(tz: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
  } catch {
    throw new Error(`Unknown time zone "${tz}"; use an IANA name such as Europe/Athens`)
  }
  if (!tz.includes('/') && tz !== 'UTC') throw new Error(`Use an IANA zone name such as Europe/Athens, not "${tz}"`)
}

export type LocalTime = {
  /** Epoch ms (UTC). */
  t: number
  /** The wall time occurred twice (clocks went back); the earlier instant was used. */
  ambiguous: boolean
  /** The wall time never occurred (clocks went forward); it was read with the offset from before the change. */
  skipped: boolean
}

/**
 * Converts a wall-clock time `YYYY-MM-DD HH:MM[:SS]` in zone `tz` to UTC.
 * Throws on any other format.
 */
export function localToUtc(text: string, tz: string): LocalTime {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim())
  if (!m) throw new Error(`Unrecognised timestamp "${text}" (expected YYYY-MM-DD HH:MM)`)
  const [y, mo, d, h, mi, s] = m.slice(1).map((v) => Number(v ?? 0))
  const naive = Date.UTC(y, mo - 1, d, h, mi, s)
  if (new Date(naive).getUTCDate() !== d || h > 23 || mi > 59 || s > 59) throw new Error(`Invalid timestamp "${text}"`)
  // Offsets either side of any transition near this time; each gives a candidate instant.
  const before = offsetAt(naive - 14 * 3600_000, tz)
  const after = offsetAt(naive + 14 * 3600_000, tz)
  const valid = [...new Set([naive - before, naive - after])].filter((c) => c + offsetAt(c, tz) === naive).sort((a, b) => a - b)
  if (valid.length === 0) return { t: naive - before, ambiguous: false, skipped: true }
  return { t: valid[0], ambiguous: valid.length > 1, skipped: false }
}
