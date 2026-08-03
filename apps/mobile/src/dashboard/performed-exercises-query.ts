// The dashboard's exercise selector (Milestone 6 Task B1): every exercise the user has at least
// one live logged set for, alphabetically.
import { useQuery } from '@powersync/react'

export interface PerformedExercise {
  id: string
  name: string
}

// Distinct exercises the user has at least one live set for, alphabetically — the dashboard's
// exercise selector. No user_id filter needed (the local mirror only holds this user's rows).
export const performedExercisesSql = `
  SELECT DISTINCT e.id AS id, e.name AS name
  FROM sets s
  JOIN session_exercises se ON se.id = s.session_exercise_id
  JOIN exercises e ON e.id = se.exercise_id
  WHERE se.deleted_at IS NULL AND s.deleted_at IS NULL
  ORDER BY e.name ASC
`

export function usePerformedExercises(): { data: PerformedExercise[]; isLoading: boolean } {
  const { data, isLoading } = useQuery<PerformedExercise>(performedExercisesSql)
  return { data, isLoading }
}
