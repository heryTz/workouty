import { defineConfig } from 'vitest/config'

// Pure unit tests (schema/drift/crud-mapping/connector): no Docker, no network, no live
// stack required. `*.node.test.ts` is the live-stack round-trip proof (Task C2) — it needs
// the Compose stack (api + powersync + postgres) up and running, so it's excluded here and
// owned by its own `test:sync` script/config instead. Mirrors apps/api's unit/e2e split.
export default defineConfig({
  // exercise-illustration-assets.ts imports the vendored SVG frames. Without this vitest tries to
  // parse them as modules; with it they resolve to a path string, which is all these tests need —
  // they assert the table's shape, not what the bundler makes of an asset.
  assetsInclude: ['**/*.svg'],
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.node.test.ts'],
  },
})
