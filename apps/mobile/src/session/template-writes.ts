// Write helpers for templates (Milestone 5 Task A1): creating a template from a session's current
// exercises, starting a fresh session from a template, reconciling a template with how a session
// actually went, renaming/deleting templates, and removing a single exercise from an in-progress
// session. These are local writes against the PowerSync SQLite mirror — PowerSync's CRUD queue
// uploads them via the connector, same as session-writes.ts.
//
// Each helper takes a minimal structural `ExecutableDb` (`execute` + `getAll`, the subset of
// `AbstractPowerSyncDatabase` these need) rather than the concrete class, so this stays
// unit-testable with a plain mock, independent of the native PowerSync import path — see
// session-writes.ts / exercises.ts for the same pattern (this file needs reads too, hence the
// added `getAll`, mirroring how exercise-picker.tsx calls `db.getAll` directly).
import type { AbstractPowerSyncDatabase } from '@powersync/common'
import { findActiveSessionId } from './session-writes'

export interface ExecutableDb {
  execute: AbstractPowerSyncDatabase['execute']
  getAll: AbstractPowerSyncDatabase['getAll']
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

interface SessionExerciseWithRest {
  exercise_id: string
  position: number
  default_rest_seconds: number
}

// A session's (live) exercises in position order, each joined with its exercise's
// default_rest_seconds — the value template_exercises.default_rest_seconds copies from, since
// that column is NOT NULL with no default.
const SESSION_EXERCISES_WITH_REST_QUERY = `
  SELECT se.exercise_id AS exercise_id, se.position AS position,
         COALESCE(p.rest_seconds, e.default_rest_seconds) AS default_rest_seconds
  FROM session_exercises se
  JOIN exercises e ON e.id = se.exercise_id
  LEFT JOIN exercise_rest_prefs p ON p.exercise_id = se.exercise_id AND p.deleted_at IS NULL
  WHERE se.session_id = ? AND se.deleted_at IS NULL
  ORDER BY se.position ASC
`

export interface CreateTemplateFromSessionInput {
  userId: string
  sessionId: string
  name: string
}

// Snapshots a session's current (live) exercises into a brand-new template: one `templates` row
// plus one `template_exercises` row per session exercise (position preserved, default_rest_seconds
// copied from the exercise). Returns the new template id.
//
// The session is then attached to the template it produced, so a freestyle workout you decide to
// keep reads back as an instance of the template rather than as unlabelled history — and the
// finish-time divergence check has something to compare against from that point on.
//
// `AND template_id IS NULL` is the whole rule: a session that was STARTED from a template keeps
// pointing at that one, because what it was started from is a fact about the workout, not a
// preference. That matters most for the divergence prompt's "Save as new", which runs this on a
// session that already has a template and must not silently rewrite its origin. Keeping the guard
// in the statement (rather than reading template_id first and branching) leaves no window between
// the check and the write.
export async function createTemplateFromSession(
  db: ExecutableDb,
  { userId, sessionId, name }: CreateTemplateFromSessionInput,
): Promise<string> {
  const rows = await db.getAll<SessionExerciseWithRest>(SESSION_EXERCISES_WITH_REST_QUERY, [sessionId])

  const templateId = newId()
  const timestamp = nowIso()

  await db.execute(
    `INSERT INTO templates
       (id, user_id, name, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
    [templateId, userId, name, timestamp, timestamp],
  )

  for (const row of rows) {
    await db.execute(
      `INSERT INTO template_exercises
         (id, user_id, template_id, exercise_id, position, default_rest_seconds, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId(), userId, templateId, row.exercise_id, row.position, row.default_rest_seconds, timestamp, timestamp],
    )
  }

  await db.execute(`UPDATE sessions SET template_id = ?, updated_at = ? WHERE id = ? AND template_id IS NULL`, [
    templateId,
    timestamp,
    sessionId,
  ])

  return templateId
}

interface TemplateExerciseRow {
  exercise_id: string
  position: number
}

const TEMPLATE_EXERCISES_QUERY = `
  SELECT exercise_id AS exercise_id, position AS position
  FROM template_exercises
  WHERE template_id = ? AND deleted_at IS NULL
  ORDER BY position ASC
`

export interface StartSessionFromTemplateInput {
  userId: string
  templateId: string
}

// Starts a new session pre-populated with a template's (live) exercises: one `sessions` row
// (template_id = templateId) plus one `session_exercises` row per template exercise (position
// preserved). No sets are inserted — the user logs those as they go. Returns the new session id.
export async function startSessionFromTemplate(
  db: ExecutableDb,
  { userId, templateId }: StartSessionFromTemplateInput,
): Promise<string> {
  // One active session per user: if one is already open, resume it instead of starting a second
  // from the template (mirrors startSession's guard; the templates screen also disables Start
  // while a session is active, this backstops it).
  const active = await findActiveSessionId(db)
  if (active) return active

  const sessionId = newId()
  const timestamp = nowIso()

  await db.execute(
    `INSERT INTO sessions
       (id, user_id, template_id, started_at, ended_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    [sessionId, userId, templateId, timestamp, timestamp, timestamp],
  )

  const rows = await db.getAll<TemplateExerciseRow>(TEMPLATE_EXERCISES_QUERY, [templateId])

  for (const row of rows) {
    await db.execute(
      `INSERT INTO session_exercises
         (id, user_id, session_id, exercise_id, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newId(), userId, sessionId, row.exercise_id, row.position, timestamp, timestamp],
    )
  }

  return sessionId
}

