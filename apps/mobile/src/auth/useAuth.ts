// Thin hook wiring the pure auth-api client (./auth-api.ts) to the PowerSyncProvider (see
// ../powersync/PowerSyncProvider.tsx): screens call login/register/signOut here and get both
// "tokens stored" and "PowerSync connected/disconnected" for free.
//
// This file imports the provider context, which transitively pulls in the native PowerSync
// client chain (op-sqlite on native, wa-sqlite/WASM on web) — so, unlike auth-api.ts, it is
// NOT unit-testable under plain Node/vitest and deliberately has no test file. It's kept as
// thin as possible (no branching logic beyond store-then-connect) so nearly everything worth
// asserting already lives in auth-api.test.ts; this hook itself is exercised by the Chunk B
// screens + Playwright (per the M4 plan).
import { useCallback, useEffect, useState } from 'react'
import { usePowerSyncApp } from '@/powersync/PowerSyncProvider'
import { decodeJwtSub } from '@/powersync/jwt'
import { AuthError, login as apiLogin, performReset as apiPerformReset, register as apiRegister, requestReset as apiRequestReset } from './auth-api'

export interface UseAuthResult {
  isSignedIn: boolean
  // The signed-in user's id (the access token's `sub` claim), decoded client-side — needed for
  // local writes that must stamp `user_id` before the row has synced (e.g. a new custom
  // exercise, Task C1). Null while signed out or before the initial token-store check resolves.
  userId: string | null
  loading: boolean
  error: string | null
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  requestReset: (email: string) => Promise<void>
  performReset: (token: string, password: string) => Promise<void>
}

function messageFor(err: unknown): string {
  if (err instanceof AuthError) return err.message
  return err instanceof Error ? err.message : 'Something went wrong'
}

export function useAuth(): UseAuthResult {
  const { tokenStore, connect, signOut: providerSignOut } = usePowerSyncApp()

  const [isSignedIn, setIsSignedIn] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  // Starts true: the router guard (see app/(app)/_layout.tsx) needs to distinguish "we don't
  // know yet" from "definitely signed out" so it doesn't flash /login before the token-store
  // check below has had a chance to resolve. Also doubles as the loading flag for
  // login/register/signOut/etc below — screens see one `loading` for "an auth thing is
  // happening," whether that's the initial check or a user-triggered action.
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Initialize isSignedIn/userId from whatever's already in the store — covers app relaunch
  // with a previous session's tokens still present (mirrors PowerSyncProvider's own initial
  // connect() effect, which handles the sync side of the same case).
  useEffect(() => {
    let cancelled = false
    tokenStore
      .getAccessToken()
      .then((token) => {
        if (!cancelled && token) {
          setIsSignedIn(true)
          setUserId(decodeJwtSub(token))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tokenStore])

  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      setLoading(true)
      setError(null)
      try {
        const pair = await apiLogin(email, password)
        await tokenStore.setTokens(pair)
        await connect()
        setIsSignedIn(true)
        setUserId(decodeJwtSub(pair.accessToken))
      } catch (err) {
        setError(messageFor(err))
        throw err
      } finally {
        setLoading(false)
      }
    },
    [tokenStore, connect],
  )

  const register = useCallback(
    async (email: string, password: string): Promise<void> => {
      setLoading(true)
      setError(null)
      try {
        const pair = await apiRegister(email, password)
        await tokenStore.setTokens(pair)
        await connect()
        setIsSignedIn(true)
        setUserId(decodeJwtSub(pair.accessToken))
      } catch (err) {
        setError(messageFor(err))
        throw err
      } finally {
        setLoading(false)
      }
    },
    [tokenStore, connect],
  )

  const signOut = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      await providerSignOut()
      setIsSignedIn(false)
      setUserId(null)
    } catch (err) {
      setError(messageFor(err))
      throw err
    } finally {
      setLoading(false)
    }
  }, [providerSignOut])

  const requestReset = useCallback(async (email: string): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      await apiRequestReset(email)
    } catch (err) {
      setError(messageFor(err))
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const performReset = useCallback(async (token: string, password: string): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      await apiPerformReset(token, password)
    } catch (err) {
      setError(messageFor(err))
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  return { isSignedIn, userId, loading, error, login, register, signOut, requestReset, performReset }
}
