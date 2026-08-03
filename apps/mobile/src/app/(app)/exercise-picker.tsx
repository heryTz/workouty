// Route: /exercise-picker (Milestone 4 Task C1). Reactive, searchable exercise picker: shows
// the built-in library seeded server-side (infra/postgres/seed-exercises.sql) plus the user's
// own custom exercises (session/exercises.ts's useExercises — see that file for why no
// user_id filter is needed and how the recents-then-grouped ordering works), with an
// add-custom affordance.
//
// Session mode (Milestone 4 Task D2): when navigated to with a `sessionId` param (from the
// active-session screen's "Add exercise" button — see ../session/[id].tsx), selecting a row
// inserts a `session_exercises` row for that session right here (position = current count) and
// navigates back, rather than just logging the selection. This sidesteps threading a return
// value back through expo-router (there's no built-in "pop with a result" — see the session
// screen's header comment for why it doesn't need one anyway: it reactively picks up the new row
// via its own useQuery once we're back). Without a `sessionId` param (reached directly, e.g. by
// URL), selecting a row is still just a visual highlight + console.log, as before.
//
// Duplicate-name rejection: PowerSyncProvider's `lastRejected` (see ../../powersync/
// PowerSyncProvider.tsx) fires at upload-BATCH granularity with the server's per-op verdicts,
// keyed by the op's client-generated id — not by name, and the optimistic local row is already
// gone by the time it fires (proved in roundtrip.node.test.ts's REJECTION case: the local
// materialized view is "synced bucket data UNION pending CRUD queue", and a rejected write has
// neither once its queue entry drains). So `pendingCustomInserts` below maps the id
// addCustomExercise() returned back to the { name, muscleGroup } the user typed, purely so this
// screen can re-surface that same form pre-filled with an error once the rejection arrives.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'
import { useAuth } from '@/auth/useAuth'
import { usePowerSyncApp } from '@/powersync/PowerSyncProvider'
import { addCustomExercise, useExercises, type ExerciseRow } from '@/session/exercises'
import { setExerciseRestPref } from '@/session/rest-prefs'
import { addSessionExercise } from '@/session/session-writes'
import { formatMmSs } from '@/session/timers'
import { Button, Field, Heading, Screen, Text, colors, minTapTarget, radii, spacing } from '@/ui'

// Structural shape of one entry in PowerSyncProvider's `lastRejected` — see
// apps/api/src/sync/upload.service.ts's RejectedOp (the server's actual source of truth) and
// connector.test.ts, which pins this shape against the live upload contract.
interface RejectedOpLike {
  op: string
  table: string
  id: string
  reason: string
}

function isRejectedOpLike(value: unknown): value is RejectedOpLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'table' in value &&
    typeof (value as { id: unknown }).id === 'string' &&
    typeof (value as { table: unknown }).table === 'string'
  )
}

