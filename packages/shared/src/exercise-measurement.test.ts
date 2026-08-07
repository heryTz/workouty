import { describe, it, expect } from 'vitest'
import { DEFAULT_MEASUREMENT, metricsFor } from './exercise-measurement'

const metrics = (loadType: 'external' | 'bodyweight', measure: 'reps' | 'duration') =>
  [...metricsFor({ loadType, measure })].sort()

describe('metricsFor', () => {
  it('gives an external rep exercise the load metrics and no reps PR', () => {
    expect(metrics('external', 'reps')).toEqual(['estimatedOneRepMax', 'setVolume', 'weight'])
  })

  it('gives a bodyweight rep exercise reps instead of the load metrics', () => {
    expect(metrics('bodyweight', 'reps')).toEqual(['reps', 'weight'])
  })

  it('gives duration exercises the hold, whether or not they carry external load', () => {
    expect(metrics('bodyweight', 'duration')).toEqual(['duration', 'weight'])
    expect(metrics('external', 'duration')).toEqual(['duration', 'weight'])
  })

  it('always includes weight — moving the load up is progress under either load type', () => {
    for (const loadType of ['external', 'bodyweight'] as const) {
      for (const measure of ['reps', 'duration'] as const) {
        expect(metrics(loadType, measure)).toContain('weight')
      }
    }
  })

  it('never pairs reps with the load metrics — they are alternative readings of the same set', () => {
    for (const loadType of ['external', 'bodyweight'] as const) {
      const m = metrics(loadType, 'reps')
      expect(m.includes('reps') && m.includes('estimatedOneRepMax')).toBe(false)
    }
  })

  it('defaults to the pre-0003 behaviour, so an unmigrated caller keeps its old metrics', () => {
    expect([...metricsFor(DEFAULT_MEASUREMENT)].sort()).toEqual(metrics('external', 'reps'))
  })
})
