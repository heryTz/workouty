/**
 * The security core of the sync upload endpoint (spec §4.6: "the client is never trusted
 * to assert ownership"). Applies a client's CRUD batch to Postgres inside one transaction,
 * enforcing that the SERVER — not the client — owns `user_id` and `updated_at` on every
 * row, and that a row can only ever be mutated by the user who owns it.
 *
 * Rejections (unknown table, invalid data, ownership violation) are collected and
 * returned, never thrown — PowerSync expects a 2xx with a rejected list for validation
 * errors, reserving 5xx for genuine DB/infra failures the client should retry.
 */
import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { DRIZZLE, type Db } from '../db/drizzle.module'
import * as schema from '../db/schema'
import {
  SYNCED_TABLES,
  uploadPatchSchemas,
  uploadPutSchemas,
  type CrudOp,
  type SyncedTable,
} from './upload-contracts'

export interface RejectedOp {
  op: CrudOp['op']
  table: string
  id: string
  reason: string
}

export interface ApplyResult {
  rejected: RejectedOp[]
}

// The transaction handle drizzle passes into db.transaction()'s callback. Derived from
// Db['transaction'] itself (rather than named explicitly against a drizzle-orm internal
// type) so it always matches whatever the installed version calls it.
type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T, ...rest: never[]) => unknown ? T : never

// Every synced table (see db/columns.ts baseColumns + db/schema.ts) has these four
// columns. That shared shape is what lets apply() below drive PUT/PATCH/DELETE across all
// six tables through one generic code path instead of a six-times-repeated switch.
type SyncedRowTable = PgTable & {
  id: PgColumn
  userId: PgColumn
  updatedAt: PgColumn
  deletedAt: PgColumn
}

// Wire table name -> { drizzle table, per-table zod schemas }. Keyed by the exact
// SyncedTable union, so a typo or a forgotten table fails typecheck, not a test run.
const REGISTRY = {
  exercises: { table: schema.exercises, put: uploadPutSchemas.exercises, patch: uploadPatchSchemas.exercises },
  templates: { table: schema.templates, put: uploadPutSchemas.templates, patch: uploadPatchSchemas.templates },
  template_exercises: {
    table: schema.templateExercises,
    put: uploadPutSchemas.template_exercises,
    patch: uploadPatchSchemas.template_exercises,
  },
  sessions: { table: schema.sessions, put: uploadPutSchemas.sessions, patch: uploadPatchSchemas.sessions },
  session_exercises: {
    table: schema.sessionExercises,
    put: uploadPutSchemas.session_exercises,
    patch: uploadPatchSchemas.session_exercises,
  },
  sets: { table: schema.sets, put: uploadPutSchemas.sets, patch: uploadPatchSchemas.sets },
  exercise_rest_prefs: {
    table: schema.exerciseRestPrefs,
    put: uploadPutSchemas.exercise_rest_prefs,
    patch: uploadPatchSchemas.exercise_rest_prefs,
  },
} as const satisfies Record<SyncedTable, { table: SyncedRowTable; put: unknown; patch: unknown }>

function isSyncedTable(table: string): table is SyncedTable {
  return (SYNCED_TABLES as readonly string[]).includes(table)
}

function hasPgCode(err: unknown, code: string): boolean {
  return (
    typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === code
  )
}

// drizzle-orm's node-postgres driver wraps every failed query in a DrizzleQueryError, with
// the real `pg` error (the one carrying `.code`) on `.cause` — same pattern AuthService
// uses to detect a `23505` unique violation on its own tables.
//
// This must stay NARROW: it exists so a same-name-different-id PUT (which collides on the
// `exercises (user_id, name)` partial unique index, a constraint `onConflictDoUpdate`'s
// `target: table.id` doesn't cover) is rejected as a per-op conflict instead of aborting
// the whole batch. Any other error — a dropped connection, a deadlock, disk-full — must
// keep propagating so the batch rolls back and the client gets a retryable 5xx. Widening
// this check would silently turn a transient infra failure into a permanent "rejected" op,
// which is client data loss.
function isUniqueViolation(err: unknown): boolean {
  return hasPgCode(err, '23505') || (err instanceof Error && hasPgCode(err.cause, '23505'))
}

/**
 * Insert-or-update `id` on `table`, forcing `userId`/`updatedAt` server-side regardless of
 * what `data` contains (the caller has already validated `data` through the table's
 * server-owned-column-stripping zod schema — this is defense in depth on top of that).
 *
 * Ownership is enforced atomically by the ON CONFLICT clause itself: `setWhere` only lets
 * the UPDATE branch apply when the existing row's `user_id` matches the caller. If a row
 * with this id already exists and is owned by someone else, Postgres evaluates the WHERE,
 * finds it false, and the conflicting insert becomes a no-op — RETURNING comes back empty,
 * the existing row is untouched (not even its updated_at moves), and the caller below
 * treats an empty result as "reject this op". One round trip, no separate SELECT-then-
 * branch race window.
 */
