import { describe, it, expect } from 'vitest'
import { personalRecordsSql, mapPersonalRecordRows } from './personal-records-query'

const row = (
  exercise_id: string,
  name: string,
  id: string,
  performed_at: string,
  weight_kg: number,
  reps: number,
) =>
  ({
    exercise_id,
    name,
    id,
    performed_at,
    weight_kg,
    reps,
    duration_seconds: null,
    load_type: 'external',
    measure: 'reps',
  }) as const

const holdRow = (
  exercise_id: string,
  name: string,
  id: string,
  performed_at: string,
  weight_kg: number,
  duration_seconds: number,
) =>
  ({
    exercise_id,
    name,
    id,
    performed_at,
    weight_kg,
    reps: null,
    duration_seconds,
    load_type: 'bodyweight',
    measure: 'duration',
  }) as const

describe('personalRecordsSql', () => {
  it('excludes soft-deleted sets and session_exercises', () => {
    expect(personalRecordsSql).toMatch(/se\.deleted_at IS NULL/)
    expect(personalRecordsSql).toMatch(/s\.deleted_at IS NULL/)
  })

  it('orders by exercise name then performed_at, so rows group by exercise', () => {
    expect(personalRecordsSql).toMatch(/ORDER BY\s+e\.name ASC,\s*s\.performed_at ASC/i)
  })

  it('selects the exercise measurement, which decides which bests apply', () => {
    expect(personalRecordsSql).toMatch(/e\.load_type/)
    expect(personalRecordsSql).toMatch(/e\.measure/)
    expect(personalRecordsSql).toMatch(/s\.duration_seconds/)
  })
})

describe('mapPersonalRecordRows', () => {
  it('groups rows by exercise and computes a personal best per exercise', () => {
    const records = mapPersonalRecordRows([
      row('ex-1', 'Bench Press', 'set-1', '2026-01-01T10:00:00.000Z', 60, 5),
      row('ex-1', 'Bench Press', 'set-2', '2026-01-08T10:00:00.000Z', 70, 5),
      row('ex-2', 'Squat', 'set-3', '2026-01-01T10:00:00.000Z', 100, 3),
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

  it('scores each exercise by its own measurement within one result set', () => {
    // A mixed dashboard is the normal case: the plank must not be scored as a bench press just
    // because they arrive from the same query.
    const records = mapPersonalRecordRows([
      row('ex-1', 'Bench Press', 'set-1', '2026-01-01T10:00:00.000Z', 60, 5),
      holdRow('ex-2', 'Plank', 'set-2', '2026-01-01T10:00:00.000Z', 0, 60),
      holdRow('ex-2', 'Plank', 'set-3', '2026-01-08T10:00:00.000Z', 10, 90),
    ])

    const bench = records.find((r) => r.exerciseId === 'ex-1')!
    expect(bench.measurement).toEqual({ loadType: 'external', measure: 'reps' })
    expect(bench.best.bestEstimatedOneRepMax).not.toBeNull()
    expect(bench.best.bestDurationSeconds).toBeNull()

    const plank = records.find((r) => r.exerciseId === 'ex-2')!
    expect(plank.measurement).toEqual({ loadType: 'bodyweight', measure: 'duration' })
    expect(plank.best.bestDurationSeconds).toBe(90)
    expect(plank.best.bestWeightKg).toBe(10)
    expect(plank.best.bestEstimatedOneRepMax).toBeNull()
    expect(plank.best.bestSetVolume).toBeNull()
  })
})
