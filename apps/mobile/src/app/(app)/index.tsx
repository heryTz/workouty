// Authed home screen. "Start session" (Milestone 4 Task D2) creates a freestyle `sessions` row
// (no template — templates are M5) via startSession and navigates straight to the active-session
// screen at /session/[id]; everything from there (adding exercises, logging sets, resting,
// finishing) lives in that screen.
//
// "Start from template" (Milestone 5 Task C1) just navigates to /templates — that screen owns
// picking a template and doing the actual startSessionFromTemplate write + navigation into the
// session screen (see app/(app)/templates.tsx).
//
// "Dashboard" (Milestone 6 Task B2) just navigates to /dashboard — that screen owns the
// progression chart + personal records (see app/(app)/dashboard.tsx).
import { useCallback, useState } from 'react'
import { useRouter } from 'expo-router'
import { useStatus } from '@powersync/react'
import { useAuth } from '@/auth/useAuth'
import { usePowerSyncApp } from '@/powersync/PowerSyncProvider'
import { useActiveSession } from '@/session/active-session'
import { startSession } from '@/session/session-writes'
import { Button, Heading, Screen, Text } from '@/ui'

export default function Home() {
  const { userId, signOut } = useAuth()
  const { db } = usePowerSyncApp()
  const status = useStatus()
  const router = useRouter()
  const activeSession = useActiveSession()
  const [signingOut, setSigningOut] = useState(false)
  const [starting, setStarting] = useState(false)

  const handleSignOut = useCallback(async () => {
    setSigningOut(true)
    try {
      await signOut()
      router.replace('/login')
    } finally {
      setSigningOut(false)
    }
  }, [signOut, router])

  const handleStartSession = useCallback(async () => {
    if (!userId) return
    setStarting(true)
    try {
      const id = await startSession(db, { userId })
      router.push({ pathname: '/session/[id]', params: { id } })
    } finally {
      setStarting(false)
    }
  }, [db, userId, router])

  const handleResumeSession = useCallback(() => {
    if (!activeSession) return
    router.push({ pathname: '/session/[id]', params: { id: activeSession.id } })
  }, [activeSession, router])

  return (
    <Screen centered={false}>
      <Heading testID="home-heading">Workouty</Heading>
      <Text muted testID="sync-status">
        Sync: {status.connected ? 'connected' : 'connecting…'}
      </Text>

      {activeSession ? (
        <Button title="Resume session" onPress={handleResumeSession} testID="resume-session-button" />
      ) : (
        <Button title="Start session" onPress={handleStartSession} loading={starting} testID="start-session-button" />
      )}

      <Button
        title="Start from template"
        variant="secondary"
        onPress={() => router.push('/templates')}
        testID="start-from-template-button"
      />

      <Button
        title="Dashboard"
        variant="secondary"
        onPress={() => router.push('/dashboard')}
        testID="dashboard-nav-button"
      />

      <Button
        title="Exercises"
        variant="secondary"
        onPress={() => router.push('/exercise-picker')}
        testID="exercises-nav-button"
      />

      <Button
        title="Sign out"
        variant="secondary"
        onPress={handleSignOut}
        loading={signingOut}
        testID="sign-out-button"
      />
    </Screen>
  )
}
