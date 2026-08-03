import { describe, it, expect } from 'vitest'
import { personalRecordsSql, mapPersonalRecordRows } from './personal-records-query'

describe('personalRecordsSql', () => {
  it('excludes soft-deleted sets and session_exercises', () => {
    expect(personalRecordsSql).toMatch(/se\.deleted_at IS NULL/)
    expect(personalRecordsSql).toMatch(/s\.deleted_at IS NULL/)
  })

  it('orders by exercise name then performed_at, so rows group by exercise', () => {
    expect(personalRecordsSql).toMatch(/ORDER BY\s+e\.name ASC,\s*s\.performed_at ASC/i)
  })
})

describe('mapPersonalRecordRows', () => {
  it('groups rows by exercise and computes a personal best per exercise', () => {
    const records = mapPersonalRecordRows([
      { exercise_id: 'ex-1', name: 'Bench Press', id: 'set-1', performed_at: '2026-01-01T10:00:00.000Z', weight_kg: 60, reps: 5 },
      { exercise_id: 'ex-1', name: 'Bench Press', id: 'set-2', performed_at: '2026-01-08T10:00:00.000Z', weight_kg: 70, reps: 5 },
      { exercise_id: 'ex-2', name: 'Squat', id: 'set-3', performed_at: '2026-01-01T10:00:00.000Z', weight_kg: 100, reps: 3 },
    ])

    expect(records).toHaveLength(2)
    const bench = records.find((r) => r.exerciseId === 'ex-1')
    expect(bench?.name).toBe('Bench Press')
    expect(bench?.best.bestWeightKg).toBe(70)

    const squat = records.find((r) => r.exerciseId === 'ex-2')
    expect(squat?.best.bestWeightKg).toBe(100)
  })

  it('drops exercises whose best is null (no rows)', () => {
    const records = mapPersonalRecordRows([])
    expect(records).toEqual([])
  })
})
