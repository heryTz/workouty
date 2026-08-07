// Behavioural proof of lastTimeTopSetSql's "top set" ranking, run against real SQLite rather
// than asserted with a regex over the query text.
//
// The ORDER BY leans on two SQLite specifics that a string match cannot check: a CASE with no
// ELSE yields NULL, and NULL sorts below every value under DESC — which together are what let a
// uniformly-NULL sort key tie every row and hand the decision to the next key. If either
// assumption were wrong the query would still LOOK right and would quietly return an arbitrary
// set, telling the user to beat a number they never trained.
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { lastTimeTopSetSql } from './last-time'

type SetSpec = { reps: number | null; durationSeconds: number | null; weightKg: number }

const PRIOR_SESSION = 'session-1'
const CURRENT_SESSION = 'session-2'
const EXERCISE = 'exercise-1'

// Just enough of the client mirror for the query under test. Column types mirror
// powersync/schema.ts (integers for reps/duration, real for weight).
function seed(loadType: string, measure: string, sets: SetSpec[]) {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE exercises (id TEXT PRIMARY KEY, load_type TEXT, measure TEXT);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, started_at TEXT);
    CREATE TABLE session_exercises (id TEXT PRIMARY KEY, session_id TEXT, exercise_id TEXT, deleted_at TEXT);
    CREATE TABLE sets (
      id TEXT PRIMARY KEY, session_exercise_id TEXT, set_index INTEGER,
      reps INTEGER, duration_seconds INTEGER, weight_kg REAL, deleted_at TEXT
    );
  `)
  db.prepare('INSERT INTO exercises VALUES (?, ?, ?)').run(EXERCISE, loadType, measure)
  db.prepare('INSERT INTO sessions VALUES (?, ?)').run(PRIOR_SESSION, '2026-01-01T10:00:00.000Z')
  db.prepare('INSERT INTO session_exercises VALUES (?, ?, ?, NULL)').run('se-1', PRIOR_SESSION, EXERCISE)

  const insert = db.prepare('INSERT INTO sets VALUES (?, ?, ?, ?, ?, ?, NULL)')
  sets.forEach((s, i) => insert.run(`set-${i}`, 'se-1', i, s.reps, s.durationSeconds, s.weightKg))
  return db
}

function topSet(loadType: string, measure: string, sets: SetSpec[]) {
  const db = seed(loadType, measure, sets)
  const { sql, params } = lastTimeTopSetSql(EXERCISE, CURRENT_SESSION)
  const row = db.prepare(sql).get(...(params as string[])) as
    | { weight_kg: number; reps: number | null; duration_seconds: number | null }
    | undefined
  db.close()
  return row
}

const rep = (reps: number, weightKg: number): SetSpec => ({ reps, durationSeconds: null, weightKg })
const hold = (durationSeconds: number, weightKg: number): SetSpec => ({ reps: null, durationSeconds, weightKg })

describe('lastTimeTopSetSql ranking, against real SQLite', () => {
  it('picks the heaviest set for an external rep exercise', () => {
    const top = topSet('external', 'reps', [rep(12, 40), rep(3, 80), rep(8, 60)])
    expect(top?.weight_kg).toBe(80)
    expect(top?.reps).toBe(3)
  })

  it('breaks a weight tie on reps for an external rep exercise', () => {
    const top = topSet('external', 'reps', [rep(5, 60), rep(9, 60), rep(7, 60)])
    expect(top?.reps).toBe(9)
  })

  it('picks the most reps for a bodyweight exercise, where every set weighs the same 0 kg', () => {
    // This case the old `ORDER BY weight_kg DESC, reps DESC` got right by accident: all three tie
    // at 0 on the leading key, so it fell through to reps anyway. Pinned so the rewrite is held
    // to the behaviour that was already correct, not just the parts that were broken.
    const top = topSet('bodyweight', 'reps', [rep(8, 0), rep(15, 0), rep(11, 0)])
    expect(top?.reps).toBe(15)
  })

  it('still prefers reps over added weight on a bodyweight exercise', () => {
    // 3 pull-ups at +40 kg is the heavier set, but reps are what this exercise progresses on, so
    // the reference to beat is the 14.
    const top = topSet('bodyweight', 'reps', [rep(14, 0), rep(3, 40)])
    expect(top?.reps).toBe(14)
    expect(top?.weight_kg).toBe(0)
  })

  it('breaks a reps tie on added weight', () => {
    const top = topSet('bodyweight', 'reps', [rep(10, 0), rep(10, 20), rep(10, 5)])
    expect(top?.weight_kg).toBe(20)
  })

  it('picks the longest hold for a duration exercise, ignoring reps entirely', () => {
    const top = topSet('bodyweight', 'duration', [hold(45, 0), hold(120, 0), hold(90, 10)])
    expect(top?.duration_seconds).toBe(120)
    expect(top?.reps).toBeNull()
  })

  it('breaks a hold tie on added weight', () => {
    const top = topSet('bodyweight', 'duration', [hold(60, 0), hold(60, 10)])
    expect(top?.duration_seconds).toBe(60)
    expect(top?.weight_kg).toBe(10)
  })

  it('ranks an externally-loaded carry on its hold, not its load', () => {
    const top = topSet('external', 'duration', [hold(30, 50), hold(75, 20)])
    expect(top?.duration_seconds).toBe(75)
  })

  it('returns nothing when the exercise has only been done in the current session', () => {
    const db = seed('external', 'reps', [rep(8, 60)])
    db.prepare('UPDATE session_exercises SET session_id = ?').run(CURRENT_SESSION)
    const { sql, params } = lastTimeTopSetSql(EXERCISE, CURRENT_SESSION)
    expect(db.prepare(sql).get(...(params as string[]))).toBeUndefined()
    db.close()
  })
})
