// The user's currently-running session, if any: the most recent session that was started but not
// yet finished (ended_at IS NULL). Used to (a) show a persistent "session in progress" banner on
// every screen and (b) make the home screen resume it instead of starting a new one — so there's
// effectively one active session at a time. Reactive: appears when a session starts, disappears
// when it's finished (endSession sets ended_at) or removed. No user_id filter needed — the local
// mirror only holds this user's sessions (user_data bucket, see sync_rules.yaml).
import { useQuery } from '@powersync/react'

export interface ActiveSession {
  id: string
  started_at: string
}

// There is at most one active session per user, enforced at creation: startSession /
// startSessionFromTemplate resume an existing un-ended session instead of creating a second (see
// session-writes.ts), and the UI hides/blocks "start" while one is open. So this is simply the
// user's un-ended session, if any.
const ACTIVE_SESSION_QUERY = `
  SELECT id AS id, started_at AS started_at
  FROM sessions
  WHERE ended_at IS NULL AND deleted_at IS NULL
  ORDER BY started_at DESC
  LIMIT 1
`

export function useActiveSession(): ActiveSession | null {
  const { data } = useQuery<ActiveSession>(ACTIVE_SESSION_QUERY)
  return data[0] ?? null
}
