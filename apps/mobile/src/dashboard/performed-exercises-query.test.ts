import { describe, it, expect } from 'vitest'
import { performedExercisesSql } from './performed-exercises-query'

describe('performedExercisesSql', () => {
  it('selects distinct exercises', () => {
    expect(performedExercisesSql).toMatch(/SELECT DISTINCT/)
  })

  it('excludes soft-deleted sets and session_exercises', () => {
    expect(performedExercisesSql).toMatch(/se\.deleted_at IS NULL/)
    expect(performedExercisesSql).toMatch(/s\.deleted_at IS NULL/)
  })

  it('orders alphabetically by exercise name', () => {
    expect(performedExercisesSql).toMatch(/ORDER BY\s+e\.name ASC/i)
  })
})
