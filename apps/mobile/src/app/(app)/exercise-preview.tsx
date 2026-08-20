// Route: /exercise-preview?name=<exercise name>. Shows how a movement is performed, as the two
// line-art frames everkinetic ships per exercise (start and end position) cross-fading into each
// other.
//
// The param is the NAME, not an exercise id. Built-in exercise ids are gen_random_uuid() and
// differ per deployment, so the illustration map is keyed by name (see
// @/session/exercise-illustrations) — and every caller already holds the name, which keeps this
// screen free of a PowerSync read on the way in and makes it work identically for a custom
// exercise the user typed.
import { useEffect, useState } from 'react'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { ILLUSTRATION_ASSETS } from '@/session/exercise-illustration-assets'
import { getIllustration } from '@/session/exercise-illustrations'
import { Button, Heading, Screen, Text, colors, radii, spacing } from '@/ui'

const FRAME_MS = 1200
const FADE_MS = 350

export default function ExercisePreview() {
  const router = useRouter()
  const { name } = useLocalSearchParams<{ name?: string }>()
  const exerciseName = name ?? ''

  const illustration = getIllustration(exerciseName)
  const frames = illustration ? ILLUSTRATION_ASSETS[illustration.slug] : undefined

  const [atEnd, setAtEnd] = useState(false)

  useEffect(() => {
    if (!frames) return
    const timer = setInterval(() => setAtEnd((previous) => !previous), FRAME_MS)
    return () => clearInterval(timer)
  }, [frames])

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace('/')
    }
  }

  return (
    <Screen centered={false}>
      <View style={styles.header}>
        <Button title="Back" variant="secondary" onPress={handleBack} testID="exercise-preview-back" />
        <Heading size="lg" testID="exercise-preview-heading">
          {exerciseName}
        </Heading>
      </View>

      {frames && illustration ? (
        <>
          <View style={styles.frame}>
            <Image
              style={styles.image}
              source={atEnd ? frames.end : frames.start}
              contentFit="contain"
              transition={{ duration: FADE_MS, effect: 'cross-dissolve' }}
              accessibilityLabel={`${exerciseName}, ${atEnd ? 'end' : 'start'} position`}
              testID="exercise-preview-image"
            />
          </View>
          <Text muted size="sm" style={styles.caption} testID="exercise-preview-frame-label">
            {atEnd ? 'End position' : 'Start position'}
          </Text>
          <Text muted size="sm" testID="exercise-preview-attribution">
            Illustration “{illustration.title}” by Greg Priday (everkinetic), CC BY-SA 4.0.
          </Text>
        </>
      ) : (
        <View style={styles.empty} testID="exercise-preview-empty">
          <Text size="md">No illustration for this exercise yet.</Text>
          <Text muted size="sm">
            Illustrations cover much of the built-in library. Custom exercises don’t have one.
          </Text>
        </View>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  frame: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    aspectRatio: 1,
  },
  image: {
    flex: 1,
    width: '100%',
  },
  caption: {
    textAlign: 'center',
  },
  empty: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
})
