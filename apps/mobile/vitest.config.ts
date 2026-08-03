import { defineConfig } from 'vitest/config'

// Pure unit tests (schema/drift/crud-mapping/connector): no Docker, no network, no live
// stack required. `*.node.test.ts` is the live-stack round-trip proof (Task C2) — it needs
// the Compose stack (api + powersync + postgres) up and running, so it's excluded here and
// owned by its own `test:sync` script/config instead. Mirrors apps/api's unit/e2e split.
export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.node.test.ts'],
  },
})
