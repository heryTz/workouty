// The affordance that opens /exercise-preview for an exercise. Shared because three screens show
// an exercise name — the picker, the active session, and a past session's detail — and all three
// should reach the same place the same way.
//
// Always rendered, whether or not a drawing exists: coverage is partial by design (see
// exercise-illustrations.ts) and an affordance that appears on some rows and not others reads as
// a bug. The preview screen owns the "nothing to show" case.
import { useRouter } from 'expo-router'
import { Pressable, StyleSheet } from 'react-native'
import { Text, colors, minTapTarget, spacing } from '@/ui'

export function useOpenExercisePreview() {
  const router = useRouter()
  // Object form, so expo-router encodes the name — exercise names carry spaces and parentheses,
  // and a custom one carries whatever the user typed.
  return (name: string) => router.push({ pathname: '/exercise-preview', params: { name } })
}

export type ExercisePreviewLinkProps = {
  name: string
  testID: string
}

export function ExercisePreviewLink({ name, testID }: ExercisePreviewLinkProps) {
  const openPreview = useOpenExercisePreview()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`How to perform ${name}`}
      onPress={() => openPreview(name)}
      style={styles.link}
      testID={testID}
    >
      <Text size="sm" style={styles.linkText}>
        How to
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  link: {
    minHeight: minTapTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  linkText: {
    color: colors.accent,
  },
})
