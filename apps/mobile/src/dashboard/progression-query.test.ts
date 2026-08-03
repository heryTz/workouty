import { describe, it, expect } from 'vitest'
import { progressionSetsSql, mapProgressionRows } from './progression-query'

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
})

describe('mapProgressionRows', () => {
  it('maps rows to a chronological one-point-per-session series', () => {
    const points = mapProgressionRows([
      { session_id: 's1', started_at: '2026-01-01T10:00:00.000Z', weight_kg: 60, reps: 8 },
      { session_id: 's1', started_at: '2026-01-01T10:00:00.000Z', weight_kg: 80, reps: 1 },
    ])
    expect(points).toHaveLength(1)
    expect(points[0].topWeightKg).toBe(80)
    expect(points[0].bestEstimatedOneRepMax).toBeCloseTo(80, 10)
  })

  it('returns one point per session, oldest first', () => {
    const points = mapProgressionRows([
      { session_id: 's2', started_at: '2026-01-08T10:00:00.000Z', weight_kg: 70, reps: 5 },
      { session_id: 's1', started_at: '2026-01-01T10:00:00.000Z', weight_kg: 60, reps: 8 },
    ])
    expect(points).toHaveLength(2)
    expect(points.map((p) => p.sessionId)).toEqual(['s1', 's2'])
  })

  it('returns an empty series for no rows', () => {
    expect(mapProgressionRows([])).toEqual([])
  })
})
