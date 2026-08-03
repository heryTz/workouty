import { describe, expect, it } from 'vitest'
import { estimateOneRepMax } from './one-rep-max'

describe('estimateOneRepMax', () => {
  it('returns the lifted weight unchanged for a single rep', () => {
    // Epley applied blindly would return 62.0 here, overstating a true 1RM by 3.3%.
    expect(estimateOneRepMax(60, 1)).toBe(60)
  })

  it('applies the Epley formula above one rep', () => {
    // 60 * (1 + 8/30) = 76
    expect(estimateOneRepMax(60, 8)).toBeCloseTo(76, 10)
  })

  it('grows with reps at a fixed weight', () => {
    expect(estimateOneRepMax(100, 10)).toBeGreaterThan(estimateOneRepMax(100, 5))
  })

  it('accepts a bodyweight movement logged at zero added weight', () => {
    expect(estimateOneRepMax(0, 12)).toBe(0)
  })

  it.each([0, -1, 1.5, Number.NaN])('rejects a rep count of %s', (reps) => {
    expect(() => estimateOneRepMax(60, reps)).toThrow(RangeError)
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects a weight of %s', (weight) => {
    expect(() => estimateOneRepMax(weight, 5)).toThrow(RangeError)
  })
})
