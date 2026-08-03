// Per-exercise progression chart data (Milestone 6 Task B1): every live set for an exercise,
// collapsed to one point per session (top weight + best estimated 1RM) via
// @workouty/shared's computeProgression.
import { useQuery } from '@powersync/react'
import { computeProgression, type ProgressionPoint, type WorkoutSet } from '@workouty/shared'

interface ProgressionRow {
  session_id: string
  started_at: string
  weight_kg: number
  reps: number
}

// All live sets for `exerciseId`, tagged with their session id + start time. Soft-deleted sets,
// session_exercises, and sessions are all excluded (a locally-written soft-delete beats the sync
// round-trip to the mirror, so filter defensively — same habit as session/templates-queries.ts).
export function progressionSetsSql(exerciseId: string): { sql: string; params: unknown[] } {
  const sql = `
    SELECT se.session_id AS session_id, sess.started_at AS started_at,
           s.weight_kg AS weight_kg, s.reps AS reps
    FROM sets s
    JOIN session_exercises se ON se.id = s.session_exercise_id
    JOIN sessions sess ON sess.id = se.session_id
    WHERE se.exercise_id = ?
      AND se.deleted_at IS NULL
      AND s.deleted_at IS NULL
      AND sess.deleted_at IS NULL
  `
  return { sql, params: [exerciseId] }
}

export function mapProgressionRows(rows: ProgressionRow[]): ProgressionPoint[] {
  const sets: WorkoutSet[] = rows.map((r) => ({
    sessionId: r.session_id,
    sessionStartedAt: r.started_at,
    weightKg: r.weight_kg,
    reps: r.reps,
  }))
  return computeProgression(sets)
}

// exerciseId may be null (nothing selected yet) — fold into a query that can't match any row
// (empty string never equals a real uuid) so the hook still runs unconditionally.
export function useProgression(exerciseId: string | null): ProgressionPoint[] {
  const { sql, params } = progressionSetsSql(exerciseId ?? '')
  const { data } = useQuery<ProgressionRow>(sql, params)
  return mapProgressionRows(data)
}
