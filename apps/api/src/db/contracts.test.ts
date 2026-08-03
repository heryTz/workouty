import { describe, expect, it } from 'vitest'
import { insertExerciseSchema, insertSetSchema } from './contracts'

const validSet = {
  userId: '00000000-0000-4000-8000-000000000001',
  sessionExerciseId: '00000000-0000-4000-8000-000000000002',
  setIndex: 0,
  reps: 8,
  weightKg: 60,
  actualRestSeconds: 90,
  performedAt: new Date('2026-07-09T10:00:00Z'),
}

describe('insertSetSchema', () => {
  it('accepts a well-formed set', () => {
    expect(insertSetSchema.safeParse(validSet).success).toBe(true)
  })

  it('accepts a null rest, which is how the final set of an exercise is recorded', () => {
    const result = insertSetSchema.safeParse({ ...validSet, actualRestSeconds: null })
    expect(result.success).toBe(true)
  })

  it('rejects a set with no owner, which sync rules could never scope', () => {
    const { userId: _omitted, ...orphan } = validSet
    expect(insertSetSchema.safeParse(orphan).success).toBe(false)
  })

  it.each([0, -3, 2.5])('rejects a rep count of %s', (reps) => {
    expect(insertSetSchema.safeParse({ ...validSet, reps }).success).toBe(false)
  })

  it('rejects a negative weight', () => {
    expect(insertSetSchema.safeParse({ ...validSet, weightKg: -1 }).success).toBe(false)
  })

  it('accepts a zero weight for bodyweight movements', () => {
    expect(insertSetSchema.safeParse({ ...validSet, weightKg: 0 }).success).toBe(true)
  })

  it('rejects a negative rest duration', () => {
    expect(insertSetSchema.safeParse({ ...validSet, actualRestSeconds: -1 }).success).toBe(false)
  })
})

describe('insertExerciseSchema', () => {
  const validExercise = { name: 'Bench press', muscleGroup: 'chest' }

  it('rejects an empty name', () => {
    expect(insertExerciseSchema.safeParse({ ...validExercise, name: '' }).success).toBe(false)
  })

  it('rejects a name longer than 120 characters', () => {
    const tooLong = 'a'.repeat(121)
    expect(insertExerciseSchema.safeParse({ ...validExercise, name: tooLong }).success).toBe(false)
  })

  it('accepts a name of exactly 120 characters', () => {
    const atLimit = 'a'.repeat(120)
    expect(insertExerciseSchema.safeParse({ ...validExercise, name: atLimit }).success).toBe(true)
  })
})
