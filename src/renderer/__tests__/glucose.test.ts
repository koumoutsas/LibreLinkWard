import {
  formatGlucose,
  fromUnit,
  glucoseLevel,
  minutesSince,
  toChartData,
  toUnit,
} from '../lib/glucose'

const T = { urgentLow: 55, low: 70, high: 180, urgentHigh: 250 }

describe('unit conversion', () => {
  it('rounds mg/dL and converts to one-decimal mmol/L', () => {
    expect(toUnit(100.4, 'mg/dL')).toBe(100)
    expect(toUnit(180, 'mmol/L')).toBe(10)
  })
  it('round-trips through the display unit', () => {
    expect(fromUnit(toUnit(126, 'mmol/L'), 'mmol/L')).toBe(126)
    expect(fromUnit(90, 'mg/dL')).toBe(90)
  })
  it('shows -- when there is no reading', () => {
    expect(formatGlucose(undefined, 'mg/dL')).toBe('--')
  })
})

describe('glucoseLevel', () => {
  it.each([
    [50, 'urgent-low'],
    [60, 'low'],
    [70, 'in-range'],
    [180, 'in-range'],
    [200, 'high'],
    [300, 'urgent-high'],
  ])('%i -> %s', (v, level) => expect(glucoseLevel(v, T)).toBe(level))
})

describe('toChartData', () => {
  const pt = (iso: string, v: number) => ({ Timestamp: iso, FactoryTimestamp: iso, ValueInMgPerDl: v })
  const history = [
    pt('2026-01-01T08:00:00Z', 100),
    pt('2026-01-01T10:00:00Z', 140),
    pt('2026-01-01T11:00:00Z', 180),
  ]
  it('keeps the window ending at the newest reading and converts units', () => {
    const data = toChartData(history, 'mmol/L', 90 * 60 * 1000)
    expect(data.map((d) => d.mgdl)).toEqual([140, 180])
    expect(data[1].value).toBe(10)
    expect(toChartData(history, 'mg/dL', 3 * 3600 * 1000)).toHaveLength(3)
  })
  it('is empty for empty history', () => expect(toChartData([], 'mg/dL', 1000)).toEqual([]))
})

describe('minutesSince', () => {
  it('floors to whole minutes and handles missing', () => {
    expect(minutesSince(0, 150000)).toBe(2)
    expect(minutesSince(undefined)).toBeUndefined()
  })
})
