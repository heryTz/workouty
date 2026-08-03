// Route: /session/[id] (Milestone 4 Task D2; Milestone 5 Task C2 adds save-as-template + the
// finish-time divergence prompt). The active-session screen — the core log-a-set -> rest ->
// next-set loop. All reads below are reactive (@powersync/react's useQuery), so this screen
// re-renders as local writes land (this device's own inserts) and as rows sync down (in
// principle; not expected mid-session on a single device, but the reactive query doesn't care
// which source a row came from).
//
// "Current" exercise: rather than threading a return value back through expo-router from the
// exercise picker (awkward — see exercise-picker.tsx's session-mode note below), the picker
// performs the `addSessionExercise` insert itself when navigated to with a `sessionId` param and
// then just `router.back()`s. This screen has no dependency on that return trip: it reactively
// watches `session_exercises` and auto-selects the most-recently-added one (highest `position`)
// as "current" whenever the exercise count grows. Tapping any exercise card also switches
// "current" by hand, so the user can log into an earlier exercise without re-adding it. Removing
// the current exercise (Task C2's remove control) falls back to the last remaining one, if any.
//
// Rest is session-scoped (only one rest countdown at a time, matching "you rest, then do the
// next thing" regardless of which exercise that next thing belongs to): logging a set stores
// { sessionExerciseId, setId, restStartedAtMs, endsAtMs } in component state and the log-set form
// is hidden until "Stop rest" is pressed, per the plan's log -> rest -> next-set loop. Stop rest
// computes actualRest from the stored restStartedAtMs (not a counter) and calls recordRest on the
// PRECEDING set (the one just logged, per the M1 schema) before clearing rest state.
//
// Finish (Task C2, spec 3.5): a freestyle session (no template_id) or a template-based session
// whose live exercise list still matches the template's finishes silently. A template-based
// session whose live list diverged (added/removed/reordered — exerciseListDiverged, computed over
// `deleted_at IS NULL`, position-ordered exercise-id arrays) shows an inline prompt (web-scriptable,
// not RN's Alert — same "inline form/dialog" convention as templates.tsx) offering Update template /
// Save as new / Don't update; each finishes the session afterward. Never finishes silently when
// diverged.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Platform, Pressable, StyleSheet, View } from 'react-native'
import { useQuery } from '@powersync/react'
import { useAuth } from '@/auth/useAuth'
import { usePrSetIds } from '@/dashboard/pr-set-ids-query'
import { usePowerSyncApp } from '@/powersync/PowerSyncProvider'
import { diffExerciseLists, exerciseListDiverged, type ExerciseListDiff } from '@/session/divergence'
import { useLastSessionSets } from '@/session/last-time'
import { playRestBeep } from '@/session/rest-beep'
import { cancelRestAlarm, ensureRestChannel, requestNotificationPermission, scheduleRestAlarm } from '@/session/rest-notification'
import { endSession, logSet, recordRest } from '@/session/session-writes'
import { createTemplateFromSession, removeSessionExercise, updateTemplateFromSession } from '@/session/template-writes'
import {
  formatElapsed,
  formatMmSs,
  isRestOver,
  restEndsAt,
  restRemainingSeconds,
  sessionElapsedSeconds,
} from '@/session/timers'
import { useNow } from '@/session/useNow'
import { Button, Field, Heading, Screen, Text, colors, minTapTarget, radii, spacing } from '@/ui'

interface SessionRow {
  started_at: string
  ended_at: string | null
  template_id: string | null
}

interface SessionExerciseRow {
  id: string
  exercise_id: string
  position: number
  name: string
  default_rest_seconds: number
}

interface SetRow {
  id: string
  session_exercise_id: string
  set_index: number
  reps: number
  weight_kg: number
  actual_rest_seconds: number | null
  performed_at: string
}

interface TemplateExerciseForSessionRow {
  exercise_id: string
  position: number
  name: string
}

interface RestState {
  setId: string
  restStartedAtMs: number
  endsAtMs: number
  /** The scheduled OS notification's id (Android), so it can be cancelled on "Stop rest".
   * null on web (no local-notification API there — see rest-notification.ts). */
  alarmId: string | null
}

interface DivergencePromptState {
  diff: ExerciseListDiff
}

