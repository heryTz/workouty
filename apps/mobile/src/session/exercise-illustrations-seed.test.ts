import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXERCISE_ILLUSTRATIONS } from './exercise-illustrations'

// The map is keyed by exercise NAME because it has to be: seeded exercise ids are
// gen_random_uuid() (apps/api/src/db/columns.ts), so they differ in every deployment and a
// client-side table cannot reference them. Name is the only stable client-visible key.
//
// This test is the guard on that choice. It catches a mapped exercise being dropped from the
// library, and a rename that removes the old name from the file entirely.
//
// What it does NOT catch: a rename that leaves the old name somewhere else in the file — which
// is exactly what seed-exercises.sql's rename UPDATE does, since it lists old and new names side
// by side. Closing that hole means executing the seed against Postgres and reading back the live
// names, which belongs to apps/api's integration suite, not to a mobile unit test. The
// complementary guard is the pointer comment in seed-exercises.sql itself.
const seedSql = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'api', 'sql', 'seed-exercises.sql'),
  'utf8',
)

describe('illustration map against the exercise seed', () => {
  it('maps only names the seed actually ships', () => {
    const orphaned = Object.keys(EXERCISE_ILLUSTRATIONS).filter(
      (name) => !seedSql.includes(`('${name}',`),
    )
    expect(orphaned).toEqual([])
  })
})
