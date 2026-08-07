import { describe, expect, it, vi } from 'vitest'
import { addSessionExercise, endSession, logSet, recordRest, startSession } from './session-writes'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function mockDb(getAllResult: unknown[] = []) {
  return {
    execute: vi.fn().mockResolvedValue(undefined),
    getAll: vi.fn().mockResolvedValue(getAllResult),
  }
}

describe('startSession', () => {
  it('resumes the existing un-ended session instead of creating a second', async () => {
    const db = mockDb([{ id: 'active-1' }])
    const id = await startSession(db, { userId: 'user-1' })
    expect(id).toBe('active-1')
    expect(db.execute).not.toHaveBeenCalled() // no new sessions row inserted
  })

  it('inserts a sessions row with user_id, a generated uuid id, started_at set, ended_at null, and returns the id', async () => {
    const db = mockDb()

    const id = await startSession(db, { userId: 'user-1' })

    expect(id).toMatch(UUID_RE)
    expect(db.execute).toHaveBeenCalledTimes(1)
    const [sql, params] = db.execute.mock.calls[0] as [string, unknown[]]

    expect(sql).toMatch(/INSERT INTO sessions/)
    expect(sql).toMatch(/ended_at.*=?\s*NULL/is)

    const [insertedId, userId, templateId, startedAt, createdAt, updatedAt] = params
    expect(insertedId).toBe(id)
    expect(userId).toBe('user-1')
    expect(templateId).toBeNull()
    expect(() => new Date(startedAt as string).toISOString()).not.toThrow()
    expect(createdAt).toBe(updatedAt)
  })

  it('passes templateId through when provided', async () => {
    const db = mockDb()

    await startSession(db, { userId: 'user-1', templateId: 'template-1' })

    const [, params] = db.execute.mock.calls[0] as [string, unknown[]]
    expect(params).toContain('template-1')
  })

  it('does not interpolate values into the SQL string (uses parameter binding)', async () => {
    const db = mockDb()

    await startSession(db, { userId: "user-1'; DROP TABLE sessions; --" })

    const [sql] = db.execute.mock.calls[0] as [string, unknown[]]
    expect(sql).not.toMatch(/DROP TABLE/)
    expect(sql).toMatch(/\?/)
  })
})

describe('addSessionExercise', () => {
  it('inserts a session_exercises row with session_id/exercise_id/position/user_id and returns the id', async () => {
    const db = mockDb()

    const id = await addSessionExercise(db, {
      userId: 'user-1',
      sessionId: 'session-1',
      exerciseId: 'exercise-1',
      position: 2,
    })

    expect(id).toMatch(UUID_RE)
    const [sql, params] = db.execute.mock.calls[0] as [string, unknown[]]
    expect(sql).toMatch(/INSERT INTO session_exercises/)

    const [insertedId, userId, sessionId, exerciseId, position] = params
    expect(insertedId).toBe(id)
    expect(userId).toBe('user-1')
    expect(sessionId).toBe('session-1')
    expect(exerciseId).toBe('exercise-1')
    expect(position).toBe(2)
  })
})

