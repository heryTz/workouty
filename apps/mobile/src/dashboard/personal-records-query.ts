// Per-exercise personal-best summary (Milestone 6 Task B1): every exercise's current best weight
// set and best estimated-1RM set, via @workouty/shared's computePersonalBest.
import { useQuery } from '@powersync/react'
import { computePersonalBest, type PersonalBest, type RecordSet } from '@workouty/shared'

export interface ExerciseRecord {
  exerciseId: string
  name: string
  best: PersonalBest
}

interface RecordRow {
  exercise_id: string
  name: string
  id: string
  performed_at: string
  weight_kg: number
  reps: number
}

// Every live set joined to its exercise, ordered so rows group by exercise. Bests are computed in
// JS (estimateOneRepMax's reps=1 case can't be done in SQL), so pull rows and reduce per exercise.
export const personalRecordsSql = `
  SELECT e.id AS exercise_id, e.name AS name, s.id AS id, s.performed_at AS performed_at,
         s.weight_kg AS weight_kg, s.reps AS reps
  FROM sets s
  JOIN session_exercises se ON se.id = s.session_exercise_id
  JOIN exercises e ON e.id = se.exercise_id
  WHERE se.deleted_at IS NULL AND s.deleted_at IS NULL
  ORDER BY e.name ASC, s.performed_at ASC
`

export function mapPersonalRecordRows(rows: RecordRow[]): ExerciseRecord[] {
  const byExercise = new Map<string, { name: string; sets: RecordSet[] }>()
  for (const r of rows) {
    let entry = byExercise.get(r.exercise_id)
    if (!entry) {
      entry = { name: r.name, sets: [] }
      byExercise.set(r.exercise_id, entry)
    }
    entry.sets.push({ id: r.id, performedAt: r.performed_at, weightKg: r.weight_kg, reps: r.reps })
  }
  const out: ExerciseRecord[] = []
  for (const [exerciseId, { name, sets }] of byExercise) {
    const best = computePersonalBest(sets)
    if (best) out.push({ exerciseId, name, best })
  }
  return out
}

export function usePersonalRecords(): { data: ExerciseRecord[]; isLoading: boolean } {
  const { data, isLoading } = useQuery<RecordRow>(personalRecordsSql)
  return { data: mapPersonalRecordRows(data), isLoading }
}
