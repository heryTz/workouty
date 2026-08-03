// Supplies PowerSync's client with credentials, per the PowerSyncBackendConnector contract:
// fetchCredentials() returns { endpoint, token, expiresAt } for a signed-in user, `null` when
// not signed in (PowerSync then just doesn't sync — not an error), and THROWS on a
// network/temporary failure so the SDK's own retry/backoff kicks in.
//
// Deliberately dependency-injected (apiUrl/powersyncUrl/tokenStore/fetch) rather than reading
// env vars or importing RN/Expo modules directly: keeps this file importable and unit
// testable under plain Node/vitest, and later drivable by @powersync/node against the live
// stack. A thin device wrapper (Task D2) is responsible for sourcing the config from
// EXPO_PUBLIC_* env and a SecureTokenStore.

import { toUploadOp, type CrudEntryLike, type UploadOp } from './crud-mapping'
import { decodeJwtExpiry } from './jwt'
import type { TokenStore } from './token-store'

export interface PowerSyncCredentials {
  endpoint: string
  token: string
  expiresAt?: Date
}

// Minimal structural shape of PowerSync's CrudBatch (from `database.getCrudBatch()`): a list
// of CRUD entries plus a `complete()` to acknowledge them (clearing the local upload queue).
// Kept structural (not imported from @powersync/*) so this file stays importable/testable
// without the native PowerSync client — see the header comment above.
export interface CrudBatchLike {
  crud: CrudEntryLike[]
  complete: () => Promise<void>
}

export interface WorkoutyConnectorConfig {
  apiUrl: string
  powersyncUrl: string
  tokenStore: TokenStore
  fetch?: typeof fetch
  // Called with the server's per-op rejection list after a batch upload that included
  // rejections. Rejections are permanent (not retried) — this is how the app surfaces them
  // to the user (or, in tests, captures them for assertions).
  onRejected?: (rejected: unknown[]) => void
}

// A token is treated as stale once it's within this many seconds of expiry (or already
// expired). Refreshing a little early avoids handing PowerSync a token that expires mid-sync.
const STALE_MARGIN_SECONDS = 30

interface RefreshResponse {
  accessToken: string
  refreshToken: string
}

export class WorkoutyConnector {
  private readonly apiUrl: string
  private readonly powersyncUrl: string
  private readonly tokenStore: TokenStore
  private readonly fetchImpl: typeof fetch
  private readonly onRejected?: (rejected: unknown[]) => void

  constructor(config: WorkoutyConnectorConfig) {
    this.apiUrl = config.apiUrl
    this.powersyncUrl = config.powersyncUrl
    this.tokenStore = config.tokenStore
    // .bind(globalThis) — NOT a bare `fetch` reference — is required here (found running
    // Milestone 4 Task A2 against a real browser): a real browser's `fetch` is a Window/
    // WorkerGlobalScope method with an internal "illegal invocation" brand check on its
    // receiver. Storing the bare function as a class property and later calling it as
    // `this.fetchImpl(...)` invokes it with `this` bound to the WorkoutyConnector instance,
    // not `window`, so every upload/refresh call throws `TypeError: Failed to execute 'fetch'
    // on 'Window': Illegal invocation` before a request is ever sent. Node's fetch (undici)
    // doesn't enforce this receiver check, which is exactly why the Milestone 3 Node-only
    // round-trip test (roundtrip.node.test.ts) never caught it — this only surfaces in an
    // actual browser.
    this.fetchImpl = config.fetch ?? fetch.bind(globalThis)
    this.onRejected = config.onRejected
  }

  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    const token = await this.getFreshAccessToken()
    if (!token) return null

