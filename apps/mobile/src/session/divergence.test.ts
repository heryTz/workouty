import { describe, expect, it } from 'vitest'
import { diffExerciseLists, exerciseListDiverged } from './divergence'

describe('exerciseListDiverged', () => {
  it('is false for identical ordered arrays', () => {
    expect(exerciseListDiverged(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(false)
  })

  it('is false for empty vs empty', () => {
    expect(exerciseListDiverged([], [])).toBe(false)
  })

  it('is true when the session has an extra exercise', () => {
    expect(exerciseListDiverged(['a', 'b', 'c'], ['a', 'b'])).toBe(true)
  })

  it('is true when the session is missing an exercise', () => {
    expect(exerciseListDiverged(['a', 'b'], ['a', 'b', 'c'])).toBe(true)
  })

  it('is true when the same ids appear in a different order (swap)', () => {
    expect(exerciseListDiverged(['b', 'a', 'c'], ['a', 'b', 'c'])).toBe(true)
  })

  it('is true for a mix of add and remove', () => {
    expect(exerciseListDiverged(['a', 'd'], ['a', 'b'])).toBe(true)
  })
})

describe('diffExerciseLists', () => {
  it('reports no changes for identical arrays', () => {
    expect(diffExerciseLists(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual({
      added: [],
      removed: [],
      reordered: false,
    })
  })

  it('reports no changes for empty vs empty', () => {
    expect(diffExerciseLists([], [])).toEqual({ added: [], removed: [], reordered: false })
  })

  it('lists an extra session exercise as added', () => {
    expect(diffExerciseLists(['a', 'b', 'c'], ['a', 'b'])).toEqual({
      added: ['c'],
      removed: [],
      reordered: false,
    })
  })

  it('lists a missing session exercise as removed', () => {
    expect(diffExerciseLists(['a', 'b'], ['a', 'b', 'c'])).toEqual({
      added: [],
      removed: ['c'],
      reordered: false,
    })
  })

  it('flags a same-set reorder (swap) as reordered, with no adds/removes', () => {
    expect(diffExerciseLists(['b', 'a', 'c'], ['a', 'b', 'c'])).toEqual({
      added: [],
      removed: [],
      reordered: true,
    })
  })

  it('reports both added and removed for a mixed change, and does not flag reordered', () => {
    expect(diffExerciseLists(['a', 'd'], ['a', 'b'])).toEqual({
      added: ['d'],
      removed: ['b'],
      reordered: false,
    })
  })

  it('handles a duplicated exercise id via position-order comparison: the length mismatch alone marks it diverged, and since the id sets are equal (no true add/remove), reordered is true', () => {
    // Session logged the same exercise twice (unlikely in practice, but the template only lists
    // it once). Set-difference sees no added/removed ids (both sides contain "a"), so the extra
    // occurrence surfaces as a "same set, different arrangement" -- reordered.
    const diff = diffExerciseLists(['a', 'a'], ['a'])
    expect(exerciseListDiverged(['a', 'a'], ['a'])).toBe(true)
    expect(diff).toEqual({ added: [], removed: [], reordered: true })
  })
})
