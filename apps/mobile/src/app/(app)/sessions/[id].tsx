// Route: /sessions/[id] — a finished workout, read-only. Reached by tapping a card on the history
// list (sessions/index.tsx).
//
// The counterpart to /session/[id], which is the ACTIVE-session screen and stays that: a live
// elapsed clock, a log-set form, a rest countdown, Finish. Nothing here can change what was
// performed — that record is closed — so the only control is "Save as template", which reads the
// session's exercises and writes a NEW row elsewhere rather than touching this one. A session
// that's still running is not an error to land on: it renders the same way, says "In progress"
// instead of a duration, and offers Resume through to the active screen.
//
// PR badges mean "was a record when you did it", not "still is". markPersonalRecords flags a set
// that strictly beat every EARLIER set (see packages/shared/src/personal-records.ts), so the
// badges on an old session read as the history they are, and a later, heavier session doesn't
// silently un-badge the day you set the record.
import { useCallback, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { StyleSheet, View } from 'react-native'
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
          <View key={s.id} style={styles.setRow}>
            <Text muted size="sm" testID={`session-detail-set-${s.id}`}>
              Set {s.set_index + 1}:{' '}
              {formatSetPerformance(exercise, {
                reps: s.reps,
                durationSeconds: s.duration_seconds,
                weightKg: s.weight_kg,
              })}
              {s.actual_rest_seconds != null ? ` · rest ${formatMmSs(s.actual_rest_seconds)}` : ''}
            </Text>
            {prSetIds.has(s.id) ? (
              <Text size="sm" style={styles.prBadge} testID={`session-detail-pr-${s.id}`}>
                PR 🏆
              </Text>
            ) : null}
          </View>
        ))
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
