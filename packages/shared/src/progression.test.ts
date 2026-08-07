import { describe, it, expect } from 'vitest'
import type { ExerciseMeasurement } from './exercise-measurement'
import { computeProgression } from './progression'

const W = (sessionId: string, sessionStartedAt: string, weightKg: number, reps: number) => ({
  sessionId,
  sessionStartedAt,
  weightKg,
  reps,
  durationSeconds: null,
})

const HELD = (sessionId: string, sessionStartedAt: string, weightKg: number, durationSeconds: number) => ({
  sessionId,
  sessionStartedAt,
  weightKg,
  reps: null,
  durationSeconds,
})

const BODYWEIGHT_REPS: ExerciseMeasurement = { loadType: 'bodyweight', measure: 'reps' }
const BODYWEIGHT_DURATION: ExerciseMeasurement = { loadType: 'bodyweight', measure: 'duration' }

describe('computeProgression', () => {
  it('returns [] for no sets', () => {
    expect(computeProgression([])).toEqual([])
  })

  it('collapses a session to its top weight and best estimated 1RM', () => {
    const points = computeProgression([
      W('s1', '2026-01-01T10:00:00.000Z', 60, 8),
      W('s1', '2026-01-01T10:00:00.000Z', 80, 1),
    ])
    expect(points).toHaveLength(1)
    // top weight = 80 (the single). best e1RM: 60×(1+8/30)=76 vs 80 (reps=1 ⇒ unchanged) ⇒ 80.
    expect(points[0]!.topWeightKg).toBe(80)
    expect(points[0]!.bestEstimatedOneRepMax).toBeCloseTo(80, 10)
    expect(points[0]!.date).toBe('2026-01-01T10:00:00.000Z')
    expect(points[0]!.sessionId).toBe('s1')
  })

  it('produces one chronological point per session, oldest first', () => {
    const points = computeProgression([
      W('b', '2026-02-01T10:00:00.000Z', 70, 5),
      W('a', '2026-01-01T10:00:00.000Z', 60, 5),
    ])
    expect(points.map((p) => p.sessionId)).toEqual(['a', 'b'])
  })

  it('carries a bodyweight session on best reps, with no 1RM series to plot', () => {
    // Every set is unweighted, so topWeightKg is a flat zero and bestReps is the only series
    // that moves — which is the whole reason it exists.
    const points = computeProgression(
      [W('s1', '2026-01-01T10:00:00.000Z', 0, 8), W('s1', '2026-01-01T10:00:00.000Z', 0, 12)],
      BODYWEIGHT_REPS,
    )
    expect(points[0]!.bestReps).toBe(12)
    expect(points[0]!.topWeightKg).toBe(0)
    expect(points[0]!.bestEstimatedOneRepMax).toBeNull()
    expect(points[0]!.bestDurationSeconds).toBeNull()
  })

  it('carries a duration session on the longest hold and the heaviest added load', () => {
    const points = computeProgression(
      [HELD('s1', '2026-01-01T10:00:00.000Z', 0, 90), HELD('s1', '2026-01-01T10:00:00.000Z', 10, 60)],
      BODYWEIGHT_DURATION,
    )
    expect(points[0]!.bestDurationSeconds).toBe(90)
    expect(points[0]!.topWeightKg).toBe(10)
    expect(points[0]!.bestReps).toBeNull()
    expect(points[0]!.bestEstimatedOneRepMax).toBeNull()
  })
})
