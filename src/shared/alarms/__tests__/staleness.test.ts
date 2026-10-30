import { isStale } from '../staleness'

const point = (iso: string) => ({ Timestamp: iso, FactoryTimestamp: iso, ValueInMgPerDl: 100 }) as never

describe('isStale', () => {
  const now = Date.parse('2026-10-30T12:00:00Z')
  it('is stale past the timeout', () => expect(isStale(point('2026-10-30T11:30:00Z'), undefined, 20, now)).toBe(true))
  it('is fresh within the timeout', () => expect(isStale(point('2026-10-30T11:50:00Z'), undefined, 20, now)).toBe(false))
  it('falls back to lastUpdated without a reading', () => expect(isStale(undefined, now - 30 * 60_000, 20, now)).toBe(true))
  it('is not stale with no data at all', () => expect(isStale(undefined, undefined, 20, now)).toBe(false))
})
