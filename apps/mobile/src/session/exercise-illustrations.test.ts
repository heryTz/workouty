import { describe, expect, it } from 'vitest'
import { EXERCISE_ILLUSTRATIONS, getIllustration } from './exercise-illustrations'

describe('getIllustration', () => {
  it('finds the drawing mapped to a built-in exercise', () => {
    expect(getIllustration('Bench press (barbell)')).toEqual({
      slug: '0042',
      title: 'Bench Press',
    })
  })

  it('returns null for a built-in with no drawing', () => {
    // Everkinetic has no plain plank — only a side plank, which is a different exercise.
    expect(getIllustration('Plank')).toBeNull()
  })

  it('returns null for a custom exercise', () => {
    expect(getIllustration('My weird cable thing')).toBeNull()
  })

  it('matches case-sensitively, so a near-miss shows the empty state rather than the wrong lift', () => {
    expect(getIllustration('bench press (barbell)')).toBeNull()
  })

  it('lets two exercises share one drawing where the drawing fits both', () => {
    expect(getIllustration('Close-grip push-up')?.slug).toBe('0188')
    expect(getIllustration('Diamond push-up')?.slug).toBe('0188')
  })

  it('maps every name to a four-digit upstream slug', () => {
    for (const [name, illustration] of Object.entries(EXERCISE_ILLUSTRATIONS)) {
      expect(illustration.slug, name).toMatch(/^\d{4}$/)
      expect(illustration.title.length, name).toBeGreaterThan(0)
    }
  })
})
