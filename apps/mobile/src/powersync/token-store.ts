// Abstraction over where the access/refresh token pair lives. Kept separate from the
// connector so the connector stays pure/testable (InMemoryTokenStore in tests / Node) while
// the device build can swap in a persisted, OS-keychain-backed implementation.

export interface TokenStore {
  getAccessToken(): Promise<string | null>
  getRefreshToken(): Promise<string | null>
  setTokens(t: { accessToken: string; refreshToken: string }): Promise<void>
  clear(): Promise<void>
}

// In-memory impl for tests / Node. Nothing persists across process restarts.
export class InMemoryTokenStore implements TokenStore {
  private accessToken: string | null = null
  private refreshToken: string | null = null

  async getAccessToken(): Promise<string | null> {
    return this.accessToken
  }

  async getRefreshToken(): Promise<string | null> {
    return this.refreshToken
  }

  async setTokens(t: { accessToken: string; refreshToken: string }): Promise<void> {
    this.accessToken = t.accessToken
    this.refreshToken = t.refreshToken
  }

  async clear(): Promise<void> {
    this.accessToken = null
    this.refreshToken = null
  }
}

const ACCESS_KEY = 'workouty.accessToken'
const REFRESH_KEY = 'workouty.refreshToken'

// expo-secure-store impl. MUST NOT import expo-secure-store at module top-level: this file
// (transitively, via connector.ts) needs to import cleanly in plain Node — e.g. under
// @powersync/node against the live stack, or in vitest — where the native module doesn't
// exist. Lazily dynamic-import it inside each method instead, so the import only happens
// when a method is actually invoked on-device.
//
// WEB CAVEAT (found running Milestone 4 Task A2 against a real browser): expo-secure-store has
// NO web implementation at all — its own `ExpoSecureStore.web.js` build output is a bare
// `export default {}` — so every SecureStore.*Async call throws `TypeError: ... is not a
// function` in a browser. That would break `connect()` (and eventually the Chunk B/C auth
// screens) on web entirely, which is the platform Milestone 4 verifies against (no Android
// device available). We fall back to `window.localStorage` on web only; native/device builds
// are unaffected and keep using the OS keychain via expo-secure-store as before. localStorage
// is NOT a secure store (no OS-level encryption) — acceptable for this dev/verification harness
// on web, not a production security posture; native remains the real target platform.
//
// `isWeb()` deliberately checks for `window.localStorage` directly instead of importing
// `Platform` from 'react-native' — importing the react-native package doesn't work cleanly
// under plain Node (vitest), and `window` is simply undefined there, so this check is a safe
// no-op off-web.
export class SecureTokenStore implements TokenStore {
  private isWeb(): boolean {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
  }

  private async secureStore() {
    return import('expo-secure-store')
  }

  async getAccessToken(): Promise<string | null> {
    if (this.isWeb()) return window.localStorage.getItem(ACCESS_KEY)
    const SecureStore = await this.secureStore()
    return SecureStore.getItemAsync(ACCESS_KEY)
  }

  async getRefreshToken(): Promise<string | null> {
    if (this.isWeb()) return window.localStorage.getItem(REFRESH_KEY)
    const SecureStore = await this.secureStore()
    return SecureStore.getItemAsync(REFRESH_KEY)
  }

  async setTokens(t: { accessToken: string; refreshToken: string }): Promise<void> {
    if (this.isWeb()) {
      window.localStorage.setItem(ACCESS_KEY, t.accessToken)
      window.localStorage.setItem(REFRESH_KEY, t.refreshToken)
      return
    }
    const SecureStore = await this.secureStore()
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_KEY, t.accessToken),
      SecureStore.setItemAsync(REFRESH_KEY, t.refreshToken),
    ])
  }

  async clear(): Promise<void> {
    if (this.isWeb()) {
      window.localStorage.removeItem(ACCESS_KEY)
      window.localStorage.removeItem(REFRESH_KEY)
      return
    }
    const SecureStore = await this.secureStore()
    await Promise.all([SecureStore.deleteItemAsync(ACCESS_KEY), SecureStore.deleteItemAsync(REFRESH_KEY)])
  }
}
