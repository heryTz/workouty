// Button primitive for the ui/ kit: primary (filled accent) / secondary (outlined) variants,
// a large default tap target (this app gets used mid-workout), disabled + loading states.
import React from 'react'
import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { colors, minTapTarget, radii, spacing } from './theme'
import { Text } from './Text'

export interface ButtonProps {
  title: string
  onPress: () => void
  variant?: 'primary' | 'secondary'
  disabled?: boolean
  loading?: boolean
  style?: StyleProp<ViewStyle>
  testID?: string
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
  testID,
}: ButtonProps): React.ReactElement {
  const isDisabled = disabled || loading

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      testID={testID}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' ? styles.primary : styles.secondary,
        isDisabled && (variant === 'primary' ? styles.primaryDisabled : styles.secondaryDisabled),
        pressed && !isDisabled && (variant === 'primary' ? styles.primaryPressed : styles.secondaryPressed),
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.textOnAccent : colors.accent} />
      ) : (
        <Text
          style={variant === 'primary' ? styles.primaryText : styles.secondaryText}
          size="md"
        >
          {title}
        </Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    minHeight: minTapTarget,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: colors.accent,
  },
  primaryPressed: {
    backgroundColor: colors.accentPressed,
  },
  primaryDisabled: {
    backgroundColor: colors.accentDisabled,
  },
  primaryText: {
    color: colors.textOnAccent,
    fontWeight: '600',
  },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.accent,
  },
  secondaryPressed: {
    backgroundColor: colors.background,
  },
  secondaryDisabled: {
    borderColor: colors.accentDisabled,
  },
  secondaryText: {
    color: colors.accent,
    fontWeight: '600',
  },
})