async function putRow<T extends SyncedRowTable>(
  tx: Tx,
  table: T,
  userId: string,
  id: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  const values = { ...data, id, userId, updatedAt: new Date() }
  const result = await tx
    .insert(table)
    // `data` was already shape-validated by the table's zod putSchema; drizzle's insert
    // value type can't express "one of six dynamically-selected tables", so this is the
    // deliberate, narrow seam between runtime validation and the static row type.
    .values(values as never)
    .onConflictDoUpdate({
      target: table.id,
      set: values as never,
      setWhere: eq(table.userId, userId),
    })
    .returning({ id: table.id })
  return result.length > 0
}

/** Loads `id`'s owner, locking the row FOR UPDATE so a concurrent op can't race the check. */
async function loadOwner<T extends SyncedRowTable>(
  tx: Tx,
  table: T,
  id: string,
): Promise<{ userId: string | null } | undefined> {
  const rows = await tx
    .select({ userId: table.userId })
    // Same generic-table seam as putRow's `.values()` cast: T is a type parameter here,
    // not a concrete table, and drizzle's `.from()` wants to prove at compile time that
    // the passed table isn't an empty-selection subquery — a check that only applies to
    // subqueries, never to a real PgTable like every member of SyncedRowTable.
    .from(table as PgTable)
    .where(eq(table.id, id))
    .for('update')
  return rows[0] as { userId: string | null } | undefined
}

async function patchRow<T extends SyncedRowTable>(
  tx: Tx,
  table: T,
  id: string,
  changes: Record<string, unknown>,
): Promise<void> {
  await tx
    .update(table)
    .set({ ...changes, updatedAt: new Date() } as never)
    .where(eq(table.id, id))
}

async function softDeleteRow<T extends SyncedRowTable>(tx: Tx, table: T, id: string): Promise<void> {
  const now = new Date()
  await tx
    .update(table)
    .set({ deletedAt: now, updatedAt: now } as never)
    .where(eq(table.id, id))
}

@Injectable()
export class UploadService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * Applies `batch` for `userId` (JWT-derived — never client-asserted) inside one outer
   * transaction, with each op further nested in its own SAVEPOINT (`tx.transaction()` on
   * node-postgres emits real SAVEPOINT / RELEASE SAVEPOINT / ROLLBACK TO SAVEPOINT — see
   * isUniqueViolation's doc comment). That per-op savepoint is what lets a single op's
   * unique-constraint collision (e.g. two devices PUTting an exercise with the same name
   * but different ids — colliding on `exercises (user_id, name)`, a constraint
   * `onConflictDoUpdate`'s `id` target doesn't cover) become a REJECTED entry without
   * aborting the ops around it.
   *
   * Validation/ownership/conflict failures are collected into `rejected` and returned; they
   * never throw. Any other error still throws out of the outer transaction (rolling back
   * the whole batch) so it surfaces as a 5xx the client retries.
   */
  async apply(userId: string, batch: CrudOp[]): Promise<ApplyResult> {
    const rejected: RejectedOp[] = []

    await this.db.transaction(async (tx) => {
      for (const op of batch) {
        if (!isSyncedTable(op.table)) {
          rejected.push({ op: op.op, table: op.table, id: op.id, reason: 'unknown table' })
          continue
        }
        const entry = REGISTRY[op.table]

        try {
          await tx.transaction(async (sp) => {
            switch (op.op) {
              case 'PUT': {
                const parsed = entry.put.safeParse({ ...(op.data ?? {}), id: op.id })
                if (!parsed.success) {
                  rejected.push({ op: op.op, table: op.table, id: op.id, reason: 'invalid data' })
                  return
                }
                const { id: _clientId, ...rest } = parsed.data as { id: string } & Record<string, unknown>
                const applied = await putRow(sp, entry.table, userId, op.id, rest)
                if (!applied) {
                  rejected.push({ op: op.op, table: op.table, id: op.id, reason: 'row owned by another user' })
                }
                break
              }
              case 'PATCH': {
                const parsed = entry.patch.safeParse(op.data ?? {})
                if (!parsed.success) {
                  rejected.push({ op: op.op, table: op.table, id: op.id, reason: 'invalid data' })
                  return
                }
                const owner = await loadOwner(sp, entry.table, op.id)
                if (!owner || owner.userId !== userId) {
                  rejected.push({ op: op.op, table: op.table, id: op.id, reason: 'not found or not owned' })
                  return
                }
                // The PATCH schema is `putSchema.partial()`, and the PUT schema keeps `id`
                // (only userId/createdAt/updatedAt/deletedAt are server-owned there) — so a
                // PATCH payload can legally carry an `id` field. Strip it: `changes` must
                // never repoint the row's primary key, only touch the row already located
                // by op.id.
                const { id: _clientId, ...changes } = parsed.data as { id?: string } & Record<string, unknown>
                await patchRow(sp, entry.table, op.id, changes)
                break
              }
              case 'DELETE': {
                const owner = await loadOwner(sp, entry.table, op.id)
                if (!owner || owner.userId !== userId) {
                  rejected.push({ op: op.op, table: op.table, id: op.id, reason: 'not found or not owned' })
                  return
                }
                await softDeleteRow(sp, entry.table, op.id)
                break
              }
            }
          })
        } catch (err) {
          if (isUniqueViolation(err)) {
            rejected.push({ op: op.op, table: op.table, id: op.id, reason: 'conflict' })
            continue
          }
          throw err
        }
      }
    })

    return { rejected }
  }
}