export interface UpdateTemplateFromSessionInput {
  userId: string
  templateId: string
  sessionId: string
}

// Reconciles a template with how a session actually went, trivially-correctly: soft-deletes ALL
// of the template's current template_exercises, then re-inserts the session's current (live)
// exercises as fresh template_exercises with contiguous positions 0..n-1 (no unique constraint on
// template_exercises, so there's no collision risk in doing this as delete-all-then-reinsert
// rather than diffing). The template's name is left untouched.
//
// The soft-delete itself MUST be a SQL DELETE (below), not an UPDATE that sets deleted_at:
// apps/api/src/sync/upload-contracts.ts's `serverOwned` omits deletedAt from every PUT/PATCH
// schema (it's stamped server-side, only via the softDeleteRow branch a PowerSync DELETE op
// triggers — see upload.service.ts). A client-side `UPDATE ... SET deleted_at = ?` uploads as a
// PATCH; the server silently drops the deletedAt field from it (rows through
// `.partial()`/`.omit()`, unknown-key-stripping zod parse), so deleted_at never actually gets
// set server-side — and the next download of that (still-live) row overwrites the local
// optimistic copy right back to not-deleted. A `DELETE FROM ...` uploads as PowerSync's `DELETE`
// op instead, which the server maps straight to softDeleteRow() — this is also what makes the
// LOCAL row disappear immediately (PowerSync's local mirror drops a row on a local DELETE, same
// as it will once the corresponding REMOVE op round-trips from the sync rules' `deleted_at IS
// NULL` filter). Confirmed against the live stack (web, Playwright + psql) while building the
// Task C1 templates screen — a soft-delete written as UPDATE looked fine against a mocked db in
// this file's unit tests but round-tripped to a no-op against the real server.
export async function updateTemplateFromSession(
  db: ExecutableDb,
  { userId, templateId, sessionId }: UpdateTemplateFromSessionInput,
): Promise<void> {
  const timestamp = nowIso()

  await db.execute(`DELETE FROM template_exercises WHERE template_id = ? AND deleted_at IS NULL`, [templateId])

  const rows = await db.getAll<SessionExerciseWithRest>(SESSION_EXERCISES_WITH_REST_QUERY, [sessionId])

  for (const [index, row] of rows.entries()) {
    await db.execute(
      `INSERT INTO template_exercises
         (id, user_id, template_id, exercise_id, position, default_rest_seconds, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId(), userId, templateId, row.exercise_id, index, row.default_rest_seconds, timestamp, timestamp],
    )
  }
}

export interface RenameTemplateInput {
  templateId: string
  name: string
}

// Renames a template.
export async function renameTemplate(db: ExecutableDb, { templateId, name }: RenameTemplateInput): Promise<void> {
  await db.execute(`UPDATE templates SET name = ?, updated_at = ? WHERE id = ?`, [name, nowIso(), templateId])
}

export interface DeleteTemplateInput {
  templateId: string
}

// Soft-deletes a template and its (live) template_exercises. Uses SQL DELETE, not an UPDATE
// setting deleted_at — see updateTemplateFromSession's header comment for why (the server-owned
// deletedAt column silently drops out of an uploaded PATCH; only a PowerSync DELETE op reaches
// the server's actual soft-delete path).
export async function deleteTemplate(db: ExecutableDb, { templateId }: DeleteTemplateInput): Promise<void> {
  await db.execute(`DELETE FROM templates WHERE id = ?`, [templateId])
  await db.execute(`DELETE FROM template_exercises WHERE template_id = ? AND deleted_at IS NULL`, [templateId])
}

export interface RemoveSessionExerciseInput {
  sessionExerciseId: string
}

// Removes an exercise from an in-progress session: soft-deletes the session_exercise AND its
// (live) sets, so a removed exercise leaves no orphaned sets behind. Uses SQL DELETE, not an
// UPDATE setting deleted_at — see updateTemplateFromSession's header comment for why.
export async function removeSessionExercise(
  db: ExecutableDb,
  { sessionExerciseId }: RemoveSessionExerciseInput,
): Promise<void> {
  await db.execute(`DELETE FROM session_exercises WHERE id = ?`, [sessionExerciseId])
  await db.execute(`DELETE FROM sets WHERE session_exercise_id = ? AND deleted_at IS NULL`, [sessionExerciseId])
}
