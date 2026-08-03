// Thin typed client over the Milestone 2 auth API (register/login/reset). Kept dependency-free
// (no provider/native imports) so it stays importable and unit-testable under plain Node/vitest
// — mirrors the pattern in ../powersync/connector.ts (dependency-injected fetch, apiUrl read
// from EXPO_PUBLIC_API_URL with a localhost dev default).
//
// This file is for the (Milestone 4 Chunk B) auth SCREENS — login/register/reset-password UI.
// It is NOT used by the PowerSync connector, which already does its own token refresh
// internally (see ../powersync/connector.ts's private refresh()) against the same
// /auth/refresh endpoint.

const DEFAULT_API_URL = 'http://localhost:3000'
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL

// .bind(globalThis) — NOT a bare `fetch` reference — required for web: a browser's `fetch` is
// a Window method with an "illegal invocation" receiver check. See connector.ts's constructor
// comment (found running Milestone 4 Task A2) for the full explanation.
const doFetch = fetch.bind(globalThis)

export type TokenPair = { accessToken: string; refreshToken: string }

// Typed error for non-2xx auth API responses, with a user-friendly `message` suitable for
// direct display (screens can just render `error.message`) plus the raw HTTP `status` for
// callers that want to branch on it (e.g. 409 vs. other failures).
export class AuthError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

export interface AuthApiOptions {
  // Overrides the module-level API_URL (derived from EXPO_PUBLIC_API_URL) — mainly for tests,
  // so each call site doesn't have to depend on process.env.
  baseUrl?: string
  // Overrides the module-level bound fetch — for tests (mock fetch) and so this file has no
  // hidden global dependency for callers that want full control.
  fetch?: typeof fetch
}

async function post(path: string, body: unknown, options?: AuthApiOptions): Promise<Response> {
  const baseUrl = options?.baseUrl ?? API_URL
  const fetchImpl = options?.fetch ?? doFetch
  return fetchImpl(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// Best-effort extraction of a server-provided error message (Nest's default error body is
// `{ statusCode, message, error }`), falling back to `fallback` when the body isn't JSON or
// doesn't have a usable `message`.
async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.clone().json()) as { message?: string | string[] }
    if (typeof body.message === 'string' && body.message.length > 0) return body.message
    if (Array.isArray(body.message) && body.message.length > 0) return body.message.join(', ')
  } catch {
    // non-JSON body — fall through to the fallback
  }
  return fallback
}

export async function register(email: string, password: string, options?: AuthApiOptions): Promise<TokenPair> {
  const res = await post('/auth/register', { email, password }, options)
  if (res.status === 409) throw new AuthError(409, await errorMessage(res, 'Email already registered'))
  if (!res.ok) throw new AuthError(res.status, await errorMessage(res, 'Registration failed'))
  return (await res.json()) as TokenPair
}

export async function login(email: string, password: string, options?: AuthApiOptions): Promise<TokenPair> {
  const res = await post('/auth/login', { email, password }, options)
  if (res.status === 401) throw new AuthError(401, await errorMessage(res, 'Invalid email or password'))
  if (!res.ok) throw new AuthError(res.status, await errorMessage(res, 'Login failed'))
  return (await res.json()) as TokenPair
}

// Always resolves — the API returns 202 regardless of whether the email is registered
// (enumeration prevention, see apps/api's auth.controller.ts). A non-2xx here would indicate
// a genuine transport/server problem, not "email not found", so it's still surfaced as an
// AuthError for that case.
export async function requestReset(email: string, options?: AuthApiOptions): Promise<void> {
  const res = await post('/auth/reset-request', { email }, options)
  if (!res.ok) throw new AuthError(res.status, await errorMessage(res, 'Reset request failed'))
}

export async function performReset(token: string, password: string, options?: AuthApiOptions): Promise<void> {
  const res = await post('/auth/reset', { token, password }, options)
  if (!res.ok) throw new AuthError(res.status, await errorMessage(res, 'Reset failed'))
}
