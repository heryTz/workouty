// "New PR!" badging for the logging screen (Milestone 6 Task B1): which of an exercise's live
// sets are a personal record (weight or estimated-1RM), via @workouty/shared's markPersonalRecords.
import { useQuery } from '@powersync/react'
import { markPersonalRecords, type RecordSet } from '@workouty/shared'

interface PrRow {
  id: string
  performed_at: string
  weight_kg: number
  reps: number
}

// All live sets for `exerciseId`, chronologically — fed through markPersonalRecords to find which
// sets are PRs (weight OR estimated-1RM). Used to badge "New PR!" in the logging screen.
export function prSetsSql(exerciseId: string): { sql: string; params: unknown[] } {
  const sql = `
    SELECT s.id AS id, s.performed_at AS performed_at, s.weight_kg AS weight_kg, s.reps AS reps
    FROM sets s
    JOIN session_exercises se ON se.id = s.session_exercise_id
    WHERE se.exercise_id = ?
      AND se.deleted_at IS NULL
      AND s.deleted_at IS NULL
  `
  return { sql, params: [exerciseId] }
}

export function mapPrSetIds(rows: PrRow[]): Set<string> {
  const sets: RecordSet[] = rows.map((r) => ({
    id: r.id,
    performedAt: r.performed_at,
    weightKg: r.weight_kg,
    reps: r.reps,
  }))
  return new Set(
    markPersonalRecords(sets)
      .filter((s) => s.isWeightPr || s.isEstimatedOneRepMaxPr || s.isSetVolumePr)
      .map((s) => s.id),
  )
}

export function usePrSetIds(exerciseId: string | null): Set<string> {
  const { sql, params } = prSetsSql(exerciseId ?? '')
  const { data } = useQuery<PrRow>(sql, params)
  return mapPrSetIds(data)
}
