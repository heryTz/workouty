// Per-exercise rest preference writes. Built-in exercises are global (user_id IS NULL) and
// read-only to clients, so a user's preferred rest for any exercise — built-in or custom — is
// stored as an override row in `exercise_rest_prefs` rather than by mutating the exercise. The
// effective rest resolved everywhere is COALESCE(this pref, exercises.default_rest_seconds); see
// session/exercises.ts (VISIBLE_EXERCISES_QUERY), app/(app)/session/[id].tsx (the countdown +
// reload reconstruction), and session/template-writes.ts (template capture).
//
// There is one live pref per (user, exercise) — enforced by a partial unique index server-side —
// so this is an upsert: update the existing live row, or insert a new one. Changing rest touches
// only `rest_seconds` (a normal field synced via PATCH); resetting to the default soft-deletes the
// pref via a real SQL DELETE (PowerSync -> DELETE op -> server soft-delete; an UPDATE deleted_at
// would be stripped by the upload contract — see template-writes.ts's note).
import type { AbstractPowerSyncDatabase } from '@powersync/common'

// crypto.randomUUID() is available in every runtime this app ships to (browsers incl.
// Playwright/Chromium, and Node/vitest) — see session/exercises.ts's generateClientId.
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  throw new Error('crypto.randomUUID is unavailable in this runtime')
}

// Minimal structural DB shape (execute + getAll) so these stay unit-testable with a plain mock.
export interface RestPrefDb {
  execute: AbstractPowerSyncDatabase['execute']
  getAll: AbstractPowerSyncDatabase['getAll']
}

export interface SetExerciseRestPrefInput {
  userId: string
  exerciseId: string
  restSeconds: number
}

// Upsert this user's rest override for `exerciseId`. No user_id filter is needed on the lookup:
// the local mirror only ever holds this user's prefs (exercise_rest_prefs is user_data-bucket
// only, scoped by user_id in sync_rules.yaml).
export async function setExerciseRestPref(
  db: RestPrefDb,
  { userId, exerciseId, restSeconds }: SetExerciseRestPrefInput,
): Promise<void> {
  const nowISO = new Date().toISOString()
  const existing = await db.getAll<{ id: string }>(
    `SELECT id FROM exercise_rest_prefs WHERE exercise_id = ? AND deleted_at IS NULL LIMIT 1`,
    [exerciseId],
  )

  if (existing[0]) {
    await db.execute(`UPDATE exercise_rest_prefs SET rest_seconds = ?, updated_at = ? WHERE id = ?`, [
      restSeconds,
      nowISO,
      existing[0].id,
    ])
    return
  }

  await db.execute(
    `INSERT INTO exercise_rest_prefs
       (id, user_id, exercise_id, rest_seconds, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [newId(), userId, exerciseId, restSeconds, nowISO, nowISO],
  )
}

// Reset an exercise back to its built-in default: SQL DELETE the live pref (syncs as a DELETE op
// -> server soft-delete). No-op if there's no override. Kept for a future "reset" affordance.
export async function clearExerciseRestPref(db: RestPrefDb, { exerciseId }: { exerciseId: string }): Promise<void> {
  await db.execute(`DELETE FROM exercise_rest_prefs WHERE exercise_id = ? AND deleted_at IS NULL`, [exerciseId])
}