    return {
      endpoint: this.powersyncUrl,
      token,
      expiresAt: decodeJwtExpiry(token) ?? undefined,
    }
  }

  // Drains PowerSync's upload queue and POSTs it to the backend. Retry-vs-complete semantics
  // (see also the constraints in the Milestone 3 plan):
  //   - network error / 5xx  -> THROW, do not complete(). Transient — the SDK retries the same
  //     batch after ~5s.
  //   - 401                  -> THROW. The access token was rejected (e.g. revoked mid-flight);
  //     don't complete() a batch the server never actually accepted. The next attempt calls
  //     getFreshAccessToken() again, which refreshes/re-authenticates.
  //   - other non-2xx (e.g. 400 malformed request) -> log + complete(). Our endpoint returns
  //     200 with a `rejected[]` list for per-op problems, so reaching a 400 here means the
  //     *request itself* was malformed — a client-side bug, not a transient condition. Retrying
  //     verbatim would just fail the same way forever, so we drain the queue rather than loop.
  //   - 2xx (with or without rejected[]) -> complete(). Rejected ops are permanent (the server
  //     already made a final decision on them) — surfaced via onRejected, not retried.
  //   - empty/missing batch -> no-op, no fetch.
  async uploadData(database: { getCrudBatch: () => Promise<CrudBatchLike | null> }): Promise<void> {
    const batch = await database.getCrudBatch()
    if (!batch || batch.crud.length === 0) return

    const ops: UploadOp[] = batch.crud.map(toUploadOp)

    const token = await this.getFreshAccessToken()
    if (!token) throw new Error('uploadData: not authenticated')

    let res: Response
    try {
      res = await this.fetchImpl(`${this.apiUrl}/sync/upload`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ batch: ops }),
      })
    } catch (err) {
      // Network failure — temporary. Let the SDK retry.
      throw new Error('uploadData: network error', { cause: err })
    }

    if (res.status === 401) {
      // Token rejected — don't complete a batch the server never accepted. Retrying (after
      // re-auth via getFreshAccessToken on the next call) is the right move.
      throw new Error('uploadData: 401 unauthorized')
    }

    if (res.status >= 500) {
      throw new Error(`uploadData: server error ${res.status}`)
    }

    if (!res.ok) {
      // Other 4xx: a malformed batch won't get better by retrying it verbatim. Log and drain
      // the queue rather than looping forever.
      console.error(`uploadData: request rejected with HTTP ${res.status}, dropping batch`)
      await batch.complete()
      return
    }

    const body = (await res.json().catch(() => ({ rejected: [] }))) as { rejected?: unknown[] }
    const rejected = body.rejected ?? []
    if (rejected.length > 0) this.onRejected?.(rejected)

    await batch.complete()
  }

  // Returns a fresh, non-stale access token, refreshing via the stored refresh token if
  // necessary. Returns null when signed out (no valid access token and no refresh token, or
  // the refresh token was rejected). Shared by fetchCredentials and uploadData so the
  // refresh/staleness logic lives in exactly one place.
  private async getFreshAccessToken(): Promise<string | null> {
    const accessToken = await this.tokenStore.getAccessToken()
    if (accessToken && !this.isStale(accessToken)) return accessToken

    const refreshToken = await this.tokenStore.getRefreshToken()
    if (!refreshToken) return null

    const refreshed = await this.refresh(refreshToken)
    return refreshed?.token ?? null
  }

  // True if the token is unparseable, already expired, or expiring within the stale margin.
  private isStale(token: string, now: Date = new Date()): boolean {
    const exp = decodeJwtExpiry(token)
    if (!exp) return true
    return exp.getTime() - now.getTime() <= STALE_MARGIN_SECONDS * 1000
  }

  private async refresh(refreshToken: string): Promise<PowerSyncCredentials | null> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.apiUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
    } catch (err) {
      // Network failure (offline, DNS, connection refused, ...) — temporary. Let the SDK
      // retry rather than treating this as a sign-out.
      throw new Error(`PowerSync credential refresh failed: network error`, { cause: err })
    }

    if (response.status === 401) {
      // Refresh token is invalid/expired/revoked — genuinely signed out.
      await this.tokenStore.clear()
      return null
    }

    if (!response.ok) {
      // 5xx or any other non-2xx: temporary/server-side, not a sign-out decision we should
      // make locally. Throw so the SDK retries.
      throw new Error(`PowerSync credential refresh failed: HTTP ${response.status}`)
    }

    const body = (await response.json()) as RefreshResponse
    await this.tokenStore.setTokens({ accessToken: body.accessToken, refreshToken: body.refreshToken })

    return {
      endpoint: this.powersyncUrl,
      token: body.accessToken,
      expiresAt: decodeJwtExpiry(body.accessToken) ?? undefined,
    }
  }
}

export function createConnector(config: WorkoutyConnectorConfig): WorkoutyConnector {
  return new WorkoutyConnector(config)
}
