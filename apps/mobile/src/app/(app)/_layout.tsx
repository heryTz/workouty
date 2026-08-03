// Router guard for the authed area. This group's routes (currently just index.tsx — the home
// screen) all resolve under "/", same as if there were no group at all; the parens don't add a
// URL segment (see expo-router's route-groups docs). Every route in here is gated by this
// layout: if useAuth() says the user isn't signed in, we redirect to /login before any child
// route mounts.
//
// `loading` (true only until the initial token-store check in useAuth resolves — see
// ../../auth/useAuth.ts) matters here: without it, a signed-in user reloading the app would
// see isSignedIn=false for one tick and get bounced to /login before the check catches up.
import { Redirect, Stack } from 'expo-router'
import { ActivityIndicator, View } from 'react-native'
import { useAuth } from '@/auth/useAuth'
import { SessionBanner } from '@/session/SessionBanner'
import { colors } from '@/ui'

export default function AuthedLayout() {
  const { isSignedIn, loading } = useAuth()

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    )
  }

  if (!isSignedIn) return <Redirect href="/login" />

  // A persistent session banner sits above the navigator, so a running session's timer (and a tap
  // to resume it) is visible on every authed screen. It renders nothing when no session is active.
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SessionBanner />
      <View style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false }} />
      </View>
    </View>
  )
}
