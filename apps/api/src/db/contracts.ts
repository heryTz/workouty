/**
 * Insert contracts derived from the Drizzle schema.
 *
 * These validate row SHAPE. They are NOT authorization.
 *
 * `createInsertSchema` includes every insertable column, so these schemas accept a
 * client-supplied `userId`, `id`, `createdAt`, `updatedAt` and `deletedAt`. The upload
 * endpoint (Milestone 2) must not trust any of them:
 *
 * - `userId` must be derived from the verified JWT. A client asserting its own ownership
 *   is exactly what the design forbids.
 * - `updatedAt` is the last-write-wins tiebreaker, so the server must stamp it. A client
 *   that sets it can win a conflict it should lose. `$onUpdate` does not protect you: an
 *   explicitly supplied value overrides it.
 *
 * Unknown keys are stripped rather than rejected. That is deliberate: a client newer than
 * the server may send a column the server has not migrated yet, and stripping keeps sync
 * working instead of hard-failing the batch.
 *
 * Client-owned timestamps (`sessions.startedAt`/`endedAt`, `sets.performedAt`) are overridden
 * to `z.coerce.date()` below. drizzle-zod's default schema for a Postgres `timestamp` column
 * is a strict `z.date()` (right for a value read back out of the DB), but these three columns
 * are also ones a CLIENT sets on upload — and PowerSync's CrudEntry -> our /sync/upload wire
 * contract is JSON, which has no Date type, so the value always arrives as an ISO string (see
 * mobile's powersync/crud-mapping.ts). A bare `z.date()` rejects that string outright ("invalid
 * data"), which was confirmed against the live stack: a session/set logged from the app could
 * never sync. `z.coerce.date()` accepts the ISO string (or a real Date, for any caller that
 * already has one) and produces the Date drizzle needs to bind the timestamp column.
 */
import { createInsertSchema } from 'drizzle-zod'
import { z } from 'zod'
import { exerciseRestPrefs, exercises, sessionExercises, sessions, sets, templateExercises, templates } from './schema'

export const insertExerciseSchema = createInsertSchema(exercises, {
  name: (s) => s.min(1).max(120),
  defaultRestSeconds: (s) => s.int().nonnegative(),
})

export const insertTemplateSchema = createInsertSchema(templates, {
  name: (s) => s.min(1).max(120),
})

export const insertTemplateExerciseSchema = createInsertSchema(templateExercises, {
  position: (s) => s.int().nonnegative(),
  defaultRestSeconds: (s) => s.int().nonnegative(),
})

export const insertSessionSchema = createInsertSchema(sessions, {
  startedAt: () => z.coerce.date(),
  endedAt: () => z.coerce.date().nullable().optional(),
})

export const insertSessionExerciseSchema = createInsertSchema(sessionExercises, {
  position: (s) => s.int().nonnegative(),
})

export const insertSetSchema = createInsertSchema(sets, {
  setIndex: (s) => s.int().nonnegative(),
  reps: (s) => s.int().positive(),
  weightKg: (s) => s.nonnegative(),
  actualRestSeconds: (s) => s.int().nonnegative().nullable(),
  performedAt: () => z.coerce.date(),
})

export const insertExerciseRestPrefSchema = createInsertSchema(exerciseRestPrefs, {
  restSeconds: (s) => s.int().nonnegative(),
})
