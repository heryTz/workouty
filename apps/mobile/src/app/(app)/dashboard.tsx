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
import { DEFAULT_MEASUREMENT, metricsFor, type ExerciseMeasurement } from '@workouty/shared'
import { ProgressionChart, type ChartMetric } from '@/dashboard/ProgressionChart'
import { usePerformedExercises } from '@/dashboard/performed-exercises-query'
import { usePersonalRecords, type ExerciseRecord } from '@/dashboard/personal-records-query'
import { useProgression } from '@/dashboard/progression-query'
import { Button, Heading, Screen, Text, colors, minTapTarget, radii, spacing } from '@/ui'

const METRIC_LABELS: Record<ChartMetric, string> = {
  weight: 'Weight',
  estimatedOneRepMax: 'Est. 1RM',
  reps: 'Reps',
  duration: 'Hold',
}

// The series this exercise can plot, best-first — the head of the list is what the chart opens on.
//
// An external exercise leads with the load it moves. A bodyweight one leads with its MEASURE,
// because its weight column is the ADDED load: opening a push-up on "Weight" draws a flat line at
// zero for anyone who isn't hanging plates off themselves, which is the least informative view of
// the exercise and exactly the one it used to default to.
function chartMetricsFor(measurement: ExerciseMeasurement): ChartMetric[] {
  const applicable = metricsFor(measurement)
  const order: ChartMetric[] =
    measurement.loadType === 'bodyweight'
      ? ['reps', 'duration', 'weight', 'estimatedOneRepMax']
      : ['weight', 'estimatedOneRepMax', 'reps', 'duration']
  return order.filter((m) => applicable.has(m))
}

export default function Dashboard() {
  const router = useRouter()
  const { data: exercises, isLoading: exercisesLoading } = usePerformedExercises()
  const { data: records, isLoading: recordsLoading } = usePersonalRecords()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  // What the user last tapped, not the metric in force. Which series is worth opening on is a
  // property of the exercise rather than a preference to carry across them, so this is cleared
  // whenever the selection changes and the derived `metric` falls back to the exercise's default.
  // Holding it this way instead of resetting state from an effect keeps the fallback impossible
  // to miss: a metric that does not apply simply never survives the derivation.
  const [metricOverride, setMetricOverride] = useState<ChartMetric | null>(null)

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

  // Which series the selected exercise can plot. `records` is keyed by the same exercises the
  // chips come from, so a miss only happens on the render between selecting a chip and the
  // records query catching up — the pre-0003 default is the right assumption for that frame.
  const availableMetrics = useMemo(() => {
    const measurement = records.find((r) => r.exerciseId === selectedId)?.measurement ?? DEFAULT_MEASUREMENT
    return chartMetricsFor(measurement)
  }, [records, selectedId])

  // An override only counts while the selected exercise actually offers it, so selecting a plank
  // with "Est. 1RM" active can't leave the toggle pointing at a series that has no values — which
  // would render the chart's empty state as though nothing had ever been logged.
  const metric =
    metricOverride && availableMetrics.includes(metricOverride) ? metricOverride : (availableMetrics[0] ?? 'weight')

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
                onPress={() => {
                  setSelectedId(exercise.id)
                  setMetricOverride(null)
                }}
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
            {availableMetrics.map((option) => (
              <Pressable
                key={option}
                accessibilityRole="button"
                onPress={() => setMetricOverride(option)}
                style={[styles.toggleOption, metric === option && styles.toggleOptionSelected]}
                testID={`metric-toggle-${option}`}
              >
                <Text size="sm" style={metric === option ? styles.chipTextSelected : undefined}>
                  {METRIC_LABELS[option]}
                </Text>
              </Pressable>
            ))}
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
                    {formatBestWeight(record)}
                  </Text>
                  {record.best.bestReps !== null && (
                    <Text muted size="sm" testID={`record-best-reps-${record.exerciseId}`}>
                      Best reps: {record.best.bestReps}
                    </Text>
                  )}
                  {record.best.bestDurationSeconds !== null && (
                    <Text muted size="sm" testID={`record-best-duration-${record.exerciseId}`}>
                      Longest hold: {record.best.bestDurationSeconds} s
                    </Text>
                  )}
                  {record.best.bestEstimatedOneRepMax !== null && (
                    <Text muted size="sm" testID={`record-best-e1rm-${record.exerciseId}`}>
                      Best est. 1RM: {formatKg(record.best.bestEstimatedOneRepMax)} kg
                    </Text>
                  )}
                  {record.best.bestSetVolume !== null && (
                    <Text muted size="sm" testID={`record-best-volume-${record.exerciseId}`}>
                      Best set volume: {formatKg(record.best.bestSetVolume)} kg ({record.best.bestSetVolumeWeightKg} kg ×{' '}
                      {record.best.bestSetVolumeReps})
                    </Text>
                  )}
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

// "Best weight" reads differently per exercise: 100 kg × 5 on a bench press is the load lifted,
// whereas +10 kg × 60 s on a plank is what was strapped on top of the user. An unweighted
// bodyweight best is not worth a line at all — "Best weight: 0 kg" is noise.
function formatBestWeight({ measurement, best }: ExerciseRecord): string {
  const performance = best.bestWeightReps !== null ? `× ${best.bestWeightReps}` : `× ${best.bestWeightDurationSeconds} s`
  if (measurement.loadType === 'external') {
    return `Best weight: ${formatKg(best.bestWeightKg)} kg ${performance}`
  }
  if (best.bestWeightKg === 0) return 'Bodyweight only'
  return `Best added weight: +${formatKg(best.bestWeightKg)} kg ${performance}`
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