const SESSION_QUERY = `SELECT started_at AS started_at, ended_at AS ended_at, template_id AS template_id FROM sessions WHERE id = ?`

const SESSION_EXERCISES_QUERY = `
  SELECT
    se.id AS id,
    se.exercise_id AS exercise_id,
    se.position AS position,
    e.name AS name,
    COALESCE(p.rest_seconds, e.default_rest_seconds) AS default_rest_seconds
  FROM session_exercises se
  JOIN exercises e ON e.id = se.exercise_id
  LEFT JOIN exercise_rest_prefs p ON p.exercise_id = se.exercise_id AND p.deleted_at IS NULL
  WHERE se.session_id = ? AND se.deleted_at IS NULL
  ORDER BY se.position ASC
`

const SETS_QUERY = `
  SELECT
    s.id AS id,
    s.session_exercise_id AS session_exercise_id,
    s.set_index AS set_index,
    s.reps AS reps,
    s.weight_kg AS weight_kg,
    s.actual_rest_seconds AS actual_rest_seconds,
    s.performed_at AS performed_at
  FROM sets s
  JOIN session_exercises se ON se.id = s.session_exercise_id
  WHERE se.session_id = ? AND s.deleted_at IS NULL
  ORDER BY s.set_index ASC
`

// The session's template's live exercises, position-ordered, joined to names — used for the
// finish-time divergence check and the diff's human-readable labels. Bound with `template_id ?? null`
// when the session is freestyle; `template_id = NULL` never matches in SQL, so this simply returns
// no rows rather than needing a second conditional query/hook.
const TEMPLATE_EXERCISES_FOR_SESSION_QUERY = `
  SELECT te.exercise_id AS exercise_id, te.position AS position, e.name AS name
  FROM template_exercises te
  JOIN exercises e ON e.id = te.exercise_id
  WHERE te.template_id = ? AND te.deleted_at IS NULL
  ORDER BY te.position ASC
`

