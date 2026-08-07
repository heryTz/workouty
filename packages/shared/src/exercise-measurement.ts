/**
 * How an exercise is loaded and what a set of it counts — the two independent axes stored on
 * `exercises.load_type` / `exercises.measure` (apps/api/src/db/schema.ts). Together they decide
 * which metrics can honestly be computed from a set, which is what `metricsFor` below answers.
 */

/**
 * 'external'   — `weightKg` is the load itself (a 60 kg bench press).
 * 'bodyweight' — `weightKg` is the load ADDED to the body (a pull-up with a 20 kg belt), so 0 is
 *                the normal value and the body's own contribution is not recorded anywhere.
 */
export type LoadType = 'external' | 'bodyweight'

/** Whether a set counts repetitions or seconds held. Decides which of `reps` / `durationSeconds` is set. */
export type Measure = 'reps' | 'duration'

export type ExerciseMeasurement = {
  loadType: LoadType
  measure: Measure
}

/**
 * What every exercise was before load_type/measure existed (drizzle/0003), and what both columns
 * default to. Used as the fallback wherever an exercise's real measurement is not to hand.
 */
export const DEFAULT_MEASUREMENT: ExerciseMeasurement = { loadType: 'external', measure: 'reps' }

/** A dimension a set can set a personal record in. */
export type SetMetric = 'weight' | 'reps' | 'duration' | 'estimatedOneRepMax' | 'setVolume'

/**
 * The metrics that mean something for this kind of exercise. Everything downstream — PR flags,
 * personal bests, progression points — is driven by this so the applicability rules live in one
 * place rather than being restated at each call site.
 *
 * `weight` always qualifies: for an external exercise it is the load, for a bodyweight one it is
 * the added load, and in both cases moving it up is progress.
 *
 * The rest are mutually exclusive by design:
 *
 * - `estimatedOneRepMax` and `setVolume` require weight to be the WHOLE load and sets to count
 *   reps. Epley on a bodyweight exercise would read the 0 kg of an unweighted pull-up as a 0 kg
 *   one-rep max, and volume would read every such set as zero work.
 * - `reps` is a PR dimension only for bodyweight, where it is the sole progression signal
 *   available. Deliberately NOT applied to external exercises: reps there are meaningless without
 *   the weight they were done at, so a first-ever high-rep set with an empty bar would otherwise
 *   register as a personal record.
 * - `duration` replaces reps entirely when sets are held rather than counted.
 */
export function metricsFor(measurement: ExerciseMeasurement): ReadonlySet<SetMetric> {
  const metrics: SetMetric[] = ['weight']
  if (measurement.measure === 'duration') {
    metrics.push('duration')
  } else if (measurement.loadType === 'external') {
    metrics.push('estimatedOneRepMax', 'setVolume')
  } else {
    metrics.push('reps')
  }
  return new Set(metrics)
}
