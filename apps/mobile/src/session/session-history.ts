// Pure presentation helpers for the session history list (app/(app)/sessions.tsx): how a stored
// session reads back as a date, a start time, and a duration.
//
// Kept separate from the query hook so they're unit-testable without PowerSync, and separate from
// timers.ts — that module is the live rest/elapsed clock (always driven by an explicit `now`),
// whereas these format a FINISHED span after the fact.

// A session's length in seconds, or null while it's still running (ended_at IS NULL). Clamped at
// 0: a clock skew between devices could in principle land ended_at before started_at, and a
// negative workout is worse than a zero-length one.
export function sessionDurationSeconds(startedAt: string, endedAt: string | null): number | null {
  if (!endedAt) return null
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime()
  if (!Number.isFinite(ms)) return null
  return Math.max(0, Math.floor(ms / 1000))
}

// Duration as it reads in a history row: "1h 05m", "45m", "<1m". Not timers.ts's mm:ss — that
// format is for a clock you're watching tick, and "72:14" is a poor way to say "an hour and a bit"
// when scanning a list.
export function formatSessionDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  if (total < 60) return '<1m'

  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  return `${minutes}m`
}

// Both of these render in the device's local timezone (a workout is remembered by the wall-clock
// time it happened at, not UTC). `locale` is left undefined in the app so the device decides; the
// tests pin it.
export function formatSessionDate(startedAt: string, locale?: string): string {
  return new Date(startedAt).toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatSessionTime(startedAt: string, locale?: string): string {
  return new Date(startedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}
