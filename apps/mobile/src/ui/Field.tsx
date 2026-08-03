// Labeled text input for the ui/ kit: label + RN TextInput + optional error text, wired for
// screen-reader accessibility (accessibilityLabel + error announced via accessibilityHint isn't
// reliable cross-platform, so the error is also just visible text under the field).
import React, { useId } from 'react'
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native'
import { colors, minTapTarget, radii, spacing } from './theme'
import { Text } from './Text'

export interface FieldProps extends Omit<TextInputProps, 'style'> {
  label: string
  error?: string | null
  testID?: string
}

export function Field({ label, error, testID, ...inputProps }: FieldProps): React.ReactElement {
  // React Native's useId isn't wired to any DOM attribute the way web's is, but it gives us a
  // stable per-instance id to derive a testID suffix from if a caller doesn't pass one.
  const id = useId()

  return (
    <View style={styles.container}>
      <Text style={styles.label} size="sm">
        {label}
      </Text>
      <TextInput
        testID={testID ?? `field-${id}`}
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, error && styles.inputError]}
        {...inputProps}
      />
      {error ? (
        <Text style={styles.error} size="sm">
          {error}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  label: {
    fontWeight: '600',
    color: colors.textMuted,
  },
  input: {
    minHeight: minTapTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  inputError: {
    borderColor: colors.dangerBorder,
  },
  error: {
    color: colors.danger,
  },
})
