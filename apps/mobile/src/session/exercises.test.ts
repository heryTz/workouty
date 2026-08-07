import { describe, expect, it, vi } from 'vitest'
import { addCustomExercise, groupExercises, type ExerciseRow } from './exercises'

function row(overrides: Partial<ExerciseRow>): ExerciseRow {
  return {
    id: 'id',
    user_id: null,
    name: 'Exercise',
    muscle_group: 'chest',
    default_rest_seconds: 90,
    effective_rest_seconds: 90,
    is_custom: 0,
    last_used_at: null,
    ...overrides,
  }
}

describe('groupExercises', () => {
  it('splits rows with a last_used_at into recents, preserving their (already-recency-sorted) order', () => {
    const rows = [
      row({ id: '1', name: 'Bench', last_used_at: '2026-07-20T00:00:00.000Z' }),
      row({ id: '2', name: 'Squat', last_used_at: '2026-07-10T00:00:00.000Z' }),
    ]

    const { recents, groups } = groupExercises(rows)

    expect(recents.map((r) => r.id)).toEqual(['1', '2'])
    expect(groups).toEqual([])
  })

  it('buckets never-used rows into consecutive-same-muscle-group groups, preserving input order', () => {
    const rows = [
      row({ id: '1', name: 'Bicep curl', muscle_group: 'arms' }),
      row({ id: '2', name: 'Hammer curl', muscle_group: 'arms' }),
      row({ id: '3', name: 'Bench press', muscle_group: 'chest' }),
    ]

    const { recents, groups } = groupExercises(rows)

    expect(recents).toEqual([])
    expect(groups).toEqual([
      { muscleGroup: 'arms', exercises: [rows[0], rows[1]] },
      { muscleGroup: 'chest', exercises: [rows[2]] },
    ])
  })

  it('does not merge two non-adjacent runs of the same muscle group into one bucket', () => {
    // Not expected from the real query (which sorts by muscle_group), but groupExercises
    // itself is a single linear pass and should not silently merge non-adjacent runs.
    const rows = [
      row({ id: '1', name: 'A', muscle_group: 'arms' }),
      row({ id: '2', name: 'B', muscle_group: 'chest' }),
      row({ id: '3', name: 'C', muscle_group: 'arms' }),
    ]

    const { groups } = groupExercises(rows)

    expect(groups).toEqual([
      { muscleGroup: 'arms', exercises: [rows[0]] },
      { muscleGroup: 'chest', exercises: [rows[1]] },
      { muscleGroup: 'arms', exercises: [rows[2]] },
    ])
  })

  it('puts recents before groups regardless of interleaving in the input', () => {
    const rows = [
      row({ id: '1', name: 'Never used', muscle_group: 'legs' }),
      row({ id: '2', name: 'Used recently', muscle_group: 'chest', last_used_at: '2026-07-20T00:00:00.000Z' }),
    ]

    const { recents, groups } = groupExercises(rows)

    expect(recents.map((r) => r.id)).toEqual(['2'])
    expect(groups.map((g) => g.muscleGroup)).toEqual(['legs'])
  })

  it('handles an empty input', () => {
    expect(groupExercises([])).toEqual({ recents: [], groups: [] })
  })
})

describe('addCustomExercise', () => {
  it('inserts a custom exercise with is_custom=1, the given user/name/muscle_group, and the default rest interval', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)

    const id = await addCustomExercise({ execute }, { name: 'My Curl', muscleGroup: 'arms', userId: 'user-1' })

    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)

    expect(execute).toHaveBeenCalledTimes(1)
    const [sql, params] = execute.mock.calls[0] as [string, unknown[]]
    expect(sql).toMatch(/INSERT INTO exercises/)
    expect(sql).toMatch(/is_custom/)

    const [insertedId, userId, name, muscleGroup, defaultRestSeconds, loadType, measure, createdAt, updatedAt] = params
    expect(insertedId).toBe(id)
    expect(userId).toBe('user-1')
    expect(name).toBe('My Curl')
    expect(muscleGroup).toBe('arms')
    expect(defaultRestSeconds).toBe(90)
    // Unspecified by this caller, so the pre-0003 behaviour: a weight moved for reps.
    expect(loadType).toBe('external')
    expect(measure).toBe('reps')
    expect(createdAt).toBe(updatedAt)
    expect(() => new Date(createdAt as string).toISOString()).not.toThrow()
  })

  it('persists an explicit load type and measure, so a custom plank is not stored as a barbell lift', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)

    await addCustomExercise(
      { execute },
      { name: 'Dead hang', muscleGroup: 'back', userId: 'user-1', loadType: 'bodyweight', measure: 'duration' },
    )

    const [, params] = execute.mock.calls[0] as [string, unknown[]]
    expect(params[5]).toBe('bodyweight')
    expect(params[6]).toBe('duration')
  })

  it('trims the exercise name before inserting', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)

    await addCustomExercise({ execute }, { name: '  Padded Name  ', muscleGroup: 'core', userId: 'user-1' })

    const [, params] = execute.mock.calls[0] as [string, unknown[]]
    expect(params[2]).toBe('Padded Name')
  })

  it('generates a different id on every call', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)

    const id1 = await addCustomExercise({ execute }, { name: 'A', muscleGroup: 'core', userId: 'user-1' })
    const id2 = await addCustomExercise({ execute }, { name: 'B', muscleGroup: 'core', userId: 'user-1' })

    expect(id1).not.toBe(id2)
  })
})
