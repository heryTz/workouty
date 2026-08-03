import { describe, expect, it, vi } from 'vitest'
import type { CrudBatchLike } from './connector'
import { WorkoutyConnector } from './connector'
import type { CrudEntryLike } from './crud-mapping'
import { decodeJwtExpiry } from './jwt'
import { InMemoryTokenStore } from './token-store'

const API_URL = 'https://api.example.test'
const POWERSYNC_URL = 'https://powersync.example.test'

// Builds a JWT-shaped string (header.payload.signature) with a base64url payload containing
// `exp` (seconds since epoch). The signature segment is a placeholder — fetchCredentials never
// verifies it, only decodes `exp` locally.
function makeToken(expSeconds: number, extra: Record<string, unknown> = {}): string {
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = { sub: 'user-1', aud: 'workouty', exp: expSeconds, ...extra }
  // btoa (not Buffer, to avoid needing @types/node) only handles Latin1 input, which is fine —
  // these test payloads are plain ASCII JSON.
  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
  return `${b64url(header)}.${b64url(payload)}.signature`
}

// Anchored to the real wall clock (not a fixed literal) since the connector itself compares
// against `new Date()` internally and isn't given an injectable clock. Each call re-reads
// Date.now() so the offset from "now" stays accurate regardless of how long the test run takes.
function futureToken(secondsFromNow: number, extra: Record<string, unknown> = {}) {
  const nowSeconds = Math.floor(Date.now() / 1000)
  return makeToken(nowSeconds + secondsFromNow, extra)
}

