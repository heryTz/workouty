import { describe, expect, it } from 'vitest'
import { sessionHistorySql, toPage, type SessionHistoryRow } from './sessions-query'

function row(id: string): SessionHistoryRow {
  return { id, started_at: '2026-08-14T18:00:00.000Z', ended_at: null, template_id: null, template_name: null }
}

describe('sessionHistorySql', () => {
  const { sql, params } = sessionHistorySql(21)

  it('excludes soft-deleted sessions', () => {
    expect(sql).toMatch(/s\.deleted_at IS NULL/)
  })

  it('orders newest-first', () => {
    expect(sql).toMatch(/ORDER BY\s+s\.started_at DESC/i)
  })

  it('binds the limit as a parameter', () => {
    expect(sql).toMatch(/LIMIT \?/)
    expect(params).toEqual([21])
  })

  it('keeps the template name optional, so freestyle sessions still list', () => {
    expect(sql).toMatch(/LEFT JOIN templates/)
  })
})

describe('toPage', () => {
  it('reports more when the probe row came back, and drops it from the page', () => {
    const page = toPage([row('a'), row('b'), row('c')], 2)
    expect(page.sessions.map((s) => s.id)).toEqual(['a', 'b'])
    expect(page.hasMore).toBe(true)
  })

  it('reports no more once the result set fits inside the limit', () => {
    const page = toPage([row('a'), row('b')], 2)
    expect(page.sessions.map((s) => s.id)).toEqual(['a', 'b'])
    expect(page.hasMore).toBe(false)
  })

  it('handles an empty history', () => {
    expect(toPage([], 20)).toEqual({ sessions: [], hasMore: false })
  })
})
