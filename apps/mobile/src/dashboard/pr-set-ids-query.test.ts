import { describe, it, expect } from 'vitest'
import { prSetsSql, mapPrSetIds } from './pr-set-ids-query'

const externalRep = (id: string, performed_at: string, weight_kg: number, reps: number) =>
  ({ id, performed_at, weight_kg, reps, duration_seconds: null, load_type: 'external', measure: 'reps' }) as const

const bodyweightRep = (id: string, performed_at: string, weight_kg: number, reps: number) =>
  ({ id, performed_at, weight_kg, reps, duration_seconds: null, load_type: 'bodyweight', measure: 'reps' }) as const

const hold = (id: string, performed_at: string, weight_kg: number, duration_seconds: number) =>
  ({
    id,
    performed_at,
    weight_kg,
    reps: null,
    duration_seconds,
    load_type: 'bodyweight',
    measure: 'duration',
  }) as const

describe('prSetsSql', () => {
  it('filters by exercise and excludes soft-deleted rows', () => {
    const { sql, params } = prSetsSql('ex-1')
    expect(sql).toMatch(/se\.exercise_id = \?/)
    expect(sql).toMatch(/se\.deleted_at IS NULL/)
    expect(sql).toMatch(/s\.deleted_at IS NULL/)
    expect(params).toEqual(['ex-1'])
  })

  it('selects the columns PR scoring depends on, including the exercise measurement', () => {
    const { sql } = prSetsSql('ex-1')
    expect(sql).toMatch(/s\.duration_seconds/)
    expect(sql).toMatch(/e\.load_type/)
    expect(sql).toMatch(/e\.measure/)
  })
})

describe('mapPrSetIds', () => {
  it('returns only the sets that are a weight or estimated-1RM PR', () => {
    const ids = mapPrSetIds([
      externalRep('set-1', '2026-01-01T10:00:00.000Z', 60, 5),
      externalRep('set-2', '2026-01-08T10:00:00.000Z', 65, 5),
    ])
    expect(ids).toEqual(new Set(['set-2']))
  })

  it('returns an empty set when there is no history', () => {
    expect(mapPrSetIds([])).toEqual(new Set())
  })

  it('badges a bodyweight rep PR, which carries no weight increase at all', () => {
    // Both sets are unweighted, so the weight dimension never moves. Before load_type/measure
    // reached this query these sets scored as external and no PR was ever badged.
    const ids = mapPrSetIds([
      bodyweightRep('set-1', '2026-01-01T10:00:00.000Z', 0, 8),
      bodyweightRep('set-2', '2026-01-08T10:00:00.000Z', 0, 12),
    ])
    expect(ids).toEqual(new Set(['set-2']))
  })

  it('badges a longer hold and a heavier weighted hold, but not an equal one', () => {
    const ids = mapPrSetIds([
      hold('set-1', '2026-01-01T10:00:00.000Z', 0, 60),
      hold('set-2', '2026-01-08T10:00:00.000Z', 0, 90),
      hold('set-3', '2026-01-15T10:00:00.000Z', 0, 90),
      hold('set-4', '2026-01-22T10:00:00.000Z', 10, 45),
    ])
    expect(ids).toEqual(new Set(['set-2', 'set-4']))
  })
})
