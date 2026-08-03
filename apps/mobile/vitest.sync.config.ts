import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { defineConfig } from 'vitest/config'

// Loads DATABASE_URL etc. from the repo-root .env, same as apps/api/vitest.e2e.config.ts —
// this test polls Postgres directly (via `pg`) to prove the sync round-trip.
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true })

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.node.test.ts'],
    // Sync is async against a real running stack (register -> connect -> first sync ->
    // upload -> Postgres poll -> Postgres write -> download poll). Generous per-test/hook
    // timeouts; individual polls inside the test still have their own explicit budgets.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
