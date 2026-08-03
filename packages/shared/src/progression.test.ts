import { describe, it, expect } from 'vitest'
import { computeProgression } from './progression'

describe('computeProgression', () => {
  it('returns [] for no sets', () => {
    expect(computeProgression([])).toEqual([])
  })

  it('collapses a session to its top weight and best estimated 1RM', () => {
    const points = computeProgression([
      { sessionId: 's1', sessionStartedAt: '2026-01-01T10:00:00.000Z', weightKg: 60, reps: 8 },
      { sessionId: 's1', sessionStartedAt: '2026-01-01T10:00:00.000Z', weightKg: 80, reps: 1 },
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
      { sessionId: 'b', sessionStartedAt: '2026-02-01T10:00:00.000Z', weightKg: 70, reps: 5 },
      { sessionId: 'a', sessionStartedAt: '2026-01-01T10:00:00.000Z', weightKg: 60, reps: 5 },
    ])
    expect(points.map((p) => p.sessionId)).toEqual(['a', 'b'])
  })
})
