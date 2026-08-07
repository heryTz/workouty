import { describe, it, expect } from 'vitest'
import { progressionSetsSql, mapProgressionRows } from './progression-query'

const externalRep = (session_id: string, started_at: string, weight_kg: number, reps: number) =>
  ({
    session_id,
    started_at,
    weight_kg,
    reps,
    duration_seconds: null,
    load_type: 'external',
    measure: 'reps',
  }) as const

const hold = (session_id: string, started_at: string, weight_kg: number, duration_seconds: number) =>
  ({
    session_id,
    started_at,
    weight_kg,
    reps: null,
    duration_seconds,
    load_type: 'bodyweight',
    measure: 'duration',
  }) as const

describe('progressionSetsSql', () => {
  it('filters by exercise and excludes soft-deleted rows and sessions', () => {
    const { sql, params } = progressionSetsSql('ex-1')
    expect(sql).toMatch(/se\.exercise_id = \?/)
    expect(sql).toMatch(/se\.deleted_at IS NULL/)
    expect(sql).toMatch(/s\.deleted_at IS NULL/)
    expect(sql).toMatch(/sess\.deleted_at IS NULL/)
    expect(params).toEqual(['ex-1'])
  })

  it('binds the exercise id as a parameter, not interpolated into the SQL', () => {
    const { sql, params } = progressionSetsSql("ex-1'; DROP TABLE sets; --")
    expect(sql).not.toMatch(/DROP TABLE/)
    expect(params).toEqual(["ex-1'; DROP TABLE sets; --"])
  })

  it('selects duration and the exercise measurement, which decide the plottable series', () => {
    const { sql } = progressionSetsSql('ex-1')
    expect(sql).toMatch(/s\.duration_seconds/)
    expect(sql).toMatch(/e\.load_type/)
    expect(sql).toMatch(/e\.measure/)
  })
})

describe('mapProgressionRows', () => {
  it('maps rows to a chronological one-point-per-session series', () => {
    const points = mapProgressionRows([
      externalRep('s1', '2026-01-01T10:00:00.000Z', 60, 8),
      externalRep('s1', '2026-01-01T10:00:00.000Z', 80, 1),
    ])
    expect(points).toHaveLength(1)
    expect(points[0].topWeightKg).toBe(80)
    expect(points[0].bestEstimatedOneRepMax).toBeCloseTo(80, 10)
  })

  it('returns one point per session, oldest first', () => {
    const points = mapProgressionRows([
      externalRep('s2', '2026-01-08T10:00:00.000Z', 70, 5),
      externalRep('s1', '2026-01-01T10:00:00.000Z', 60, 8),
    ])
    expect(points).toHaveLength(2)
    expect(points.map((p) => p.sessionId)).toEqual(['s1', 's2'])
  })

  it('returns an empty series for no rows', () => {
    expect(mapProgressionRows([])).toEqual([])
  })

  it('carries a duration exercise on the hold series, with no 1RM to plot', () => {
    const points = mapProgressionRows([
      hold('s1', '2026-01-01T10:00:00.000Z', 0, 60),
      hold('s1', '2026-01-01T10:00:00.000Z', 0, 90),
    ])
    expect(points[0].bestDurationSeconds).toBe(90)
    expect(points[0].bestEstimatedOneRepMax).toBeNull()
  })
})
