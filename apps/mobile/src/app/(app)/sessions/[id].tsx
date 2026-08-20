// Route: /sessions/[id] — a finished workout. Reached by tapping a card on the history list
// (sessions/index.tsx).
//
// The counterpart to /session/[id], which is the ACTIVE-session screen and stays that: a live
// elapsed clock, a log-set form, a rest countdown, Finish. What this screen adds instead is
// correction after the fact — each logged set can be edited (reps or hold, and weight) or deleted,
// for the miscount you only notice once the workout is over. A session that's still running is not
// an error to land on: it renders the same way, says "In progress" instead of a duration, offers
// Resume through to the active screen, and its sets are editable here too.
//
// Everything else on the screen recomputes itself from the same reactive queries, so an edit or a
// deletion moves the summary's set count and tonnage without any refresh of our own.
//
// An exercise on the card can also be swapped for another logged the same way — see
// session/exercise-swap.ts for why load_type + measure is the boundary, and
// changeSessionExercise in session/session-writes.ts for why the logged sets come along
// untouched.
//
// PR badges mean "was a record when you did it", not "still is". markPersonalRecords flags a set
// that strictly beat every EARLIER set (see packages/shared/src/personal-records.ts), so the
// badges on an old session read as the history they are, and a later, heavier session doesn't
// silently un-badge the day you set the record.
import { useCallback, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'
import { useAuth } from '@/auth/useAuth'
import { usePrSetIds } from '@/dashboard/pr-set-ids-query'
import { usePowerSyncApp } from '@/powersync/PowerSyncProvider'
import {
  useSessionDetail,
  type DetailExerciseRow,
  type DetailSetRow,
  type SessionDetailRow,
} from '@/session/session-detail-query'
import { formatVolumeKg, sessionTotals } from '@/session/session-detail'
import {
  formatSessionDate,
  formatSessionDuration,
  formatSessionTime,
  sessionDurationSeconds,
} from '@/session/session-history'
import { formatSetPerformance } from '@/session/set-format'
import { useSwapCandidates, type SwapCandidateRow } from '@/session/exercise-swap'
import { changeSessionExercise, deleteSet, updateSet } from '@/session/session-writes'
import { createTemplateFromSession } from '@/session/template-writes'
import { formatMmSs } from '@/session/timers'
import { Button, Field, Heading, Screen, Text, colors, minTapTarget, radii, spacing } from '@/ui'

export default function SessionDetail() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { userId } = useAuth()
  const { db } = usePowerSyncApp()

  const { session, exercises, setsByExercise, sets, isLoading } = useSessionDetail(sessionId)
  const totals = sessionTotals(exercises.length, sets)

  const [savingTemplateOpen, setSavingTemplateOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [savingTemplateBusy, setSavingTemplateBusy] = useState(false)
  const [savedTemplate, setSavedTemplate] = useState(false)

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back()
    else router.replace('/sessions')
  }, [router])

  const handleSaveAsTemplate = useCallback(async () => {
    const trimmed = templateName.trim()
    if (!userId || !trimmed) return
    setSavingTemplateBusy(true)
    try {
      await createTemplateFromSession(db, { userId, sessionId, name: trimmed })
      setSavingTemplateOpen(false)
      setTemplateName('')
      setSavedTemplate(true)
    } finally {
      setSavingTemplateBusy(false)
    }
  }, [db, userId, sessionId, templateName])

  return (
    <Screen centered={false}>
      <View style={styles.header}>
        <Button title="Back" variant="secondary" onPress={handleBack} testID="session-detail-back" />
        <Heading size="lg" testID="session-detail-heading">
          Session
        </Heading>
      </View>

      {isLoading && !session ? (
        <Text muted testID="session-detail-loading">
          Loading…
        </Text>
      ) : !session ? (
        <Text muted testID="session-detail-missing">
          This session no longer exists.
        </Text>
      ) : (
        <>
          <SessionSummary session={session} totals={totals} />

          {session.ended_at === null ? (
            <Button
              title="Resume session"
              onPress={() => router.replace({ pathname: '/session/[id]', params: { id: sessionId } })}
              testID="session-detail-resume"
            />
          ) : null}

          <View style={styles.exerciseList} testID="session-detail-exercise-list">
            {exercises.length === 0 ? (
              <Text muted testID="session-detail-exercise-empty">
                No exercises were logged in this session.
              </Text>
            ) : (
              exercises.map((exercise) => (
                <PerformedExerciseCard
                  key={exercise.id}
                  exercise={exercise}
                  sets={setsByExercise.get(exercise.id) ?? []}
                />
              ))
            )}
          </View>

          {savingTemplateOpen ? (
            <View style={styles.inlineForm} testID="session-detail-save-template-form">
              <Field
                label="Template name"
                value={templateName}
                onChangeText={setTemplateName}
                testID="session-detail-save-template-name-field"
              />
              <View style={styles.rowButtons}>
                <Button
                  title="Save"
                  onPress={handleSaveAsTemplate}
                  loading={savingTemplateBusy}
                  testID="session-detail-save-template-confirm"
                />
                <Button
                  title="Cancel"
                  variant="secondary"
                  onPress={() => {
                    setSavingTemplateOpen(false)
                    setTemplateName('')
                  }}
                  testID="session-detail-save-template-cancel"
                />
              </View>
            </View>
          ) : (
            <Button
              title="Save as template"
              variant="secondary"
              onPress={() => {
                setSavedTemplate(false)
                setSavingTemplateOpen(true)
              }}
              testID="session-detail-save-template-toggle"
            />
          )}

          {savedTemplate ? (
            <Text muted size="sm" testID="session-detail-save-template-done">
              Saved to your templates.
            </Text>
          ) : null}
        </>
      )}
    </Screen>
  )
}

