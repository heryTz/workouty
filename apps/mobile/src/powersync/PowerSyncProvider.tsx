// React wiring for the PowerSync client: creates the on-device database (platform-selected —
// op-sqlite on native, wa-sqlite/WASM on web, see database.native.ts/database.web.ts) +
// connector once, exposes the db via @powersync/react's PowerSyncContext (so `usePowerSync`/
// `useQuery` from that package work app-wide, per PowerSync's own idiomatic React wiring), and
// exposes connect()/signOut() for the (Milestone 4) auth flow to call.
//
// This file itself imports neither @powersync/react-native nor @powersync/web — it depends only
// on the neutral `AbstractPowerSyncDatabase` type from @powersync/common (also what
// @powersync/react's PowerSyncContext expects), so it type-checks and bundles identically on
// both platforms. Keep it out of anything the vitest unit-test path imports regardless — the 92
// pure unit tests must stay Node-only.
import type { AbstractPowerSyncDatabase } from '@powersync/common'
import { PowerSyncContext } from '@powersync/react'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createConnector, type WorkoutyConnector } from './connector'
import { createDatabase } from './database'
import { SecureTokenStore, type TokenStore } from './token-store'

// Dev defaults mirror compose.yml's published ports (api :3000, powersync :8080) — see
// apps/mobile/AGENTS.md-adjacent .env.example. `localhost` only resolves to the dev machine
// itself: a physical device (or emulator, depending on platform) needs the dev machine's LAN
// IP instead. Override via EXPO_PUBLIC_API_URL / EXPO_PUBLIC_POWERSYNC_URL in apps/mobile/.env
// (EXPO_PUBLIC_* vars are inlined into the JS bundle at build time by Expo).
const DEFAULT_API_URL = 'http://localhost:3000'
const DEFAULT_POWERSYNC_URL = 'http://localhost:8080'

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL
const POWERSYNC_URL = process.env.EXPO_PUBLIC_POWERSYNC_URL ?? DEFAULT_POWERSYNC_URL

export interface PowerSyncAppContextValue {
  db: AbstractPowerSyncDatabase
  tokenStore: TokenStore
  // Connects the sync stream if the user is authenticated (tokens exist in the store);
  // no-ops otherwise. Call after a successful login, and once on app start in case the user
  // is already signed in from a previous session.
  connect: () => Promise<void>
  // Per spec §3.7: sign-out clears the local synced DB, not just the tokens.
  signOut: () => Promise<void>
  // TODO(milestone-4): surface rejected ops in the UI (toast/banner) instead of just this
  // captured value + console.warn.
  lastRejected: unknown[] | null
}

const PowerSyncAppContext = createContext<PowerSyncAppContextValue | null>(null)

export function usePowerSyncApp(): PowerSyncAppContextValue {
  const ctx = useContext(PowerSyncAppContext)
  if (!ctx) throw new Error('usePowerSyncApp must be used within a PowerSyncProvider')
  return ctx
}

export function PowerSyncProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  // Created once per provider instance (which wraps the whole app, so effectively once per
  // app lifetime) via lazy ref init, not per render.
  const dbRef = useRef<AbstractPowerSyncDatabase | null>(null)
  if (!dbRef.current) dbRef.current = createDatabase()
  const db = dbRef.current

  const tokenStoreRef = useRef<TokenStore | null>(null)
  if (!tokenStoreRef.current) tokenStoreRef.current = new SecureTokenStore()
  const tokenStore = tokenStoreRef.current

  const [lastRejected, setLastRejected] = useState<unknown[] | null>(null)

  const connectorRef = useRef<WorkoutyConnector | null>(null)
  if (!connectorRef.current) {
    connectorRef.current = createConnector({
      apiUrl: API_URL,
      powersyncUrl: POWERSYNC_URL,
      tokenStore,
      onRejected: (rejected) => {
        console.warn('PowerSync: server rejected op(s) in an upload batch', rejected)
        setLastRejected(rejected)
      },
    })
  }
  const connector = connectorRef.current

  const connect = useCallback(async (): Promise<void> => {
    const [accessToken, refreshToken] = await Promise.all([
      tokenStore.getAccessToken(),
      tokenStore.getRefreshToken(),
    ])
    if (!accessToken && !refreshToken) return // not signed in — nothing to connect
    await db.connect(connector)
  }, [db, connector, tokenStore])

  const signOut = useCallback(async (): Promise<void> => {
    await db.disconnectAndClear()
    await tokenStore.clear()
  }, [db, tokenStore])

  useEffect(() => {
    // Covers the app being relaunched while a previous session's tokens are still valid.
    connect().catch((err) => {
      console.error('PowerSync: initial connect() failed', err)
    })

    return () => {
      db.disconnect().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- db/connect are stable for the provider's lifetime
  }, [])

  const value = useMemo<PowerSyncAppContextValue>(
    () => ({ db, tokenStore, connect, signOut, lastRejected }),
    [db, tokenStore, connect, signOut, lastRejected],
  )

  return (
    <PowerSyncContext.Provider value={db}>
      <PowerSyncAppContext.Provider value={value}>{children}</PowerSyncAppContext.Provider>
    </PowerSyncContext.Provider>
  )
}
