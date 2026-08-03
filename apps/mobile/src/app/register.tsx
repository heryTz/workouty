// Public route: /register. Mirrors login.tsx's structure (see that file's header comment for
// why the "already signed in → redirect" check works per-mount without a shared auth context).
// Adds a client-side password-confirmation check before ever calling the API — a mismatch is a
// pure UI concern, not worth a round trip.
import { useCallback, useState } from 'react'
import { Link, Redirect } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { useAuth } from '@/auth/useAuth'
import { Button, Field, Heading, Screen, Text, colors, spacing } from '@/ui'

export default function Register() {
  const { isSignedIn, loading, error, register } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const mismatch = submitted && password !== confirmPassword

  const handleSubmit = useCallback(async () => {
    setSubmitted(true)
    if (password !== confirmPassword) return
    try {
      await register(email.trim(), password)
    } catch {
      // error is already captured in useAuth's `error` state; nothing else to do here.
    }
  }, [register, email, password, confirmPassword])

  if (!loading && isSignedIn) return <Redirect href="/" />

  return (
    <Screen>
      <Heading testID="register-heading">Create account</Heading>

      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        testID="register-email"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        testID="register-password"
      />
      <Field
        label="Confirm password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        error={mismatch ? 'Passwords do not match' : null}
        testID="register-confirm-password"
      />

      {submitted && !mismatch && error ? (
        <View style={styles.errorBanner} testID="register-error">
          <Text style={{ color: colors.danger }}>{error}</Text>
        </View>
      ) : null}

      <Button
        title="Create account"
        onPress={handleSubmit}
        loading={loading && submitted && !mismatch}
        testID="register-submit"
      />

      <View style={styles.links}>
        <Link href="/login" testID="register-login-link">
          <Text style={{ color: colors.accent }}>Already have an account? Log in</Text>
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
  links: {
    marginTop: spacing.sm,
  },
})
