// A ticking `Date.now()` for DISPLAY only (Milestone 4 Task D2). Per timers.ts's header comment,
// the rest countdown and session-elapsed clock must be *computed* from stored timestamps
// (`endsAt`, `startedAt`) rather than an incrementing counter, so backgrounding/sleeping the
// screen never desyncs them. This hook supplies the other half of that: something that forces a
// re-render every `intervalMs` so the timestamp-derived values (restRemainingSeconds,
// sessionElapsedSeconds, ...) get recomputed against a fresh `now` and the screen visibly ticks.
// The returned number is never fed back into itself and never accumulates — each tick just reads
// `Date.now()` again, so a long background gap self-corrects on the next tick instead of drifting.
import { useEffect, useState } from 'react'

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return now
}
