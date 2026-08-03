/**
 * Estimated one-rep max via the Epley formula.
 *
 * Epley is undefined at a single rep — it would inflate a true 1RM by 1/30. A set of one
 * IS the one-rep max, so it is returned unchanged.
 */
export function estimateOneRepMax(weightKg: number, reps: number): number {
  if (!Number.isFinite(weightKg) || weightKg < 0) {
    throw new RangeError(`weightKg must be a non-negative finite number, got ${weightKg}`)
  }
  if (!Number.isInteger(reps) || reps < 1) {
    throw new RangeError(`reps must be a positive integer, got ${reps}`)
  }
  if (reps === 1) return weightKg
  return weightKg * (1 + reps / 30)
}
