// Dependency-free per-exercise progression bar chart (Milestone 6 Task B2): one bar per session,
// height proportional to the selected metric normalized to the series max, newest bar labelled
// with its value, horizontal scroll for long histories. Plain Views only (no react-native-svg, no
// charting lib) so web and Android render identically — see task-B2-brief.md Step 1.
import { ScrollView, View } from 'react-native'
import type { ProgressionPoint } from '@workouty/shared'
import { Text, theme } from '@/ui'

export interface ProgressionChartProps {
  points: ProgressionPoint[]
  metric: 'weight' | 'e1rm'
}

const CHART_HEIGHT = 160

export function ProgressionChart({ points, metric }: ProgressionChartProps) {
  if (points.length === 0) {
    return <Text testID="progression-chart-empty">No sets logged for this exercise yet.</Text>
  }
  const value = (p: ProgressionPoint) => (metric === 'weight' ? p.topWeightKg : p.bestEstimatedOneRepMax)
  const max = Math.max(...points.map(value))
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} testID="progression-chart">
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: CHART_HEIGHT, gap: 8 }}>
        {points.map((p, i) => {
          const v = value(p)
          const h = max > 0 ? Math.max(4, (v / max) * (CHART_HEIGHT - 24)) : 4
          const isLast = i === points.length - 1
          return (
            <View key={p.sessionId} style={{ alignItems: 'center', justifyContent: 'flex-end' }}>
              <Text style={{ fontSize: 11 }}>{isLast ? Math.round(v) : ''}</Text>
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
