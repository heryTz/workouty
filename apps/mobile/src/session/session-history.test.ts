import { beforeAll, describe, expect, it } from 'vitest'
import {
  formatSessionDate,
  formatSessionDuration,
  formatSessionTime,
  sessionDurationSeconds,
} from './session-history'

// The date/time helpers render in the device's local zone, so pin it — otherwise these assertions
// pass or fail depending on where they run.
beforeAll(() => {
  process.env.TZ = 'UTC'
})

describe('sessionDurationSeconds', () => {
  it('is the span between started_at and ended_at', () => {
    expect(sessionDurationSeconds('2026-08-14T18:00:00.000Z', '2026-08-14T19:05:30.000Z')).toBe(3930)
  })

  it('is null while the session is still running', () => {
    expect(sessionDurationSeconds('2026-08-14T18:00:00.000Z', null)).toBeNull()
  })

  it('clamps a backwards span (clock skew) at zero rather than going negative', () => {
    expect(sessionDurationSeconds('2026-08-14T19:00:00.000Z', '2026-08-14T18:00:00.000Z')).toBe(0)
  })
})

describe('formatSessionDuration', () => {
  it('shows minutes under an hour', () => {
    expect(formatSessionDuration(45 * 60)).toBe('45m')
  })

  it('shows hours and zero-padded minutes past an hour', () => {
    expect(formatSessionDuration(3930)).toBe('1h 05m')
    expect(formatSessionDuration(2 * 3600 + 45 * 60)).toBe('2h 45m')
  })

  it('collapses anything under a minute rather than showing 0m', () => {
    expect(formatSessionDuration(0)).toBe('<1m')
    expect(formatSessionDuration(59)).toBe('<1m')
  })
})

describe('formatSessionDate / formatSessionTime', () => {
  it('formats the start as a weekday date and a clock time', () => {
    expect(formatSessionDate('2026-08-14T18:42:00.000Z', 'en-GB')).toBe('Fri, 14 Aug 2026')
    expect(formatSessionTime('2026-08-14T18:42:00.000Z', 'en-GB')).toBe('18:42')
  })
})