export default function ExercisePicker() {
  const router = useRouter()
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>()
  const { userId } = useAuth()
  const { db, lastRejected } = usePowerSyncApp()

  const [search, setSearch] = useState('')
  const { recents, groups, isLoading } = useExercises(search)

  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [showAddForm, setShowAddForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newMuscleGroup, setNewMuscleGroup] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // id -> what the user submitted, for the rejected exercise ops still "in flight" (neither
  // confirmed nor rejected yet). See the file header comment for why this exists.
  const pendingCustomInserts = useRef(new Map<string, { name: string; muscleGroup: string }>())

  useEffect(() => {
    if (!lastRejected || lastRejected.length === 0) return

    for (const entry of lastRejected) {
      if (!isRejectedOpLike(entry) || entry.table !== 'exercises') continue

      const pending = pendingCustomInserts.current.get(entry.id)
      if (!pending) continue // not one of ours (or already handled)

      pendingCustomInserts.current.delete(entry.id)

      setNewName(pending.name)
      setNewMuscleGroup(pending.muscleGroup)
      setAddError(
        entry.reason === 'conflict'
          ? `"${pending.name}" already exists`
          : `Could not add "${pending.name}": ${entry.reason}`,
      )
      setShowAddForm(true)
      setSaving(false)
    }
  }, [lastRejected])

  // Go back to wherever we came from, but only if there's actually history to pop. The picker is
  // normally push()ed from the session screen (../session/[id].tsx) so back() works — but when it's
  // reached with no stack behind it (a direct URL, or a browser refresh on /exercise-picker), a bare
  // router.back() emits expo-router's "GO_BACK was not handled by any navigator" warning and does
  // nothing. In that case replace() to a real destination: the originating session if we know it,
  // else home.
  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back()
    } else if (sessionId) {
      router.replace({ pathname: '/session/[id]', params: { id: sessionId } })
    } else {
      router.replace('/')
    }
  }, [router, sessionId])

  const handleSelect = useCallback(
    async (exercise: ExerciseRow) => {
      setSelectedId(exercise.id)

      if (sessionId && userId) {
        // Session mode: attach this exercise to the active session and hand control back — see
        // the file header comment for why the session screen doesn't need us to return anything
        // beyond just navigating back (its own reactive query picks up the new row).
        const countRows = await db.getAll<{ cnt: number }>(
          `SELECT COUNT(*) AS cnt FROM session_exercises WHERE session_id = ? AND deleted_at IS NULL`,
          [sessionId],
        )
        const position = countRows[0]?.cnt ?? 0
        await addSessionExercise(db, { userId, sessionId, exerciseId: exercise.id, position })
        goBack()
        return
      }

      console.log('Exercise selected', exercise.id, exercise.name)
    },
    [sessionId, userId, db, goBack],
  )

  const handleToggleAddForm = useCallback(() => {
    setShowAddForm((open) => !open)
    setAddError(null)
  }, [])

  // Persist this user's per-exercise rest override (see session/rest-prefs.ts). Works for built-in
  // and custom exercises alike; the effective rest resolves to COALESCE(pref, default) everywhere.
  const handleSaveRest = useCallback(
    async (exerciseId: string, restSeconds: number) => {
      if (!userId) return
      await setExerciseRestPref(db, { userId, exerciseId, restSeconds })
    },
    [db, userId],
  )

  const handleAddSubmit = useCallback(async () => {
    const name = newName.trim()
    const muscleGroup = newMuscleGroup.trim()
    if (!name || !muscleGroup) {
      setAddError('Name and muscle group are both required')
      return
    }
    if (!userId) {
      setAddError('Not signed in')
      return
    }

    setSaving(true)
    setAddError(null)
    try {
      const id = await addCustomExercise(db, { name, muscleGroup, userId })
      pendingCustomInserts.current.set(id, { name, muscleGroup })
      // Optimistic success: clear + close the form immediately. The new row already shows up
      // via useExercises' reactive query. If the server later rejects it, the effect above
      // re-opens the form with the error and the typed values restored.
      setNewName('')
      setNewMuscleGroup('')
      setShowAddForm(false)
    } finally {
      setSaving(false)
    }
  }, [db, newName, newMuscleGroup, userId])

  return (
    <Screen centered={false}>
      <View style={styles.header}>
        <Button title="Back" variant="secondary" onPress={goBack} testID="picker-back" />
        <Heading size="lg" testID="picker-heading">
          Exercises
        </Heading>
      </View>

      <Field
        label="Search"
        placeholder="Search exercises"
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        testID="picker-search"
      />

      <Button
        title={showAddForm ? 'Cancel' : 'Add custom exercise'}
        variant="secondary"
        onPress={handleToggleAddForm}
        testID="picker-add-toggle"
      />

      {showAddForm ? (
        <View style={styles.addForm} testID="picker-add-form">
          <Field label="Name" value={newName} onChangeText={setNewName} testID="picker-add-name" />
          <Field
            label="Muscle group"
            value={newMuscleGroup}
            onChangeText={setNewMuscleGroup}
            autoCapitalize="none"
            testID="picker-add-muscle-group"
          />
          {addError ? (
            <View style={styles.errorBanner} testID="picker-add-error">
              <Text style={{ color: colors.danger }}>{addError}</Text>
            </View>
          ) : null}
          <Button title="Save" onPress={handleAddSubmit} loading={saving} testID="picker-add-submit" />
        </View>
      ) : null}

      {isLoading ? (
        <Text muted testID="picker-loading">
          Loading…
        </Text>
      ) : (
        <View style={styles.list} testID="picker-list">
          {recents.length === 0 && groups.length === 0 ? (
            <Text muted testID="picker-empty">
              No exercises found
            </Text>
          ) : null}

          {recents.length > 0 ? (
            <View style={styles.group} testID="muscle-group-recent">
              <Text style={styles.groupHeading} size="sm">
                Recent
              </Text>
              {recents.map((exercise) => (
                <ExerciseRowView
                  key={exercise.id}
                  exercise={exercise}
                  selected={exercise.id === selectedId}
                  onPress={handleSelect}
                  onSaveRest={handleSaveRest}
                />
              ))}
            </View>
          ) : null}

          {groups.map((group) => (
            <View key={group.muscleGroup} style={styles.group} testID={`muscle-group-${group.muscleGroup}`}>
              <Text style={styles.groupHeading} size="sm">
                {group.muscleGroup}
              </Text>
              {group.exercises.map((exercise) => (
                <ExerciseRowView
                  key={exercise.id}
                  exercise={exercise}
                  selected={exercise.id === selectedId}
                  onPress={handleSelect}
                  onSaveRest={handleSaveRest}
                />
              ))}
            </View>
          ))}
        </View>
      )}
    </Screen>
  )
}

