import { estimateOneRepMax } from './one-rep-max'

/** A logged set reduced to what PR detection needs. `performedAt` is ISO (chronological sort key). */
export interface RecordSet {
  id: string
  performedAt: string
  weightKg: number
  reps: number
}

export interface RecordFlags {
  isWeightPr: boolean
  isEstimatedOneRepMaxPr: boolean
  isSetVolumePr: boolean
}

/** Single-set volume load: weight × reps. The most common "volume PR" metric. */
export function setVolume(weightKg: number, reps: number): number {
  return weightKg * reps
}

/** The current all-time bests for a single exercise's history. */
export interface PersonalBest {
  bestWeightKg: number
  bestWeightReps: number
  bestWeightAt: string
  bestEstimatedOneRepMax: number
  bestEstimatedOneRepMaxAt: string
  // Best single-set volume (weight × reps) and the set that achieved it.
  bestSetVolume: number
  bestSetVolumeWeightKg: number
  bestSetVolumeReps: number
  bestSetVolumeAt: string
}

// ISO strings sort chronologically; tie-break on id for determinism.
function chronological(a: RecordSet, b: RecordSet): number {
  return a.performedAt < b.performedAt ? -1 : a.performedAt > b.performedAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Flag each set that STRICTLY beats the best weight, best estimated 1RM, or best single-set
 * volume (weight × reps) established by any EARLIER set. The first set is never a PR (nothing
 * preceded it); equalling a prior best is not a PR. A "PR" for surfacing purposes is
 * `isWeightPr || isEstimatedOneRepMaxPr || isSetVolumePr`.
 */
export function markPersonalRecords(sets: RecordSet[]): Array<RecordSet & RecordFlags> {
  const ordered = [...sets].sort(chronological)
  let maxWeight: number | null = null
  let maxE1rm: number | null = null
  let maxVolume: number | null = null
  return ordered.map((s) => {
    const e1rm = estimateOneRepMax(s.weightKg, s.reps)
    const volume = setVolume(s.weightKg, s.reps)
    const isWeightPr = maxWeight !== null && s.weightKg > maxWeight
    const isEstimatedOneRepMaxPr = maxE1rm !== null && e1rm > maxE1rm
    const isSetVolumePr = maxVolume !== null && volume > maxVolume
    if (maxWeight === null || s.weightKg > maxWeight) maxWeight = s.weightKg
    if (maxE1rm === null || e1rm > maxE1rm) maxE1rm = e1rm
    if (maxVolume === null || volume > maxVolume) maxVolume = volume
    return { ...s, isWeightPr, isEstimatedOneRepMaxPr, isSetVolumePr }
  })
}

/** The current best weight set, best estimated-1RM set, and best set-volume set — or null for empty. */
export function computePersonalBest(sets: RecordSet[]): PersonalBest | null {
  const first = sets[0]
  if (!first) return null
  let bw = first
  let be = first
  let beVal = estimateOneRepMax(first.weightKg, first.reps)
  let bv = first
  let bvVal = setVolume(first.weightKg, first.reps)
  for (const s of sets) {
    if (s.weightKg > bw.weightKg) bw = s
    const e = estimateOneRepMax(s.weightKg, s.reps)
    if (e > beVal) {
      be = s
      beVal = e
    }
    const v = setVolume(s.weightKg, s.reps)
    if (v > bvVal) {
      bv = s
      bvVal = v
    }
  }
  return {
    bestWeightKg: bw.weightKg,
    bestWeightReps: bw.reps,
    bestWeightAt: bw.performedAt,
    bestEstimatedOneRepMax: beVal,
    bestEstimatedOneRepMaxAt: be.performedAt,
    bestSetVolume: bvVal,
    bestSetVolumeWeightKg: bv.weightKg,
    bestSetVolumeReps: bv.reps,
    bestSetVolumeAt: bv.performedAt,
  }
}
