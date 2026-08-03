import { describe, expect, it } from 'vitest'
import { crudOpSchema, SYNCED_TABLES, uploadPatchSchemas, uploadPutSchemas } from './upload-contracts'

describe('upload contracts', () => {
  it('strips server-owned columns from a PUT payload', () => {
    const parsed = uploadPutSchemas.sets.parse({
      id: '00000000-0000-4000-8000-000000000001',
      userId: 'attacker-supplied', // must be stripped
      updatedAt: new Date('2999-01-01'), // must be stripped (LWW tiebreaker)
      sessionExerciseId: '00000000-0000-4000-8000-000000000002',
      setIndex: 0,
      reps: 8,
      weightKg: 60,
      actualRestSeconds: 90,
      performedAt: new Date('2026-07-27T10:00:00Z'),
    })
    expect('userId' in parsed).toBe(false)
    expect('updatedAt' in parsed).toBe(false)
    expect(parsed.id).toBe('00000000-0000-4000-8000-000000000001')
    expect(parsed.reps).toBe(8)
  })

  it('rejects a set with invalid domain data even after stripping (reps must be positive int)', () => {
    const r = uploadPutSchemas.sets.safeParse({
      id: '00000000-0000-4000-8000-000000000001',
      sessionExerciseId: '00000000-0000-4000-8000-000000000002',
      setIndex: 0,
      reps: 0,
      weightKg: 60,
      performedAt: new Date(),
    })
    expect(r.success).toBe(false) // reps=0 still invalid
  })

  it('PATCH schema allows a partial payload (only changed columns)', () => {
    const r = uploadPatchSchemas.sets.safeParse({ reps: 10 })
    expect(r.success).toBe(true)
  })

  it('PATCH still strips server-owned columns', () => {
    const parsed = uploadPatchSchemas.sets.parse({ reps: 10, userId: 'x', updatedAt: new Date() })
    expect('userId' in parsed).toBe(false)
    expect('updatedAt' in parsed).toBe(false)
    expect(parsed.reps).toBe(10)
  })

  it('crudOpSchema validates op/table/id and rejects a bad op', () => {
    expect(
      crudOpSchema.safeParse({
        op: 'PUT',
        table: 'sets',
        id: '00000000-0000-4000-8000-000000000001',
        data: {},
      }).success,
    ).toBe(true)
    expect(
      crudOpSchema.safeParse({ op: 'NOPE', table: 'sets', id: '00000000-0000-4000-8000-000000000001' })
        .success,
    ).toBe(false)
  })

  it('SYNCED_TABLES is exactly the synced app tables (no users/token tables)', () => {
    expect([...SYNCED_TABLES].sort()).toEqual(
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
    expect(SYNCED_TABLES).not.toContain('users')
  })
})
