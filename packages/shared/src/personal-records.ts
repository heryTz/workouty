import {
  DEFAULT_MEASUREMENT,
  metricsFor,
  type ExerciseMeasurement,
  type SetMetric,
} from './exercise-measurement'
import { estimateOneRepMax } from './one-rep-max'

/**
 * A logged set reduced to what PR detection needs. `performedAt` is ISO (chronological sort key).
 *
 * Exactly one of `reps` / `durationSeconds` carries the set's measure, per its exercise's
 * `measure` — a plank has no reps, a push-up has no duration. `weightKg` is the added load for a
 * bodyweight exercise and the whole load for an external one (see ExerciseMeasurement).
 */
export type RecordSet = {
  id: string
  performedAt: string
  weightKg: number
  reps: number | null
  durationSeconds: number | null
}

/**
 * Which dimensions this set beat. A flag is false whenever its metric does not apply to the
 * exercise (see metricsFor) — so a plank never claims an estimated-1RM PR — which means callers
 * must not infer "this exercise has no PRs" from any single flag. Use `isPersonalRecord`.
 */
export type RecordFlags = {
  isWeightPr: boolean
  isEstimatedOneRepMaxPr: boolean
  isSetVolumePr: boolean
  isRepsPr: boolean
  isDurationPr: boolean
}

/**
 * Whether a set is a personal record in ANY applicable dimension — the "New PR!" condition.
 *
 * Exists so call sites don't hand-roll the disjunction: one that ORs the flags it knows about
 * keeps compiling when a new dimension is added and silently stops badging the sets that only
 * beat the new one. That is exactly what happened to bodyweight exercises before `isRepsPr`.
 */
export function isPersonalRecord(flags: RecordFlags): boolean {
  return (
    flags.isWeightPr ||
    flags.isEstimatedOneRepMaxPr ||
    flags.isSetVolumePr ||
    flags.isRepsPr ||
    flags.isDurationPr
  )
}

/** Single-set volume load: weight × reps. The most common "volume PR" metric. */
export function setVolume(weightKg: number, reps: number): number {
  return weightKg * reps
}

/**
 * The current all-time bests for a single exercise's history. A field is null when its metric
 * does not apply to the exercise, never 0 — "your best estimated 1RM is 0 kg" is a lie a plank
 * should not tell. `bestWeightKg` is the only always-present best.
 */
export type PersonalBest = {
  bestWeightKg: number
  bestWeightReps: number | null
  bestWeightDurationSeconds: number | null
  bestWeightAt: string
  bestEstimatedOneRepMax: number | null
  bestEstimatedOneRepMaxAt: string | null
  // Best single-set volume (weight × reps) and the set that achieved it.
  bestSetVolume: number | null
  bestSetVolumeWeightKg: number | null
  bestSetVolumeReps: number | null
  bestSetVolumeAt: string | null
  // Best reps and best hold, each ignoring the load the set carried — see the caveat on
  // markPersonalRecords about why these two stay independent of `bestWeightKg`.
  bestReps: number | null
  bestRepsAt: string | null
  bestDurationSeconds: number | null
  bestDurationAt: string | null
}