function ExerciseRowView({
  exercise,
  selected,
  onPress,
  onSaveRest,
}: {
  exercise: ExerciseRow
  selected: boolean
  onPress: (exercise: ExerciseRow) => void
  onSaveRest: (exerciseId: string, restSeconds: number) => Promise<void>
}) {
  const [editingRest, setEditingRest] = useState(false)
  const [restDraft, setRestDraft] = useState('')
  const [restError, setRestError] = useState<string | null>(null)
  const [savingRest, setSavingRest] = useState(false)

  const startEditRest = useCallback(() => {
    setRestDraft(String(exercise.effective_rest_seconds))
    setRestError(null)
    setEditingRest(true)
  }, [exercise.effective_rest_seconds])

  const saveRest = useCallback(async () => {
    const secs = Number(restDraft.trim())
    // Whole seconds, 0..1 hour — rest is a duration, not a rep count; reject anything else.
    if (!Number.isInteger(secs) || secs < 0 || secs > 3600) {
      setRestError('Enter whole seconds (0–3600)')
      return
    }
    setSavingRest(true)
    setRestError(null)
    try {
      await onSaveRest(exercise.id, secs)
      setEditingRest(false)
    } finally {
      setSavingRest(false)
    }
  }, [restDraft, onSaveRest, exercise.id])

  return (
    <View style={styles.exerciseItem}>
      <Pressable
        accessibilityRole="button"
        onPress={() => onPress(exercise)}
        style={[styles.row, selected && styles.rowSelected]}
        testID={`exercise-row-${exercise.id}`}
      >
        <Text size="md">{exercise.name}</Text>
        <Text muted size="sm">
          {exercise.muscle_group}
          {exercise.is_custom ? ' · custom' : ''}
        </Text>
      </Pressable>

      {editingRest ? (
        <View style={styles.restEditor} testID={`rest-editor-${exercise.id}`}>
          <Field
            label="Rest (seconds)"
            value={restDraft}
            onChangeText={setRestDraft}
            keyboardType="number-pad"
            error={restError}
            testID={`rest-input-${exercise.id}`}
          />
          <View style={styles.restEditorButtons}>
            <Button title="Save" onPress={saveRest} loading={savingRest} testID={`rest-save-${exercise.id}`} />
            <Button
              title="Cancel"
              variant="secondary"
              onPress={() => setEditingRest(false)}
              testID={`rest-cancel-${exercise.id}`}
            />
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={startEditRest}
          style={styles.restLine}
          testID={`rest-edit-${exercise.id}`}
        >
          <Text muted size="sm">
            Rest {formatMmSs(exercise.effective_rest_seconds)}
          </Text>
          <Text size="sm" style={styles.restEditLink}>
            Edit
          </Text>
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  addForm: {
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  errorBanner: {
    backgroundColor: colors.dangerBackground,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radii.sm,
    padding: spacing.sm,
  },
  list: {
    gap: spacing.lg,
  },
  group: {
    gap: spacing.xs,
  },
  groupHeading: {
    textTransform: 'uppercase',
    fontWeight: '700',
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  row: {
    minHeight: minTapTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.background,
  },
  exerciseItem: {
    gap: spacing.xs,
  },
  restLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  restEditLink: {
    color: colors.accent,
    fontWeight: '600',
  },
  restEditor: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  restEditorButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
})
