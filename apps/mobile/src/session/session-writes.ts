// Write helpers for the logging loop (Milestone 4 Task D1): starting a session, adding exercises
// to it, logging sets, recording rest between sets, and ending the session. These are local
// writes against the PowerSync SQLite mirror — PowerSync's CRUD queue uploads them via the
// connector (see crud-mapping.ts for the snake_case -> camelCase + boolean coercion on the wire).
//
// Each helper takes a minimal structural `ExecutableDb` (just `execute`) rather than
// `AbstractPowerSyncDatabase` so this stays unit-testable with a plain mock, independent of the
// native PowerSync import path (see exercises.ts's `ExecutableDb` for the same pattern).
import type { AbstractPowerSyncDatabase } from '@powersync/common'

export interface ExecutableDb {
  execute: AbstractPowerSyncDatabase['execute']
}

// A db that can also read — needed by the single-active-session guard below.
export interface QueryableDb extends ExecutableDb {
  getAll: AbstractPowerSyncDatabase['getAll']
}

// The user's currently-open (un-ended) session id, if any. Enforces "one active session per user":
// no user_id filter is needed — the local mirror only holds this user's sessions. Exported so
// startSessionFromTemplate (template-writes.ts) can share the same guard.
export async function findActiveSessionId(db: QueryableDb): Promise<string | null> {
  const rows = await db.getAll<{ id: string }>(
    `SELECT id FROM sessions WHERE ended_at IS NULL AND deleted_at IS NULL ORDER BY started_at DESC LIMIT 1`,
  )
  return rows[0]?.id ?? null
}

// crypto.randomUUID() is available in every runtime this app currently ships to (browsers incl.
// Playwright/Chromium, and Node — vitest's environment); see exercises.ts's generateClientId for
// the fuller rationale and the non-crypto fallback (this id is a dedupe/correlation key, not a
// security token, so Math.random is an acceptable last resort on a runtime without randomUUID).
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/gu, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function nowIso(): string {
  return new Date().toISOString()
}

export interface StartSessionInput {
  userId: string
  templateId?: string
}

// Inserts a new `sessions` row (started_at = now, ended_at = null) and returns its id — UNLESS the
// user already has an un-ended session, in which case that one is returned instead (one active
// session at a time; the home screen shows "Resume" while one is open, so this also backstops any
// other caller).
export async function startSession(db: QueryableDb, { userId, templateId }: StartSessionInput): Promise<string> {
  const active = await findActiveSessionId(db)
  if (active) return active

  const id = newId()
  const timestamp = nowIso()

  await db.execute(
    `INSERT INTO sessions
       (id, user_id, template_id, started_at, ended_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    [id, userId, templateId ?? null, timestamp, timestamp, timestamp],
  )

  return id
}

export interface AddSessionExerciseInput {
  userId: string
  sessionId: string
  exerciseId: string
  position: number
}

// Inserts a `session_exercises` row (an exercise added to an in-progress session) and returns
// its id.
export async function addSessionExercise(
  db: ExecutableDb,
  { userId, sessionId, exerciseId, position }: AddSessionExerciseInput,
): Promise<string> {
  const id = newId()
  const timestamp = nowIso()

  await db.execute(
    `INSERT INTO session_exercises
       (id, user_id, session_id, exercise_id, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, sessionId, exerciseId, position, timestamp, timestamp],
  )

  return id
}

export interface LogSetInput {
  userId: string
  sessionExerciseId: string
  setIndex: number
  // Exactly one of these carries the set, per the exercise's `measure`: reps for a push-up,
  // durationSeconds for a plank. Both are required rather than optional so a caller that forgets
  // one fails here instead of writing a measureless row.
  reps: number | null
  durationSeconds: number | null
  // The load for an external exercise, the ADDED load for a bodyweight one — 0 for a plain
  // push-up. Defaults to 0 so the common bodyweight case needn't spell it out.
  weightKg?: number
  // Defaults to now if omitted — the moment the set was actually performed, not necessarily
  // the moment this function runs, but for the common case (logging right after doing the set)
  // those coincide.
  performedAt?: string
}

// Inserts a `sets` row. actual_rest_seconds starts NULL — rest is recorded afterwards, on this
// (the preceding) set, once the user stops resting; see recordRest.
export async function logSet(
  db: ExecutableDb,
  { userId, sessionExerciseId, setIndex, reps, durationSeconds, weightKg = 0, performedAt }: LogSetInput,
): Promise<string> {
  // Postgres enforces this as `sets_measure_present_ck`, but the local SQLite mirror carries no
  // CHECK constraints — an invalid row would insert cleanly, sync, and be rejected server-side
  // where the user would never see it. Failing at the write keeps that silent loss impossible.
  if (reps === null && durationSeconds === null) {
    throw new Error('logSet requires either reps or durationSeconds')
  }

  const id = newId()
  const timestamp = nowIso()

  await db.execute(
    `INSERT INTO sets
       (id, user_id, session_exercise_id, set_index, reps, duration_seconds, weight_kg, actual_rest_seconds, performed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    [
      id,
      userId,
      sessionExerciseId,
      setIndex,
      reps,
      durationSeconds,
      weightKg,
      performedAt ?? timestamp,
      timestamp,
      timestamp,
    ],
  )

  return id
}

export interface RecordRestInput {
  setId: string
  actualRestSeconds: number
}

// Records the rest the user actually took after a set. Per the M1 schema, rest is tracked on the
// PRECEDING set (the one just finished, that the user is now resting from) rather than the next
// one — so this UPDATEs actual_rest_seconds on the given set id once the user stops resting.
export async function recordRest(db: ExecutableDb, { setId, actualRestSeconds }: RecordRestInput): Promise<void> {
  await db.execute(`UPDATE sets SET actual_rest_seconds = ?, updated_at = ? WHERE id = ?`, [
    actualRestSeconds,
    nowIso(),
    setId,
  ])
}

export interface EndSessionInput {
  sessionId: string
}

// Marks a session finished: ended_at = now.
export async function endSession(db: ExecutableDb, { sessionId }: EndSessionInput): Promise<void> {
  await db.execute(`UPDATE sessions SET ended_at = ?, updated_at = ? WHERE id = ?`, [nowIso(), nowIso(), sessionId])
}
