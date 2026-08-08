// Build metadata for the About screen. The web app is a static Expo export served by Caddy, so
// it has no runtime env — Expo inlines these EXPO_PUBLIC_* reads at export time. They have to
// stay literal member expressions for that substitution to happen.
//
// An `ARG` declared in the Dockerfile without a matching `--build-arg` still sets the variable,
// to the empty string, which is why `?? 'dev'` alone isn't enough.
function nonEmpty(value: string | undefined): string | null {
  return value !== undefined && value.length > 0 ? value : null
}

export const appVersion = nonEmpty(process.env.EXPO_PUBLIC_APP_VERSION) ?? 'dev'
export const appReleaseDate = nonEmpty(process.env.EXPO_PUBLIC_APP_RELEASE_DATE)

const DEFAULT_API_URL = 'http://localhost:6100'
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL

// .bind(globalThis) — NOT a bare `fetch` reference — required for web: a browser's `fetch` is a
// Window method with an "illegal invocation" receiver check. Same reason as auth-api.ts.
const doFetch = fetch.bind(globalThis)

export type AppMeta = {
  version: string
  releaseDate: string | null
}

export type FetchApiMetaOptions = {
  baseUrl?: string
  fetch?: typeof fetch
}

// Resolves to null rather than throwing on every failure mode — the About screen renders one
// "unavailable" state and doesn't care which of them happened.
export async function fetchApiMeta(options?: FetchApiMetaOptions): Promise<AppMeta | null> {
  const baseUrl = options?.baseUrl ?? API_URL
  const fetchImpl = options?.fetch ?? doFetch

  try {
    const res = await fetchImpl(`${baseUrl}/version`)
    if (!res.ok) return null

    const body: unknown = await res.json()
    if (typeof body !== 'object' || body === null) return null

    const { version, releaseDate } = body as { version?: unknown; releaseDate?: unknown }
    if (typeof version !== 'string') return null

    return { version, releaseDate: typeof releaseDate === 'string' ? releaseDate : null }
  } catch {
    return null
  }
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const RELEASE_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

// Formatted from the parts rather than via `new Date(value)`: that parses a bare YYYY-MM-DD as
// UTC midnight, so every viewer west of UTC would see the previous day.
export function formatReleaseDate(value: string): string {
  const match = RELEASE_DATE_PATTERN.exec(value)
  if (!match) return value

  const [, year, month, day] = match
  const monthName = MONTHS[Number(month) - 1]
  if (monthName === undefined) return value

  return `${monthName} ${Number(day)}, ${year}`
}
