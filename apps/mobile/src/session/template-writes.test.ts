import { describe, expect, it, vi } from 'vitest'
import {
  createTemplateFromSession,
  deleteTemplate,
  removeSessionExercise,
  renameTemplate,
  startSessionFromTemplate,
  updateTemplateFromSession,
} from './template-writes'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function mockDb(getAllResult: unknown[] = []) {
  return {
    execute: vi.fn().mockResolvedValue(undefined),
    getAll: vi.fn().mockResolvedValue(getAllResult),
  }
}

describe('createTemplateFromSession', () => {
  it('inserts a templates row and one template_exercise per session exercise, preserving position and copying default_rest_seconds', async () => {
    const sessionExercises = [
      { exercise_id: 'ex-1', position: 0, default_rest_seconds: 60 },
      { exercise_id: 'ex-2', position: 1, default_rest_seconds: 90 },
    ]
    const db = mockDb(sessionExercises)

    const templateId = await createTemplateFromSession(db, {
      userId: 'user-1',
      sessionId: 'session-1',
      name: 'Push Day',
    })

    expect(templateId).toMatch(UUID_RE)

    // The read: session_exercises joined with exercises, scoped to the session, live rows only.
    expect(db.getAll).toHaveBeenCalledTimes(1)
    const [readSql, readParams] = db.getAll.mock.calls[0] as [string, unknown[]]
    expect(readSql).toMatch(/session_exercises/)
    expect(readSql).toMatch(/deleted_at IS NULL/)
    expect(readParams).toEqual(['session-1'])

    // 1 templates insert + 2 template_exercises inserts.
    expect(db.execute).toHaveBeenCalledTimes(3)

    const [templateSql, templateParams] = db.execute.mock.calls[0] as [string, unknown[]]
    expect(templateSql).toMatch(/INSERT INTO templates/)
    const [insertedTemplateId, userId, name] = templateParams
    expect(insertedTemplateId).toBe(templateId)
    expect(userId).toBe('user-1')
    expect(name).toBe('Push Day')

    const [teSql1, teParams1] = db.execute.mock.calls[1] as [string, unknown[]]
    expect(teSql1).toMatch(/INSERT INTO template_exercises/)
    const [teId1, teUserId1, teTemplateId1, exerciseId1, position1, restSeconds1] = teParams1
    expect(teId1).toMatch(UUID_RE)
    expect(teUserId1).toBe('user-1')
    expect(teTemplateId1).toBe(templateId)
    expect(exerciseId1).toBe('ex-1')
    expect(position1).toBe(0)
    expect(restSeconds1).toBe(60)

    const [, teParams2] = db.execute.mock.calls[2] as [string, unknown[]]
    const [, , teTemplateId2, exerciseId2, position2, restSeconds2] = teParams2
    expect(teTemplateId2).toBe(templateId)
    expect(exerciseId2).toBe('ex-2')
    expect(position2).toBe(1)
    expect(restSeconds2).toBe(90)
  })

  it('inserts only the templates row when the session has no live exercises', async () => {
    const db = mockDb([])

    await createTemplateFromSession(db, { userId: 'user-1', sessionId: 'session-1', name: 'Empty' })

    expect(db.execute).toHaveBeenCalledTimes(1)
  })

  it('does not interpolate values into the SQL string (uses parameter binding)', async () => {
    const db = mockDb([])

    await createTemplateFromSession(db, {
      userId: 'user-1',
      sessionId: 'session-1',
      name: "'; DROP TABLE templates; --",
    })

    const [sql] = db.execute.mock.calls[0] as [string, unknown[]]
    expect(sql).not.toMatch(/DROP TABLE/)
    expect(sql).toMatch(/\?/)
  })
})

