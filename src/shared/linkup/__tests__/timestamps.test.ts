import { normaliseMeasurement, withExplicitZone } from '../timestamps'

describe('withExplicitZone', () => {
  it.each([
    ['10/28/2026 12:15:30 PM', '2026-10-28T12:15:30.000Z'],
    ['2026-10-28T12:15:30', '2026-10-28T12:15:30.000Z'],
  ])('reads zoneless %s as UTC', (ts, iso) => {
    expect(withExplicitZone(ts)).toBe(iso)
  })

  it.each(['2026-10-28T12:15:30Z', '2026-10-28T14:15:30+02:00'])('keeps %s', (ts) => {
    expect(withExplicitZone(ts)).toBe(ts)
  })

  it('leaves garbage alone', () => {
    expect(withExplicitZone('nope')).toBe('nope')
  })
})

describe('normaliseMeasurement', () => {
  it('rewrites FactoryTimestamp only', () => {
    const m = { Timestamp: '10/28/2026 8:15:30 AM', FactoryTimestamp: '10/28/2026 12:15:30 PM', ValueInMgPerDl: 1 }
    expect(normaliseMeasurement(m)).toEqual({ ...m, FactoryTimestamp: '2026-10-28T12:15:30.000Z' })
  })

  it('passes undefined through', () => {
    expect(normaliseMeasurement(undefined)).toBeUndefined()
  })
})
