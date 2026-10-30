import { ar2Forecast } from '../ar2'

const COEF_PREV = -0.723
const COEF_CURR = 1.716
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

  it('picks the closest of several candidates, the earlier one on a tie', () => {
    const via = (m: number, v: number) => ar2Forecast([at(m, v), at(10, 110)])[0].mgdl
    expect(ar2Forecast([at(4, 130), at(7, 90), at(10, 110)])[0].mgdl).toBe(via(4, 130))
    expect(ar2Forecast([at(7, 90), at(4, 130), at(10, 110)])[0].mgdl).toBe(via(4, 130))
    expect(ar2Forecast([at(3, 130), at(7, 90), at(10, 110)])[0].mgdl).toBe(via(3, 130))
  })

  it('accepts a previous reading exactly half a step off, but not further', () => {
    expect(ar2Forecast([at(2.5, 100), at(10, 100)])).toHaveLength(13)
    expect(ar2Forecast([at(2.4, 100), at(10, 100)])).toEqual([])
    expect(ar2Forecast([at(0, 100), at(10, 100)])).toEqual([])
  })

  it('applies the boundary of the input guards', () => {
    expect(ar2Forecast([at(0, 100), at(5, 36)])).toHaveLength(13)
    expect(ar2Forecast([at(0, 100), at(5, 35)])).toEqual([])
    expect(ar2Forecast([at(0, 0), at(5, 100)])).toEqual([])
    expect(ar2Forecast([at(0, -5), at(5, 100)])).toEqual([])
  })

  it('sizes the cone as coneFactor times the step multiplier around the line', () => {
    const f = ar2Forecast([at(0, 100), at(5, 120)], 3)
    const curr = COEF_PREV * Math.log(100 / 140) + COEF_CURR * Math.log(120 / 140)
    expect(f[0].high).toBe(Math.round(140 * Math.exp(curr + 3 * 0.02)))
    expect(f[0].low).toBe(Math.round(140 * Math.exp(curr - 3 * 0.02)))
  })
})
