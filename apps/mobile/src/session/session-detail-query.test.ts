import { describe, expect, it } from 'vitest'
import {
  groupSetsByExercise,
  sessionDetailExercisesSql,
  sessionDetailSetsSql,
  sessionDetailSql,
  type DetailSetRow,
} from './session-detail-query'

describe('sessionDetailSql', () => {
  const { sql, params } = sessionDetailSql('session-1')

  it('binds the session id as a parameter', () => {
    expect(sql).toMatch(/WHERE s\.id = \?/)
    expect(params).toEqual(['session-1'])
  })

  it('reads back when the session ended, so a finished one can show its duration', () => {
    expect(sql).toMatch(/s\.ended_at AS ended_at/)
  })

  it('keeps the template name optional, so a freestyle session still loads', () => {
    expect(sql).toMatch(/LEFT JOIN templates/)
  })
})

describe('sessionDetailExercisesSql', () => {
  const { sql, params } = sessionDetailExercisesSql('session-1')

  it('scopes to the session', () => {
    expect(sql).toMatch(/se\.session_id = \?/)
    expect(params).toEqual(['session-1'])
  })

  it('excludes exercises removed from the session', () => {
    expect(sql).toMatch(/se\.deleted_at IS NULL/)
  })

  it('lists them in the order they were performed', () => {
    expect(sql).toMatch(/ORDER BY\s+se\.position ASC/i)
  })

  it('carries load_type and measure, which decide how a set reads back', () => {
    expect(sql).toMatch(/e\.load_type AS load_type/)
    expect(sql).toMatch(/e\.measure AS measure/)
  })
})

describe('sessionDetailSetsSql', () => {
  const { sql, params } = sessionDetailSetsSql('session-1')

  it('scopes to the session through its exercises', () => {
    expect(sql).toMatch(/JOIN session_exercises se ON se\.id = s\.session_exercise_id/)
    expect(sql).toMatch(/se\.session_id = \?/)
    expect(params).toEqual(['session-1'])
  })

  it('excludes soft-deleted sets', () => {
    expect(sql).toMatch(/s\.deleted_at IS NULL/)
  })

  it('lists sets in the order they were logged', () => {
    expect(sql).toMatch(/ORDER BY\s+s\.set_index ASC/i)
  })

  it('reads back the rest that followed each set', () => {
    expect(sql).toMatch(/s\.actual_rest_seconds AS actual_rest_seconds/)
  })
})

describe('groupSetsByExercise', () => {
  function row(id: string, sessionExerciseId: string, setIndex: number): DetailSetRow {
    return {
      id,
      session_exercise_id: sessionExerciseId,
      set_index: setIndex,
      reps: 8,
      duration_seconds: null,
      weight_kg: 60,
      actual_rest_seconds: 90,
    }
  }

  it('files each set under the exercise it belongs to', () => {
    const grouped = groupSetsByExercise([row('a', 'se-1', 0), row('b', 'se-2', 0), row('c', 'se-1', 1)])
    expect(grouped.get('se-1')?.map((s) => s.id)).toEqual(['a', 'c'])
    expect(grouped.get('se-2')?.map((s) => s.id)).toEqual(['b'])
  })

  it('has nothing for an exercise that was never logged into', () => {
    expect(groupSetsByExercise([]).get('se-1')).toBeUndefined()
  })
})
