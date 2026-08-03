import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.tsx'],
  format: ['cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
})
