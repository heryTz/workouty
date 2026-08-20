// Everything the finished-session detail screen (app/(app)/sessions/[id].tsx) reads: the session
// row, its exercises in performed order, and every set logged into them.
//
// Deliberately NOT shared with the active-session screen's inline queries. That screen's exercise
// query joins `exercise_rest_prefs` to resolve the rest countdown's default — a live-logging
// concern with nothing to say about a workout that already happened. The two shapes only look
// alike; they answer different questions.
//
// Query builders are exported separately from the hook so the SQL is unit-testable without a live
// PowerSync database (same split as sessions-query.ts / last-time.ts). All three reads are
// reactive: a session finishing on another device turns "In progress" into a duration here without
// a refetch.
import { useMemo } from 'react'
import { useQuery } from '@powersync/react'
import type { LoadType, Measure } from '@workouty/shared'

export interface SessionDetailRow {
  started_at: string
  /** null while the session is still running. */
  ended_at: string | null
  template_id: string | null
  /** null for a freestyle session, or one whose template has since been deleted. */
  template_name: string | null
}

export interface DetailExerciseRow {
  id: string
  exercise_id: string
  position: number
  name: string
  muscle_group: string
  load_type: LoadType
  measure: Measure
}

export interface DetailSetRow {
  id: string
  session_exercise_id: string
  set_index: number
  reps: number | null
  duration_seconds: number | null
  weight_kg: number
  /** null when the rest was never stopped — the session ended on this set, typically. */
  actual_rest_seconds: number | null
}

// The templates join matches sessions-query.ts and is likewise unfiltered on the template's own
// `deleted_at`: the name is a record of what was run, not a live link.
export function sessionDetailSql(sessionId: string): { sql: string; params: unknown[] } {
  const sql = `
    SELECT
      s.started_at AS started_at,
      s.ended_at AS ended_at,
      s.template_id AS template_id,
      t.name AS template_name
    FROM sessions s
    LEFT JOIN templates t ON t.id = s.template_id
    WHERE s.id = ? AND s.deleted_at IS NULL
  `
  return { sql, params: [sessionId] }
}

export function sessionDetailExercisesSql(sessionId: string): { sql: string; params: unknown[] } {
  const sql = `
    SELECT
      se.id AS id,
      se.exercise_id AS exercise_id,
      se.position AS position,
      e.name AS name,
      e.muscle_group AS muscle_group,
      e.load_type AS load_type,
      e.measure AS measure
    FROM session_exercises se
    JOIN exercises e ON e.id = se.exercise_id
    WHERE se.session_id = ? AND se.deleted_at IS NULL
    ORDER BY se.position ASC
  `
  return { sql, params: [sessionId] }
}

export function sessionDetailSetsSql(sessionId: string): { sql: string; params: unknown[] } {
  const sql = `
    SELECT
      s.id AS id,
      s.session_exercise_id AS session_exercise_id,
      s.set_index AS set_index,
      s.reps AS reps,
      s.duration_seconds AS duration_seconds,
      s.weight_kg AS weight_kg,
      s.actual_rest_seconds AS actual_rest_seconds
    FROM sets s
    JOIN session_exercises se ON se.id = s.session_exercise_id
    WHERE se.session_id = ? AND s.deleted_at IS NULL
    ORDER BY s.set_index ASC
  `
  return { sql, params: [sessionId] }
}

export function groupSetsByExercise(rows: DetailSetRow[]): Map<string, DetailSetRow[]> {
  const map = new Map<string, DetailSetRow[]>()
  for (const row of rows) {
    const list = map.get(row.session_exercise_id)
    if (list) {
      list.push(row)
    } else {
      map.set(row.session_exercise_id, [row])
    }
  }
  return map
}

export interface SessionDetail {
  /** null while loading, and for a session id that doesn't exist (or was deleted). */
  session: SessionDetailRow | null
  exercises: DetailExerciseRow[]
  setsByExercise: Map<string, DetailSetRow[]>
  sets: DetailSetRow[]
  isLoading: boolean
}

export function useSessionDetail(sessionId: string): SessionDetail {
  const session = sessionDetailSql(sessionId)
  const exercises = sessionDetailExercisesSql(sessionId)
  const sets = sessionDetailSetsSql(sessionId)

  const { data: sessionRows, isLoading: sessionLoading } = useQuery<SessionDetailRow>(session.sql, session.params)
  const { data: exerciseRows, isLoading: exercisesLoading } = useQuery<DetailExerciseRow>(
    exercises.sql,
    exercises.params,
  )
  const { data: setRows, isLoading: setsLoading } = useQuery<DetailSetRow>(sets.sql, sets.params)

  const setsByExercise = useMemo(() => groupSetsByExercise(setRows), [setRows])

  return {
    session: sessionRows[0] ?? null,
    exercises: exerciseRows,
    setsByExercise,
    sets: setRows,
    isLoading: sessionLoading || exercisesLoading || setsLoading,
  }
}
