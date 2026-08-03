import { defineConfig } from 'drizzle-kit'

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL is required. Did you `cp .env.example .env` at the repo root?')
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
})
