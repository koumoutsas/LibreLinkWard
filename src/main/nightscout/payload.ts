import { createHash } from 'crypto'
import { GraphPoint } from '../../shared/linkup'
import { pointTime } from '../../shared/stores'

export type NightscoutEntry = {
  type: 'sgv'
  sgv: number
  /** Epoch ms. */
  date: number
  dateString: string
  direction?: string
  device: string
}

// LibreLinkUp TrendArrow 1..5 -> Nightscout direction.
const DIRECTIONS: Record<number, string> = {
  1: 'SingleDown',
  2: 'FortyFiveDown',
  3: 'Flat',
  4: 'FortyFiveUp',
  5: 'SingleUp',
}

/** Nightscout expects the SHA1 hex digest of the API secret in `api-secret`. */
export const hashSecret = (secret: string): string =>
  createHash('sha1').update(secret).digest('hex')

/** Null when the point has no usable timestamp or value. */
export function toEntry(point: GraphPoint, device: string): NightscoutEntry | null {
  const date = pointTime(point)
  if (Number.isNaN(date) || !Number.isFinite(point.ValueInMgPerDl)) return null
  return {
    type: 'sgv',
    sgv: Math.round(point.ValueInMgPerDl),
    date,
    dateString: new Date(date).toISOString(),
    direction: point.TrendArrow !== undefined ? DIRECTIONS[point.TrendArrow] : undefined,
    device,
  }
}