describe('startSessionFromTemplate', () => {
  it('inserts a sessions row with template_id + started_at, and session_exercises from the template exercises in position order', async () => {
    const templateExercises = [
      { exercise_id: 'ex-1', position: 0 },
      { exercise_id: 'ex-2', position: 1 },
    ]
    const db = mockDb(templateExercises)
    db.getAll.mockResolvedValueOnce([]) // first getAll is the active-session guard → none active

    const sessionId = await startSessionFromTemplate(db, { userId: 'user-1', templateId: 'template-1' })

    expect(sessionId).toMatch(UUID_RE)

    // sessions insert happens before the template_exercises read/inserts.
    expect(db.execute).toHaveBeenCalledTimes(3)

    const [sessionSql, sessionParams] = db.execute.mock.calls[0] as [string, unknown[]]
    expect(sessionSql).toMatch(/INSERT INTO sessions/)
    expect(sessionSql).toMatch(/ended_at.*=?\s*NULL/is)
    const [insertedSessionId, userId, templateId, startedAt] = sessionParams
    expect(insertedSessionId).toBe(sessionId)
    expect(userId).toBe('user-1')
    expect(templateId).toBe('template-1')
    expect(() => new Date(startedAt as string).toISOString()).not.toThrow()

    const [readSql, readParams] = db.getAll.mock.calls[1] as [string, unknown[]]
    expect(readSql).toMatch(/template_exercises/)
    expect(readSql).toMatch(/deleted_at IS NULL/)
    expect(readParams).toEqual(['template-1'])

    const [seSql1, seParams1] = db.execute.mock.calls[1] as [string, unknown[]]
    expect(seSql1).toMatch(/INSERT INTO session_exercises/)
    const [seId1, seUserId1, seSessionId1, seExerciseId1, sePosition1] = seParams1
    expect(seId1).toMatch(UUID_RE)
    expect(seUserId1).toBe('user-1')
    expect(seSessionId1).toBe(sessionId)
    expect(seExerciseId1).toBe('ex-1')
    expect(sePosition1).toBe(0)

    const [, seParams2] = db.execute.mock.calls[2] as [string, unknown[]]
    const [, , , seExerciseId2, sePosition2] = seParams2
    expect(seExerciseId2).toBe('ex-2')
    expect(sePosition2).toBe(1)
  })

  it('does not interpolate values into the SQL string (uses parameter binding)', async () => {
    const db = mockDb([])

    await startSessionFromTemplate(db, { userId: "user-1'; DROP TABLE sessions; --", templateId: 'template-1' })

    // execute.calls[0] is the sessions insert (getAll active-check returned [] → no active session).
    const [sql] = db.execute.mock.calls[0] as [string, unknown[]]
    expect(sql).not.toMatch(/DROP TABLE/)
    expect(sql).toMatch(/\?/)
  })

  it('resumes the existing un-ended session instead of creating one from the template', async () => {
    const db = mockDb([{ id: 'active-1' }]) // active-session guard finds an open session
    const sessionId = await startSessionFromTemplate(db, { userId: 'user-1', templateId: 'template-1' })
    expect(sessionId).toBe('active-1')
    expect(db.execute).not.toHaveBeenCalled() // no new session / session_exercises inserted
  })
})

describe('updateTemplateFromSession', () => {
  it('soft-deletes the existing template_exercises then inserts the session exercises fresh with positions 0..n-1', async () => {
    const sessionExercises = [
      { exercise_id: 'ex-9', position: 5, default_rest_seconds: 45 },
      { exercise_id: 'ex-8', position: 7, default_rest_seconds: 120 },
    ]
    const db = mockDb(sessionExercises)

    await updateTemplateFromSession(db, { userId: 'user-1', templateId: 'template-1', sessionId: 'session-1' })

    // 1 soft-delete DELETE + 2 fresh inserts.
    expect(db.execute).toHaveBeenCalledTimes(3)

    // A real SQL DELETE, not an UPDATE setting deleted_at: the server's upload contract
    // (apps/api/src/sync/upload-contracts.ts) treats deletedAt as server-owned and strips it
    // from PATCH payloads, so only a PowerSync DELETE op actually reaches the server's
    // soft-delete path — see this file's header comment on updateTemplateFromSession.
    const [deleteSql, deleteParams] = db.execute.mock.calls[0] as [string, unknown[]]
    expect(deleteSql).toMatch(/DELETE FROM template_exercises/)
    expect(deleteSql).toMatch(/WHERE template_id = \?/)
    expect(deleteSql).toMatch(/deleted_at IS NULL/)
    const [deletedTemplateId] = deleteParams
    expect(deletedTemplateId).toBe('template-1')

    const [readSql, readParams] = db.getAll.mock.calls[0] as [string, unknown[]]
    expect(readSql).toMatch(/session_exercises/)
    expect(readParams).toEqual(['session-1'])

    const [insSql1, insParams1] = db.execute.mock.calls[1] as [string, unknown[]]
    expect(insSql1).toMatch(/INSERT INTO template_exercises/)
    const [teId1, teUserId1, teTemplateId1, exerciseId1, position1, restSeconds1] = insParams1
    expect(teId1).toMatch(UUID_RE)
    expect(teUserId1).toBe('user-1')
    expect(teTemplateId1).toBe('template-1')
    expect(exerciseId1).toBe('ex-9')
    expect(position1).toBe(0) // reindexed, not the session's original position (5)
    expect(restSeconds1).toBe(45)

    const [, insParams2] = db.execute.mock.calls[2] as [string, unknown[]]
    const [, , , exerciseId2, position2, restSeconds2] = insParams2
    expect(exerciseId2).toBe('ex-8')
    expect(position2).toBe(1) // reindexed
    expect(restSeconds2).toBe(120)
  })

  it('does not touch the templates row (keeps the name)', async () => {
    const db = mockDb([])

    await updateTemplateFromSession(db, { userId: 'user-1', templateId: 'template-1', sessionId: 'session-1' })

    for (const call of db.execute.mock.calls) {
      const [sql] = call as [string, unknown[]]
      expect(sql).not.toMatch(/UPDATE templates\b/)
    }
  })
})

