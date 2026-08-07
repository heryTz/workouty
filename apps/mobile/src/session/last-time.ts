// "Last time" reference (Milestone 4 Task E3): while logging a set for the CURRENT session's
// current exercise, show the user's top set from their most recent PRIOR session that included
// that exercise -- e.g. "Last time: 60 kg x 8" -- so they know what to beat (spec 3.6).
//
// Query shape (see lastTimeTopSetSql): a subquery finds the most recent PRIOR session_id that has
// at least one live set for this exercise, excluding the current session, ordered by
// sessions.started_at DESC, LIMIT 1. The outer query then picks the top (live) set within that
// session for that exercise. If the user has never done this exercise before (or has only done it
// in the current session), the subquery returns no session_id and the outer query returns zero
// rows -- useLastTime maps that to null and callers show nothing / "First time".
import { useQuery } from '@powersync/react'

export interface LastTimeTopSet {
  weightKg: number
  reps: number | null
  durationSeconds: number | null
}

interface LastTimeRow {
  weight_kg: number
  reps: number | null
  duration_seconds: number | null
}

/**
 * What "top set" means, per exercise. Ranking on weight alone is right only when weight is the
 * whole load: every set of an unweighted push-up carries 0 kg, so `weight_kg DESC` would pick an
 * arbitrary one and the user would be told to beat whichever row SQLite happened to return first.
 *
 * The first CASE is NULL for every row of a non-external-rep exercise, which ties them all and
 * hands the decision to the second — SQLite treats NULL as smaller than any value, so a
 * uniformly-NULL key simply has no effect on the ordering.
 *
 *   external + reps  -> weight, then reps   (unchanged from before load_type/measure existed)
 *   bodyweight+ reps -> reps, then added weight
 *   any + duration   -> hold, then added weight
 */
const TOP_SET_ORDER = `
    ORDER BY
      CASE WHEN e.load_type = 'external' AND e.measure = 'reps' THEN s.weight_kg END DESC,
      CASE WHEN e.measure = 'duration' THEN s.duration_seconds ELSE s.reps END DESC,
      s.weight_kg DESC
`

// Pure query builder so the SQL shape is unit-testable without a live PowerSync DB (see the
// header comment above and last-time.test.ts).
export function lastTimeTopSetSql(exerciseId: string, currentSessionId: string): { sql: string; params: unknown[] } {
  const sql = `
    SELECT s.weight_kg AS weight_kg, s.reps AS reps, s.duration_seconds AS duration_seconds
    FROM sets s
    JOIN session_exercises se ON se.id = s.session_exercise_id
    JOIN exercises e ON e.id = se.exercise_id
    WHERE se.exercise_id = ?
      AND se.deleted_at IS NULL
      AND s.deleted_at IS NULL
      AND se.session_id = (
        SELECT se2.session_id
        FROM sets s2
        JOIN session_exercises se2 ON se2.id = s2.session_exercise_id
        JOIN sessions sess2 ON sess2.id = se2.session_id
        WHERE se2.exercise_id = ?
          AND se2.deleted_at IS NULL
          AND s2.deleted_at IS NULL
          AND se2.session_id != ?
        ORDER BY sess2.started_at DESC
        LIMIT 1
      )
    ${TOP_SET_ORDER}
    LIMIT 1
  `
  return { sql, params: [exerciseId, exerciseId, currentSessionId] }
}

// Reactive (via @powersync/react's useQuery) top-set reference for `exerciseId` as of the most
// recent session prior to `currentSessionId`, or null if there isn't one (never done, or only
// done in the current session). `exerciseId` may be null (no current exercise selected yet) --
// hooks must run unconditionally, so that case is folded into a query that structurally can't
// match any row (empty-string exercise_id never equals a real uuid) rather than skipping the
// useQuery call.
export function useLastTime(exerciseId: string | null, currentSessionId: string): LastTimeTopSet | null {
  const { sql, params } = lastTimeTopSetSql(exerciseId ?? '', currentSessionId)
  const { data } = useQuery<LastTimeRow>(sql, params)
  const row = data[0]
  if (!row) return null
  return { weightKg: row.weight_kg, reps: row.reps, durationSeconds: row.duration_seconds }
}

// The FULL last-time reference: every set the user logged for `exerciseId` in their most recent
// PRIOR session (not just the top set), in set order — so each exercise card can show the whole
// previous performance (reps × weight + the rest taken after each set), not only "what to beat".
// Same "most recent prior session" subquery as lastTimeTopSetSql; the difference is the outer
// query returns all of that session's sets ordered by set_index instead of the single top set.
export interface LastSessionSet {
  setIndex: number
  weightKg: number
  reps: number | null
  durationSeconds: number | null
  // Rest taken AFTER this set (seconds). The last set of the exercise has none, hence nullable.
  actualRestSeconds: number | null
}

interface LastSessionSetRow {
  set_index: number
  weight_kg: number
  reps: number | null
  duration_seconds: number | null
  actual_rest_seconds: number | null
}

export function lastSessionSetsSql(exerciseId: string, currentSessionId: string): { sql: string; params: unknown[] } {
  const sql = `
    SELECT s.set_index AS set_index, s.weight_kg AS weight_kg, s.reps AS reps,
           s.duration_seconds AS duration_seconds, s.actual_rest_seconds AS actual_rest_seconds
    FROM sets s
    JOIN session_exercises se ON se.id = s.session_exercise_id
    WHERE se.exercise_id = ?
      AND se.deleted_at IS NULL
      AND s.deleted_at IS NULL
      AND se.session_id = (
        SELECT se2.session_id
        FROM sets s2
        JOIN session_exercises se2 ON se2.id = s2.session_exercise_id
        JOIN sessions sess2 ON sess2.id = se2.session_id
        WHERE se2.exercise_id = ?
          AND se2.deleted_at IS NULL
          AND s2.deleted_at IS NULL
          AND se2.session_id != ?
        ORDER BY sess2.started_at DESC
        LIMIT 1
      )
    ORDER BY s.set_index ASC
  `
  return { sql, params: [exerciseId, exerciseId, currentSessionId] }
}

// Reactive full list of `exerciseId`'s sets from the most recent session prior to
// `currentSessionId`, in set order — empty if it's never been done before (or only in the current
// session). `exerciseId` may be null; folded into an unmatchable query so the hook still runs
// unconditionally (same pattern as useLastTime).
export function useLastSessionSets(exerciseId: string | null, currentSessionId: string): LastSessionSet[] {
  const { sql, params } = lastSessionSetsSql(exerciseId ?? '', currentSessionId)
  const { data } = useQuery<LastSessionSetRow>(sql, params)
  return data.map((r) => ({
    setIndex: r.set_index,
    weightKg: r.weight_kg,
    reps: r.reps,
    durationSeconds: r.duration_seconds,
    actualRestSeconds: r.actual_rest_seconds,
  }))
}
