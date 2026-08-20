// Candidates for replacing an exercise on a session that already has sets logged against it —
// the "Change exercise" affordance on app/(app)/sessions/[id].tsx.
//
// The filter is load_type + measure, not muscle group: those two decide the SHAPE of a set (reps
// or seconds, weight or added weight), and the swap keeps every existing `sets` row exactly as
// it is. Restricting the list to the same shape is therefore what makes the swap safe — a
// reps × kg set can never end up under a timed exercise. Muscle group only sorts: same-group
// exercises come first because that's where the intended correction almost always is (bench →
// incline bench), while the rest of the same-shape library stays reachable by searching.
//
// Query builder exported separately from the hook so the SQL is unit-testable without a live
// PowerSync database, matching session-detail-query.ts.
import { useQuery } from '@powersync/react'
import type { LoadType, Measure } from '@workouty/shared'

export interface SwapCandidateRow {
  id: string
  name: string
  muscle_group: string
  is_custom: number
}

export interface SwapCandidatesInput {
  loadType: LoadType
  measure: Measure
  /** The exercise currently on the card — never a candidate for replacing itself. */
  excludeExerciseId: string
  /** Sorted to the top, not filtered on. */
  muscleGroup: string
  search: string
}

// Enough rows to browse a muscle group without scrolling forever; searching narrows past it.
const CANDIDATE_LIMIT = 50

export function swapCandidatesSql({
  loadType,
  measure,
  excludeExerciseId,
  muscleGroup,
  search,
}: SwapCandidatesInput): { sql: string; params: unknown[] } {
  const sql = `
    SELECT
      e.id AS id,
      e.name AS name,
      e.muscle_group AS muscle_group,
      e.is_custom AS is_custom
    FROM exercises e
    WHERE e.deleted_at IS NULL
      AND e.load_type = ?
      AND e.measure = ?
      AND e.id != ?
      AND e.name LIKE ?
    ORDER BY
      (e.muscle_group = ?) DESC,
      e.muscle_group ASC,
      e.name ASC
    LIMIT ${CANDIDATE_LIMIT}
  `
  return { sql, params: [loadType, measure, excludeExerciseId, `%${search.trim()}%`, muscleGroup] }
}

export interface UseSwapCandidatesResult {
  candidates: SwapCandidateRow[]
  isLoading: boolean
}

// Reactive, like every other read on the detail screen: a custom exercise added on another device
// shows up here without a refetch.
export function useSwapCandidates(input: SwapCandidatesInput): UseSwapCandidatesResult {
  const { sql, params } = swapCandidatesSql(input)
  const { data, isLoading } = useQuery<SwapCandidateRow>(sql, params)
  return { candidates: data, isLoading }
}
