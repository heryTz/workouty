import { describe, expect, it } from 'vitest'
import { formatSetPerformance } from './set-format'

describe('formatSetPerformance', () => {
  it('reads an external-load rep set as reps × weight', () => {
    expect(
      formatSetPerformance({ load_type: 'external', measure: 'reps' }, { reps: 8, durationSeconds: null, weightKg: 60 }),
    ).toBe('8 × 60kg')
  })

  it('drops the weight entirely for an unweighted bodyweight set', () => {
    expect(
      formatSetPerformance(
        { load_type: 'bodyweight', measure: 'reps' },
        { reps: 12, durationSeconds: null, weightKg: 0 },
      ),
    ).toBe('12')
  })

  it('shows added load on a weighted bodyweight set as a "+"', () => {
    expect(
      formatSetPerformance({ load_type: 'bodyweight', measure: 'reps' }, { reps: 5, durationSeconds: null, weightKg: 20 }),
    ).toBe('5 +20kg')
  })

  it('reads a bodyweight hold as bare seconds', () => {
    expect(
      formatSetPerformance(
        { load_type: 'bodyweight', measure: 'duration' },
        { reps: null, durationSeconds: 60, weightKg: 0 },
      ),
    ).toBe('60s')
  })

  it('shows added load on a weighted hold', () => {
    expect(
      formatSetPerformance(
        { load_type: 'bodyweight', measure: 'duration' },
        { reps: null, durationSeconds: 60, weightKg: 10 },
      ),
    ).toBe('60s +10kg')
  })

  it('reads an external-load hold as seconds × weight', () => {
    expect(
      formatSetPerformance(
        { load_type: 'external', measure: 'duration' },
        { reps: null, durationSeconds: 45, weightKg: 15 },
      ),
    ).toBe('45s × 15kg')
  })

  it('falls back to zero when the row is missing the measure it should carry', () => {
    expect(
      formatSetPerformance({ load_type: 'external', measure: 'reps' }, { reps: null, durationSeconds: null, weightKg: 40 }),
    ).toBe('0 × 40kg')
  })
})
