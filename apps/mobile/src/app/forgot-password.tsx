// Public route: /forgot-password. Two independent steps on one screen, per the M4 plan:
//   1. Request a reset link by email — always shows the same "if that email exists…" message
//      (the API itself returns 202 regardless per apps/api's auth.controller.ts enumeration
//      prevention; useAuth().requestReset only throws for genuine transport/server errors).
//   2. Paste the token from the (dev/Mailpit) email + a new password to actually reset it.
// These aren't chained/gated behind each other — a returning user who already has a token can
// skip straight to step 2.
import { useCallback, useState } from 'react'
import { Link, useRouter } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { useAuth } from '@/auth/useAuth'
import { Button, Field, Heading, Screen, Text, colors, spacing } from '@/ui'

export default function ForgotPassword() {
  const { error: requestError, loading: requestLoading, requestReset } = useAuth()
  const { error: resetError, loading: resetLoading, performReset } = useAuth()
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [requestSubmitted, setRequestSubmitted] = useState(false)
  const [requestMessage, setRequestMessage] = useState<string | null>(null)

  const [token, setToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [resetSubmitted, setResetSubmitted] = useState(false)
  const [resetDone, setResetDone] = useState(false)

  const handleRequest = useCallback(async () => {
    setRequestSubmitted(true)
    setRequestMessage(null)
    try {
      await requestReset(email.trim())
      setRequestMessage('If that email exists, we sent a reset link.')
    } catch {
      // requestError (from this hook instance) already reflects the failure; nothing else to do.
    }
  }, [requestReset, email])

  const handleReset = useCallback(async () => {
    setResetSubmitted(true)
    try {
      await performReset(token.trim(), newPassword)
      setResetDone(true)
    } catch {
      // resetError already reflects the failure.
    }
  }, [performReset, token, newPassword])

  if (resetDone) {
    return (
      <Screen>
        <Heading testID="reset-done-heading">Password reset</Heading>
        <Text>Your password has been updated. You can log in with your new password now.</Text>
        <Button title="Go to login" onPress={() => router.replace('/login')} testID="reset-done-login-button" />
      </Screen>
    )
  }

  return (
    <Screen>
      <Heading testID="forgot-password-heading">Forgot password</Heading>

      <Text muted>Enter your email and we'll send you a reset link.</Text>
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        testID="forgot-email"
      />
      {requestSubmitted && requestMessage ? (
        <View style={styles.infoBanner} testID="forgot-request-message">
          <Text>{requestMessage}</Text>
        </View>
      ) : null}
      {requestSubmitted && !requestMessage && requestError ? (
        <View style={styles.errorBanner} testID="forgot-request-error">
          <Text style={{ color: colors.danger }}>{requestError}</Text>
        </View>
      ) : null}
      <Button
        title="Send reset link"
        onPress={handleRequest}
        loading={requestLoading && requestSubmitted}
        testID="forgot-request-submit"
      />

      <View style={styles.divider} />

      <Text muted>Already have a reset token? Enter it below with your new password.</Text>
      <Field label="Reset token" value={token} onChangeText={setToken} autoCapitalize="none" testID="forgot-token" />
      <Field
        label="New password"
        value={newPassword}
        onChangeText={setNewPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        testID="forgot-new-password"
      />
      {resetSubmitted && resetError ? (
        <View style={styles.errorBanner} testID="forgot-reset-error">
          <Text style={{ color: colors.danger }}>{resetError}</Text>
        </View>
      ) : null}
      <Button
        title="Reset password"
        variant="secondary"
        onPress={handleReset}
        loading={resetLoading && resetSubmitted}
        testID="forgot-reset-submit"
      />

      <View style={styles.links}>
        <Link href="/login" testID="forgot-login-link">
          <Text style={{ color: colors.accent }}>Back to login</Text>
        </Link>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  errorBanner: {
    backgroundColor: colors.dangerBackground,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: 10,
    padding: spacing.md,
  },
  infoBanner: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.md,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  links: {
    marginTop: spacing.sm,
  },
})
