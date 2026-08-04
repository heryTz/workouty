import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

// This suite writes to the database. Fail fast rather than mutate something real.
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required. Is the Compose stack up?')

const { hostname } = new URL(databaseUrl)
if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
  throw new Error(`Refusing to run write tests against a non-local database: ${hostname}`)
}

const pool = new Pool({ connectionString: databaseUrl })
const db = drizzle(pool)

afterAll(async () => {
  await pool.end()
})

async function columnIsNullable(table: string, column: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT is_nullable FROM information_schema.columns
    WHERE table_name = ${table} AND column_name = ${column}
  `)
  const row = result.rows[0] as { is_nullable: string } | undefined
  if (!row) throw new Error(`${table}.${column} does not exist`)
  return row.is_nullable === 'YES'
}

describe('migrations', () => {
  it('creates every application table', async () => {
    const result = await db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
    `)
    const tables = result.rows.map((r) => (r as { table_name: string }).table_name)
    for (const table of [
      'users',
      'exercises',
      'templates',
      'template_exercises',
      'sessions',
      'session_exercises',
      'sets',
      'exercise_rest_prefs',
    ]) {
      expect(tables).toContain(table)
    }
  })

  it('requires an owner on every child row, because sync rules cannot join to a parent', async () => {
    for (const table of ['sets', 'session_exercises', 'template_exercises']) {
      expect(await columnIsNullable(table, 'user_id')).toBe(false)
    }
  })

  it('allows a null rest on the final set of an exercise', async () => {
    expect(await columnIsNullable('sets', 'actual_rest_seconds')).toBe(true)
  })

  it('keeps deleted_at nullable so live rows are representable', async () => {
    expect(await columnIsNullable('sets', 'deleted_at')).toBe(true)
  })

  it('gives id a database default, so raw inserts may omit it', async () => {
    // Regression: `$defaultFn` is a Drizzle-runtime default and emits no DDL DEFAULT, so
    // this insert would fail on NOT NULL. It must be `.defaultRandom()`.
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query(
        `INSERT INTO exercises (name, muscle_group) VALUES ($1, 'chest') RETURNING id`,
        [`test-default-${crypto.randomUUID()}`],
      )
      expect(result.rows[0].id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      )
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })

  it('prevents duplicate built-in exercises despite user_id being NULL', async () => {
    const name = `test-dup-${crypto.randomUUID()}`
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`INSERT INTO exercises (name, muscle_group) VALUES ($1, 'chest')`, [name])
      await expect(
        client.query(`INSERT INTO exercises (name, muscle_group) VALUES ($1, 'chest')`, [name]),
      ).rejects.toThrow(/exercises_global_name_uq/)
    } finally {
      // The failed insert aborts the transaction; the rollback also discards the first row,
      // so nothing leaks and no physical DELETE is ever issued.
      await client.query('ROLLBACK')
      client.release()
    }
  })

  it('lets a soft-deleted exercise name be reused', async () => {
    // Regression: without `AND deleted_at IS NULL` in the partial unique index, deleting a
    // custom exercise would reserve its name forever.
    const name = `test-tomb-${crypto.randomUUID()}`
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`INSERT INTO exercises (name, muscle_group) VALUES ($1, 'chest')`, [name])
      await client.query(`UPDATE exercises SET deleted_at = now() WHERE name = $1`, [name])
      const result = await client.query(
        `INSERT INTO exercises (name, muscle_group) VALUES ($1, 'chest') RETURNING id`,
        [name],
      )
      expect(result.rows[0].id).toBeDefined()
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })

  it('publishes exactly the synced app tables, and never users', async () => {
    // Asserting the EXACT set is the point. A new synced table that nobody published, or a
    // secret table that somebody did, both fail loudly here instead of silently.
    const result = await db.execute(sql`
      SELECT tablename FROM pg_publication_tables
      WHERE pubname = 'powersync' ORDER BY tablename
    `)
    const published = result.rows.map((r) => (r as { tablename: string }).tablename)
    expect(published).toEqual([
      'exercise_rest_prefs',
      'exercises',
      'session_exercises',
      'sessions',
      'sets',
      'template_exercises',
      'templates',
    ])
    expect(published).not.toContain('users')
  })
})