export default function ActiveSession() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { userId } = useAuth()
  const { db } = usePowerSyncApp()
  const now = useNow(1000)

  const { data: sessionRows, isLoading: sessionLoading } = useQuery<SessionRow>(SESSION_QUERY, [sessionId])
  const session = sessionRows[0] ?? null

  const { data: sessionExercises, isLoading: sessionExercisesLoading } = useQuery<SessionExerciseRow>(
    SESSION_EXERCISES_QUERY,
    [sessionId],
  )
  const { data: setRows, isLoading: setsLoading } = useQuery<SetRow>(SETS_QUERY, [sessionId])
  const { data: templateExercises } = useQuery<TemplateExerciseForSessionRow>(TEMPLATE_EXERCISES_FOR_SESSION_QUERY, [
    session?.template_id ?? null,
  ])

  const setsByExercise = useMemo(() => {
    const map = new Map<string, SetRow[]>()
    for (const row of setRows) {
      const list = map.get(row.session_exercise_id)
      if (list) {
        list.push(row)
      } else {
        map.set(row.session_exercise_id, [row])
      }
    }
    return map
  }, [setRows])

  const [currentSessionExerciseId, setCurrentSessionExerciseId] = useState<string | null>(null)
  const previousExerciseCount = useRef(0)
  useEffect(() => {
    if (sessionExercises.length > previousExerciseCount.current && sessionExercises.length > 0) {
      setCurrentSessionExerciseId(sessionExercises[sessionExercises.length - 1].id)
    }
    previousExerciseCount.current = sessionExercises.length
  }, [sessionExercises])

  // If the "current" exercise was removed (Task C2's remove control), fall back to the last
  // remaining one rather than leaving "current" pointing at a now-gone id (which would just hide
  // the log-set form with no way back short of tapping another card).
  useEffect(() => {
    if (currentSessionExerciseId && !sessionExercises.some((se) => se.id === currentSessionExerciseId)) {
      setCurrentSessionExerciseId(sessionExercises.length > 0 ? sessionExercises[sessionExercises.length - 1].id : null)
    }
  }, [sessionExercises, currentSessionExerciseId])

  const currentExercise = sessionExercises.find((se) => se.id === currentSessionExerciseId) ?? null

  // "New PR!" badging (Task C1): which of the CURRENT exercise's live sets are a personal record
  // (weight or estimated-1RM) — see pr-set-ids-query.ts. Called unconditionally (rules-of-hooks;
  // it internally handles a null exerciseId) so this stays a plain top-level hook call regardless
  // of whether an exercise is selected. Reactive, so logging a set that beats a previous best
  // flips its badge on immediately with no extra state.
  const prSetIds = usePrSetIds(currentExercise?.exercise_id ?? null)

  const [reps, setReps] = useState('')
  const [weight, setWeight] = useState('')
  const [logging, setLogging] = useState(false)
  const [restState, setRestState] = useState<RestState | null>(null)
  const [finishing, setFinishing] = useState(false)

  // Save as template (Task C2, Step 1): an inline name form (not Alert — see the file header),
  // available any time the session has at least started — createTemplateFromSession snapshots
  // whatever the session's live exercises are right now.
  const [savingTemplateOpen, setSavingTemplateOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [savingTemplateBusy, setSavingTemplateBusy] = useState(false)

  // Finish + the divergence prompt (Task C2, Step 3). `divergencePrompt` holds a snapshot of the
  // diff computed at the moment Finish was pressed; each of its three actions re-reads live rows
  // itself (updateTemplateFromSession / createTemplateFromSession both query fresh), so a stale
  // snapshot only affects the displayed diff text, never correctness of the write.
  const [divergencePrompt, setDivergencePrompt] = useState<DivergencePromptState | null>(null)
  const [divergenceBusy, setDivergenceBusy] = useState(false)
  const [savingNewOpen, setSavingNewOpen] = useState(false)
  const [newTemplateName, setNewTemplateName] = useState('')

  // Name lookups for the divergence diff's human-readable labels: "added" ids come from the
  // session's live exercises, "removed" ids from the template's live exercises (removed ones no
  // longer have a session_exercises row to read a name from).
  const sessionExerciseNameByExerciseId = useMemo(
    () => new Map(sessionExercises.map((se) => [se.exercise_id, se.name])),
    [sessionExercises],
  )
  const templateExerciseNameByExerciseId = useMemo(
    () => new Map(templateExercises.map((te) => [te.exercise_id, te.name])),
    [templateExercises],
  )

  // Rest-timer ALARM setup (Task E2): ask for notification permission and create the Android
  // 'rest' channel once, up front, so the first rest of the session can schedule an alarm without
  // waiting on a permission round-trip. Both are native-only no-ops on web (see rest-notification.ts) —
  // fire-and-forget; a denied/unavailable permission just means no OS alarm fires, the in-app
  // countdown still works either way.
  useEffect(() => {
    void requestNotificationPermission()
    void ensureRestChannel()
  }, [])

  const handleAddExercise = useCallback(() => {
    router.push({ pathname: '/exercise-picker', params: { sessionId } })
  }, [router, sessionId])

  const handleLogSet = useCallback(async () => {
    if (!userId || !currentExercise) return
    const repsNum = Number(reps)
    const weightNum = Number(weight)
    if (
      !Number.isFinite(repsNum) ||
      repsNum <= 0 ||
      !Number.isInteger(repsNum) ||
      !Number.isFinite(weightNum) ||
      weightNum < 0
    )
      return

    setLogging(true)
    try {
      const existingSets = setsByExercise.get(currentExercise.id) ?? []
      const setId = await logSet(db, {
        userId,
        sessionExerciseId: currentExercise.id,
        setIndex: existingSets.length,
        reps: repsNum,
        weightKg: weightNum,
      })
      setReps('')
      setWeight('')

      const restStartedAtMs = Date.now()
      const endsAtMs = restEndsAt(restStartedAtMs, currentExercise.default_rest_seconds)
      // Schedules the OS-level alarm (Android; null on web) so rest-complete fires even if the
      // app is backgrounded or killed — the in-app countdown below is the on-screen display, this
      // is the background-safe nudge.
      const alarmId = await scheduleRestAlarm(endsAtMs)
      setRestState({ setId, restStartedAtMs, endsAtMs, alarmId })
    } finally {
      setLogging(false)
    }
  }, [db, userId, currentExercise, reps, weight, setsByExercise])

  const handleStopRest = useCallback(async () => {
    if (!restState) return
    // Cancel the OS alarm before clearing rest state — stopping rest early (or logging the next
    // set) should silence the pending notification, not leave a stale one to fire late.
    await cancelRestAlarm(restState.alarmId)
    const actualRestSeconds = Math.round((Date.now() - restState.restStartedAtMs) / 1000)
    await recordRest(db, { setId: restState.setId, actualRestSeconds })
    setRestState(null)
  }, [db, restState])

  const handleRemoveExercise = useCallback(
    async (sessionExerciseId: string) => {
      await removeSessionExercise(db, { sessionExerciseId })
    },
    [db],
  )

  const handleSaveAsTemplate = useCallback(async () => {
    const trimmed = templateName.trim()
    if (!userId || !trimmed) return
    setSavingTemplateBusy(true)
    try {
      await createTemplateFromSession(db, { userId, sessionId, name: trimmed })
      setSavingTemplateOpen(false)
      setTemplateName('')
    } finally {
      setSavingTemplateBusy(false)
    }
  }, [db, userId, sessionId, templateName])

  // The actual finish write, common to the silent path and every divergence-prompt choice.
  const finishSession = useCallback(async () => {
    await endSession(db, { sessionId })
    router.replace('/')
  }, [db, sessionId, router])

  const handleFinishPress = useCallback(async () => {
    if (!session) return
    setFinishing(true)
    try {
      // Finishing (or even just deciding whether to prompt) mid-rest should silence any pending
      // alarm too — the session is ending, the alert no longer applies.
      if (restState) await cancelRestAlarm(restState.alarmId)

      if (!session.template_id) {
        // Freestyle session: no template to diverge from, finish silently.
        await finishSession()
        return
      }

      const sessionExerciseIds = sessionExercises.map((se) => se.exercise_id)
      const templateExerciseIds = templateExercises.map((te) => te.exercise_id)

      if (!exerciseListDiverged(sessionExerciseIds, templateExerciseIds)) {
        // Template-based, but still matches the template: finish silently.
        await finishSession()
        return
      }

      // Diverged: never finish silently — show the Update / Save as new / Don't update prompt.
      setDivergencePrompt({ diff: diffExerciseLists(sessionExerciseIds, templateExerciseIds) })
    } finally {
      setFinishing(false)
    }
  }, [session, restState, sessionExercises, templateExercises, finishSession])

  const handleUpdateTemplate = useCallback(async () => {
    if (!userId || !session?.template_id) return
    setDivergenceBusy(true)
    try {
      await updateTemplateFromSession(db, { userId, templateId: session.template_id, sessionId })
      await finishSession()
    } finally {
      setDivergenceBusy(false)
    }
  }, [db, userId, session, sessionId, finishSession])

  const handleDontUpdate = useCallback(async () => {
    setDivergenceBusy(true)
    try {
      await finishSession()
    } finally {
      setDivergenceBusy(false)
    }
  }, [finishSession])

  const handleSaveAsNewConfirm = useCallback(async () => {
    const trimmed = newTemplateName.trim()
    if (!userId || !trimmed) return
    setDivergenceBusy(true)
    try {
      await createTemplateFromSession(db, { userId, sessionId, name: trimmed })
      await finishSession()
    } finally {
      setDivergenceBusy(false)
    }
  }, [db, userId, sessionId, newTemplateName, finishSession])

  const elapsedSeconds = session ? sessionElapsedSeconds(new Date(session.started_at).getTime(), now) : 0
  const restRemaining = restState ? restRemainingSeconds(restState.endsAtMs, now) : 0
  const restOver = restState ? isRestOver(restState.endsAtMs, now) : false
  // Once the countdown reaches zero, keep a live timer running — seconds elapsed PAST the target —
  // so the rest box still shows how long you've actually been resting (counting up) instead of a
  // frozen label. Display-only; "Stop rest" still records the full elapsed rest as actualRest.
  const restOvertime = restState ? sessionElapsedSeconds(restState.endsAtMs, now) : 0

  // Web in-app beep (Task E2): while the tab is open, fire a Web Audio beep exactly once when the
  // countdown transitions to "over" — a `beepedForSetRef` guard keyed on the resting set's id so
  // the interval-driven re-renders (useNow ticks every second) don't replay it. Native's audible
  // cue is the scheduled OS notification's sound (rest-notification.ts); this effect only plays on
  // web, where there is no local-notification API to make a sound on its own.
  const beepedForSetRef = useRef<string | null>(null)
  useEffect(() => {
    if (!restState) {
      beepedForSetRef.current = null
      return
    }
    if (restOver && beepedForSetRef.current !== restState.setId) {
      beepedForSetRef.current = restState.setId
      if (Platform.OS === 'web') {
        playRestBeep()
      }
    }
  }, [restState, restOver])

  // Rehydrate the rest countdown after a full page reload. `restState` lives only in component
  // state, so a browser refresh drops it and the on-screen timer vanishes even though the rest is
  // still running. But the rest is fully derived from persisted data: the last-logged set whose
  // rest was never stopped (`actual_rest_seconds IS NULL`) began resting at its `performed_at`, for
  // its exercise's `default_rest_seconds`. Reconstruct it exactly once, after the queries first
  // load — the `restHydratedRef` guard means later `setRestState(null)`s (from "Stop rest") never
  // re-trigger this. (Backgrounding keeps JS state alive and needs no rehydration; only a reload
  // wipes it.)
  const restHydratedRef = useRef(false)
  useEffect(() => {
    if (restHydratedRef.current) return
    if (sessionLoading || sessionExercisesLoading || setsLoading) return
    restHydratedRef.current = true
    if (session?.ended_at) return // a finished session has no active rest

    let pending: SetRow | null = null
    for (const s of setRows) {
      if (s.actual_rest_seconds === null && (!pending || s.performed_at > pending.performed_at)) {
        pending = s
      }
    }
    if (!pending) return

    const se = sessionExercises.find((x) => x.id === pending.session_exercise_id)
    if (!se) return
    const restStartedAtMs = Date.parse(pending.performed_at)
    if (Number.isNaN(restStartedAtMs)) return

    const endsAtMs = restEndsAt(restStartedAtMs, se.default_rest_seconds)
    // If the rest already elapsed while the page was closed, mark it beeped so the beep effect
    // above doesn't fire a stale chime on load. `alarmId` is null — any OS alarm scheduled before
    // the reload is unrecoverable (and is a no-op on web anyway).
    if (isRestOver(endsAtMs, Date.now())) beepedForSetRef.current = pending.id
    setRestState({ setId: pending.id, restStartedAtMs, endsAtMs, alarmId: null })
  }, [sessionLoading, sessionExercisesLoading, setsLoading, session, setRows, sessionExercises])

  return (
    <Screen centered={false}>
      <View style={styles.header}>
        <Heading testID="session-heading">Session</Heading>
        <Text muted testID="session-elapsed">
          {formatElapsed(elapsedSeconds)}
        </Text>
      </View>

      <View style={styles.exerciseList} testID="session-exercise-list">
        {sessionExercises.length === 0 ? (
          <Text muted testID="session-exercise-empty">
            No exercises yet — add one to start logging.
          </Text>
        ) : null}

        {sessionExercises.map((se) => (
          <SessionExerciseCard
            key={se.id}
            sessionExercise={se}
            sets={setsByExercise.get(se.id) ?? []}
            sessionId={sessionId}
            isCurrent={se.id === currentSessionExerciseId}
            prSetIds={se.id === currentSessionExerciseId ? prSetIds : EMPTY_PR_SET_IDS}
            onSelect={() => setCurrentSessionExerciseId(se.id)}
            onRemove={handleRemoveExercise}
          />
        ))}
      </View>

      <Button title="Add exercise" variant="secondary" onPress={handleAddExercise} testID="add-exercise-button" />

      {savingTemplateOpen ? (
        <View style={styles.inlineForm} testID="save-template-form">
          <Field
            label="Template name"
            value={templateName}
            onChangeText={setTemplateName}
            testID="save-template-name-field"
          />
          <View style={styles.rowButtons}>
            <Button
              title="Save"
              onPress={handleSaveAsTemplate}
              loading={savingTemplateBusy}
              testID="save-template-confirm"
            />
            <Button
              title="Cancel"
              variant="secondary"
              onPress={() => {
                setSavingTemplateOpen(false)
                setTemplateName('')
              }}
              testID="save-template-cancel"
            />
          </View>
        </View>
      ) : (
        <Button
          title="Save as template"
          variant="secondary"
          onPress={() => setSavingTemplateOpen(true)}
          testID="save-template-toggle"
        />
      )}

      {currentExercise && !restState ? (
        <View style={styles.logForm} testID="log-set-form">
          <Text size="sm" muted>
            Logging: {currentExercise.name}
          </Text>
          <Field
            label="Reps"
            value={reps}
            onChangeText={setReps}
            keyboardType="number-pad"
            testID="reps-field"
          />
          <Field
            label="Weight (kg)"
            value={weight}
            onChangeText={setWeight}
            keyboardType="decimal-pad"
            testID="weight-field"
          />
          <Button title="Log set" onPress={handleLogSet} loading={logging} testID="log-set-button" />
        </View>
      ) : null}

      {restState ? (
        <View style={styles.restBox} testID="rest-box">
          <Text size="sm" muted>
            {restOver ? 'Rest complete' : 'Resting'}
          </Text>
          <Text size="xl" testID="rest-countdown" style={restOver ? { color: colors.accent } : undefined}>
            {restOver ? `+${formatMmSs(restOvertime)}` : formatMmSs(restRemaining)}
          </Text>
          <Button title="Stop rest" onPress={handleStopRest} testID="stop-rest-button" />
        </View>
      ) : null}

      {divergencePrompt ? (
        <View style={styles.divergenceBox} testID="divergence-prompt">
          <Text size="md" style={styles.divergenceTitle}>
            This session no longer matches the template
          </Text>
          {divergencePrompt.diff.added.length > 0 ? (
            <Text size="sm" testID="divergence-added">
              Added: {divergencePrompt.diff.added.map((id) => sessionExerciseNameByExerciseId.get(id) ?? id).join(', ')}
            </Text>
          ) : null}
          {divergencePrompt.diff.removed.length > 0 ? (
            <Text size="sm" testID="divergence-removed">
              Removed:{' '}
              {divergencePrompt.diff.removed.map((id) => templateExerciseNameByExerciseId.get(id) ?? id).join(', ')}
            </Text>
          ) : null}
          {divergencePrompt.diff.reordered ? (
            <Text size="sm" testID="divergence-reordered">
              Exercises were reordered
            </Text>
          ) : null}

          {savingNewOpen ? (
            <View style={styles.inlineForm} testID="divergence-save-new-form">
              <Field
                label="New template name"
                value={newTemplateName}
                onChangeText={setNewTemplateName}
                testID="divergence-save-new-name-field"
              />
              <View style={styles.rowButtons}>
                <Button
                  title="Save"
                  onPress={handleSaveAsNewConfirm}
                  loading={divergenceBusy}
                  testID="divergence-save-new-confirm"
                />
                <Button
                  title="Cancel"
                  variant="secondary"
                  onPress={() => {
                    setSavingNewOpen(false)
                    setNewTemplateName('')
                  }}
                  testID="divergence-save-new-cancel"
                />
              </View>
            </View>
          ) : (
            <View style={styles.rowButtons}>
              <Button
                title="Update template"
                onPress={handleUpdateTemplate}
                loading={divergenceBusy}
                testID="divergence-update-button"
              />
              <Button
                title="Save as new"
                variant="secondary"
                onPress={() => setSavingNewOpen(true)}
                disabled={divergenceBusy}
                testID="divergence-save-new-button"
              />
              <Button
                title="Don't update"
                variant="secondary"
                onPress={handleDontUpdate}
                loading={divergenceBusy}
                testID="divergence-dont-update-button"
              />
            </View>
          )}
        </View>
      ) : (
        <Button
          title="Finish session"
          variant="secondary"
          onPress={handleFinishPress}
          loading={finishing}
          testID="finish-session-button"
        />
      )}
    </Screen>
  )
}

