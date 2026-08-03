import { estimateOneRepMax } from './one-rep-max'

/**
 * One logged set, tagged with the session it belongs to and when that session started.
 * `sessionStartedAt` is identical across every set in a session (it's the session's timestamp,
 * not the set's) — it's what the chart plots the session against on the time axis.
 */
export interface WorkoutSet {
  sessionId: string
  sessionStartedAt: string
  weightKg: number
  reps: number
}

/** One point on the per-exercise progression chart: a single session collapsed to its bests. */
export interface ProgressionPoint {
  sessionId: string
  date: string
  topWeightKg: number
  bestEstimatedOneRepMax: number
}

/**
 * Collapse an exercise's set history into one point per session — the session's heaviest set and
 * its best estimated 1RM (Epley; the heaviest set and the best-1RM set need not be the same one,
 * e.g. a heavy single vs. a lighter high-rep set). Points come out oldest-first (ISO timestamps
 * sort chronologically). Input may span many sessions in any order.
 */
export function computeProgression(sets: WorkoutSet[]): ProgressionPoint[] {
  const bySession = new Map<string, ProgressionPoint>()
  for (const s of sets) {
    const e1rm = estimateOneRepMax(s.weightKg, s.reps)
    const existing = bySession.get(s.sessionId)
    if (!existing) {
      bySession.set(s.sessionId, {
        sessionId: s.sessionId,
        date: s.sessionStartedAt,
        topWeightKg: s.weightKg,
        bestEstimatedOneRepMax: e1rm,
      })
    } else {
      if (s.weightKg > existing.topWeightKg) existing.topWeightKg = s.weightKg
      if (e1rm > existing.bestEstimatedOneRepMax) existing.bestEstimatedOneRepMax = e1rm
    }
  }
  return [...bySession.values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0,
  )
}
