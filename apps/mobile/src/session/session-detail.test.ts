import { describe, expect, it } from 'vitest'
import { formatVolumeKg, sessionTotals, type TotalsSetRow } from './session-detail'

function set(partial: Partial<TotalsSetRow> = {}): TotalsSetRow {
  return { reps: 8, duration_seconds: null, weight_kg: 60, ...partial }
}

describe('sessionTotals', () => {
  it('counts the exercises and the sets logged across them', () => {
    const totals = sessionTotals(2, [set(), set(), set()])
    expect(totals.exerciseCount).toBe(2)
    expect(totals.setCount).toBe(3)
  })

  it('sums volume as weight × reps across sets', () => {
    expect(sessionTotals(1, [set({ reps: 8, weight_kg: 60 }), set({ reps: 5, weight_kg: 80 })]).totalVolumeKg).toBe(880)
  })

  it('counts an unweighted bodyweight set as no volume, while still counting the set', () => {
    const totals = sessionTotals(1, [set({ reps: 12, weight_kg: 0 })])
    expect(totals.setCount).toBe(1)
    expect(totals.totalVolumeKg).toBe(0)
  })

  it('leaves a held set out of the volume — a 60s plank has no weight × reps to add', () => {
    const totals = sessionTotals(1, [set({ reps: null, duration_seconds: 60, weight_kg: 10 })])
    expect(totals.setCount).toBe(1)
    expect(totals.totalVolumeKg).toBe(0)
  })

  it('reports zeroes for a session with no sets', () => {
    expect(sessionTotals(0, [])).toEqual({ exerciseCount: 0, setCount: 0, totalVolumeKg: 0 })
  })
})

describe('formatVolumeKg', () => {
  it('rounds to whole kilos', () => {
    expect(formatVolumeKg(1237.5)).toBe('1238 kg')
  })

  it('keeps a plain whole number plain', () => {
    expect(formatVolumeKg(880)).toBe('880 kg')
  })
})
