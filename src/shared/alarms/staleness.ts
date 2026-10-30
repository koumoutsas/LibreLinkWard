import type { GraphPoint } from '../linkup/types'
import { pointTime } from '../stores'

export const DEFAULT_SIGNAL_LOSS_MINUTES = 20

/** Time of the last data from a patient: the reading's own timestamp, else the last successful poll. */
export function lastSeenAt(latest: GraphPoint | undefined, lastUpdated: number | undefined): number | undefined {
  const readingTime = latest ? pointTime(latest) : NaN
  return Number.isNaN(readingTime) ? lastUpdated : readingTime
}

/** True when the newest data is older than the signal-loss timeout. */
export function isStale(
  latest: GraphPoint | undefined,
  lastUpdated: number | undefined,
  signalLossMinutes: number,
  now: number,
): boolean {
  const lastSeen = lastSeenAt(latest, lastUpdated)
  return lastSeen !== undefined && now - lastSeen > signalLossMinutes * 60_000
}
