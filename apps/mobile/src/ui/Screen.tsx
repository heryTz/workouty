// Safe, padded, scrollable container for the ui/ kit — every screen in the app renders its
// content inside one of these instead of hand-rolling SafeAreaView/ScrollView/KeyboardAvoiding
// boilerplate per screen. `centered` is for short auth-style forms (login/register); pass
// `centered={false}` for content that should start at the top (e.g. lists).
import React from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, spacing } from './theme'

export interface ScreenProps {
  children: React.ReactNode
  centered?: boolean
  style?: ViewStyle
}

export function Screen({ children, centered = true, style }: ScreenProps): React.ReactElement {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.content, centered && styles.centered, style]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.inner}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    padding: spacing.lg,
  },
  centered: {
    justifyContent: 'center',
  },
  inner: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    gap: spacing.md,
  },
})