describe('renameTemplate', () => {
  it('UPDATEs templates.name and updated_at', async () => {
    const db = mockDb()

    await renameTemplate(db, { templateId: 'template-1', name: 'New Name' })

    expect(db.execute).toHaveBeenCalledTimes(1)
    const [sql, params] = db.execute.mock.calls[0] as [string, unknown[]]
    expect(sql).toMatch(/UPDATE templates/)
    expect(sql).toMatch(/name\s*=\s*\?/)
    expect(sql).toMatch(/WHERE id = \?/)

    const [name, updatedAt, templateId] = params
    expect(name).toBe('New Name')
    expect(() => new Date(updatedAt as string).toISOString()).not.toThrow()
    expect(templateId).toBe('template-1')
  })

  it('does not interpolate values into the SQL string (uses parameter binding)', async () => {
    const db = mockDb()

    await renameTemplate(db, { templateId: 'template-1', name: "'; DROP TABLE templates; --" })

    const [sql] = db.execute.mock.calls[0] as [string, unknown[]]
    expect(sql).not.toMatch(/DROP TABLE/)
    expect(sql).toMatch(/\?/)
  })
})

describe('deleteTemplate', () => {
  it('soft-deletes the templates row and its template_exercises via SQL DELETE (not an UPDATE of deleted_at)', async () => {
    const db = mockDb()

    await deleteTemplate(db, { templateId: 'template-1' })

    expect(db.execute).toHaveBeenCalledTimes(2)

    // Real DELETEs, not UPDATEs setting deleted_at — see this file's header comment on
    // updateTemplateFromSession for why: the server strips deletedAt out of any uploaded PATCH,
    // so only a PowerSync DELETE op actually reaches the server's soft-delete path.
    const [templateSql, templateParams] = db.execute.mock.calls[0] as [string, unknown[]]
    expect(templateSql).toMatch(/DELETE FROM templates/)
    expect(templateSql).toMatch(/WHERE id = \?/)
    const [templateId] = templateParams
    expect(templateId).toBe('template-1')

    const [teSql, teParams] = db.execute.mock.calls[1] as [string, unknown[]]
    expect(teSql).toMatch(/DELETE FROM template_exercises/)
    expect(teSql).toMatch(/WHERE template_id = \?/)
    expect(teSql).toMatch(/deleted_at IS NULL/)
    const [teTemplateId] = teParams
    expect(teTemplateId).toBe('template-1')
  })
})

describe('removeSessionExercise', () => {
  it('soft-deletes the session_exercise and its sets via SQL DELETE (not an UPDATE of deleted_at)', async () => {
    const db = mockDb()

    await removeSessionExercise(db, { sessionExerciseId: 'se-1' })

    expect(db.execute).toHaveBeenCalledTimes(2)

    // Real DELETEs, not UPDATEs setting deleted_at — see template-writes.ts's header comment on
    // updateTemplateFromSession for why: the server strips deletedAt out of any uploaded PATCH,
    // so only a PowerSync DELETE op actually reaches the server's soft-delete path.
    const [seSql, seParams] = db.execute.mock.calls[0] as [string, unknown[]]
    expect(seSql).toMatch(/DELETE FROM session_exercises/)
    expect(seSql).toMatch(/WHERE id = \?/)
    const [sessionExerciseId] = seParams
    expect(sessionExerciseId).toBe('se-1')

    const [setsSql, setsParams] = db.execute.mock.calls[1] as [string, unknown[]]
    expect(setsSql).toMatch(/DELETE FROM sets/)
    expect(setsSql).toMatch(/WHERE session_exercise_id = \?/)
    expect(setsSql).toMatch(/deleted_at IS NULL/)
    const [setsSessionExerciseId] = setsParams
    expect(setsSessionExerciseId).toBe('se-1')
  })
})