function SessionSummary({
  session,
  totals,
}: {
  session: SessionDetailRow
  totals: ReturnType<typeof sessionTotals>
}) {
  const durationSeconds = sessionDurationSeconds(session.started_at, session.ended_at)
  const duration = durationSeconds === null ? 'In progress' : formatSessionDuration(durationSeconds)

  return (
    <View style={styles.summary} testID="session-detail-summary">
      <Text size="md" style={styles.summaryDate} testID="session-detail-date">
        {formatSessionDate(session.started_at)}
      </Text>
      <Text muted size="sm" testID="session-detail-meta">
        {formatSessionTime(session.started_at)} · {duration}
      </Text>
      {session.template_name ? (
        <Text muted size="sm" testID="session-detail-template">
          {session.template_name}
        </Text>
      ) : null}
      <Text size="sm" testID="session-detail-totals">
        {totals.exerciseCount} {totals.exerciseCount === 1 ? 'exercise' : 'exercises'} · {totals.setCount}{' '}
        {totals.setCount === 1 ? 'set' : 'sets'}
        {/* A bodyweight-only session has no tonnage to report, and "0 kg" would read as a
            measurement rather than as "this metric doesn't apply here". */}
        {totals.totalVolumeKg > 0 ? ` · ${formatVolumeKg(totals.totalVolumeKg)}` : ''}
      </Text>
    </View>
  )
}

function PerformedExerciseCard({ exercise, sets }: { exercise: DetailExerciseRow; sets: DetailSetRow[] }) {
  const prSetIds = usePrSetIds(exercise.exercise_id)
  const [swapping, setSwapping] = useState(false)

  return (
    <View style={styles.exerciseCard} testID={`session-detail-exercise-${exercise.id}`}>
      <Text size="md" style={styles.exerciseName}>
        {exercise.name}
      </Text>
      {sets.length === 0 ? (
        <Text muted size="sm">
          No sets logged
        </Text>
      ) : (
        sets.map((s) => (
          <PerformedSetRow key={s.id} exercise={exercise} set={s} isPr={prSetIds.has(s.id)} />
        ))
      )}
      {swapping ? (
        <ExerciseSwapPicker exercise={exercise} onDone={() => setSwapping(false)} />
      ) : (
        <Button
          title="Change exercise"
          variant="secondary"
          onPress={() => setSwapping(true)}
          testID={`session-detail-exercise-swap-${exercise.id}`}
        />
      )}
    </View>
  )
}

// The replacement list, expanded in place on the card. Only exercises logged the same way appear
// (see exercise-swap.ts), so picking one is a rename of what the slot was, never a reinterpretation
// of the sets under it — which is why it commits on a single tap with no confirmation step.
function ExerciseSwapPicker({ exercise, onDone }: { exercise: DetailExerciseRow; onDone: () => void }) {
  const { db } = usePowerSyncApp()
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)

  const { candidates, isLoading } = useSwapCandidates({
    loadType: exercise.load_type,
    measure: exercise.measure,
    excludeExerciseId: exercise.exercise_id,
    muscleGroup: exercise.muscle_group,
    search,
  })

  const handlePick = useCallback(
    async (candidate: SwapCandidateRow) => {
      setBusy(true)
      try {
        await changeSessionExercise(db, { sessionExerciseId: exercise.id, exerciseId: candidate.id })
        onDone()
      } finally {
        setBusy(false)
      }
    },
    [db, exercise.id, onDone],
  )

  return (
    <View style={styles.swapPicker} testID={`session-detail-swap-picker-${exercise.id}`}>
      <Field
        label="Replace with"
        placeholder="Search exercises"
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        testID={`session-detail-swap-search-${exercise.id}`}
      />
      {isLoading ? (
        <Text muted size="sm" testID={`session-detail-swap-loading-${exercise.id}`}>
          Loading…
        </Text>
      ) : candidates.length === 0 ? (
        <Text muted size="sm" testID={`session-detail-swap-empty-${exercise.id}`}>
          No other exercise is logged the same way.
        </Text>
      ) : (
        candidates.map((candidate) => (
          <Pressable
            key={candidate.id}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => handlePick(candidate)}
            style={styles.swapRow}
            testID={`session-detail-swap-option-${exercise.id}-${candidate.id}`}
          >
            <Text size="md">{candidate.name}</Text>
            <Text muted size="sm">
              {candidate.muscle_group}
              {candidate.is_custom ? ' · custom' : ''}
            </Text>
          </Pressable>
        ))
      )}
      <Button
        title="Cancel"
        variant="secondary"
        onPress={onDone}
        testID={`session-detail-swap-cancel-${exercise.id}`}
      />
    </View>
  )
}

