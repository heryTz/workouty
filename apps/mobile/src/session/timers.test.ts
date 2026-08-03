import { describe, expect, it } from 'vitest'
import {
  formatElapsed,
  formatMmSs,
  isRestOver,
  restEndsAt,
  restRemainingSeconds,
  sessionElapsedSeconds,
} from './timers'

describe('restRemainingSeconds', () => {
  const started = 1_000_000
  const endsAt = started + 90 * 1000 // 90s rest

  it('is ~90 at the start (now == started)', () => {
    expect(restRemainingSeconds(endsAt, started)).toBe(90)
  })

  it('is ~60 at started+30s', () => {
    expect(restRemainingSeconds(endsAt, started + 30 * 1000)).toBe(60)
  })

  it('is 0 exactly at endsAt (started+90s)', () => {
    expect(restRemainingSeconds(endsAt, started + 90 * 1000)).toBe(0)
  })

  it('is clamped at 0 (not negative) once past endsAt (started+120s)', () => {
    expect(restRemainingSeconds(endsAt, started + 120 * 1000)).toBe(0)
  })

  it('floors partial seconds', () => {
    expect(restRemainingSeconds(endsAt, started + 30_400)).toBe(59)
  })

  it('BACKGROUND-GAP PROOF: value at t+80s is exactly 10s, computed purely from endsAt - now — no drift regardless of any gap', () => {
    // The app is backgrounded from t+10s to t+80s. The rest countdown is never
    // "ticked" during the gap: restRemainingSeconds is stateless, so resuming at
    // t+80s and computing endsAt - now yields the exact wall-clock remainder (10s),
    // identical to what an uninterrupted foregrounded timer would show. There is no
    // counter to have drifted.
    const beforeGap = restRemainingSeconds(endsAt, started + 10 * 1000)
    expect(beforeGap).toBe(80)

    const afterGap = restRemainingSeconds(endsAt, started + 80 * 1000)
    expect(afterGap).toBe(10)
    expect(afterGap).toBe(90 - 80) // exactly the wall-clock delta, not 90 - 10 (no drift, no missed ticks)
  })
})

describe('isRestOver', () => {
  const started = 0
  const endsAt = 90 * 1000

  it('is false before endsAt', () => {
    expect(isRestOver(endsAt, started)).toBe(false)
    expect(isRestOver(endsAt, endsAt - 1)).toBe(false)
  })

  it('is true at endsAt', () => {
    expect(isRestOver(endsAt, endsAt)).toBe(true)
  })

  it('is true after endsAt', () => {
    expect(isRestOver(endsAt, endsAt + 1000)).toBe(true)
  })
})

describe('sessionElapsedSeconds', () => {
  const started = 2_000_000

  it('is 0 at start', () => {
    expect(sessionElapsedSeconds(started, started)).toBe(0)
  })

  it('is 3600 after an hour', () => {
    expect(sessionElapsedSeconds(started, started + 3600 * 1000)).toBe(3600)
  })

  it('is clamped at 0 for a now before startedAt (clock skew defense)', () => {
    expect(sessionElapsedSeconds(started, started - 5000)).toBe(0)
  })

  it('floors partial seconds', () => {
    expect(sessionElapsedSeconds(started, started + 1_999)).toBe(1)
  })

  it('BACKGROUND-GAP PROOF: elapsed at started+5000s is exactly 5000s regardless of any backgrounding gap in between', () => {
    // sessionElapsedSeconds has no internal ticking state to desync: whether the app
    // was foregrounded continuously or backgrounded for a long stretch in the middle,
    // computing now - startedAt at the same wall-clock instant gives the same answer.
    const beforeGap = sessionElapsedSeconds(started, started + 12 * 1000)
    expect(beforeGap).toBe(12)

    const afterLongGap = sessionElapsedSeconds(started, started + 5000 * 1000)
    expect(afterLongGap).toBe(5000)
    expect(afterLongGap).toBe(5000) // exact wall-clock delta, independent of the gap length
  })
})

describe('restEndsAt', () => {
  it('is started + duration*1000', () => {
    expect(restEndsAt(1_000_000, 90)).toBe(1_000_000 + 90 * 1000)
    expect(restEndsAt(0, 0)).toBe(0)
    expect(restEndsAt(500, 5)).toBe(5500)
  })
})

describe('formatMmSs', () => {
  it.each([
    [90, '1:30'],
    [5, '0:05'],
    [0, '0:00'],
    [605, '10:05'],
    [59, '0:59'],
    [60, '1:00'],
  ])('formats %i seconds as %s', (seconds, expected) => {
    expect(formatMmSs(seconds)).toBe(expected)
  })

  it('rolls hours into minutes (does not use h:mm:ss)', () => {
    expect(formatMmSs(3661)).toBe('61:01')
  })

  it('floors fractional seconds', () => {
    expect(formatMmSs(90.9)).toBe('1:30')
  })

  it('clamps negative input at 0:00', () => {
    expect(formatMmSs(-5)).toBe('0:00')
  })
})

describe('formatElapsed', () => {
  it.each([
    [0, '0:00'],
    [59, '0:59'],
    [60, '1:00'],
    [3599, '59:59'],
  ])('formats %i seconds as %s (mm:ss below 1h)', (seconds, expected) => {
    expect(formatElapsed(seconds)).toBe(expected)
  })

  it.each([
    [3600, '1:00:00'],
    [3661, '1:01:01'],
    [7325, '2:02:05'],
  ])('formats %i seconds as %s (h:mm:ss at/above 1h)', (seconds, expected) => {
    expect(formatElapsed(seconds)).toBe(expected)
  })

  it('floors fractional seconds', () => {
    expect(formatElapsed(59.9)).toBe('0:59')
  })

  it('clamps negative input at 0:00', () => {
    expect(formatElapsed(-5)).toBe('0:00')
  })
})
