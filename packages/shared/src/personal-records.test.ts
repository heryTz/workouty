import { describe, it, expect } from 'vitest'
import type { ExerciseMeasurement } from './exercise-measurement'
import { computePersonalBest, isPersonalRecord, markPersonalRecords, setVolume } from './personal-records'

const S = (id: string, performedAt: string, weightKg: number, reps: number) => ({
  id,
  performedAt,
  weightKg,
  reps,
  durationSeconds: null,
})

// A held set: no reps, `weightKg` is whatever was added on top of bodyweight.
const H = (id: string, performedAt: string, weightKg: number, durationSeconds: number) => ({
  id,
  performedAt,
  weightKg,
  reps: null,
  durationSeconds,
})

const BODYWEIGHT_REPS: ExerciseMeasurement = { loadType: 'bodyweight', measure: 'reps' }
const BODYWEIGHT_DURATION: ExerciseMeasurement = { loadType: 'bodyweight', measure: 'duration' }

describe('markPersonalRecords', () => {
  it('never flags the first set (nothing to beat)', () => {
    const [only] = markPersonalRecords([S('a', '2026-01-01T00:00:00.000Z', 60, 5)])
    expect(only).toBeDefined()
    expect(only!.isWeightPr).toBe(false)
    expect(only!.isEstimatedOneRepMaxPr).toBe(false)
    expect(only!.isSetVolumePr).toBe(false)
  })

  it('flags a set-volume PR (more total work) even when weight and e1RM did not increase', () => {
    // a: 60×5 ⇒ weight 60, e1RM 70, volume 300.
    // b: 50×8 ⇒ weight 50 (<60), e1RM ~63 (<70), volume 400 (>300) ⇒ ONLY a set-volume PR.
    const out = markPersonalRecords([
      S('a', '2026-01-01T00:00:00.000Z', 60, 5),
      S('b', '2026-01-08T00:00:00.000Z', 50, 8),
    ])
    const b = out.find((s) => s.id === 'b')!
    expect(b.isWeightPr).toBe(false)
    expect(b.isEstimatedOneRepMaxPr).toBe(false)
    expect(b.isSetVolumePr).toBe(true)
  })

  it('does not flag equalling the previous best set volume', () => {
    // Same volume (300) via a different rep/weight split is not a volume PR.
    const out = markPersonalRecords([
      S('a', '2026-01-01T00:00:00.000Z', 60, 5), // vol 300
      S('b', '2026-01-08T00:00:00.000Z', 30, 10), // vol 300 (equal, not >)
    ])
    expect(out.find((s) => s.id === 'b')!.isSetVolumePr).toBe(false)
  })

  it('flags a strictly heavier set as a weight PR', () => {
    const out = markPersonalRecords([
      S('a', '2026-01-01T00:00:00.000Z', 60, 5),
      S('b', '2026-01-08T00:00:00.000Z', 65, 5),
    ])
    expect(out.find((s) => s.id === 'b')!.isWeightPr).toBe(true)
  })

  it('does not flag equalling the previous best', () => {
    const out = markPersonalRecords([
      S('a', '2026-01-01T00:00:00.000Z', 60, 5),
      S('b', '2026-01-08T00:00:00.000Z', 60, 5),
    ])
    expect(out.find((s) => s.id === 'b')!.isWeightPr).toBe(false)
  })

  it('flags an estimated-1RM PR even when weight did not increase', () => {
    // a: 60×5 ⇒ e1RM 70. b: same 60 kg but 8 reps ⇒ e1RM 76 (> 70) ⇒ e1RM PR, not a weight PR.
    const out = markPersonalRecords([
      S('a', '2026-01-01T00:00:00.000Z', 60, 5),
      S('b', '2026-01-08T00:00:00.000Z', 60, 8),
    ])
    const b = out.find((s) => s.id === 'b')!
    expect(b.isWeightPr).toBe(false)
    expect(b.isEstimatedOneRepMaxPr).toBe(true)
  })

  it('processes chronologically regardless of input order', () => {
    const out = markPersonalRecords([
      S('b', '2026-01-08T00:00:00.000Z', 65, 5),
      S('a', '2026-01-01T00:00:00.000Z', 60, 5),
    ])
    expect(out.find((s) => s.id === 'a')!.isWeightPr).toBe(false) // earliest
    expect(out.find((s) => s.id === 'b')!.isWeightPr).toBe(true)
  })

  it('does not flag a reps PR on an external exercise, where reps alone say nothing', () => {
    // 20 reps with an empty bar is not a bench press record. Without this, every first high-rep
    // set on a light weight would badge "New PR!".
    const out = markPersonalRecords([
      S('a', '2026-01-01T00:00:00.000Z', 60, 5),
      S('b', '2026-01-08T00:00:00.000Z', 20, 20),
    ])
    expect(out.find((s) => s.id === 'b')!.isRepsPr).toBe(false)
  })

  it('flags a reps PR on a bodyweight exercise, where reps are the progression signal', () => {
    const out = markPersonalRecords(
      [S('a', '2026-01-01T00:00:00.000Z', 0, 8), S('b', '2026-01-08T00:00:00.000Z', 0, 12)],
      BODYWEIGHT_REPS,
    )
    const b = out.find((s) => s.id === 'b')!
    expect(b.isRepsPr).toBe(true)
    expect(b.isWeightPr).toBe(false) // both sets are unweighted
    expect(isPersonalRecord(b)).toBe(true)
  })

  it('never claims a 1RM or volume PR on a bodyweight exercise, where added weight is 0', () => {
    // Epley would read every unweighted set as a 0 kg one-rep max and volume as zero work, so
    // both metrics stay switched off rather than reporting a meaningless tie at zero.
    const out = markPersonalRecords(
      [S('a', '2026-01-01T00:00:00.000Z', 0, 8), S('b', '2026-01-08T00:00:00.000Z', 0, 12)],
      BODYWEIGHT_REPS,
    )
    for (const s of out) {
      expect(s.isEstimatedOneRepMaxPr).toBe(false)
      expect(s.isSetVolumePr).toBe(false)
    }
  })

  it('ranks added weight and reps independently on a bodyweight exercise', () => {
    // 3 pull-ups at +40 kg does not beat 12 unweighted ones on reps, and vice versa — both are
    // records in their own dimension. There is no scalar combining them without bodyweight.
    const out = markPersonalRecords(
      [
        S('a', '2026-01-01T00:00:00.000Z', 0, 12),
        S('b', '2026-01-08T00:00:00.000Z', 40, 3),
        S('c', '2026-01-15T00:00:00.000Z', 0, 14),
      ],
      BODYWEIGHT_REPS,
    )
    const b = out.find((s) => s.id === 'b')!
    expect(b.isWeightPr).toBe(true)
    expect(b.isRepsPr).toBe(false)
    const c = out.find((s) => s.id === 'c')!
    expect(c.isWeightPr).toBe(false)
    expect(c.isRepsPr).toBe(true)
  })

  it('flags a longer hold as a duration PR, and added weight separately', () => {
    const out = markPersonalRecords(
      [
        H('a', '2026-01-01T00:00:00.000Z', 0, 60),
        H('b', '2026-01-08T00:00:00.000Z', 0, 90),
        H('c', '2026-01-15T00:00:00.000Z', 10, 60),
      ],
      BODYWEIGHT_DURATION,
    )
    const b = out.find((s) => s.id === 'b')!
    expect(b.isDurationPr).toBe(true)
    expect(b.isWeightPr).toBe(false)
    // A shorter but weighted plank: a weight PR, not a duration one.
    const c = out.find((s) => s.id === 'c')!
    expect(c.isDurationPr).toBe(false)
    expect(c.isWeightPr).toBe(true)
    expect(isPersonalRecord(c)).toBe(true)
  })

  it('does not flag equalling a previous hold', () => {
    const out = markPersonalRecords(
      [H('a', '2026-01-01T00:00:00.000Z', 0, 60), H('b', '2026-01-08T00:00:00.000Z', 0, 60)],
      BODYWEIGHT_DURATION,
    )
    expect(out.find((s) => s.id === 'b')!.isDurationPr).toBe(false)
  })
})

