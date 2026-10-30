import { GlucoseMeasurement } from './types'

export const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i

/**
 * LibreLinkUp's FactoryTimestamp is UTC but carries no zone ("10/28/2026 12:15:30 PM").
 * This is the one place that knowledge lives: it is rewritten to an explicit-UTC ISO string
 * so everything downstream can require a zone. Unparseable values are returned unchanged
 * and are rejected downstream.
 */
export function withExplicitZone(ts: string): string {
  if (HAS_ZONE.test(ts)) return ts
  const ms = Date.parse(ts.includes('T') ? `${ts}Z` : `${ts} UTC`)
  return Number.isNaN(ms) ? ts : new Date(ms).toISOString()
}

export function normaliseMeasurement<T extends GlucoseMeasurement | undefined>(m: T): T {
  if (!m?.FactoryTimestamp) return m
  return { ...m, FactoryTimestamp: withExplicitZone(m.FactoryTimestamp) }
}