// ISO strings sort chronologically; tie-break on id for determinism.
function chronological(a: RecordSet, b: RecordSet): number {
  return a.performedAt < b.performedAt ? -1 : a.performedAt > b.performedAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// The value of one metric for one set, or null when the metric does not apply to this exercise or
// the set does not carry the measure it needs. Null propagates as "no opinion": it can neither set
// nor beat a record.
function metricValue(metrics: ReadonlySet<SetMetric>, metric: SetMetric, set: RecordSet): number | null {
  if (!metrics.has(metric)) return null
  switch (metric) {
    case 'weight':
      return set.weightKg
    case 'reps':
      return set.reps
    case 'duration':
      return set.durationSeconds
    case 'estimatedOneRepMax':
      return set.reps === null ? null : estimateOneRepMax(set.weightKg, set.reps)
    case 'setVolume':
      return set.reps === null ? null : setVolume(set.weightKg, set.reps)
  }
}

// Running maximum for one metric. The returned function reports whether `value` STRICTLY beat
// everything seen so far, and folds it in. A null value leaves the maximum untouched and is never
// a record, which is how an inapplicable metric stays quiet without a branch at every call site.
function runningMax(): (value: number | null) => boolean {
  let best: number | null = null
  return (value) => {
    if (value === null) return false
    const beaten = best !== null && value > best
    if (best === null || value > best) best = value
    return beaten
  }
}

/**
 * Flag each set that STRICTLY beats every EARLIER set in each dimension that applies to the
 * exercise (see metricsFor). The first set is never a PR (nothing preceded it); equalling a prior
 * best is not a PR.
 *
 * Caveat for bodyweight exercises: reps/duration and added weight are ranked INDEPENDENTLY, so
 * 12 unweighted pull-ups and 3 at +40 kg are both records and neither is compared against the
 * other. There is no honest scalar that combines them without knowing the user's bodyweight,
 * which is not recorded anywhere.
 */
export function markPersonalRecords(
  sets: RecordSet[],
  measurement: ExerciseMeasurement = DEFAULT_MEASUREMENT,
): Array<RecordSet & RecordFlags> {
  const metrics = metricsFor(measurement)
  const beatsWeight = runningMax()
  const beatsE1rm = runningMax()
  const beatsVolume = runningMax()
  const beatsReps = runningMax()
  const beatsDuration = runningMax()

  return [...sets].sort(chronological).map((s) => ({
    ...s,
    isWeightPr: beatsWeight(metricValue(metrics, 'weight', s)),
    isEstimatedOneRepMaxPr: beatsE1rm(metricValue(metrics, 'estimatedOneRepMax', s)),
    isSetVolumePr: beatsVolume(metricValue(metrics, 'setVolume', s)),
    isRepsPr: beatsReps(metricValue(metrics, 'reps', s)),
    isDurationPr: beatsDuration(metricValue(metrics, 'duration', s)),
  }))
}

// The set scoring highest on `metric`, or null if the metric never produced a value. Ties go to
// the EARLIEST set: the record belongs to whoever set it first, and a later equal set is not a PR
// (markPersonalRecords agrees — it requires a strict improvement).
function bestBy(
  sets: RecordSet[],
  metrics: ReadonlySet<SetMetric>,
  metric: SetMetric,
): { set: RecordSet; value: number } | null {
  let best: { set: RecordSet; value: number } | null = null
  for (const s of [...sets].sort(chronological)) {
    const value = metricValue(metrics, metric, s)
    if (value === null) continue
    if (best === null || value > best.value) best = { set: s, value }
  }
  return best
}

/** The current best set in each applicable dimension — or null for an empty history. */
export function computePersonalBest(
  sets: RecordSet[],
  measurement: ExerciseMeasurement = DEFAULT_MEASUREMENT,
): PersonalBest | null {
  const metrics = metricsFor(measurement)
  const weight = bestBy(sets, metrics, 'weight')
  // `weight` applies to every exercise, so it is null only when there is no history at all.
  if (!weight) return null

  const e1rm = bestBy(sets, metrics, 'estimatedOneRepMax')
  const volume = bestBy(sets, metrics, 'setVolume')
  const reps = bestBy(sets, metrics, 'reps')
  const duration = bestBy(sets, metrics, 'duration')

  return {
    bestWeightKg: weight.value,
    bestWeightReps: weight.set.reps,
    bestWeightDurationSeconds: weight.set.durationSeconds,
    bestWeightAt: weight.set.performedAt,
    bestEstimatedOneRepMax: e1rm?.value ?? null,
    bestEstimatedOneRepMaxAt: e1rm?.set.performedAt ?? null,
    bestSetVolume: volume?.value ?? null,
    bestSetVolumeWeightKg: volume?.set.weightKg ?? null,
    bestSetVolumeReps: volume?.set.reps ?? null,
    bestSetVolumeAt: volume?.set.performedAt ?? null,
    bestReps: reps?.value ?? null,
    bestRepsAt: reps?.set.performedAt ?? null,
    bestDurationSeconds: duration?.value ?? null,
    bestDurationAt: duration?.set.performedAt ?? null,
  }
}
