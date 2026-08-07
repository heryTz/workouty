// Dependency-free per-exercise progression bar chart (Milestone 6 Task B2): one bar per session,
// height proportional to the selected metric normalized to the series max, newest bar labelled
// with its value, horizontal scroll for long histories. Plain Views only (no react-native-svg, no
// charting lib) so web and Android render identically — see task-B2-brief.md Step 1.
import { ScrollView, View } from 'react-native'
import type { ProgressionPoint, SetMetric } from '@workouty/shared'
import { Text, theme } from '@/ui'

// Every PR dimension except set volume, which computeProgression does not collapse a session to.
export type ChartMetric = Exclude<SetMetric, 'setVolume'>

export interface ProgressionChartProps {
  points: ProgressionPoint[]
  metric: ChartMetric
}

const CHART_HEIGHT = 160

function valueOf(point: ProgressionPoint, metric: ChartMetric): number | null {
  switch (metric) {
    case 'weight':
      return point.topWeightKg
    case 'estimatedOneRepMax':
      return point.bestEstimatedOneRepMax
    case 'reps':
      return point.bestReps
    case 'duration':
      return point.bestDurationSeconds
  }
}

export function ProgressionChart({ points, metric }: ProgressionChartProps) {
  // A session contributes a bar only if it has a value for THIS metric. Sessions predating a
  // change of measurement carry null for the new series, and plotting those as zero would invent
  // a dip the user never trained.
  const bars = points.flatMap((point) => {
    const value = valueOf(point, metric)
    return value === null ? [] : [{ point, value }]
  })

  if (bars.length === 0) {
    return <Text testID="progression-chart-empty">No sets logged for this exercise yet.</Text>
  }

  const max = Math.max(...bars.map((b) => b.value))
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} testID="progression-chart">
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: CHART_HEIGHT, gap: 8 }}>
        {bars.map(({ point, value }, i) => {
          const h = max > 0 ? Math.max(4, (value / max) * (CHART_HEIGHT - 24)) : 4
          const isLast = i === bars.length - 1
          return (
            <View key={point.sessionId} style={{ alignItems: 'center', justifyContent: 'flex-end' }}>
              <Text style={{ fontSize: 11 }}>{isLast ? Math.round(value) : ''}</Text>
              <View
                testID={`bar-${i}`}
                style={{ width: 24, height: h, backgroundColor: theme.colors.accent, borderRadius: 4 }}
              />
            </View>
          )
        })}
      </View>
    </ScrollView>
  )
}