// One logged set: its performance line, and — once "Edit" is tapped — the fields to correct it.
// The reps/duration split is the exercise's `measure`, exactly as it was when the set was logged,
// and the validation matches the active screen's log-set form so a set can't be edited into a
// shape that form would have refused to create.
function PerformedSetRow({
  exercise,
  set,
  isPr,
}: {
  exercise: DetailExerciseRow
  set: DetailSetRow
  isPr: boolean
}) {
  const { db } = usePowerSyncApp()
  const isHold = exercise.measure === 'duration'

  const [editing, setEditing] = useState(false)
  const [effort, setEffort] = useState('')
  const [weight, setWeight] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleOpenEdit = useCallback(() => {
    setEffort(String((isHold ? set.duration_seconds : set.reps) ?? ''))
    setWeight(String(set.weight_kg))
    setConfirmingDelete(false)
    setEditing(true)
  }, [isHold, set.duration_seconds, set.reps, set.weight_kg])

  const handleSave = useCallback(async () => {
    const effortNum = Number(effort)
    if (!Number.isInteger(effortNum) || effortNum <= 0) return
    // Blank weight means 0 — right for an unweighted bodyweight set, same as when logging one.
    const weightNum = Number(weight)
    if (!Number.isFinite(weightNum) || weightNum < 0) return

    setBusy(true)
    try {
      await updateSet(db, {
        setId: set.id,
        reps: isHold ? null : effortNum,
        durationSeconds: isHold ? effortNum : null,
        weightKg: weightNum,
      })
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }, [db, effort, isHold, set.id, weight])

  const handleDelete = useCallback(async () => {
    setBusy(true)
    try {
      await deleteSet(db, { setId: set.id })
    } finally {
      setBusy(false)
    }
  }, [db, set.id])

  if (editing) {
    return (
      <View style={styles.setEditor} testID={`session-detail-set-editor-${set.id}`}>
        <Text muted size="sm">
          Set {set.set_index + 1}
        </Text>
        <Field
          label={isHold ? 'Duration (s)' : 'Reps'}
          value={effort}
          onChangeText={setEffort}
          keyboardType="number-pad"
          testID={`session-detail-set-effort-${set.id}`}
        />
        <Field
          label={exercise.load_type === 'bodyweight' ? 'Added weight (kg)' : 'Weight (kg)'}
          value={weight}
          onChangeText={setWeight}
          keyboardType="decimal-pad"
          placeholder={exercise.load_type === 'bodyweight' ? '0' : undefined}
          testID={`session-detail-set-weight-${set.id}`}
        />
        <View style={styles.rowButtons}>
          <Button title="Save" onPress={handleSave} loading={busy} testID={`session-detail-set-save-${set.id}`} />
          <Button
            title="Cancel"
            variant="secondary"
            onPress={() => {
              setEditing(false)
              setConfirmingDelete(false)
            }}
            testID={`session-detail-set-cancel-${set.id}`}
          />
        </View>
        {/* Two-step inline confirm rather than a native Alert — deleting a set is not undoable, and
            an on-screen confirmation stays scriptable in the web build. */}
        {confirmingDelete ? (
          <View style={styles.rowButtons}>
            <Button
              title="Confirm delete"
              variant="secondary"
              onPress={handleDelete}
              loading={busy}
              testID={`session-detail-set-delete-confirm-${set.id}`}
            />
            <Button
              title="Keep set"
              variant="secondary"
              onPress={() => setConfirmingDelete(false)}
              testID={`session-detail-set-delete-cancel-${set.id}`}
            />
          </View>
        ) : (
          <Button
            title="Delete set"
            variant="secondary"
            onPress={() => setConfirmingDelete(true)}
            testID={`session-detail-set-delete-${set.id}`}
          />
        )}
      </View>
    )
  }

  return (
    <View style={styles.setRow}>
      <Text muted size="sm" style={styles.setText} testID={`session-detail-set-${set.id}`}>
        Set {set.set_index + 1}:{' '}
        {formatSetPerformance(exercise, {
          reps: set.reps,
          durationSeconds: set.duration_seconds,
          weightKg: set.weight_kg,
        })}
        {set.actual_rest_seconds != null ? ` · rest ${formatMmSs(set.actual_rest_seconds)}` : ''}
      </Text>
      {isPr ? (
        <Text size="sm" style={styles.prBadge} testID={`session-detail-pr-${set.id}`}>
          PR 🏆
        </Text>
      ) : null}
      <Button
        title="Edit"
        variant="secondary"
        onPress={handleOpenEdit}
        testID={`session-detail-set-edit-${set.id}`}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  summary: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  summaryDate: {
    fontWeight: '700',
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
  exerciseName: {
    fontWeight: '700',
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  setText: {
    flex: 1,
  },
  swapPicker: {
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  swapRow: {
    minHeight: minTapTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  setEditor: {
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  prBadge: {
    color: colors.accent,
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
})