describe('logSet', () => {
  it('inserts a sets row with reps/weight_kg/set_index/performed_at/user_id/session_exercise_id and null actual_rest_seconds', async () => {
    const db = mockDb()

    const id = await logSet(db, {
      userId: 'user-1',
      sessionExerciseId: 'se-1',
      setIndex: 0,
      reps: 10,
      durationSeconds: null,
      weightKg: 42.5,
    })

    expect(id).toMatch(UUID_RE)
    const [sql, params] = db.execute.mock.calls[0] as [string, unknown[]]
    expect(sql).toMatch(/INSERT INTO sets/)
    expect(sql).toMatch(/actual_rest_seconds/)

    const [insertedId, userId, sessionExerciseId, setIndex, reps, durationSeconds, weightKg, performedAt] = params
    expect(insertedId).toBe(id)
    expect(userId).toBe('user-1')
    expect(sessionExerciseId).toBe('se-1')
    expect(setIndex).toBe(0)
    expect(reps).toBe(10)
    expect(durationSeconds).toBeNull()
    expect(weightKg).toBe(42.5)
    expect(() => new Date(performedAt as string).toISOString()).not.toThrow()
  })

  it('uses the provided performedAt instead of now when given', async () => {
    const db = mockDb()
    const explicitPerformedAt = '2026-01-01T00:00:00.000Z'

    await logSet(db, {
      userId: 'user-1',
      sessionExerciseId: 'se-1',
      setIndex: 1,
      reps: 8,
      durationSeconds: null,
      weightKg: 20,
      performedAt: explicitPerformedAt,
    })

    const [, params] = db.execute.mock.calls[0] as [string, unknown[]]
    expect(params).toContain(explicitPerformedAt)
  })

  it('inserts a held set as duration_seconds with reps left null', async () => {
    const db = mockDb()

    await logSet(db, {
      userId: 'user-1',
      sessionExerciseId: 'se-1',
      setIndex: 0,
      reps: null,
      durationSeconds: 60,
      weightKg: 10,
    })

    const [, params] = db.execute.mock.calls[0] as [string, unknown[]]
    const [, , , , reps, durationSeconds, weightKg] = params
    expect(reps).toBeNull()
    expect(durationSeconds).toBe(60)
    expect(weightKg).toBe(10)
  })

  it('defaults weightKg to 0, the normal case for an unweighted bodyweight set', async () => {
    const db = mockDb()

    await logSet(db, { userId: 'user-1', sessionExerciseId: 'se-1', setIndex: 0, reps: 12, durationSeconds: null })

    const [, params] = db.execute.mock.calls[0] as [string, unknown[]]
    expect(params[6]).toBe(0)
  })

  it('refuses a set that measures nothing, which the SQLite mirror would otherwise accept', async () => {
    // The local mirror carries no CHECK constraints, so without this guard the row would insert,
    // sync, and be rejected server-side by sets_measure_present_ck where the user never sees it.
    const db = mockDb()

    await expect(
      logSet(db, { userId: 'user-1', sessionExerciseId: 'se-1', setIndex: 0, reps: null, durationSeconds: null }),
    ).rejects.toThrow(/reps or durationSeconds/)
    expect(db.execute).not.toHaveBeenCalled()
  })
})

describe('recordRest', () => {
  it('UPDATEs actual_rest_seconds (and updated_at) on the given set id', async () => {
    const db = mockDb()

    await recordRest(db, { setId: 'set-1', actualRestSeconds: 90 })

    expect(db.execute).toHaveBeenCalledTimes(1)
    const [sql, params] = db.execute.mock.calls[0] as [string, unknown[]]

    expect(sql).toMatch(/UPDATE sets/)
    expect(sql).toMatch(/actual_rest_seconds\s*=\s*\?/)
    expect(sql).toMatch(/WHERE id = \?/)

    const [actualRestSeconds, updatedAt, setId] = params
    expect(actualRestSeconds).toBe(90)
    expect(() => new Date(updatedAt as string).toISOString()).not.toThrow()
    expect(setId).toBe('set-1')
  })
})

describe('endSession', () => {
  it('UPDATEs ended_at (and updated_at) on the given session id', async () => {
    const db = mockDb()

    await endSession(db, { sessionId: 'session-1' })

    expect(db.execute).toHaveBeenCalledTimes(1)
    const [sql, params] = db.execute.mock.calls[0] as [string, unknown[]]

    expect(sql).toMatch(/UPDATE sessions/)
    expect(sql).toMatch(/ended_at\s*=\s*\?/)
    expect(sql).toMatch(/WHERE id = \?/)

    const [endedAt, updatedAt, sessionId] = params
    expect(() => new Date(endedAt as string).toISOString()).not.toThrow()
    expect(() => new Date(updatedAt as string).toISOString()).not.toThrow()
    expect(sessionId).toBe('session-1')
  })
})
