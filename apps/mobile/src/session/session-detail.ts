// Summary arithmetic for the finished-session detail screen (app/(app)/sessions/[id].tsx): how
// much work a session actually was, in the three numbers worth putting above the exercise list.
//
// Pure, so it's testable without PowerSync — the same split as session-history.ts, which owns the
// date/duration side of the same header.
export interface TotalsSetRow {
  reps: number | null
  duration_seconds: number | null
  weight_kg: number
}

export interface SessionTotals {
  exerciseCount: number
  setCount: number
  /**
   * Tonnage: weight × reps summed over the sets that HAVE reps. A held set is left out entirely
   * rather than counted as its weight — a 60-second plank at +10 kg is real work, but it isn't
   * 10 kg of volume, and there is no honest way to fold seconds into a rep-based sum. Sets with
   * no added load contribute 0, which is arithmetic rather than a special case.
   */
  totalVolumeKg: number
}

export function sessionTotals(exerciseCount: number, sets: TotalsSetRow[]): SessionTotals {
  let totalVolumeKg = 0
  for (const s of sets) {
    if (s.reps !== null) totalVolumeKg += s.weight_kg * s.reps
  }
  return { exerciseCount, setCount: sets.length, totalVolumeKg }
}

// Whole kilos: the sum of a session's sets is a scale-of-effort number, and "1237.5 kg" implies a
// precision that 2.5 kg plate increments don't earn.
export function formatVolumeKg(totalVolumeKg: number): string {
  return `${Math.round(totalVolumeKg)} kg`
}
