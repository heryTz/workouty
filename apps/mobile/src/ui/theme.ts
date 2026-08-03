// Minimal shared theme for the "clean & functional" ui/ kit (Milestone 4 Task B2). Not a design
// system — just the handful of tokens every screen/component in this kit needs, kept in one
// place so the app reads as one consistent product instead of a pile of one-off styles.
//
// #208AEF (accent) already appears in app.json's splash-screen background and the temporary A2
// harness's button, so it's reused here as the app's one accent color rather than introducing a
// second blue.

export const colors = {
  background: '#F7F8FA',
  surface: '#FFFFFF',
  border: '#E1E4EA',

  text: '#12151B',
  textMuted: '#5B6270',
  textOnAccent: '#FFFFFF',

  accent: '#208AEF',
  accentPressed: '#1A72C7',
  accentDisabled: '#9CC7EE',

  danger: '#D92D20',
  dangerBackground: '#FEF3F2',
  dangerBorder: '#FDA29B',
} as const

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const

export const fontSizes = {
  sm: 14,
  md: 16,
  lg: 20,
  xl: 28,
  xxl: 34,
} as const

// Large tap targets throughout — this app gets used mid-workout, often one-handed.
export const minTapTarget = 48

export const theme = { colors, spacing, radii, fontSizes, minTapTarget } as const
export type Theme = typeof theme
