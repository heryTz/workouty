import { describe, expect, it } from 'vitest'
import { AppSchema } from './schema'

describe('AppSchema', () => {
  it('defines exactly the synced tables', () => {
    const tableNames = AppSchema.tables.map((t) => t.name).sort()
    expect(tableNames).toEqual(
      [
        'exercise_rest_prefs',
        'exercises',
        'session_exercises',
        'sessions',
        'sets',
        'template_exercises',
        'templates',
      ].sort(),
    )
  })

  it('defines the sets table with the expected columns', () => {
    const sets = AppSchema.tables.find((t) => t.name === 'sets')
    expect(sets).toBeDefined()
    const columnNames = sets!.columns.map((c) => c.name)
    expect(columnNames).toEqual(
      expect.arrayContaining([
        'user_id',
        'session_exercise_id',
        'set_index',
        'reps',
        'weight_kg',
        'actual_rest_seconds',
        'performed_at',
        'created_at',
        'updated_at',
        'deleted_at',
      ]),
    )
    // Guard against a half-edited file: id must NOT be declared (PowerSync adds it).
    expect(columnNames).not.toContain('id')
  })
})