// Stable empty-Set reference for non-current exercise cards (Task C1) — prSetIds is only
// meaningful for the currently-selected exercise (see the pr-set-ids-query.ts import above), so
// other cards get this instead of a fresh `new Set()` on every render.
const EMPTY_PR_SET_IDS: Set<string> = new Set()

function SessionExerciseCard({
  sessionExercise,
  sets,
  sessionId,
  isCurrent,
  prSetIds,
  onSelect,
  onRemove,
}: {
  sessionExercise: SessionExerciseRow
  sets: SetRow[]
  sessionId: string
  isCurrent: boolean
  prSetIds: Set<string>
  onSelect: () => void
  onRemove: (sessionExerciseId: string) => Promise<void>
}) {
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [removing, setRemoving] = useState(false)

  // The full previous-session performance for this exercise (all sets: reps × weight + rest),
  // reactively — so the card shows exactly what to match/beat, set by set. Empty when it's never
  // been done before (or only in this session).
  const lastSessionSets = useLastSessionSets(sessionExercise.exercise_id, sessionId)

  const handleConfirmRemove = useCallback(async () => {
    setRemoving(true)
    try {
      await onRemove(sessionExercise.id)
      // No need to reset confirmingRemove/removing on success — the removed row disappears
      // reactively (via SESSION_EXERCISES_QUERY), so this component unmounts.
    } finally {
      setRemoving(false)
    }
  }, [onRemove, sessionExercise.id])

  return (
    <View
      style={[styles.exerciseCard, isCurrent && styles.exerciseCardCurrent]}
      testID={`session-exercise-${sessionExercise.id}`}
    >
      <Pressable accessibilityRole="button" onPress={onSelect} style={styles.exerciseCardBody}>
        <Text size="md" style={styles.exerciseName}>
          {sessionExercise.name}
        </Text>
        {sets.length === 0 ? (
          <Text muted size="sm">
            No sets yet
          </Text>
        ) : (
          sets.map((s) => (
            <View key={s.id} style={styles.setRow}>
              <Text muted size="sm" testID={`set-row-${s.id}`}>
                Set {s.set_index + 1}: {s.reps} × {s.weight_kg}kg
                {s.actual_rest_seconds != null ? ` · rest ${s.actual_rest_seconds}s` : ''}
              </Text>
              {prSetIds.has(s.id) ? (
                <Text size="sm" style={styles.prBadge} testID="pr-badge">
                  New PR! 🏆
                </Text>
              ) : null}
            </View>
          ))
        )}

        {lastSessionSets.length > 0 ? (
          <View style={styles.lastTimeBlock} testID={`last-time-${sessionExercise.id}`}>
            <Text size="sm" muted style={styles.lastTimeHeading}>
              Last time
            </Text>
            {lastSessionSets.map((ls) => (
              <Text key={ls.setIndex} size="sm" muted testID={`last-time-set-${sessionExercise.id}-${ls.setIndex}`}>
                Set {ls.setIndex + 1}: {ls.reps} × {ls.weightKg}kg
                {ls.actualRestSeconds != null ? ` · rest ${formatMmSs(ls.actualRestSeconds)}` : ''}
              </Text>
            ))}
          </View>
        ) : null}
      </Pressable>

      {confirmingRemove ? (
        <View style={styles.rowButtons}>
          <Button
            title="Confirm remove"
            variant="secondary"
            onPress={handleConfirmRemove}
            loading={removing}
            testID={`remove-exercise-confirm-${sessionExercise.id}`}
          />
          <Button
            title="Cancel"
            variant="secondary"
            onPress={() => setConfirmingRemove(false)}
            testID={`remove-exercise-cancel-${sessionExercise.id}`}
          />
        </View>
      ) : (
        <Button
          title="Remove"
          variant="secondary"
          onPress={() => setConfirmingRemove(true)}
          testID={`remove-exercise-toggle-${sessionExercise.id}`}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  exerciseList: {
    gap: spacing.sm,
  },
  exerciseCard: {
    minHeight: minTapTarget,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  exerciseCardCurrent: {
    borderColor: colors.accent,
  },
  exerciseCardBody: {
    gap: spacing.xs,
  },
  exerciseName: {
    fontWeight: '700',
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  prBadge: {
    color: colors.accent,
    fontWeight: '700',
  },
  lastTimeBlock: {
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 2,
  },
  lastTimeHeading: {
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  inlineForm: {
    gap: spacing.sm,
  },
  rowButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  divergenceBox: {
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  divergenceTitle: {
    fontWeight: '700',
  },
  logForm: {
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  restBox: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.accent,
  },
})
