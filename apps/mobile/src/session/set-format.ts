// How one logged set reads back, shared by every screen that shows sets: the active session
// (app/(app)/session/[id].tsx, including its "Last time" block) and the finished-session detail
// view (app/(app)/sessions/[id].tsx). A set has to read the same way in history as it did while
// you were logging it, which is the reason this lives here rather than in either screen.
import type { LoadType, Measure } from '@workouty/shared'

export interface SetPerformanceMeasurement {
  load_type: LoadType
  measure: Measure
}

export interface SetPerformance {
  reps: number | null
  durationSeconds: number | null
  weightKg: number
}

/**
 * "12 × 0kg" is a nonsense way to describe a push-up, so an unweighted bodyweight set shows the
 * bare count. Anything strapped on is shown as an explicit "+", because for these exercises the
 * number is what was ADDED, not what was lifted.
 *
 *   Bench press  -> "8 × 60kg"      Push-up  -> "12"      Weighted pull-up -> "5 +20kg"
 *   Plank        -> "60s"           Weighted plank       -> "60s +10kg"
 */
export function formatSetPerformance(
  { load_type, measure }: SetPerformanceMeasurement,
  set: SetPerformance,
): string {
  const effort = measure === 'duration' ? `${set.durationSeconds ?? 0}s` : `${set.reps ?? 0}`
  if (load_type === 'bodyweight') {
    return set.weightKg > 0 ? `${effort} +${set.weightKg}kg` : effort
  }
  return `${effort} × ${set.weightKg}kg`
}
