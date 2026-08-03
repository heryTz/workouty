// Applies apps/api/drizzle/*.sql. Bundled by `db:build-migrate` into a standalone
// dist/migrate.mjs and run from docker-entrypoint.sh before the server starts.
//
// Uses drizzle-orm's programmatic migrator rather than the drizzle-kit CLI: drizzle-orm is a
// production dependency, drizzle-kit is a dev one, and shipping the CLI would drag esbuild
// and a second TypeScript into the runtime image just to run migrations once. Both read the
// same meta/_journal.json and both record applied migrations in `drizzle.__drizzle_migrations`,
// so this stays interchangeable with `pnpm db:migrate` on a developer's machine.
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

// Resolved against the working directory, not this file: the bundle lands in dist/ while the
// SQL stays in drizzle/, and both sit under the image's WORKDIR. `import.meta.dirname` would
// point at dist/ and would also break `nest build`, which compiles this same file to CommonJS.
const MIGRATIONS_FOLDER = 'drizzle'

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required to run migrations')

  const pool = new Pool({ connectionString })
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER })
    console.log(`migrations applied from ${MIGRATIONS_FOLDER}`)
  } finally {
    await pool.end()
  }
}

main().catch((err: unknown) => {
  console.error('migration failed:', err)
  process.exit(1)
})
