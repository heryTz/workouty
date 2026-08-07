import { DEFAULT_MEASUREMENT, metricsFor, type ExerciseMeasurement } from './exercise-measurement'
import { estimateOneRepMax } from './one-rep-max'

/**
 * One logged set, tagged with the session it belongs to and when that session started.
 * `sessionStartedAt` is identical across every set in a session (it's the session's timestamp,
 * not the set's) — it's what the chart plots the session against on the time axis.
 *
 * As in RecordSet, exactly one of `reps` / `durationSeconds` is populated, and `weightKg` is the
 * added load for a bodyweight exercise.
 */
export type WorkoutSet = {
  sessionId: string
  sessionStartedAt: string
  weightKg: number
  reps: number | null
  durationSeconds: number | null
}

/**
 * One point on the per-exercise progression chart: a single session collapsed to its bests.
 *
 * Only the series that apply to the exercise are populated; the rest are null (see metricsFor).
 * An external rep exercise fills `topWeightKg` + `bestEstimatedOneRepMax`; a bodyweight one fills
 * `topWeightKg` (the heaviest ADDED load, usually 0) plus whichever of `bestReps` /
 * `bestDurationSeconds` it measures. Charting `topWeightKg` alone for a bodyweight exercise draws
 * a flat line at zero, which is why the other two series exist.
 */
export type ProgressionPoint = {
  sessionId: string
  date: string
  topWeightKg: number
  bestEstimatedOneRepMax: number | null
  bestReps: number | null
  bestDurationSeconds: number | null
}

// Keeps the higher of two values when either may be absent, so a session's running best survives
// sets that don't carry the measure at all.
function higher(current: number | null, candidate: number | null): number | null {
  if (candidate === null) return current
  if (current === null) return candidate
  return candidate > current ? candidate : current
}

/**
 * Collapse an exercise's set history into one point per session — the session's heaviest set and
 * its best estimated 1RM (Epley; the heaviest set and the best-1RM set need not be the same one,
 * e.g. a heavy single vs. a lighter high-rep set), plus its best reps or longest hold where those
 * apply. Points come out oldest-first (ISO timestamps sort chronologically). Input may span many
 * sessions in any order.
 */
export function computeProgression(
  sets: WorkoutSet[],
  measurement: ExerciseMeasurement = DEFAULT_MEASUREMENT,
): ProgressionPoint[] {
  const metrics = metricsFor(measurement)
  const bySession = new Map<string, ProgressionPoint>()

  for (const s of sets) {
    const e1rm =
      metrics.has('estimatedOneRepMax') && s.reps !== null ? estimateOneRepMax(s.weightKg, s.reps) : null
    const reps = metrics.has('reps') ? s.reps : null
    const duration = metrics.has('duration') ? s.durationSeconds : null

    const existing = bySession.get(s.sessionId)
    if (!existing) {
      bySession.set(s.sessionId, {
        sessionId: s.sessionId,
        date: s.sessionStartedAt,
        topWeightKg: s.weightKg,
        bestEstimatedOneRepMax: e1rm,
        bestReps: reps,
        bestDurationSeconds: duration,
      })
    } else {
      if (s.weightKg > existing.topWeightKg) existing.topWeightKg = s.weightKg
      existing.bestEstimatedOneRepMax = higher(existing.bestEstimatedOneRepMax, e1rm)
      existing.bestReps = higher(existing.bestReps, reps)
      existing.bestDurationSeconds = higher(existing.bestDurationSeconds, duration)
    }
  }

  return [...bySession.values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0,
  )
}
