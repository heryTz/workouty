// Data helpers + queries for the exercise library / picker (Milestone 4 Task C1).
//
// "Visible" exercises: the local PowerSync SQLite mirror only ever contains rows this device is
// allowed to see — the built-in library via the `global_exercises` bucket (user_id IS NULL) and
// this user's own rows via `user_data` (see apps/powersync/sync_rules.yaml). So a plain
// `SELECT * FROM exercises` needs no explicit user_id filter to stay scoped correctly: every
// locally-visible row already belongs to either nobody (built-in) or the signed-in user.
//
// Ordering: exercises the user has actually performed (derived from sets.performed_at via
// session_exercises — there is no direct "last used" column) sort first, most-recent first;
// everything else (built-in or custom, never performed) follows, grouped by muscle_group then
// alphabetically by name. This is a v1 simplification of "recents interleaved with browsing" —
// good enough to make recently-used exercises fast to find without fighting the muscle-group
// grouping for rows that have no usage history at all.
import { useMemo } from 'react'
import type { AbstractPowerSyncDatabase } from '@powersync/common'
import { useQuery } from '@powersync/react'
import type { LoadType, Measure } from '@workouty/shared'

export interface ExerciseRow {
  id: string
  user_id: string | null
  name: string
  muscle_group: string
  default_rest_seconds: number
  // The rest the app actually uses for this exercise: the user's per-exercise override
  // (exercise_rest_prefs) if set, else the exercise's built-in default_rest_seconds.
  effective_rest_seconds: number
  is_custom: number
  // ISO timestamp of the most recent set logged against this exercise by the current user, or
  // null if it's never been used.
  last_used_at: string | null
}

export interface ExerciseGroup {
  muscleGroup: string
  exercises: ExerciseRow[]
}

// `lu` is a per-exercise "last used" aggregate: the most recent performed_at across all (live)
// sets logged against a (live) session_exercise pointing at that exercise. LEFT JOIN so
// never-used exercises still appear, with last_used_at = NULL.
//
// ORDER BY, in order of precedence:
//   1. (lu.last_used_at IS NULL) ASC  — rows WITH usage history (0) sort before rows without (1)
//   2. lu.last_used_at DESC           — among used rows, most-recently-used first (ISO-8601
//                                        strings sort chronologically as plain text)
//   3. e.muscle_group ASC, e.name ASC — among never-used rows (and as a tiebreak generally),
//                                        grouped by muscle group then alphabetical
const VISIBLE_EXERCISES_QUERY = `
  SELECT
    e.id AS id,
    e.user_id AS user_id,
    e.name AS name,
    e.muscle_group AS muscle_group,
    e.default_rest_seconds AS default_rest_seconds,
    COALESCE(p.rest_seconds, e.default_rest_seconds) AS effective_rest_seconds,
    e.is_custom AS is_custom,
    lu.last_used_at AS last_used_at
  FROM exercises e
  LEFT JOIN exercise_rest_prefs p ON p.exercise_id = e.id AND p.deleted_at IS NULL
  LEFT JOIN (
    SELECT se.exercise_id AS exercise_id, MAX(s.performed_at) AS last_used_at
    FROM session_exercises se
    JOIN sets s ON s.session_exercise_id = se.id AND s.deleted_at IS NULL
    WHERE se.deleted_at IS NULL
    GROUP BY se.exercise_id
  ) lu ON lu.exercise_id = e.id
  WHERE e.deleted_at IS NULL AND e.name LIKE ?
  ORDER BY
    (lu.last_used_at IS NULL) ASC,
    lu.last_used_at DESC,
    e.muscle_group ASC,
    e.name ASC
`

export interface UseExercisesResult {
  // Flat, already-ordered result (as VISIBLE_EXERCISES_QUERY produced it) — handy for tests /
  // callers that don't need the grouped shape.
  data: ExerciseRow[]
  // Recently-used exercises, most-recent first.
  recents: ExerciseRow[]
  // Never-used exercises, bucketed by muscle group (each bucket alphabetical by name).
  groups: ExerciseGroup[]
  isLoading: boolean
}

