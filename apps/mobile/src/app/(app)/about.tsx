// Route: /about. Shows build metadata for both halves of the deploy: the app and the API.
//
// The app rows (App version/App released) come from `@/about/app-meta`'s EXPO_PUBLIC_* reads,
// inlined into this static Expo export at build time — so they render instantly, with no
// network call. The API rows are fetched separately via fetchApiMeta() hitting GET /version at
// render time, because the API image is deployed independently and can be pinned to a different
// tag than the web export it's paired with — there's no build-time guarantee the two match.
import { useEffect, useState } from 'react'
import { useRouter } from 'expo-router'
import { Linking, StyleSheet, View } from 'react-native'
import { appReleaseDate, appVersion, fetchApiMeta, formatReleaseDate, type AppMeta } from '@/about/app-meta'
import { Button, Heading, Screen, Text, colors, radii, spacing } from '@/ui'

const GITHUB_URL = 'https://github.com/heryTz/workouty'
const ILLUSTRATION_LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/'

type MetaRowProps = {
  label: string
  value: string
  first: boolean
  testID: string
}

function MetaRow({ label, value, first, testID }: MetaRowProps) {
  return (
    <View style={[styles.row, !first && styles.rowDivided]}>
      <Text muted size="sm">
        {label}
      </Text>
      <Text size="sm" testID={testID}>
        {value}
      </Text>
    </View>
  )
}

export default function About() {
  const router = useRouter()
  const [apiMeta, setApiMeta] = useState<AppMeta | null>(null)
  const [loadingApiMeta, setLoadingApiMeta] = useState(true)

  useEffect(() => {
    let ignore = false

    void fetchApiMeta().then((meta) => {
      if (ignore) return
      setApiMeta(meta)
      setLoadingApiMeta(false)
    })

    return () => {
      ignore = true
    }
  }, [])

  const apiVersion = loadingApiMeta ? '…' : (apiMeta?.version ?? 'unavailable')
  const apiReleased = loadingApiMeta
    ? '…'
    : apiMeta === null
      ? 'unavailable'
      : apiMeta.releaseDate === null
        ? 'unknown'
        : formatReleaseDate(apiMeta.releaseDate)

  const rows = [
    { label: 'App version', value: appVersion, testID: 'about-app-version' },
    ...(appReleaseDate === null
      ? []
      : [{ label: 'App released', value: formatReleaseDate(appReleaseDate), testID: 'about-app-released' }]),
    { label: 'API version', value: apiVersion, testID: 'about-api-version' },
    { label: 'API released', value: apiReleased, testID: 'about-api-released' },
  ]

  const handleOpenGithub = () => {
    Linking.openURL(GITHUB_URL).catch(() => {})
  }

  const handleOpenIllustrationLicense = () => {
    Linking.openURL(ILLUSTRATION_LICENSE_URL).catch(() => {})
  }

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
        <Button title="Back" variant="secondary" onPress={handleBack} testID="about-back-button" />
        <Heading size="lg" testID="about-heading">
          About
        </Heading>
      </View>

      <View style={styles.rows}>
        {rows.map((row, index) => (
          <MetaRow key={row.label} label={row.label} value={row.value} testID={row.testID} first={index === 0} />
        ))}
      </View>

      <Button title="View on GitHub" variant="secondary" onPress={handleOpenGithub} testID="about-github-button" />

      {/* CC BY-SA requires attribution wherever the work is distributed, so this is not optional
          decoration — see assets/exercises/SOURCE. */}
      <View style={styles.credits}>
        <Text muted size="sm">
          Credits
        </Text>
        <Text size="sm" testID="about-illustration-credit">
          Exercise illustrations by Greg Priday (everkinetic), licensed under CC BY-SA 4.0.
        </Text>
        <Button
          title="View illustration licence"
          variant="secondary"
          onPress={handleOpenIllustrationLicense}
          testID="about-illustration-license-button"
        />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rows: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  credits: {
    gap: spacing.sm,
  },
  rowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
})
