// Route: /dashboard (Milestone 6 Task B2). Per-exercise progression chart + personal records.
// Composes the B1 hooks (session/dashboard/*-query.ts): usePerformedExercises() drives an
// exercise-chip selector (defaulting to the first exercise alphabetically), useProgression(id)
// feeds the ProgressionChart for whichever chip + weight/e1rm toggle is selected, and
// usePersonalRecords() lists every exercise's current bests. All three are reactive
// @powersync/react useQuery wrappers, so logging a new set anywhere updates this screen live —
// no manual refetch, no reload. Empty state (no exercise ever logged) shows in place of the
// selector + chart + records.
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'
import { ProgressionChart } from '@/dashboard/ProgressionChart'
import { usePerformedExercises } from '@/dashboard/performed-exercises-query'
import { usePersonalRecords } from '@/dashboard/personal-records-query'
import { useProgression } from '@/dashboard/progression-query'
import { Button, Heading, Screen, Text, colors, minTapTarget, radii, spacing } from '@/ui'

type Metric = 'weight' | 'e1rm'

export default function Dashboard() {
  const router = useRouter()
  const { data: exercises, isLoading: exercisesLoading } = usePerformedExercises()
  const { data: records, isLoading: recordsLoading } = usePersonalRecords()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [metric, setMetric] = useState<Metric>('weight')

  // Default-select the first exercise once the list loads; if the currently-selected exercise
  // disappears (e.g. its only sets get deleted elsewhere), fall back to the new first one rather
  // than pointing at a chip that no longer exists.
  useEffect(() => {
    if (exercises.length === 0) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !exercises.some((e) => e.id === selectedId)) {
      setSelectedId(exercises[0].id)
    }
  }, [exercises, selectedId])

  const points = useProgression(selectedId)

  const isEmpty = !exercisesLoading && exercises.length === 0

  return (
    <Screen centered={false}>
      <View style={styles.header}>
        <Button
          title="Back"
          variant="secondary"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          testID="dashboard-back"
        />
        <Heading size="lg" testID="dashboard-heading">
          Dashboard
        </Heading>
      </View>

      {exercisesLoading ? (
        <Text muted testID="dashboard-loading">
          Loading…
        </Text>
      ) : isEmpty ? (
        <Text muted testID="dashboard-empty">
          Log some sets to see your progress.
        </Text>
      ) : (
        <>
          <View style={styles.chipRow} testID="exercise-chips">
            {exercises.map((exercise) => (
              <Pressable
                key={exercise.id}
                accessibilityRole="button"
                onPress={() => setSelectedId(exercise.id)}
                style={[styles.chip, exercise.id === selectedId && styles.chipSelected]}
                testID={`exercise-chip-${exercise.id}`}
              >
                <Text size="sm" style={exercise.id === selectedId ? styles.chipTextSelected : undefined}>
                  {exercise.name}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.toggleRow} testID="metric-toggle">
            <Pressable
              accessibilityRole="button"
              onPress={() => setMetric('weight')}
              style={[styles.toggleOption, metric === 'weight' && styles.toggleOptionSelected]}
              testID="metric-toggle-weight"
            >
              <Text size="sm" style={metric === 'weight' ? styles.chipTextSelected : undefined}>
                Weight
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setMetric('e1rm')}
              style={[styles.toggleOption, metric === 'e1rm' && styles.toggleOptionSelected]}
              testID="metric-toggle-e1rm"
            >
              <Text size="sm" style={metric === 'e1rm' ? styles.chipTextSelected : undefined}>
                Est. 1RM
              </Text>
            </Pressable>
          </View>

          <ProgressionChart points={points} metric={metric} />

          <Heading size="lg" testID="records-heading">
            Personal records
          </Heading>

          {recordsLoading ? (
            <Text muted testID="records-loading">
              Loading…
            </Text>
          ) : records.length === 0 ? (
            <Text muted testID="records-empty">
              No records yet.
            </Text>
          ) : (
            <View style={styles.list} testID="records-list">
              {records.map((record) => (
                <View key={record.exerciseId} style={styles.card} testID={`record-row-${record.exerciseId}`}>
                  <Text size="md" style={styles.name} testID={`record-name-${record.exerciseId}`}>
                    {record.name}
                  </Text>
                  <Text muted size="sm" testID={`record-best-weight-${record.exerciseId}`}>
                    Best weight: {formatKg(record.best.bestWeightKg)} kg × {record.best.bestWeightReps}
                  </Text>
                  <Text muted size="sm" testID={`record-best-e1rm-${record.exerciseId}`}>
                    Best est. 1RM: {formatKg(record.best.bestEstimatedOneRepMax)} kg
                  </Text>
                  <Text muted size="sm" testID={`record-best-volume-${record.exerciseId}`}>
                    Best set volume: {formatKg(record.best.bestSetVolume)} kg ({record.best.bestSetVolumeWeightKg} kg ×{' '}
                    {record.best.bestSetVolumeReps})
                  </Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </Screen>
  )
}

function formatKg(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    minHeight: minTapTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  chipTextSelected: {
    color: colors.textOnAccent,
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  toggleOption: {
    minHeight: minTapTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toggleOptionSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  list: {
    gap: spacing.sm,
  },
  card: {
    minHeight: minTapTarget,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  name: {
    fontWeight: '700',
  },
})
