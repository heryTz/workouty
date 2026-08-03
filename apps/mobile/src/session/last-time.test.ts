import { describe, expect, it } from 'vitest'
import { lastSessionSetsSql, lastTimeTopSetSql } from './last-time'

describe('lastTimeTopSetSql', () => {
  it('filters by the given exercise (both the outer query and the prior-session subquery)', () => {
    const { sql, params } = lastTimeTopSetSql('exercise-1', 'session-2')

    expect(sql).toMatch(/se\.exercise_id\s*=\s*\?/)
    expect(sql).toMatch(/se2\.exercise_id\s*=\s*\?/)
    // exerciseId is bound twice: once for the outer query, once for the subquery.
    expect(params.filter((p) => p === 'exercise-1')).toHaveLength(2)
  })

  it('excludes the current session from the prior-session lookup', () => {
    const { sql, params } = lastTimeTopSetSql('exercise-1', 'session-2')

    expect(sql).toMatch(/se2\.session_id\s*!=\s*\?/)
    expect(params).toContain('session-2')
  })

  it('orders the prior-session lookup by session recency, most recent first', () => {
    const { sql } = lastTimeTopSetSql('exercise-1', 'session-2')

    expect(sql).toMatch(/ORDER BY\s+sess2\.started_at DESC/i)
    expect(sql).toMatch(/JOIN sessions sess2 ON sess2\.id = se2\.session_id/)
  })

  it('picks the top set (highest weight, ties broken by reps) within the found session', () => {
    const { sql } = lastTimeTopSetSql('exercise-1', 'session-2')

    expect(sql).toMatch(/ORDER BY\s+s\.weight_kg DESC,\s*s\.reps DESC/i)
    expect(sql).toMatch(/LIMIT 1/)
  })

  it('excludes soft-deleted rows at every join (sets and session_exercises, in and out of the subquery)', () => {
    const { sql } = lastTimeTopSetSql('exercise-1', 'session-2')

    expect(sql).toMatch(/se\.deleted_at IS NULL/)
    expect(sql).toMatch(/s\.deleted_at IS NULL/)
    expect(sql).toMatch(/se2\.deleted_at IS NULL/)
    expect(sql).toMatch(/s2\.deleted_at IS NULL/)
  })

  it('binds the exercise id and session id as parameters, in query order, not interpolated into the SQL', () => {
    const { sql, params } = lastTimeTopSetSql("exercise-1'; DROP TABLE sets; --", "session-2'; DROP TABLE sessions; --")

    expect(sql).not.toMatch(/DROP TABLE/)
    expect(params).toEqual([
      "exercise-1'; DROP TABLE sets; --",
      "exercise-1'; DROP TABLE sets; --",
      "session-2'; DROP TABLE sessions; --",
    ])
  })
})

describe('lastSessionSetsSql', () => {
  it('returns every set of the most-recent prior session, ordered by set index (not just the top set)', () => {
    const { sql } = lastSessionSetsSql('exercise-1', 'session-2')

    // Selects the per-set fields the card renders (reps × weight + rest), not a single top row.
    expect(sql).toMatch(/s\.set_index AS set_index/)
    expect(sql).toMatch(/s\.weight_kg AS weight_kg/)
    expect(sql).toMatch(/s\.reps AS reps/)
    expect(sql).toMatch(/s\.actual_rest_seconds AS actual_rest_seconds/)
    expect(sql).toMatch(/ORDER BY\s+s\.set_index ASC/i)
    // The single-row LIMIT belongs only to the prior-session subquery, not the outer set list.
    expect(sql.match(/LIMIT 1/g)).toHaveLength(1)
  })

  it('scopes to the most recent PRIOR session for this exercise, excluding the current one', () => {
    const { sql, params } = lastSessionSetsSql('exercise-1', 'session-2')

    expect(sql).toMatch(/ORDER BY\s+sess2\.started_at DESC/i)
    expect(sql).toMatch(/se2\.session_id\s*!=\s*\?/)
    expect(params).toEqual(['exercise-1', 'exercise-1', 'session-2'])
  })

  it('excludes soft-deleted rows at every join', () => {
    const { sql } = lastSessionSetsSql('exercise-1', 'session-2')

    expect(sql).toMatch(/se\.deleted_at IS NULL/)
    expect(sql).toMatch(/s\.deleted_at IS NULL/)
    expect(sql).toMatch(/se2\.deleted_at IS NULL/)
    expect(sql).toMatch(/s2\.deleted_at IS NULL/)
  })
})