// Reactive (via @powersync/react's useQuery — re-runs whenever exercises/session_exercises/sets
// change locally, which covers both local writes and rows synced down from the server) list of
// exercises visible to the current user, filtered by `search` (case-insensitive substring match
// on name — SQLite's LIKE is case-insensitive for ASCII by default).
export function useExercises(search: string): UseExercisesResult {
  const pattern = `%${search.trim()}%`
  const { data, isLoading } = useQuery<ExerciseRow>(VISIBLE_EXERCISES_QUERY, [pattern])

  const { recents, groups } = useMemo(() => groupExercises(data), [data])

  return { data, recents, groups, isLoading }
}

// Pure — exported so the grouping/bucketing logic is unit-testable without a live PowerSync DB.
// Assumes `rows` is already ordered per VISIBLE_EXERCISES_QUERY: a single linear pass splits
// "used" rows into `recents` (already in most-recent-first order) and folds consecutive
// same-muscle-group "never used" rows into `groups` (already in muscle_group/name order).
export function groupExercises(rows: ExerciseRow[]): { recents: ExerciseRow[]; groups: ExerciseGroup[] } {
  const recents: ExerciseRow[] = []
  const groups: ExerciseGroup[] = []

  for (const row of rows) {
    if (row.last_used_at) {
      recents.push(row)
      continue
    }

    const currentGroup = groups[groups.length - 1]
    if (currentGroup && currentGroup.muscleGroup === row.muscle_group) {
      currentGroup.exercises.push(row)
    } else {
      groups.push({ muscleGroup: row.muscle_group, exercises: [row] })
    }
  }

  return { recents, groups }
}

// New custom exercises default to this rest interval (matches the Postgres column default —
// see apps/api/src/db/schema.ts's `defaultRestSeconds`); the picker's add-custom form doesn't
// currently ask for one.
const DEFAULT_CUSTOM_REST_SECONDS = 90

export interface AddCustomExerciseInput {
  name: string
  muscleGroup: string
  userId: string
  // How the exercise is loaded and what a set of it counts. Defaulted rather than required so
  // existing callers keep the pre-0003 behaviour, and because these are the values the vast
  // majority of custom exercises want — matching both the Postgres column defaults and the
  // picker form's initial state.
  loadType?: LoadType
  measure?: Measure
}

// Minimal structural type of what addCustomExercise needs from the PowerSync database — kept
// structural (not AbstractPowerSyncDatabase) so this stays unit-testable with a plain mock.
export interface ExecutableDb {
  execute: AbstractPowerSyncDatabase['execute']
}

// Inserts a new custom exercise locally (optimistic — appears in useExercises immediately via
// its reactive query) and lets PowerSync's CRUD queue sync it up. Returns the generated id: the
// caller (the picker screen) needs it to correlate a later rejection (PowerSyncProvider's
// `lastRejected`, keyed by op id) back to this specific submission — see crud-mapping.ts/
// connector.ts's onRejected contract and roundtrip.node.test.ts's REJECTION case for why a
// duplicate (user_id, name) is rejected rather than silently accepted.
export async function addCustomExercise(
  db: ExecutableDb,
  { name, muscleGroup, userId, loadType = 'external', measure = 'reps' }: AddCustomExerciseInput,
): Promise<string> {
  const id = generateClientId()
  const nowISO = new Date().toISOString()

  await db.execute(
    `INSERT INTO exercises
       (id, user_id, name, muscle_group, default_rest_seconds, load_type, measure, is_custom, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [id, userId, name.trim(), muscleGroup, DEFAULT_CUSTOM_REST_SECONDS, loadType, measure, nowISO, nowISO],
  )

  return id
}

// crypto.randomUUID() is available in every runtime this app currently ships to (browsers incl.
// Playwright/Chromium, and Node — vitest's environment) — this is the client-side id generation
// the schema relies on (see powersync/schema.ts's header comment: clients generate their own
// uuids so an offline insert is safe to upload later without collision). The Math.random
// fallback below exists only so this doesn't hard-crash on a runtime without it (e.g. an older
// Hermes on native, not yet exercised by this web-verified task); it's not cryptographically
// strong, which is fine here — this id is a dedupe/correlation key, not a security token.
function generateClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/gu, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
