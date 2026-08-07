// "New PR!" badging for the logging screen (Milestone 6 Task B1): which of an exercise's live
// sets are a personal record in any dimension that applies to it, via @workouty/shared's
// markPersonalRecords + isPersonalRecord.
import { useQuery } from '@powersync/react'
import {
  DEFAULT_MEASUREMENT,
  isPersonalRecord,
  markPersonalRecords,
  type ExerciseMeasurement,
  type LoadType,
  type Measure,
  type RecordSet,
} from '@workouty/shared'

interface PrRow {
  id: string
  performed_at: string
  weight_kg: number
  reps: number | null
  duration_seconds: number | null
  load_type: LoadType
  measure: Measure
}

// All live sets for `exerciseId`, chronologically — fed through markPersonalRecords to find which
// sets are PRs. The join to `exercises` is what carries load_type/measure: which dimensions even
// count as a record depends on them (a plank has no 1RM to beat), so the rows cannot be scored
// without them.
export function prSetsSql(exerciseId: string): { sql: string; params: unknown[] } {
  const sql = `
    SELECT s.id AS id, s.performed_at AS performed_at, s.weight_kg AS weight_kg, s.reps AS reps,
           s.duration_seconds AS duration_seconds, e.load_type AS load_type, e.measure AS measure
    FROM sets s
    JOIN session_exercises se ON se.id = s.session_exercise_id
    JOIN exercises e ON e.id = se.exercise_id
    WHERE se.exercise_id = ?
      AND se.deleted_at IS NULL
      AND s.deleted_at IS NULL
  `
  return { sql, params: [exerciseId] }
}

// Every row belongs to the one exercise the query was parameterised with, so its measurement is
// whatever the first row carries. No rows means no sets to score.
function measurementOf(rows: PrRow[]): ExerciseMeasurement {
  const first = rows[0]
  if (!first) return DEFAULT_MEASUREMENT
  return { loadType: first.load_type, measure: first.measure }
}

export function mapPrSetIds(rows: PrRow[]): Set<string> {
  const sets: RecordSet[] = rows.map((r) => ({
    id: r.id,
    performedAt: r.performed_at,
    weightKg: r.weight_kg,
    reps: r.reps,
    durationSeconds: r.duration_seconds,
  }))
  return new Set(
    markPersonalRecords(sets, measurementOf(rows))
      .filter(isPersonalRecord)
      .map((s) => s.id),
  )
}

export function usePrSetIds(exerciseId: string | null): Set<string> {
  const { sql, params } = prSetsSql(exerciseId ?? '')
  const { data } = useQuery<PrRow>(sql, params)
  return mapPrSetIds(data)
}
