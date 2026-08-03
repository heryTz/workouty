import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { defineConfig } from 'vitest/config'

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true })

export default defineConfig({
  test: {
    environment: 'node',
    // Unit + integration tests, but NOT e2e (which boots a Nest app). test:e2e owns those.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.e2e.test.ts'],
  },
})
