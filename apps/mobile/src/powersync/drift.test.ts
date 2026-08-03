import { getTableConfig } from 'drizzle-orm/pg-core'
import type { PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  exerciseRestPrefs,
  exercises,
  sessionExercises,
  sessions,
  sets,
  templateExercises,
  templates,
} from '@workouty/api/src/db/schema'
import { ColumnType } from '@powersync/common'
import { AppSchema } from './schema'

/**
 * Schema drift guard: the PowerSync client SQLite schema (apps/mobile/src/powersync/schema.ts)
 * must stay in lockstep with the six synced Postgres tables (apps/api/src/db/schema.ts).
 *
 * Postgres is the source of truth. If this test fails, fix the CLIENT schema — never the
 * Drizzle schema — unless the client mirror is deliberately being redesigned.
 *
 * Rule: for each synced table, client column names == Postgres column names minus `id`
 * (PowerSync auto-creates `id`; it must never be declared client-side). Each client column's
 * SQLite type must also match the mapping of its Postgres column's SQL type:
 *   uuid | text                    -> TEXT
 *   integer                        -> INTEGER
 *   double precision               -> REAL
 *   boolean                        -> INTEGER (SQLite has no boolean; PowerSync stores 0/1)
 *   timestamp with time zone       -> TEXT (ISO string)
 */

// Postgres SQL type (as returned by Column#getSQLType()) -> expected PowerSync ColumnType.
const PG_TO_CLIENT_TYPE: Record<string, ColumnType> = {
  uuid: ColumnType.TEXT,
  text: ColumnType.TEXT,
  integer: ColumnType.INTEGER,
  'double precision': ColumnType.REAL,
  boolean: ColumnType.INTEGER,
  'timestamp with time zone': ColumnType.TEXT,
}

const SYNCED_TABLES: Record<string, PgTable> = {
  exercises,
  templates,
  template_exercises: templateExercises,
  sessions,
  session_exercises: sessionExercises,
  sets,
  exercise_rest_prefs: exerciseRestPrefs,
}

describe('client/Postgres schema drift', () => {
  it('the AppSchema tables are exactly the synced Postgres tables', () => {
    const clientTableNames = AppSchema.tables.map((t) => t.name).sort()
    const pgTableNames = Object.keys(SYNCED_TABLES).sort()
    expect(clientTableNames).toEqual(pgTableNames)
  })

  for (const [tableName, drizzleTable] of Object.entries(SYNCED_TABLES)) {
    describe(tableName, () => {
      const clientTable = AppSchema.tables.find((t) => t.name === tableName)
      const pgColumns = getTableConfig(drizzleTable).columns

      it('exists in the client AppSchema', () => {
        expect(clientTable, `client AppSchema has no table named "${tableName}"`).toBeDefined()
      })

      it('has exactly the Postgres columns minus id', () => {
        const clientColNames = new Set(clientTable!.columns.map((c) => c.name))
        const pgColNames = new Set(pgColumns.map((c) => c.name))
        const expectedClientColNames = new Set([...pgColNames].filter((name) => name !== 'id'))

        const missingFromClient = [...expectedClientColNames].filter((n) => !clientColNames.has(n))
        const extraOnClient = [...clientColNames].filter((n) => !expectedClientColNames.has(n))

        expect(
          missingFromClient,
          `${tableName}: columns present in Postgres but missing from the client schema: ${JSON.stringify(missingFromClient)}`,
        ).toEqual([])
        expect(
          extraOnClient,
          `${tableName}: columns present on the client but absent from Postgres: ${JSON.stringify(extraOnClient)}`,
        ).toEqual([])
      })

      it('id is the only Postgres column absent client-side', () => {
        const clientColNames = new Set(clientTable!.columns.map((c) => c.name))
        const pgColNames = new Set(pgColumns.map((c) => c.name))
        const absentClientSide = [...pgColNames].filter((n) => !clientColNames.has(n))
        expect(absentClientSide).toEqual(['id'])
      })

      for (const pgCol of pgColumns) {
        if (pgCol.name === 'id') continue

        it(`column "${pgCol.name}" has the correct mapped SQLite type`, () => {
          const sqlType = pgCol.getSQLType()
          const expectedType = PG_TO_CLIENT_TYPE[sqlType]
          expect(
            expectedType,
            `${tableName}.${pgCol.name}: no type mapping known for Postgres SQL type "${sqlType}" — add it to PG_TO_CLIENT_TYPE`,
          ).toBeDefined()

          const clientCol = clientTable!.columns.find((c) => c.name === pgCol.name)
          expect(
            clientCol,
            `${tableName}.${pgCol.name}: expected on the client but not found (should have been caught above)`,
          ).toBeDefined()

          expect(
            clientCol!.type,
            `${tableName}.${pgCol.name}: Postgres type "${sqlType}" maps to ${expectedType}, but the client column is ${clientCol!.type}`,
          ).toBe(expectedType)
        })
      }
    })
  }
})
