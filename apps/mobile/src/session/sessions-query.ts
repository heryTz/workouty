// The user's session history, paginated (app/(app)/sessions.tsx): every session newest-first,
// with the name of the template it was started from, if any.
//
// Pagination is a growing window rather than offset pages: the screen holds a page COUNT and this
// hook asks for `limit` rows, so "Load more" re-runs one query for a bigger slice and the list
// stays a single reactive result set. Offset paging would fight the reactivity — a session
// starting or being deleted shifts every later row's offset, so page 2 could silently skip or
// repeat a row. It also asks for one row MORE than `limit` to learn whether a further page exists,
// which is cheaper than a second COUNT(*) query and can't disagree with the rows themselves.
//
// No user_id filter is needed (the local mirror only holds this user's rows — user_data bucket,
// see apps/powersync/sync_rules.yaml); `deleted_at IS NULL` still matters, since a local
// soft-delete lands in the mirror ahead of the sync round-trip (same habit as templates-queries.ts).
import { useQuery } from '@powersync/react'

export interface SessionHistoryRow {
  id: string
  started_at: string
  /** null while the session is still running. */
  ended_at: string | null
  template_id: string | null
  /** null for a freestyle session, or one whose template has since been deleted. */
  template_name: string | null
}

export const SESSION_HISTORY_PAGE_SIZE = 20

// The templates join is deliberately NOT filtered on `t.deleted_at IS NULL`: the name is history
// here, not a live link, so a session stays labelled with the template it was run from even after
// that template is deleted — for as long as the row survives locally, at least (PowerSync drops a
// soft-deleted row from the bucket, after which the LEFT JOIN yields null on its own).
export function sessionHistorySql(limit: number): { sql: string; params: unknown[] } {
  const sql = `
    SELECT
      s.id AS id,
      s.started_at AS started_at,
      s.ended_at AS ended_at,
      s.template_id AS template_id,
      t.name AS template_name
    FROM sessions s
    LEFT JOIN templates t ON t.id = s.template_id
    WHERE s.deleted_at IS NULL
    ORDER BY s.started_at DESC
    LIMIT ?
  `
  return { sql, params: [limit] }
}

export interface SessionHistoryPage {
  sessions: SessionHistoryRow[]
  hasMore: boolean
  isLoading: boolean
}

// Trims the probe row (the +1 fetched above `limit`) back off, and reports its presence as
// `hasMore`.
export function toPage(rows: SessionHistoryRow[], limit: number): { sessions: SessionHistoryRow[]; hasMore: boolean } {
  return { sessions: rows.slice(0, limit), hasMore: rows.length > limit }
}

export function useSessionHistory(limit: number = SESSION_HISTORY_PAGE_SIZE): SessionHistoryPage {
  const { sql, params } = sessionHistorySql(limit + 1)
  const { data, isLoading } = useQuery<SessionHistoryRow>(sql, params)
  return { ...toPage(data, limit), isLoading }
}
