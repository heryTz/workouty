// Body text primitive for the ui/ kit. Wraps RN's Text with the theme's default type color/size
// so screens don't hand-roll StyleSheet objects for ordinary copy.
import React from 'react'
import { StyleSheet, Text as RNText, type TextProps as RNTextProps } from 'react-native'
import { colors, fontSizes } from './theme'

export interface TextProps extends RNTextProps {
  muted?: boolean
  size?: keyof typeof fontSizes
}

export function Text({ style, muted, size = 'md', ...rest }: TextProps): React.ReactElement {
  return <RNText style={[styles.base, { fontSize: fontSizes[size] }, muted && styles.muted, style]} {...rest} />
}

const styles = StyleSheet.create({
  base: {
    color: colors.text,
  },
  muted: {
    color: colors.textMuted,
  },
})
