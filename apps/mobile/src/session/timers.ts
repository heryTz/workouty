/**
 * Pure, timestamp-derived timer math for the rest countdown and session elapsed clock.
 *
 * Spec §3.3 / §3.4: the rest countdown and the session elapsed clock MUST be computed
 * from stored timestamps (`endsAt`, `startedAt`), NOT an incrementing counter — so
 * backgrounding the app / sleeping the screen never desynchronises them. The UI
 * re-renders on an interval for display only; the VALUE always comes from
 * `now - startedAt` / `endsAt - now`.
 *
 * All times are epoch-ms numbers. `now` is always an explicit parameter (never
 * `Date.now()` internally) so these functions are deterministic and unit-testable,
 * and so the "survives a background gap" guarantee is structural: since there is no
 * internal counter to drift, the value at any `now` is exactly the wall-clock delta.
 */

/** Seconds remaining on a rest timer that ends at `endsAtMs`. Clamped at 0 (never negative). Floored. */
export function restRemainingSeconds(endsAtMs: number, nowMs: number): number {
  const remainingMs = endsAtMs - nowMs
  if (remainingMs <= 0) return 0
  return Math.floor(remainingMs / 1000)
}

/** Whether the rest timer has elapsed (true at and after `endsAtMs`). */
export function isRestOver(endsAtMs: number, nowMs: number): boolean {
  return nowMs >= endsAtMs
}

/** Seconds elapsed since a session started at `startedAtMs`. Clamped at 0. Floored. */
export function sessionElapsedSeconds(startedAtMs: number, nowMs: number): number {
  const elapsedMs = nowMs - startedAtMs
  if (elapsedMs <= 0) return 0
  return Math.floor(elapsedMs / 1000)
}

/** Compute the rest end time from a start + a duration, so it can be persisted. */
export function restEndsAt(startedAtMs: number, durationSeconds: number): number {
  return startedAtMs + durationSeconds * 1000
}

/** Format a duration in seconds as mm:ss (hours roll into minutes). Floors fractional seconds. */
export function formatMmSs(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const mm = Math.floor(total / 60)
  const ss = total % 60
  return `${mm}:${String(ss).padStart(2, '0')}`
}

/** Format a duration in seconds as m:ss, rolling into h:mm:ss once it reaches an hour. */
export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hh = Math.floor(total / 3600)
  const mm = Math.floor((total % 3600) / 60)
  const ss = total % 60

  if (hh > 0) {
    return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  }
  return `${mm}:${String(ss).padStart(2, '0')}`
}
