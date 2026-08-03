// Public route: /login. Redirects away to the authed home ("/") if useAuth() finds the user is
// already signed in on mount (e.g. a signed-in user navigates here directly) — this is a fresh
// hook instance per mount, so it re-checks the token store itself rather than relying on any
// other screen's state (useAuth's isSignedIn/loading are local per-call, not shared context; see
// ../auth/useAuth.ts). After a successful login() call *in this same component*, the same
// reactive check fires and redirects — no separate navigation call needed.
import { useCallback, useState } from 'react'
import { Link, Redirect } from 'expo-router'
import { useAuth } from '@/auth/useAuth'
import { Button, Field, Heading, Screen, Text, colors, spacing } from '@/ui'
import { StyleSheet, View } from 'react-native'

export default function Login() {
  const { isSignedIn, loading, error, login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = useCallback(async () => {
    setSubmitted(true)
    try {
      await login(email.trim(), password)
    } catch {
      // error is already captured in useAuth's `error` state; nothing else to do here.
    }
  }, [login, email, password])

  if (!loading && isSignedIn) return <Redirect href="/" />

  return (
    <Screen>
      <Heading testID="login-heading">Log in</Heading>

      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        testID="login-email"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="password"
        textContentType="password"
        testID="login-password"
      />

      {submitted && error ? (
        <View style={styles.errorBanner} testID="login-error">
          <Text style={{ color: colors.danger }}>{error}</Text>
        </View>
      ) : null}

      <Button title="Log in" onPress={handleSubmit} loading={loading && submitted} testID="login-submit" />

      <View style={styles.links}>
        <Link href="/register" testID="login-register-link">
          <Text style={{ color: colors.accent }}>Create an account</Text>
        </Link>
        <Link href="/forgot-password" testID="login-forgot-link">
          <Text style={{ color: colors.accent }}>Forgot password?</Text>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
})
