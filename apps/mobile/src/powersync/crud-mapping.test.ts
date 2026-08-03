import { describe, expect, it } from 'vitest'
import { CrudEntryLike, toUploadOp, UploadOp } from './crud-mapping'

describe('toUploadOp', () => {
  it('maps a PUT entry with opData to an upload op with data, converting snake_case column names to the camelCase wire format the server expects', () => {
    const entry: CrudEntryLike = {
      op: 'PUT',
      id: '550e8400-e29b-41d4-a716-446655440001',
      table: 'exercises',
      opData: { name: 'Squat', muscle_group: 'Legs', default_rest_seconds: 90 },
    }

    const result = toUploadOp(entry)

    expect(result).toEqual({
      op: 'PUT',
      table: 'exercises',
      id: '550e8400-e29b-41d4-a716-446655440001',
      data: { name: 'Squat', muscleGroup: 'Legs', defaultRestSeconds: 90 },
    })
  })

  it('maps a PATCH entry with partial opData to an upload op, converting to camelCase', () => {
    const entry: CrudEntryLike = {
      op: 'PATCH',
      id: '550e8400-e29b-41d4-a716-446655440002',
      table: 'sets',
      opData: { reps: 10, weight_kg: 50.5 },
    }

    const result = toUploadOp(entry)

    expect(result).toEqual({
      op: 'PATCH',
      table: 'sets',
      id: '550e8400-e29b-41d4-a716-446655440002',
      data: { reps: 10, weightKg: 50.5 },
    })
  })

  it('maps a DELETE entry to an upload op without data key', () => {
    const entry: CrudEntryLike = {
      op: 'DELETE',
      id: '550e8400-e29b-41d4-a716-446655440003',
      table: 'templates',
    }

    const result = toUploadOp(entry)

    expect(result).toEqual({
      op: 'DELETE',
      table: 'templates',
      id: '550e8400-e29b-41d4-a716-446655440003',
    })
    // Verify that data key is not present at all (not data: undefined)
    expect('data' in result).toBe(false)
  })

  it('preserves op, table, and id exactly', () => {
    const id = '550e8400-e29b-41d4-a716-446655440004'
    const table = 'session_exercises'
    const op = 'PUT'

    const entry: CrudEntryLike = {
      op,
      id,
      table,
      opData: { position: 2 },
    }

    const result = toUploadOp(entry)

    expect(result.op).toBe(op)
    expect(result.table).toBe(table)
    expect(result.id).toBe(id)
  })

  it('defaults opData to empty object when opData is undefined for PUT', () => {
    const entry: CrudEntryLike = {
      op: 'PUT',
      id: '550e8400-e29b-41d4-a716-446655440005',
      table: 'exercises',
      opData: undefined,
    }

    const result = toUploadOp(entry)

    expect(result.data).toEqual({})
  })

  it('defaults opData to empty object when opData is null for PUT', () => {
    const entry: CrudEntryLike = {
      op: 'PUT',
      id: '550e8400-e29b-41d4-a716-446655440006',
      table: 'exercises',
      opData: null,
    }

    const result = toUploadOp(entry)

    expect(result.data).toEqual({})
  })

  it('defaults opData to empty object when opData is undefined for PATCH', () => {
    const entry: CrudEntryLike = {
      op: 'PATCH',
      id: '550e8400-e29b-41d4-a716-446655440007',
      table: 'sets',
      opData: undefined,
    }

    const result = toUploadOp(entry)

    expect(result.data).toEqual({})
  })

  it('omits data key for DELETE even if opData is present', () => {
    const entry: CrudEntryLike = {
      op: 'DELETE',
      id: '550e8400-e29b-41d4-a716-446655440008',
      table: 'sets',
      opData: { reps: 12 }, // Should be ignored for DELETE
    }

    const result = toUploadOp(entry)

    expect(result).toEqual({
      op: 'DELETE',
      table: 'sets',
      id: '550e8400-e29b-41d4-a716-446655440008',
    })
    expect('data' in result).toBe(false)
  })

  it('converts multi-underscore column names (e.g. session_exercise_id) to camelCase', () => {
    const entry: CrudEntryLike = {
      op: 'PUT',
      id: '550e8400-e29b-41d4-a716-446655440009',
      table: 'sets',
      opData: {
        session_exercise_id: 'se-1',
        actual_rest_seconds: 45,
        performed_at: '2026-07-28T00:00:00.000Z',
        user_id: 'user-1',
      },
    }

    const result = toUploadOp(entry)

    expect(result.data).toEqual({
      sessionExerciseId: 'se-1',
      actualRestSeconds: 45,
      performedAt: '2026-07-28T00:00:00.000Z',
      userId: 'user-1',
    })
  })

  it('coerces exercises.is_custom from a SQLite 0/1 integer to a real boolean', () => {
    const entryTrue: CrudEntryLike = {
      op: 'PUT',
      id: '550e8400-e29b-41d4-a716-446655440010',
      table: 'exercises',
      opData: { name: 'Bench', is_custom: 1 },
    }
    const entryFalse: CrudEntryLike = {
      op: 'PUT',
      id: '550e8400-e29b-41d4-a716-446655440011',
      table: 'exercises',
      opData: { name: 'Bench', is_custom: 0 },
    }

    expect(toUploadOp(entryTrue).data).toEqual({ name: 'Bench', isCustom: true })
    expect(toUploadOp(entryFalse).data).toEqual({ name: 'Bench', isCustom: false })
  })

  it('leaves is_custom untouched on non-exercises tables (no such column) and on other tables generally', () => {
    const entry: CrudEntryLike = {
      op: 'PUT',
      id: '550e8400-e29b-41d4-a716-446655440012',
      table: 'templates',
      opData: { name: 'Push Day' },
    }

    expect(toUploadOp(entry).data).toEqual({ name: 'Push Day' })
  })
})
