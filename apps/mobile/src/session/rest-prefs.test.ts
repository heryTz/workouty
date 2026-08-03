import { describe, expect, it, vi } from 'vitest'
import { clearExerciseRestPref, setExerciseRestPref } from './rest-prefs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function mockDb(getAllResult: unknown[] = []) {
  return {
    execute: vi.fn().mockResolvedValue(undefined),
    getAll: vi.fn().mockResolvedValue(getAllResult),
  }
}

describe('setExerciseRestPref', () => {
  it('inserts a new pref (with a client uuid) when none exists', async () => {
    const db = mockDb([]) // no existing pref
    await setExerciseRestPref(db, { userId: 'user-1', exerciseId: 'ex-1', restSeconds: 180 })

    expect(db.execute).toHaveBeenCalledTimes(1)
    const [sql, params] = db.execute.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO exercise_rest_prefs/)
    // params: [id, userId, exerciseId, restSeconds, created_at, updated_at]
    expect(params[0]).toMatch(UUID_RE)
    expect(params[1]).toBe('user-1')
    expect(params[2]).toBe('ex-1')
    expect(params[3]).toBe(180)
  })

  it('updates the existing live pref in place when one is found', async () => {
    const db = mockDb([{ id: 'pref-9' }])
    await setExerciseRestPref(db, { userId: 'user-1', exerciseId: 'ex-1', restSeconds: 200 })

    expect(db.execute).toHaveBeenCalledTimes(1)
    const [sql, params] = db.execute.mock.calls[0]
    expect(sql).toMatch(/UPDATE exercise_rest_prefs SET rest_seconds/)
    expect(params[0]).toBe(200) // rest_seconds
    expect(params[2]).toBe('pref-9') // WHERE id
  })

  it('scopes the existing-pref lookup to the exercise and live rows', async () => {
    const db = mockDb([])
    await setExerciseRestPref(db, { userId: 'user-1', exerciseId: 'ex-7', restSeconds: 90 })
    const [sql, params] = db.getAll.mock.calls[0]
    expect(sql).toMatch(/WHERE exercise_id = \? AND deleted_at IS NULL/)
    expect(params).toEqual(['ex-7'])
  })
})

describe('clearExerciseRestPref', () => {
  it('SQL-DELETEs the live pref for the exercise (syncs as a delete op)', async () => {
    const db = mockDb()
    await clearExerciseRestPref(db, { exerciseId: 'ex-1' })
    const [sql, params] = db.execute.mock.calls[0]
    expect(sql).toMatch(/DELETE FROM exercise_rest_prefs WHERE exercise_id = \? AND deleted_at IS NULL/)
    expect(params).toEqual(['ex-1'])
  })
})
