import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { defineConfig } from 'vitest/config'

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true })

export default defineConfig({
  test: {
    environment: 'node',
    // Unit tests only — no Compose stack, no Postgres, no SMTP, which is what lets CI run this
    // on a PR without booting anything. `*.int.test.ts` hits the real database and Mailpit,
    // `*.e2e.test.ts` boots a Nest app on top of both; test:int and test:e2e own those.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.int.test.ts', '**/*.e2e.test.ts'],
  },
})
