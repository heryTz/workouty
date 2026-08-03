// Persistent "session in progress" banner shown above every authed screen (mounted once in
// app/(app)/_layout.tsx). While a session is running it shows the live elapsed time and taps
// through to resume it. Hidden while you're already on that session's screen (which shows its own
// timer). The elapsed clock is timestamp-derived (started_at), re-rendered on a 1s tick — the tick
// lives here, not in the layout, so only this bar re-renders each second, not the whole navigator.
import { Pressable, StyleSheet } from 'react-native'
import { usePathname, useRouter } from 'expo-router'
import { useActiveSession } from '@/session/active-session'
import { formatElapsed, sessionElapsedSeconds } from '@/session/timers'
import { useNow } from '@/session/useNow'
import { colors, radii, spacing, Text } from '@/ui'

export function SessionBanner() {
  const active = useActiveSession()
  const pathname = usePathname()
  const router = useRouter()
  const now = useNow(1000)

  // Rules of hooks: every hook above runs unconditionally; only the render is conditional.
  // Hide on any /session/[id] screen — it already shows the elapsed timer.
  if (!active || pathname.startsWith('/session/')) return null

  const elapsed = sessionElapsedSeconds(new Date(active.started_at).getTime(), now)

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/session/[id]', params: { id: active.id } })}
      style={styles.banner}
      testID="active-session-banner"
    >
      <Text style={styles.label} testID="active-session-banner-elapsed">
        Session in progress · {formatElapsed(elapsed)}
      </Text>
      <Text style={styles.resume}>Resume →</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.accent,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomLeftRadius: radii.md,
    borderBottomRightRadius: radii.md,
  },
  label: {
    color: colors.textOnAccent,
    fontWeight: '600',
  },
  resume: {
    color: colors.textOnAccent,
    fontWeight: '700',
  },
})
