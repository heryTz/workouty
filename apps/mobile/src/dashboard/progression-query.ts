// Per-exercise progression chart data (Milestone 6 Task B1): every live set for an exercise,
// collapsed to one point per session (top weight, best estimated 1RM, best reps, longest hold)
// via @workouty/shared's computeProgression.
import { useQuery } from '@powersync/react'
import {
  DEFAULT_MEASUREMENT,
  computeProgression,
  type ExerciseMeasurement,
  type LoadType,
  type Measure,
  type ProgressionPoint,
  type WorkoutSet,
} from '@workouty/shared'

interface ProgressionRow {
  session_id: string
  started_at: string
  weight_kg: number
  reps: number | null
  duration_seconds: number | null
  load_type: LoadType
  measure: Measure
}

// All live sets for `exerciseId`, tagged with their session id + start time. Soft-deleted sets,
// session_exercises, and sessions are all excluded (a locally-written soft-delete beats the sync
// round-trip to the mirror, so filter defensively — same habit as session/templates-queries.ts).
// `exercises` is joined for load_type/measure, which decide which series the chart can plot.
export function progressionSetsSql(exerciseId: string): { sql: string; params: unknown[] } {
  const sql = `
    SELECT se.session_id AS session_id, sess.started_at AS started_at,
           s.weight_kg AS weight_kg, s.reps AS reps, s.duration_seconds AS duration_seconds,
           e.load_type AS load_type, e.measure AS measure
    FROM sets s
    JOIN session_exercises se ON se.id = s.session_exercise_id
    JOIN sessions sess ON sess.id = se.session_id
    JOIN exercises e ON e.id = se.exercise_id
    WHERE se.exercise_id = ?
      AND se.deleted_at IS NULL
      AND s.deleted_at IS NULL
      AND sess.deleted_at IS NULL
  `
  return { sql, params: [exerciseId] }
}

// Every row belongs to the one exercise the query was parameterised with.
function measurementOf(rows: ProgressionRow[]): ExerciseMeasurement {
  const first = rows[0]
  if (!first) return DEFAULT_MEASUREMENT
  return { loadType: first.load_type, measure: first.measure }
}

export function mapProgressionRows(rows: ProgressionRow[]): ProgressionPoint[] {
  const sets: WorkoutSet[] = rows.map((r) => ({
    sessionId: r.session_id,
    sessionStartedAt: r.started_at,
    weightKg: r.weight_kg,
    reps: r.reps,
    durationSeconds: r.duration_seconds,
  }))
  return computeProgression(sets, measurementOf(rows))
}

// exerciseId may be null (nothing selected yet) — fold into a query that can't match any row
// (empty string never equals a real uuid) so the hook still runs unconditionally.
export function useProgression(exerciseId: string | null): ProgressionPoint[] {
  const { sql, params } = progressionSetsSql(exerciseId ?? '')
  const { data } = useQuery<ProgressionRow>(sql, params)
  return mapProgressionRows(data)
}