describe('WorkoutyConnector.fetchCredentials', () => {
  it('returns credentials from a valid, non-stale stored access token without calling fetch', async () => {
    const tokenStore = new InMemoryTokenStore()
    const accessToken = futureToken(600) // 10 min out, well past the 30s staleness margin
    await tokenStore.setTokens({ accessToken, refreshToken: 'refresh-1' })

    const fetchMock = vi.fn()
    const connector = new WorkoutyConnector({
      apiUrl: API_URL,
      powersyncUrl: POWERSYNC_URL,
      tokenStore,
      fetch: fetchMock,
    })

    const result = await connector.fetchCredentials()

    expect(result).toEqual({
      endpoint: POWERSYNC_URL,
      token: accessToken,
      expiresAt: decodeJwtExpiry(accessToken),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes when the access token is stale and a valid refresh token is present', async () => {
    const tokenStore = new InMemoryTokenStore()
    const staleAccessToken = futureToken(10) // within the 30s stale margin
    await tokenStore.setTokens({ accessToken: staleAccessToken, refreshToken: 'refresh-1' })

    const newAccessToken = futureToken(900)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accessToken: newAccessToken, refreshToken: 'refresh-2' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const connector = new WorkoutyConnector({
      apiUrl: API_URL,
      powersyncUrl: POWERSYNC_URL,
      tokenStore,
      fetch: fetchMock,
    })

    const result = await connector.fetchCredentials()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${API_URL}/auth/refresh`)
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ refreshToken: 'refresh-1' })

    expect(result).toEqual({
      endpoint: POWERSYNC_URL,
      token: newAccessToken,
      expiresAt: decodeJwtExpiry(newAccessToken),
    })

    await expect(tokenStore.getAccessToken()).resolves.toBe(newAccessToken)
    await expect(tokenStore.getRefreshToken()).resolves.toBe('refresh-2')
  })

  it('also refreshes when there is no stored access token at all, given a valid refresh token', async () => {
    // A store that only ever had a refresh token set (e.g. a device that never completed a
    // sync, or one recovering from a partial write) — no InMemoryTokenStore.setTokens call
    // models this since it always sets both, so implement the interface directly here.
    const tokenStore: import('./token-store').TokenStore = {
      getAccessToken: async () => null,
      getRefreshToken: async () => 'refresh-1',
      setTokens: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
    }

    const newAccessToken = futureToken(900)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accessToken: newAccessToken, refreshToken: 'refresh-2' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const connector = new WorkoutyConnector({
      apiUrl: API_URL,
      powersyncUrl: POWERSYNC_URL,
      tokenStore,
      fetch: fetchMock,
    })

    const result = await connector.fetchCredentials()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result?.token).toBe(newAccessToken)
  })

  it('returns null (not signed in) when there is no refresh token and no valid access token', async () => {
    const tokenStore = new InMemoryTokenStore()
    // Never set any tokens: getAccessToken/getRefreshToken both resolve to null.

    const fetchMock = vi.fn()
    const connector = new WorkoutyConnector({
      apiUrl: API_URL,
      powersyncUrl: POWERSYNC_URL,
      tokenStore,
      fetch: fetchMock,
    })

    const result = await connector.fetchCredentials()

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('clears the store and returns null when refresh responds 401 (refresh token invalid/expired)', async () => {
    const tokenStore = new InMemoryTokenStore()
    await tokenStore.setTokens({ accessToken: futureToken(-10), refreshToken: 'expired-refresh' })

    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
    const connector = new WorkoutyConnector({
      apiUrl: API_URL,
      powersyncUrl: POWERSYNC_URL,
      tokenStore,
      fetch: fetchMock,
    })

    const result = await connector.fetchCredentials()

    expect(result).toBeNull()
    await expect(tokenStore.getAccessToken()).resolves.toBeNull()
    await expect(tokenStore.getRefreshToken()).resolves.toBeNull()
  })

  it('throws when the refresh request fails with a network error (SDK should retry, not sign out)', async () => {
    const tokenStore = new InMemoryTokenStore()
    await tokenStore.setTokens({ accessToken: futureToken(-10), refreshToken: 'refresh-1' })

    const fetchMock = vi.fn().mockRejectedValue(new Error('fetch failed'))
    const connector = new WorkoutyConnector({
      apiUrl: API_URL,
      powersyncUrl: POWERSYNC_URL,
      tokenStore,
      fetch: fetchMock,
    })

    await expect(connector.fetchCredentials()).rejects.toThrow()

    // The store must be left untouched — a network blip is not a sign-out.
    await expect(tokenStore.getRefreshToken()).resolves.toBe('refresh-1')
  })

  it('throws when the refresh request responds with a 5xx server error', async () => {
    const tokenStore = new InMemoryTokenStore()
    await tokenStore.setTokens({ accessToken: futureToken(-10), refreshToken: 'refresh-1' })

    const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }))
    const connector = new WorkoutyConnector({
      apiUrl: API_URL,
      powersyncUrl: POWERSYNC_URL,
      tokenStore,
      fetch: fetchMock,
    })

    await expect(connector.fetchCredentials()).rejects.toThrow()
    await expect(tokenStore.getRefreshToken()).resolves.toBe('refresh-1')
  })

  it('treats an already-expired access token as stale and refreshes', async () => {
    const tokenStore = new InMemoryTokenStore()
    const expiredAccessToken = futureToken(-60) // expired a minute ago
    await tokenStore.setTokens({ accessToken: expiredAccessToken, refreshToken: 'refresh-1' })

    const newAccessToken = futureToken(900)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accessToken: newAccessToken, refreshToken: 'refresh-2' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const connector = new WorkoutyConnector({
      apiUrl: API_URL,
      powersyncUrl: POWERSYNC_URL,
      tokenStore,
      fetch: fetchMock,
    })

    const result = await connector.fetchCredentials()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result?.token).toBe(newAccessToken)
  })
})

describe('WorkoutyConnector.uploadData', () => {
  const crudEntries: CrudEntryLike[] = [
    { op: 'PUT', id: 'ex-1', table: 'exercises', opData: { name: 'Squat' } },
    { op: 'DELETE', id: 'ex-2', table: 'exercises', opData: null },
  ]

  function makeBatch(crud: CrudEntryLike[]): CrudBatchLike & { complete: ReturnType<typeof vi.fn> } {
    return { crud, complete: vi.fn(async () => {}) }
  }

  async function seededTokenStore(): Promise<InMemoryTokenStore> {
    const tokenStore = new InMemoryTokenStore()
    await tokenStore.setTokens({ accessToken: futureToken(600), refreshToken: 'refresh-1' })
    return tokenStore
  }

  it('maps and POSTs a non-empty batch to /sync/upload with a bearer token, then completes it', async () => {
    const tokenStore = await seededTokenStore()
    const accessToken = await tokenStore.getAccessToken()
    const batch = makeBatch(crudEntries)
    const database = { getCrudBatch: vi.fn(async () => batch) }

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ rejected: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const connector = new WorkoutyConnector({
      apiUrl: API_URL,
      powersyncUrl: POWERSYNC_URL,
      tokenStore,
      fetch: fetchMock,
    })

    await connector.uploadData(database)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${API_URL}/sync/upload`)
    const request = init as RequestInit
    expect((request.headers as Record<string, string>).authorization).toBe(`Bearer ${accessToken}`)
    expect((request.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(JSON.parse(request.body as string)).toEqual({
      batch: [
        { op: 'PUT', table: 'exercises', id: 'ex-1', data: { name: 'Squat' } },
        { op: 'DELETE', table: 'exercises', id: 'ex-2' },
      ],
    })
    expect(batch.complete).toHaveBeenCalledTimes(1)
  })

  it('throws and does not complete the batch on a 5xx response (SDK retries)', async () => {
    const tokenStore = await seededTokenStore()
    const batch = makeBatch(crudEntries)
    const database = { getCrudBatch: vi.fn(async () => batch) }
    const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 503 }))

    const connector = new WorkoutyConnector({
      apiUrl: API_URL,
      powersyncUrl: POWERSYNC_URL,
      tokenStore,
      fetch: fetchMock,
    })

    await expect(connector.uploadData(database)).rejects.toThrow()
    expect(batch.complete).not.toHaveBeenCalled()
  })

  it('throws and does not complete the batch on a network error (SDK retries)', async () => {
    const tokenStore = await seededTokenStore()
    const batch = makeBatch(crudEntries)
    const database = { getCrudBatch: vi.fn(async () => batch) }
    const fetchMock = vi.fn().mockRejectedValue(new Error('fetch failed'))

    const connector = new WorkoutyConnector({
      apiUrl: API_URL,
      powersyncUrl: POWERSYNC_URL,
      tokenStore,
      fetch: fetchMock,
    })

    await expect(connector.uploadData(database)).rejects.toThrow()
    expect(batch.complete).not.toHaveBeenCalled()
  })

  it('completes the batch and surfaces rejected ops via onRejected on a 2xx response with rejected[]', async () => {
    const tokenStore = await seededTokenStore()
    const batch = makeBatch(crudEntries)
    const database = { getCrudBatch: vi.fn(async () => batch) }
    const rejected = [{ op: 'PUT', table: 'exercises', id: 'ex-1', reason: 'conflict' }]
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ rejected }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const onRejected = vi.fn()

    const connector = new WorkoutyConnector({
      apiUrl: API_URL,
      powersyncUrl: POWERSYNC_URL,
      tokenStore,
      fetch: fetchMock,
      onRejected,
    })

    await connector.uploadData(database)

    expect(onRejected).toHaveBeenCalledTimes(1)
    expect(onRejected).toHaveBeenCalledWith(rejected)
    expect(batch.complete).toHaveBeenCalledTimes(1)
  })

  it('does nothing (no fetch) when the batch is empty', async () => {
    const tokenStore = await seededTokenStore()
    const batch = makeBatch([])
    const database = { getCrudBatch: vi.fn(async () => batch) }
    const fetchMock = vi.fn()

    const connector = new WorkoutyConnector({
      apiUrl: API_URL,
      powersyncUrl: POWERSYNC_URL,
      tokenStore,
      fetch: fetchMock,
    })

    await connector.uploadData(database)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does nothing (no fetch) when getCrudBatch returns null', async () => {
    const tokenStore = await seededTokenStore()
    const database = { getCrudBatch: vi.fn(async () => null) }
    const fetchMock = vi.fn()

    const connector = new WorkoutyConnector({
      apiUrl: API_URL,
      powersyncUrl: POWERSYNC_URL,
      tokenStore,
      fetch: fetchMock,
    })

    await connector.uploadData(database)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws without calling /sync/upload when there is no authenticated token', async () => {
    const tokenStore = new InMemoryTokenStore() // never seeded: no access token, no refresh token
    const batch = makeBatch(crudEntries)
    const database = { getCrudBatch: vi.fn(async () => batch) }
    const fetchMock = vi.fn()

    const connector = new WorkoutyConnector({
      apiUrl: API_URL,
      powersyncUrl: POWERSYNC_URL,
      tokenStore,
      fetch: fetchMock,
    })

    await expect(connector.uploadData(database)).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(batch.complete).not.toHaveBeenCalled()
  })
})
