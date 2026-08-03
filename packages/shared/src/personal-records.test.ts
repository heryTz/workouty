import { describe, it, expect } from 'vitest'
import { markPersonalRecords, computePersonalBest, setVolume } from './personal-records'

const S = (id: string, performedAt: string, weightKg: number, reps: number) => ({ id, performedAt, weightKg, reps })

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
})

describe('setVolume', () => {
  it('is weight × reps', () => {
    expect(setVolume(60, 8)).toBe(480)
    expect(setVolume(100, 1)).toBe(100)
  })
})
