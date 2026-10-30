import { ar2Forecast } from '../ar2'

const MIN = 60000
const at = (m: number, mgdl: number) => ({ t: m * MIN, mgdl })

describe('ar2Forecast', () => {
  it('returns 13 five-minute steps after the newest reading', () => {
    const f = ar2Forecast([at(0, 100), at(5, 100)])
    expect(f).toHaveLength(13)
    expect(f[0].t).toBe(10 * MIN)
    expect(f[12].t).toBe(70 * MIN)
  })

  it('holds a flat reading at the 140 baseline-relative fixed point', () => {
    const f = ar2Forecast([at(0, 140), at(5, 140)])
    expect(f.every((p) => p.mgdl === 140)).toBe(true)
  })

  it('matches the recurrence for the first step', () => {
    const [first] = ar2Forecast([at(0, 100), at(5, 120)])
    const expected = Math.round(140 * Math.exp(-0.723 * Math.log(100 / 140) + 1.716 * Math.log(120 / 140)))
    expect(first.mgdl).toBe(expected)
  })

  it('continues a rise', () => {
    const f = ar2Forecast([at(0, 100), at(5, 110)])
    expect(f[0].mgdl).toBeGreaterThan(110)
  })

  it('brackets the line with the cone, and a zero factor collapses it', () => {
    const f = ar2Forecast([at(0, 100), at(5, 110)])
    expect(f[12].high).toBeGreaterThan(f[12].mgdl)
    expect(f[12].low).toBeLessThan(f[12].mgdl)
    expect(ar2Forecast([at(0, 100), at(5, 110)], 0).every((p) => p.high === p.mgdl && p.low === p.mgdl)).toBe(true)
  })

  it('clamps to 36..400', () => {
    const up = ar2Forecast([at(0, 200), at(5, 300)])
    const down = ar2Forecast([at(0, 100), at(5, 60)])
    expect(Math.max(...up.map((p) => p.high))).toBe(400)
    expect(Math.min(...down.map((p) => p.low))).toBeGreaterThanOrEqual(36)
  })

  it('uses the reading nearest five minutes back', () => {
    const [first] = ar2Forecast([at(0, 100), at(4, 130), at(9, 110)])
    const [viaNearest] = ar2Forecast([at(4, 130), at(9, 110)])
    expect(first.mgdl).toBe(viaNearest.mgdl)
  })

  it('is empty without a reading five minutes back, or for a low current value', () => {
    expect(ar2Forecast([])).toEqual([])
    expect(ar2Forecast([at(5, 100)])).toEqual([])
    expect(ar2Forecast([at(0, 100), at(20, 100)])).toEqual([])
    expect(ar2Forecast([at(0, 40), at(5, 30)])).toEqual([])
  })
})
