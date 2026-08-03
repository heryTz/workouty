import { describe, it, expect } from 'vitest'
import { prSetsSql, mapPrSetIds } from './pr-set-ids-query'

describe('prSetsSql', () => {
  it('filters by exercise and excludes soft-deleted rows', () => {
    const { sql, params } = prSetsSql('ex-1')
    expect(sql).toMatch(/se\.exercise_id = \?/)
    expect(sql).toMatch(/se\.deleted_at IS NULL/)
    expect(sql).toMatch(/s\.deleted_at IS NULL/)
    expect(params).toEqual(['ex-1'])
  })
})

describe('mapPrSetIds', () => {
  it('returns only the sets that are a weight or estimated-1RM PR', () => {
    const ids = mapPrSetIds([
      { id: 'set-1', performed_at: '2026-01-01T10:00:00.000Z', weight_kg: 60, reps: 5 },
      { id: 'set-2', performed_at: '2026-01-08T10:00:00.000Z', weight_kg: 65, reps: 5 },
    ])
    expect(ids).toEqual(new Set(['set-2']))
  })

  it('returns an empty set when there is no history', () => {
    expect(mapPrSetIds([])).toEqual(new Set())
  })
})
