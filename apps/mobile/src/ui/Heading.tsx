// Heading primitive for the ui/ kit — the "xl"/"lg" ends of the type scale, bold, used for
// screen titles and section headers. Kept separate from Text.tsx per the M4 plan's component
// list, but shares the same theme tokens.
import React from 'react'
import { StyleSheet, Text as RNText, type TextProps as RNTextProps } from 'react-native'
import { colors, fontSizes } from './theme'

export interface HeadingProps extends RNTextProps {
  size?: 'lg' | 'xl' | 'xxl'
}

export function Heading({ style, size = 'xl', ...rest }: HeadingProps): React.ReactElement {
  return <RNText style={[styles.base, { fontSize: fontSizes[size] }, style]} {...rest} />
}

const styles = StyleSheet.create({
  base: {
    color: colors.text,
    fontWeight: '700',
  },
})
