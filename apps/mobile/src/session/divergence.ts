// Template divergence detection (Milestone 5 Task B1, spec 3.5): on finishing a session that
// started from a template, if the exercise list diverged from the template -- exercises added,
// removed, or swapped/reordered -- the caller prompts the user. This module is the pure
// comparison: given the session's ordered exercise-id list and the template's ordered
// exercise-id list, is it diverged, and what changed. No DB, no React -- callers are responsible
// for querying live (deleted_at IS NULL) rows in position order and passing plain id arrays here.

// True iff the ordered arrays are NOT identical: different length, different ids at some
// position, or the same ids in a different order. Order matters -- a swap/reorder counts as
// divergence even when the two lists contain the same set of exercise ids.
export function exerciseListDiverged(sessionExerciseIds: string[], templateExerciseIds: string[]): boolean {
  if (sessionExerciseIds.length !== templateExerciseIds.length) return true
  for (let i = 0; i < sessionExerciseIds.length; i++) {
    if (sessionExerciseIds[i] !== templateExerciseIds[i]) return true
  }
  return false
}

// A richer diff for a helpful prompt message.
export interface ExerciseListDiff {
  added: string[] // exercise ids in the session but not the template
  removed: string[] // exercise ids in the template but not the session
  reordered: boolean // same set of ids, but the order differs (no adds/removes)
}

export function diffExerciseLists(sessionExerciseIds: string[], templateExerciseIds: string[]): ExerciseListDiff {
  const templateSet = new Set(templateExerciseIds)
  const sessionSet = new Set(sessionExerciseIds)

  const added = sessionExerciseIds.filter((id) => !templateSet.has(id))
  const removed = templateExerciseIds.filter((id) => !sessionSet.has(id))

  // Reordered only means something when there's no add/remove residual: the same ids present in
  // both, just rearranged. With adds/removes in play, "reordered" is left false -- the added/
  // removed lists already explain the divergence.
  const reordered =
    added.length === 0 && removed.length === 0 && exerciseListDiverged(sessionExerciseIds, templateExerciseIds)

  return { added, removed, reordered }
}
