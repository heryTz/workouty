import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ILLUSTRATION_ASSETS } from './exercise-illustration-assets'
import { EXERCISE_ILLUSTRATIONS } from './exercise-illustrations'

const assetsDir = join(import.meta.dirname, '..', '..', 'assets', 'exercises')

const mappedSlugs = [...new Set(Object.values(EXERCISE_ILLUSTRATIONS).map((i) => i.slug))].sort()

describe('illustration assets', () => {
  it('has a frame pair for every slug the map points at', () => {
    expect(Object.keys(ILLUSTRATION_ASSETS).sort()).toEqual(mappedSlugs)
  })

  it('vendors both frames on disk for every mapped slug', () => {
    for (const slug of mappedSlugs) {
      expect(existsSync(join(assetsDir, `${slug}-relaxation.svg`)), `${slug} start`).toBe(true)
      expect(existsSync(join(assetsDir, `${slug}-tension.svg`)), `${slug} end`).toBe(true)
    }
  })

  it('ships the upstream licence and provenance beside the drawings', () => {
    expect(existsSync(join(assetsDir, 'LICENSE'))).toBe(true)
    expect(existsSync(join(assetsDir, 'SOURCE'))).toBe(true)
  })
})
