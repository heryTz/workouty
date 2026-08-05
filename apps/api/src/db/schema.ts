import { sql } from 'drizzle-orm'
import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { baseColumns } from './columns'

/**
 * Never published to the replication stream, and never synced to clients.
 * See apps/api/sql/publication.sql.
 */
export const users = pgTable(
  'users',
  {
    ...baseColumns,
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
  },
  // Partial, so a soft-deleted account does not permanently reserve its email address.
  (t) => [uniqueIndex('users_email_uq').on(t.email).where(sql`${t.deletedAt} IS NULL`)],
)

/** `userId` NULL marks a built-in library row, synced to everyone via a global bucket. */
export const exercises = pgTable(
  'exercises',
  {
    ...baseColumns,
    userId: uuid('user_id').references(() => users.id),
    name: text('name').notNull(),
    muscleGroup: text('muscle_group').notNull(),
    defaultRestSeconds: integer('default_rest_seconds').notNull().default(90),
    // Invariant: `isCustom` is true exactly when `userId IS NOT NULL`. Kept as a column
    // for client-side query ergonomics against the SQLite mirror.
    isCustom: boolean('is_custom').notNull().default(false),
  },
  (t) => [
    // Two partial indexes, not one: Postgres treats NULLs as distinct, so a plain
    // unique(user_id, name) would happily allow duplicate built-in exercises.
    //
    // Both exclude soft-deleted rows. Without that, deleting a custom exercise would
    // permanently reserve its name and the user could never recreate it.
    //
    // A user's custom exercise MAY share a name with a built-in one: a row with
    // `user_id IS NOT NULL` is never checked against the global index. That is intended —
    // users shadow library entries.
    uniqueIndex('exercises_global_name_uq')
      .on(t.name)
      .where(sql`${t.userId} IS NULL AND ${t.deletedAt} IS NULL`),
    uniqueIndex('exercises_user_name_uq')
      .on(t.userId, t.name)
      .where(sql`${t.userId} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    index('exercises_user_id_idx').on(t.userId),
  ],
)

export const templates = pgTable(
  'templates',
  {
    ...baseColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
  },
  (t) => [index('templates_user_id_idx').on(t.userId)],
)

export const templateExercises = pgTable(
  'template_exercises',
  {
    ...baseColumns,
    // Denormalised from templates.user_id. PowerSync sync rules filter on columns present
    // in the row and cannot join to a parent, so ownership must live here.
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id),
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id),
    position: integer('position').notNull(),
    defaultRestSeconds: integer('default_rest_seconds').notNull(),
  },
  (t) => [
    index('template_exercises_user_id_idx').on(t.userId),
    // Deliberately not unique on (template_id, position): reordering swaps positions and a
    // unique constraint would reject the intermediate state.
    index('template_exercises_template_idx').on(t.templateId),
  ],
)

export const sessions = pgTable(
  'sessions',
  {
    ...baseColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    templateId: uuid('template_id').references(() => templates.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [index('sessions_user_started_idx').on(t.userId, t.startedAt)],
)

export const sessionExercises = pgTable(
  'session_exercises',
  {
    ...baseColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id),
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id),
    position: integer('position').notNull(),
  },
  (t) => [
    index('session_exercises_user_id_idx').on(t.userId),
    index('session_exercises_session_idx').on(t.sessionId),
  ],
)

export const sets = pgTable(
  'sets',
  {
    ...baseColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    sessionExerciseId: uuid('session_exercise_id')
      .notNull()
      .references(() => sessionExercises.id),
    setIndex: integer('set_index').notNull(),
    reps: integer('reps').notNull(),
    // doublePrecision, not numeric: numeric round-trips as a string in Drizzle, and the
    // client mirror of this column is a SQLite REAL. Matching types keeps the two sides
    // honest. The unit is in the name so nobody writes pounds into it.
    weightKg: doublePrecision('weight_kg').notNull(),
    // Rest taken AFTER this set, until "Stop rest" was pressed. The last set of an
    // exercise has no following rest, hence nullable.
    actualRestSeconds: integer('actual_rest_seconds'),
    performedAt: timestamp('performed_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('sets_user_id_idx').on(t.userId),
    index('sets_session_exercise_idx').on(t.sessionExerciseId),
  ],
)

/**
 * Per-user override of an exercise's `default_rest_seconds`. Built-in exercises are global
 * (user_id IS NULL) and read-only to clients, so a user who wants a different rest for, say,
 * Bench press stores it here instead of mutating the shared library row. The effective rest for
 * an exercise is `COALESCE(this user's pref, exercises.default_rest_seconds)`. Synced per-user.
 */
export const exerciseRestPrefs = pgTable(
  'exercise_rest_prefs',
  {
    ...baseColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id),
    restSeconds: integer('rest_seconds').notNull(),
  },
  (t) => [
    // One live pref per (user, exercise). Partial (excludes tombstones) so resetting a pref
    // (soft delete) frees the slot to be set again later.
    uniqueIndex('exercise_rest_prefs_user_exercise_uq')
      .on(t.userId, t.exerciseId)
      .where(sql`${t.deletedAt} IS NULL`),
    index('exercise_rest_prefs_user_id_idx').on(t.userId),
  ],
)

/**
 * Never published to the replication stream: holds token hashes.
 * See apps/api/sql/publication.sql.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    ...baseColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('refresh_tokens_user_id_idx').on(t.userId)],
)

/**
 * Never published to the replication stream: holds token hashes.
 * See apps/api/sql/publication.sql.
 */
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    ...baseColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => [index('password_reset_tokens_user_id_idx').on(t.userId)],
)
