import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// This suite writes to the database. Fail fast rather than mutate something real.
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required. Is the Compose stack up?')

const { hostname } = new URL(databaseUrl)
if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
  throw new Error(`Refusing to run write tests against a non-local database: ${hostname}`)
}

const pool = new Pool({ connectionString: databaseUrl })
// Resolved against the working directory, as migrate.ts resolves its migrations folder and for
// the same reason: this package compiles to CommonJS, where `import.meta` is a type error.
const seedPath = join(process.cwd(), 'sql', 'seed-exercises.sql')

/** What docker-entrypoint.sh does on every container start. */
async function runSeed(): Promise<void> {
  await pool.query(await readFile(seedPath, 'utf8'))
}

type SetRow = { id: string; reps: number | null; duration_seconds: number | null; updated_at: Date }

async function setsFor(exerciseId: string): Promise<SetRow[]> {
  const { rows } = await pool.query<SetRow>(
    `SELECT s.id, s.reps, s.duration_seconds, s.updated_at
     FROM sets s
     JOIN session_exercises se ON se.id = s.session_exercise_id
     WHERE se.exercise_id = $1 AND s.user_id = $2
     ORDER BY s.set_index`,
    [exerciseId, userId],
  )
  return rows
}

async function insertReturningId(text: string, values: unknown[]): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(text, values)
  if (!rows[0]) throw new Error(`insert returned no row: ${text}`)
  return rows[0].id
}

async function measureOf(exerciseId: string): Promise<string> {
  const { rows } = await pool.query<{ measure: string }>(
    'SELECT measure FROM exercises WHERE id = $1',
    [exerciseId],
  )
  if (!rows[0]) throw new Error(`exercise ${exerciseId} does not exist`)
  return rows[0].measure
}

const SHOULDER_TAP = 'Plank shoulder tap'

let userId: string
let sessionId: string
let globalExerciseId: string
let customExerciseId: string

beforeAll(async () => {
  await runSeed()

  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM exercises WHERE name = $1 AND user_id IS NULL AND deleted_at IS NULL',
    [SHOULDER_TAP],
  )
  if (!rows[0]) throw new Error(`the seed did not produce a global '${SHOULDER_TAP}'`)
  globalExerciseId = rows[0].id

  userId = await insertReturningId(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
    [`seed-exercises-${randomUUID()}@example.com`, 'not-a-real-hash'],
  )
  sessionId = await insertReturningId(
    'INSERT INTO sessions (user_id, started_at) VALUES ($1, now()) RETURNING id',
    [userId],
  )
  // A user's own exercise may share a built-in's name. Nothing in the seed may touch it.
  customExerciseId = await insertReturningId(
    `INSERT INTO exercises (user_id, name, muscle_group, load_type, measure, is_custom)
     VALUES ($1, $2, 'core', 'bodyweight', 'reps', true) RETURNING id`,
    [userId, SHOULDER_TAP],
  )
})

afterAll(async () => {
  await pool.query(
    'DELETE FROM sets WHERE session_exercise_id IN (SELECT id FROM session_exercises WHERE user_id = $1)',
    [userId],
  )
  await pool.query('DELETE FROM session_exercises WHERE user_id = $1', [userId])
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId])
  await pool.query('DELETE FROM exercises WHERE user_id = $1', [userId])
  await pool.query('DELETE FROM users WHERE id = $1', [userId])
  // The suite rewinds the shared global row to its pre-change state; leave it corrected.
  await runSeed()
  await pool.end()
})

async function logRepSets(exerciseId: string, reps: number[]): Promise<void> {
  const sessionExerciseId = await insertReturningId(
    'INSERT INTO session_exercises (user_id, session_id, exercise_id, position) VALUES ($1, $2, $3, 0) RETURNING id',
    [userId, sessionId, exerciseId],
  )
  for (const [index, count] of reps.entries()) {
    await pool.query(
      'INSERT INTO sets (user_id, session_exercise_id, set_index, reps, performed_at) VALUES ($1, $2, $3, $4, now())',
      [userId, sessionExerciseId, index, count],
    )
  }
}

/** The state of a database seeded before shoulder taps became a timed exercise. */
async function rewindToRepsMeasure(): Promise<void> {
  await pool.query("UPDATE exercises SET measure = 'reps' WHERE id = $1", [globalExerciseId])
}

describe('seed-exercises.sql: shoulder taps become a timed exercise', () => {
  it('corrects the built-in row on an already-seeded database', async () => {
    await rewindToRepsMeasure()

    await runSeed()

    expect(await measureOf(globalExerciseId)).toBe('duration')
  })

  it('converts sets already logged as reps, keeping the original count', async () => {
    await rewindToRepsMeasure()
    await logRepSets(globalExerciseId, [20, 18, 16])
    await logRepSets(customExerciseId, [24])

    await runSeed()

    expect(await setsFor(globalExerciseId)).toMatchObject([
      { reps: 20, duration_seconds: 20 },
      { reps: 18, duration_seconds: 18 },
      { reps: 16, duration_seconds: 16 },
    ])
    // The user's own same-named exercise keeps both its measure and its sets.
    expect(await measureOf(customExerciseId)).toBe('reps')
    expect(await setsFor(customExerciseId)).toMatchObject([{ reps: 24, duration_seconds: null }])
  })

  it('re-runs as a no-op, so a container restart republishes nothing', async () => {
    await runSeed()
    const before = await setsFor(globalExerciseId)

    await runSeed()

    expect(await setsFor(globalExerciseId)).toEqual(before)
  })
})
