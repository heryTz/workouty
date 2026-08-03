import { timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Every synced table shares these.
 *
 * Clients generate their own UUIDs offline, which is what makes an offline insert safe to
 * upload later without collision. The database default only fills in when a caller omits
 * one — which raw SQL (seeds, integration tests) does.
 *
 * There is no hard delete anywhere: a physical DELETE cannot be replicated to a client
 * that has not yet seen the row. Deletion means setting `deletedAt`.
 *
 * The database does NOT cascade a soft delete. Soft-deleting a parent leaves its children
 * live and syncable; the application must set `deletedAt` on the children too.
 */
export const baseColumns = {
  // `.defaultRandom()`, not `$defaultFn`. `$defaultFn` is a Drizzle-runtime default: it
  // runs in JS inside the query builder and emits NO Postgres DEFAULT, so any raw SQL
  // insert that omits `id` fails on NOT NULL. `.defaultRandom()` emits
  // `DEFAULT gen_random_uuid()` in the DDL.
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}
