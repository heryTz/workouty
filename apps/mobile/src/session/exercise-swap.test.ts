import { describe, expect, it } from 'vitest'
import { swapCandidatesSql } from './exercise-swap'

describe('swapCandidatesSql', () => {
  const { sql, params } = swapCandidatesSql({
    loadType: 'external',
    measure: 'reps',
    excludeExerciseId: 'ex-current',
    muscleGroup: 'chest',
    search: '',
  })

  it('offers only exercises logged the same way, so the sets already logged stay valid', () => {
    expect(sql).toMatch(/e\.load_type = \?/)
    expect(sql).toMatch(/e\.measure = \?/)
    expect(params.slice(0, 2)).toEqual(['external', 'reps'])
  })

  it('leaves out the exercise being replaced', () => {
    expect(sql).toMatch(/e\.id != \?/)
    expect(params).toContain('ex-current')
  })

  it('leaves out deleted exercises', () => {
    expect(sql).toMatch(/e\.deleted_at IS NULL/)
  })

  it('puts the same muscle group first, where the plausible swap lives', () => {
    expect(sql).toMatch(/ORDER BY\s+\(e\.muscle_group = \?\) DESC/i)
    expect(sql).toMatch(/e\.muscle_group ASC/)
    expect(sql).toMatch(/e\.name ASC/)
    expect(params).toContain('chest')
  })

  it('matches an empty search against every name', () => {
    expect(params).toContain('%%')
  })

  it('matches a search as a substring of the name, trimmed', () => {
    const { params: searched } = swapCandidatesSql({
      loadType: 'bodyweight',
      measure: 'duration',
      excludeExerciseId: 'ex-current',
      muscleGroup: 'core',
      search: '  plank ',
    })
    expect(searched).toContain('%plank%')
  })

  it('caps the list so a long library cannot flood the card', () => {
    expect(sql).toMatch(/LIMIT \d+/)
  })

  it('binds every value as a parameter rather than interpolating it', () => {
    const { sql: injected } = swapCandidatesSql({
      loadType: 'external',
      measure: 'reps',
      excludeExerciseId: "x'; DROP TABLE exercises; --",
      muscleGroup: 'chest',
      search: "'; DROP TABLE exercises; --",
    })
    expect(injected).not.toMatch(/DROP TABLE/)
  })
})