describe('isPersonalRecord', () => {
  it('is false only when every dimension is false', () => {
    const none = {
      isWeightPr: false,
      isEstimatedOneRepMaxPr: false,
      isSetVolumePr: false,
      isRepsPr: false,
      isDurationPr: false,
    }
    expect(isPersonalRecord(none)).toBe(false)
    expect(isPersonalRecord({ ...none, isDurationPr: true })).toBe(true)
    expect(isPersonalRecord({ ...none, isRepsPr: true })).toBe(true)
  })
})

describe('computePersonalBest', () => {
  it('returns null for empty history', () => {
    expect(computePersonalBest([])).toBeNull()
  })

  it('reports the best weight and best estimated 1RM with their timestamps', () => {
    const best = computePersonalBest([
      S('a', '2026-01-01T00:00:00.000Z', 60, 8), // e1RM 76
      S('b', '2026-01-08T00:00:00.000Z', 80, 1), // weight 80, e1RM 80
    ])!
    expect(best.bestWeightKg).toBe(80)
    expect(best.bestWeightAt).toBe('2026-01-08T00:00:00.000Z')
    expect(best.bestEstimatedOneRepMax).toBeCloseTo(80, 10)
    expect(best.bestEstimatedOneRepMaxAt).toBe('2026-01-08T00:00:00.000Z')
  })

  it('reports the best single-set volume (weight × reps) and the set that achieved it', () => {
    const best = computePersonalBest([
      S('a', '2026-01-01T00:00:00.000Z', 80, 1), // vol 80 (heaviest weight, lowest volume)
      S('b', '2026-01-08T00:00:00.000Z', 60, 8), // vol 480 (best volume)
      S('c', '2026-01-15T00:00:00.000Z', 70, 5), // vol 350
    ])!
    expect(best.bestSetVolume).toBe(480)
    expect(best.bestSetVolumeWeightKg).toBe(60)
    expect(best.bestSetVolumeReps).toBe(8)
    expect(best.bestSetVolumeAt).toBe('2026-01-08T00:00:00.000Z')
    // Best volume comes from a DIFFERENT set than best weight (80 kg single).
    expect(best.bestWeightKg).toBe(80)
  })

  it('reports best reps and nulls the load metrics for a bodyweight exercise', () => {
    const best = computePersonalBest(
      [S('a', '2026-01-01T00:00:00.000Z', 0, 8), S('b', '2026-01-08T00:00:00.000Z', 20, 3)],
      BODYWEIGHT_REPS,
    )!
    expect(best.bestReps).toBe(8)
    expect(best.bestRepsAt).toBe('2026-01-01T00:00:00.000Z')
    expect(best.bestWeightKg).toBe(20) // best ADDED weight
    expect(best.bestWeightReps).toBe(3)
    // Null, not 0 — "your best estimated 1RM is 0 kg" is a lie a pull-up should not tell.
    expect(best.bestEstimatedOneRepMax).toBeNull()
    expect(best.bestSetVolume).toBeNull()
    expect(best.bestDurationSeconds).toBeNull()
  })

  it('reports the longest hold and the heaviest weighted hold for a duration exercise', () => {
    const best = computePersonalBest(
      [
        H('a', '2026-01-01T00:00:00.000Z', 0, 90),
        H('b', '2026-01-08T00:00:00.000Z', 10, 60),
      ],
      BODYWEIGHT_DURATION,
    )!
    expect(best.bestDurationSeconds).toBe(90)
    expect(best.bestDurationAt).toBe('2026-01-01T00:00:00.000Z')
    expect(best.bestWeightKg).toBe(10)
    expect(best.bestWeightDurationSeconds).toBe(60)
    expect(best.bestWeightReps).toBeNull()
    expect(best.bestReps).toBeNull()
    expect(best.bestEstimatedOneRepMax).toBeNull()
  })

  it('returns null for empty history on a bodyweight exercise too', () => {
    expect(computePersonalBest([], BODYWEIGHT_DURATION)).toBeNull()
  })
})

describe('setVolume', () => {
  it('is weight × reps', () => {
    expect(setVolume(60, 8)).toBe(480)
    expect(setVolume(100, 1)).toBe(100)
  })
})
