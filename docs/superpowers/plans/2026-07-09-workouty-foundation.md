# Workouty Foundation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo foundation — an isomorphic `packages/shared`, the Drizzle schema and migrations in `apps/api`, and a Docker Compose stack (Postgres, PowerSync Service on Postgres bucket storage, Mailpit) that comes up and actively replicates.

**Architecture:** Postgres is the source of truth. A self-hosted PowerSync Service replicates from it via logical replication into a *separate* Postgres database used for sync-bucket storage, then serves scoped replicas to clients. `apps/api` owns the Postgres schema; `packages/shared` owns only code that runs on both server and client.

**Tech Stack:** pnpm workspaces, TypeScript, Drizzle ORM + drizzle-kit, Zod (via drizzle-zod), Vitest, Docker Compose, Postgres 18, `journeyapps/powersync-service`, Mailpit.

---

## Scope

This is **plan 1 of 6**, covering **Milestone 1 (Foundation)** from §8 of
`docs/superpowers/specs/2026-07-09-workouty-design.md`.

The spec describes two independent subsystems (backend and mobile client). Writing them as
one plan would produce something no one could execute or verify incrementally. Each
milestone gets its own plan, and each must produce working, testable software on its own.

**This plan is done when:** `docker compose up -d` yields a healthy stack in which PowerSync
holds an *active logical replication slot* against the app database, and `pnpm test` passes.

**Deliberately NOT in this plan:** the NestJS application itself (Milestone 2), auth and the
JWKS endpoint (Milestone 2), the upload endpoint (Milestone 2), proving a client sync
round-trip (Milestone 3), and anything in `apps/mobile` (Milestones 4–6).

`apps/api` **is** created here, as a plain TypeScript package that owns the database schema
and migrations. It has to be: the Compose stack cannot be verified without tables, and the
replication publication cannot be created without them. Milestone 2 adds NestJS on top of it.

## Verified facts this plan depends on

These were read from the PowerSync docs and the official `powersync-ja/self-host-demo` repo
before writing, per the spec's §10 instruction. Do not re-derive them; do re-verify if a
step fails.

- Postgres bucket storage is supported (PowerSync Service **v1.3.8+**), configured as
  `storage: { type: postgresql }`. MongoDB is not required.
- **The bucket-storage database must be a separate database from the source database.**
  Hence two Postgres containers, not one. The service creates a `powersync` schema inside
  the storage database.
- The source Postgres needs `wal_level=logical`.
- Service image is `journeyapps/powersync-service`, started with `["start", "-r", "unified"]`
  (API server + replication worker in one container), config path via
  `POWERSYNC_CONFIG_PATH`.
- **Only environment variables named `PS_*` can be substituted into the PowerSync config**,
  using the `!env PS_NAME` YAML tag. Anything else must be a literal.
- Sync rules: a per-user bucket uses `parameters: SELECT request.user_id() as user_id` and
  filters with `WHERE user_id = bucket.user_id`. A bucket that **omits `parameters`
  entirely** is global and syncs to every client.

## Decision record: why the schema lives in `apps/api`

The spec originally placed the Drizzle schema in `packages/shared`, reasoning that one
shared schema stops the server and client from drifting. That reasoning does not survive
contact with PowerSync:

- The client **cannot use `pgTable`**. PowerSync's client schema is a different object
  describing SQLite tables. Two definitions exist no matter where they live; sharing the
  Postgres one does not collapse them into one.
- `drizzle-zod`'s `createInsertSchema(sets)` is a **runtime call against the Postgres table
  object**. Had `packages/shared` re-exported it, the first `import { estimateOneRepMax }
  from '@workouty/shared'` in the Expo app would have bundled `drizzle-orm/pg-core` into the
  Android and web clients.

So: `apps/api` owns the Postgres schema and its contracts. `packages/shared` holds only
**isomorphic** code with no database dependency. Type-only imports (`import type`) are erased
at build time and remain safe across the boundary.

The drift test that asserts the two schemas agree arrives in Milestone 4, when a client
schema exists to compare against.

## Deviations from the spec (deliberate, with reasons)

- **`sets.weight` is named `weight_kg`.** The spec fixes kilograms as the only unit. Encoding
  the unit in the column name is how you stop a future contributor from writing pounds into
  it. Same value, safer name.
- **A `users` table is added.** The spec's §5 data model omits it, but every table's
  `user_id` must reference something. Auth-specific tables (refresh tokens, reset tokens)
  are Milestone 2's job, not this plan's.
- **`users` is excluded from the Postgres publication.** The spec says only that sync rules
  scope reads. But replication happens *before* sync rules are applied, so publishing
  `users` would stream `password_hash` into the sync engine's storage. Publishing only the
  six app tables means the hash never leaves the app database.

## Testing philosophy for this plan

Do not write unit tests against Drizzle's table builders — that tests the library, not us.
Test three things instead:

1. **Our own logic** (the one-rep-max estimator) with plain unit tests.
2. **Our validation contracts**, which exercise the schema indirectly and catch real bugs
   (a negative rep count, a missing `user_id`).
3. **That the migration actually applies** and the constraints we care about really exist,
   by querying a live Postgres. A schema that only typechecks is not a schema that works.

## File structure

```
tsconfig.base.json            (new)  strict TS defaults, extended by every package
docker-compose.yml            (new)  postgres, pg-storage, powersync, mailpit
.env.example                  (new)  committed; real .env is gitignored
infra/
  powersync/
    powersync.yaml            (new)  service config: replication, storage, client_auth
    sync_rules.yaml           (new)  global exercise bucket + per-user bucket
  postgres/
    publication.sql           (new)  publication over the six app tables only
packages/shared/
  package.json                (new)  zero runtime dependencies
  tsconfig.json               (new)
  src/
    index.ts                  (new)
    one-rep-max.ts            (new)  Epley estimator
    one-rep-max.test.ts       (new)
apps/api/
  package.json                (new)  CommonJS, to match stable NestJS 11 — revisit at v12
  tsconfig.json               (new)
  drizzle.config.ts           (new)
  src/db/
    columns.ts                (new)  id + timestamp + soft-delete column set
    schema.ts                 (new)  the seven tables
    contracts.ts              (new)  Zod insert schemas via drizzle-zod
    contracts.test.ts         (new)
    migrate.test.ts           (new)  integration: migration applies, constraints hold
  drizzle/                    (generated) migration SQL
```

**On loading `.env`:** every command that needs `DATABASE_URL` gets it from `dotenv-cli` in
the package script (`dotenv -e ../../.env -- ...`). pnpm runs scripts with the package
directory as the working directory, so the relative path is stable. This avoids
`import.meta.url` (which would force ESM) and avoids per-command inline environment
variables — keeping `apps/api` **neutral about its module system**, which matters because
that choice is still open. See Task 3 Step 1.

---

## Chunk 1: Workspace, shared package, and the database layer

### Task 1: Root config, workspace scripts, and environment

**Files:**
- Create: `tsconfig.base.json`
- Create: `.env.example`
- Modify: `package.json`

- [ ] **Step 1: Create the shared TypeScript base config**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true
  }
}
```

- [ ] **Step 2: Add workspace-wide scripts to the root `package.json`**

Add a `scripts` block. Leave the rest of the file untouched.

```json
{
  "name": "workouty",
  "private": true,
  "version": "0.0.0",
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  }
}
```

- [ ] **Step 3: Create `.env.example`**

The real `.env` is already gitignored. Commit only the example.

```bash
POSTGRES_USER=workouty
POSTGRES_PASSWORD=workouty_dev_password
POSTGRES_DB=workouty

PG_STORAGE_USER=powersync_storage
PG_STORAGE_PASSWORD=powersync_dev_password
PG_STORAGE_DB=powersync_storage

# Used by drizzle-kit and the API's tests from the host, so it targets the published port.
DATABASE_URL=postgresql://workouty:workouty_dev_password@localhost:5432/workouty
```

- [ ] **Step 4: Create a working `.env`**

It must exist before any `apps/api` script runs, because `dotenv-cli` fails on a missing
file.

```bash
cp .env.example .env
git status --short
```

Expected: `.env` is **not** listed. `.env.example` is.

- [ ] **Step 5: Verify pnpm resolves the workspace**

Run: `pnpm -r list --depth -1`
Expected: lists `@workouty/mobile`. No error about a missing workspace.

- [ ] **Step 6: Commit**

```bash
git add tsconfig.base.json package.json .env.example
git commit -m "chore: add shared tsconfig, workspace scripts, and env example"
```

---

### Task 2: `packages/shared` and the one-rep-max estimator

This package must have **zero runtime dependencies**. It is imported by the Expo app.

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/one-rep-max.ts`
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/src/one-rep-max.test.ts`

- [ ] **Step 1: Create the package manifest**

`packages/shared/package.json`:

```json
{
  "name": "@workouty/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Create the package tsconfig**

`packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 3: Install dev dependencies only**

Nothing goes into `dependencies`. If a later change wants a runtime dependency here, that is
a signal the code belongs in `apps/api` instead.

```bash
pnpm --filter @workouty/shared add -D vitest typescript
```

- [ ] **Step 4: Write the failing test**

`packages/shared/src/one-rep-max.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { estimateOneRepMax } from './one-rep-max'

describe('estimateOneRepMax', () => {
  it('returns the lifted weight unchanged for a single rep', () => {
    // Epley applied blindly would return 62.0 here, overstating a true 1RM by 3.3%.
    expect(estimateOneRepMax(60, 1)).toBe(60)
  })

  it('applies the Epley formula above one rep', () => {
    // 60 * (1 + 8/30) = 76
    expect(estimateOneRepMax(60, 8)).toBeCloseTo(76, 10)
  })

  it('grows with reps at a fixed weight', () => {
    expect(estimateOneRepMax(100, 10)).toBeGreaterThan(estimateOneRepMax(100, 5))
  })

  it('accepts a bodyweight movement logged at zero added weight', () => {
    expect(estimateOneRepMax(0, 12)).toBe(0)
  })

  it.each([0, -1, 1.5, Number.NaN])('rejects a rep count of %s', (reps) => {
    expect(() => estimateOneRepMax(60, reps)).toThrow(RangeError)
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects a weight of %s', (weight) => {
    expect(() => estimateOneRepMax(weight, 5)).toThrow(RangeError)
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @workouty/shared test`
Expected: FAIL — cannot resolve `./one-rep-max`. (Vitest runs fine with no config file; it
auto-discovers `*.test.ts` and defaults to the `node` environment.)

- [ ] **Step 6: Write the minimal implementation**

`packages/shared/src/one-rep-max.ts`:

```ts
/**
 * Estimated one-rep max via the Epley formula.
 *
 * Epley is undefined at a single rep — it would inflate a true 1RM by 1/30. A set of one
 * IS the one-rep max, so it is returned unchanged.
 */
export function estimateOneRepMax(weightKg: number, reps: number): number {
  if (!Number.isFinite(weightKg) || weightKg < 0) {
    throw new RangeError(`weightKg must be a non-negative finite number, got ${weightKg}`)
  }
  if (!Number.isInteger(reps) || reps < 1) {
    throw new RangeError(`reps must be a positive integer, got ${reps}`)
  }
  if (reps === 1) return weightKg
  return weightKg * (1 + reps / 30)
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @workouty/shared test`
Expected: PASS (the two `it.each` blocks expand to 4 and 3 cases).

- [ ] **Step 8: Create the package entry point**

`packages/shared/src/index.ts`:

```ts
export * from './one-rep-max'
```

- [ ] **Step 9: Typecheck and commit**

Run: `pnpm --filter @workouty/shared typecheck`
Expected: no errors.

```bash
git add packages/shared pnpm-lock.yaml
git commit -m "feat(shared): add one-rep-max estimator with Epley single-rep correction"
```

---

### Task 3: Scaffold `apps/api` and define the Drizzle schema

No unit test on the schema — a table definition is a declaration, and asserting it matches
itself proves nothing. Task 4 tests it through the contracts; Task 6 tests it against a real
database.

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/db/columns.ts`
- Create: `apps/api/src/db/schema.ts`

- [ ] **Step 1: Create the package manifest**

Note the deliberate absence of `"type": "module"` — and check this decision before you act
on it, because it has an expiry date.

As of 2026-07-09, `@nestjs/core@latest` is **11.1.28**, which publishes no `"type"` field and
is therefore CommonJS. `@nestjs/core@next` is **12.0.0-alpha.5**, which *is* `"type":
"module"` — v12 migrates every official NestJS package to ESM. It is still alpha.

So this package stays CommonJS to match stable NestJS, not because ESM is wrong. See the
handoff note for the condition under which Milestone 2 should flip it.

**Do not assume this makes `packages/shared` importable from `apps/api`.** An earlier draft
of this plan claimed Node 22's `require(esm)` lets a CommonJS Nest app load it. That is
misleading: `require(esm)` loads ESM **JavaScript**, and it does not transpile TypeScript.
`packages/shared` publishes raw `.ts` in `main`/`exports`. Metro transpiles that for the
Expo app; a `tsc`-compiled NestJS app will not. The module system was never the obstacle —
the raw TypeScript entry point is. See the handoff note.

This does not affect Task 3, which must not depend on `@workouty/shared` at all.

`apps/api/package.json`:

```json
{
  "name": "@workouty/api",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "test": "dotenv -e ../../.env -- vitest run",
    "typecheck": "tsc --noEmit",
    "db:generate": "dotenv -e ../../.env -- drizzle-kit generate",
    "db:migrate": "dotenv -e ../../.env -- drizzle-kit migrate"
  }
}
```

- [ ] **Step 2: Create the package tsconfig**

`apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node"]
  },
  "include": ["src", "drizzle.config.ts"]
}
```

The `types` array is required by Task 5, not by this task. TypeScript 6 does not
auto-discover `@types/node`, and `drizzle.config.ts` reads `process.env.DATABASE_URL`, which
needs the Node ambient types. Adding it here avoids churn later; typecheck passes with or
without it at the end of Task 3.

Setting `types` explicitly disables auto-inclusion of other `@types` packages, which is safe
here: vitest helpers are imported explicitly rather than relied on as globals, and `pg`'s
types arrive through its module import, not an ambient.

Keep this scoped to `apps/api`. Do not move it into `tsconfig.base.json`.

- [ ] **Step 3: Install dependencies**

Let pnpm resolve current versions rather than pinning versions invented here.

```bash
pnpm --filter @workouty/api add drizzle-orm drizzle-zod zod pg
pnpm --filter @workouty/api add -D drizzle-kit vitest typescript dotenv-cli @types/pg @types/node
```

- [ ] **Step 4: Create the shared column set**

`apps/api/src/db/columns.ts`:

```ts
import { timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Every synced table shares these.
 *
 * Clients generate their own UUIDs offline, which is what makes an offline insert safe to
 * upload later without collision. The database default only fills in when a caller omits
 * one — which raw SQL (seeds, integration tests) does.
 *
 * There is no hard delete anywhere: a physical DELETE cannot be replicated to a client
 * that has not yet seen the row. Deletion means setting `deletedAt`.
 *
 * The database does NOT cascade a soft delete. Soft-deleting a parent leaves its children
 * live and syncable; the application must set `deletedAt` on the children too.
 */
export const baseColumns = {
  // `.defaultRandom()`, not `$defaultFn`. `$defaultFn` is a Drizzle-runtime default: it
  // runs in JS inside the query builder and emits NO Postgres DEFAULT, so any raw SQL
  // insert that omits `id` fails on NOT NULL. `.defaultRandom()` emits
  // `DEFAULT gen_random_uuid()` in the DDL.
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}
```

- [ ] **Step 5: Create the schema**

`apps/api/src/db/schema.ts`:

```ts
import { sql } from 'drizzle-orm'
import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { baseColumns } from './columns'

/**
 * Never published to the replication stream, and never synced to clients.
 * See infra/postgres/publication.sql.
 */
export const users = pgTable(
  'users',
  {
    ...baseColumns,
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
  },
  // Partial, so a soft-deleted account does not permanently reserve its email address.
  (t) => [uniqueIndex('users_email_uq').on(t.email).where(sql`${t.deletedAt} IS NULL`)],
)

/** `userId` NULL marks a built-in library row, synced to everyone via a global bucket. */
export const exercises = pgTable(
  'exercises',
  {
    ...baseColumns,
    userId: uuid('user_id').references(() => users.id),
    name: text('name').notNull(),
    muscleGroup: text('muscle_group').notNull(),
    defaultRestSeconds: integer('default_rest_seconds').notNull().default(90),
    // Invariant: `isCustom` is true exactly when `userId IS NOT NULL`. Kept as a column
    // for client-side query ergonomics against the SQLite mirror.
    isCustom: boolean('is_custom').notNull().default(false),
  },
  (t) => [
    // Two partial indexes, not one: Postgres treats NULLs as distinct, so a plain
    // unique(user_id, name) would happily allow duplicate built-in exercises.
    //
    // Both exclude soft-deleted rows. Without that, deleting a custom exercise would
    // permanently reserve its name and the user could never recreate it.
    //
    // A user's custom exercise MAY share a name with a built-in one: a row with
    // `user_id IS NOT NULL` is never checked against the global index. That is intended —
    // users shadow library entries.
    uniqueIndex('exercises_global_name_uq')
      .on(t.name)
      .where(sql`${t.userId} IS NULL AND ${t.deletedAt} IS NULL`),
    uniqueIndex('exercises_user_name_uq')
      .on(t.userId, t.name)
      .where(sql`${t.userId} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    index('exercises_user_id_idx').on(t.userId),
  ],
)

export const templates = pgTable(
  'templates',
  {
    ...baseColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
  },
  (t) => [index('templates_user_id_idx').on(t.userId)],
)

export const templateExercises = pgTable(
  'template_exercises',
  {
    ...baseColumns,
    // Denormalised from templates.user_id. PowerSync sync rules filter on columns present
    // in the row and cannot join to a parent, so ownership must live here.
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id),
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id),
    position: integer('position').notNull(),
    defaultRestSeconds: integer('default_rest_seconds').notNull(),
  },
  (t) => [
    index('template_exercises_user_id_idx').on(t.userId),
    // Deliberately not unique on (template_id, position): reordering swaps positions and a
    // unique constraint would reject the intermediate state.
    index('template_exercises_template_idx').on(t.templateId),
  ],
)

export const sessions = pgTable(
  'sessions',
  {
    ...baseColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    templateId: uuid('template_id').references(() => templates.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [index('sessions_user_started_idx').on(t.userId, t.startedAt)],
)

export const sessionExercises = pgTable(
  'session_exercises',
  {
    ...baseColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id),
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id),
    position: integer('position').notNull(),
  },
  (t) => [
    index('session_exercises_user_id_idx').on(t.userId),
    index('session_exercises_session_idx').on(t.sessionId),
  ],
)

export const sets = pgTable(
  'sets',
  {
    ...baseColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    sessionExerciseId: uuid('session_exercise_id')
      .notNull()
      .references(() => sessionExercises.id),
    setIndex: integer('set_index').notNull(),
    reps: integer('reps').notNull(),
    // doublePrecision, not numeric: numeric round-trips as a string in Drizzle, and the
    // client mirror of this column is a SQLite REAL. Matching types keeps the two sides
    // honest. The unit is in the name so nobody writes pounds into it.
    weightKg: doublePrecision('weight_kg').notNull(),
    // Rest taken AFTER this set, until "Stop rest" was pressed. The last set of an
    // exercise has no following rest, hence nullable.
    actualRestSeconds: integer('actual_rest_seconds'),
    performedAt: timestamp('performed_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('sets_user_id_idx').on(t.userId),
    index('sets_session_exercise_idx').on(t.sessionExerciseId),
  ],
)
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @workouty/api typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): add Drizzle schema with denormalised user_id and soft deletes"
```

---

### Task 4: TDD the Zod contracts

**Files:**
- Create: `apps/api/src/db/contracts.ts`
- Test: `apps/api/src/db/contracts.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/db/contracts.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { insertExerciseSchema, insertSetSchema } from './contracts'

const validSet = {
  userId: '00000000-0000-4000-8000-000000000001',
  sessionExerciseId: '00000000-0000-4000-8000-000000000002',
  setIndex: 0,
  reps: 8,
  weightKg: 60,
  actualRestSeconds: 90,
  performedAt: new Date('2026-07-09T10:00:00Z'),
}

describe('insertSetSchema', () => {
  it('accepts a well-formed set', () => {
    expect(insertSetSchema.safeParse(validSet).success).toBe(true)
  })

  it('accepts a null rest, which is how the final set of an exercise is recorded', () => {
    const result = insertSetSchema.safeParse({ ...validSet, actualRestSeconds: null })
    expect(result.success).toBe(true)
  })

  it('rejects a set with no owner, which sync rules could never scope', () => {
    const { userId: _omitted, ...orphan } = validSet
    expect(insertSetSchema.safeParse(orphan).success).toBe(false)
  })

  it.each([0, -3, 2.5])('rejects a rep count of %s', (reps) => {
    expect(insertSetSchema.safeParse({ ...validSet, reps }).success).toBe(false)
  })

  it('rejects a negative weight', () => {
    expect(insertSetSchema.safeParse({ ...validSet, weightKg: -1 }).success).toBe(false)
  })

  it('accepts a zero weight for bodyweight movements', () => {
    expect(insertSetSchema.safeParse({ ...validSet, weightKg: 0 }).success).toBe(true)
  })

  it('rejects a negative rest duration', () => {
    expect(insertSetSchema.safeParse({ ...validSet, actualRestSeconds: -1 }).success).toBe(false)
  })
})

// The name bound is the only refinement with string-length rather than numeric semantics,
// so it is the one rule the `sets` tests do not cover transitively.
describe('insertExerciseSchema', () => {
  const validExercise = { name: 'Bench press', muscleGroup: 'chest' }

  it('rejects an empty name', () => {
    expect(insertExerciseSchema.safeParse({ ...validExercise, name: '' }).success).toBe(false)
  })

  it('rejects a name longer than 120 characters', () => {
    const tooLong = 'a'.repeat(121)
    expect(insertExerciseSchema.safeParse({ ...validExercise, name: tooLong }).success).toBe(false)
  })

  it('accepts a name of exactly 120 characters', () => {
    const atLimit = 'a'.repeat(120)
    expect(insertExerciseSchema.safeParse({ ...validExercise, name: atLimit }).success).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workouty/api test`
Expected: FAIL — cannot resolve `./contracts`. (This works with no database running: the
contracts are pure. `dotenv-cli` needs `.env` to exist, which Task 1 Step 4 created.)

- [ ] **Step 3: Write the implementation**

`apps/api/src/db/contracts.ts`:

```ts
/**
 * Insert contracts derived from the Drizzle schema.
 *
 * These validate row SHAPE. They are NOT authorization.
 *
 * `createInsertSchema` includes every insertable column, so these schemas accept a
 * client-supplied `userId`, `id`, `createdAt`, `updatedAt` and `deletedAt`. The upload
 * endpoint (Milestone 2) must not trust any of them:
 *
 * - `userId` must be derived from the verified JWT. A client asserting its own ownership
 *   is exactly what the design forbids.
 * - `updatedAt` is the last-write-wins tiebreaker, so the server must stamp it. A client
 *   that sets it can win a conflict it should lose. `$onUpdate` does not protect you: an
 *   explicitly supplied value overrides it.
 *
 * Unknown keys are stripped rather than rejected. That is deliberate: a client newer than
 * the server may send a column the server has not migrated yet, and stripping keeps sync
 * working instead of hard-failing the batch.
 */
import { createInsertSchema } from 'drizzle-zod'
import { exercises, sessionExercises, sessions, sets, templateExercises, templates } from './schema'

export const insertExerciseSchema = createInsertSchema(exercises, {
  name: (s) => s.min(1).max(120),
  defaultRestSeconds: (s) => s.int().nonnegative(),
})

export const insertTemplateSchema = createInsertSchema(templates, {
  name: (s) => s.min(1).max(120),
})

export const insertTemplateExerciseSchema = createInsertSchema(templateExercises, {
  position: (s) => s.int().nonnegative(),
  defaultRestSeconds: (s) => s.int().nonnegative(),
})

export const insertSessionSchema = createInsertSchema(sessions)

export const insertSessionExerciseSchema = createInsertSchema(sessionExercises, {
  position: (s) => s.int().nonnegative(),
})

export const insertSetSchema = createInsertSchema(sets, {
  setIndex: (s) => s.int().nonnegative(),
  reps: (s) => s.int().positive(),
  weightKg: (s) => s.nonnegative(),
  actualRestSeconds: (s) => s.int().nonnegative().nullable(),
})
```

> **If this fails to typecheck:** `drizzle-zod`'s refinement callback signature changed
> across majors. Check the installed version's README for whether the callback receives the
> field schema (`(s) => s.int()`) or a factory. Adjust the callbacks; do not weaken the
> validation rules to make it compile.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workouty/api test`
Expected: PASS. `insertSetSchema` must reject `reps: 0`, `reps: 2.5`, and a missing `userId`.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @workouty/api typecheck`

```bash
git add apps/api/src/db
git commit -m "feat(api): add Zod insert contracts derived from the Drizzle schema"
```

---

### Task 5: Generate the initial migration

**Files:**
- Create: `apps/api/drizzle.config.ts`
- Generated: `apps/api/drizzle/*.sql`

- [ ] **Step 1: Create the drizzle-kit config**

`DATABASE_URL` is injected by `dotenv-cli` from the package script, so this file only reads
it. No `import.meta.url`, no `__dirname` — nothing that ties the file to a module system.

`apps/api/drizzle.config.ts`:

```ts
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
```

- [ ] **Step 2: Generate the migration**

`db:generate` reads the schema and the `DATABASE_URL` *string*; it does not open a
connection. No database is running yet, and that is fine.

```bash
pnpm --filter @workouty/api db:generate
```

Expected: a new `apps/api/drizzle/0000_*.sql` plus a `meta/` directory.

- [ ] **Step 3: Read the generated SQL before trusting it**

Confirm by eye that it contains:
- `"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL` on **every** table
- `CREATE TABLE "sets"` with `"user_id" uuid NOT NULL` and `"weight_kg" double precision NOT NULL`
- `"actual_rest_seconds" integer` (nullable — no `NOT NULL`)
- two partial unique indexes on `exercises`, each with a `WHERE` clause naming **both**
  `user_id` and `deleted_at`
- a partial unique index on `users(email)` with `WHERE "deleted_at" IS NULL`
- `"deleted_at" timestamp with time zone` on every table, nullable

**If `id` has no `DEFAULT`, stop.** It means `$defaultFn` crept back in: that is a
Drizzle-runtime default which emits no DDL, so every raw SQL insert that omits `id` — the
seeds, and Task 6's integration test — fails on NOT NULL. It must be `.defaultRandom()`.

If the partial indexes lack `WHERE`, the schema's `.where(...)` did not take effect — fix
before continuing, or duplicate built-in exercises become possible.

- [ ] **Step 4: Commit**

```bash
git add apps/api/drizzle apps/api/drizzle.config.ts
git commit -m "feat(api): generate initial Postgres migration"
```

---

## Chunk 2: Compose infrastructure

### Task 6: Bring up the two Postgres databases and apply migrations

PowerSync requires the bucket-storage database to be **separate from the source database**,
so this is two containers.

**Files:**
- Create: `docker-compose.yml`
- Test: `apps/api/src/db/migrate.test.ts`

- [ ] **Step 1: Create the Compose file with the two databases**

`docker-compose.yml` (the `powersync` and `mailpit` services are added in Tasks 8–9):

```yaml
name: workouty

services:
  postgres:
    image: postgres:18
    restart: unless-stopped
    # PowerSync replicates via the logical WAL; the default `replica` level is not enough.
    command: ["postgres", "-c", "wal_level=logical"]
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    # Loopback only. Nothing off-host needs the database: PowerSync reaches it over the
    # Compose network, and drizzle-kit/tests connect via localhost.
    ports:
      - "127.0.0.1:5432:5432"
    # The parent directory, NOT /var/lib/postgresql/data. postgres:18 moved PGDATA to
    # /var/lib/postgresql/18/docker, so the conventional `data` mount would persist nothing.
    volumes:
      - pg_data:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 5

  # PowerSync's internal bucket storage. It is a replication *sink*, never a source, so it
  # deliberately does NOT set wal_level=logical.
  pg-storage:
    image: postgres:18
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${PG_STORAGE_USER}
      POSTGRES_PASSWORD: ${PG_STORAGE_PASSWORD}
      POSTGRES_DB: ${PG_STORAGE_DB}
    ports:
      - "127.0.0.1:5433:5432"
    volumes:
      - pg_storage_data:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${PG_STORAGE_USER} -d ${PG_STORAGE_DB}"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pg_data:
  pg_storage_data:
```

- [ ] **Step 2: Start the databases**

```bash
docker compose up -d postgres pg-storage
docker compose ps
```

Expected: both services `running (healthy)`. Wait for the healthcheck if needed.

- [ ] **Step 3: Verify logical replication is actually on**

```bash
docker compose exec postgres psql -U workouty -d workouty -c "SHOW wal_level;"
```

Expected: `logical`. If it says `replica`, the `command:` override is not being applied.

- [ ] **Step 4: Write the failing migration test**

`apps/api/src/db/migrate.test.ts`. This talks to the running Compose Postgres, so it is an
integration test, not a unit test.

```ts
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

// This suite writes to the database. Fail fast rather than mutate something real.
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required. Is the Compose stack up?')

const { hostname } = new URL(databaseUrl)
if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
  throw new Error(`Refusing to run write tests against a non-local database: ${hostname}`)
}

const pool = new Pool({ connectionString: databaseUrl })
const db = drizzle(pool)

afterAll(async () => {
  await pool.end()
})

async function columnIsNullable(table: string, column: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT is_nullable FROM information_schema.columns
    WHERE table_name = ${table} AND column_name = ${column}
  `)
  const row = result.rows[0] as { is_nullable: string } | undefined
  if (!row) throw new Error(`${table}.${column} does not exist`)
  return row.is_nullable === 'YES'
}

describe('migrations', () => {
  // `users` is an application table but NOT a synced one — it is excluded from the
  // replication publication in Task 7. Do not rename this back to "synced".
  it('creates every application table', async () => {
    const result = await db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
    `)
    const tables = result.rows.map((r) => (r as { table_name: string }).table_name)
    for (const table of [
      'users',
      'exercises',
      'templates',
      'template_exercises',
      'sessions',
      'session_exercises',
      'sets',
    ]) {
      expect(tables).toContain(table)
    }
  })

  it('requires an owner on every child row, because sync rules cannot join to a parent', async () => {
    for (const table of ['sets', 'session_exercises', 'template_exercises']) {
      expect(await columnIsNullable(table, 'user_id')).toBe(false)
    }
  })

  it('allows a null rest on the final set of an exercise', async () => {
    expect(await columnIsNullable('sets', 'actual_rest_seconds')).toBe(true)
  })

  it('keeps deleted_at nullable so live rows are representable', async () => {
    expect(await columnIsNullable('sets', 'deleted_at')).toBe(true)
  })

  // The three write tests below run inside a transaction that always rolls back. That
  // leaks nothing when an assertion fails, issues no physical DELETE (which the design
  // forbids on replicated rows), and keeps fixture churn out of the logical WAL.

  it('gives id a database default, so raw inserts may omit it', async () => {
    // Regression: `$defaultFn` is a Drizzle-runtime default and emits no DDL DEFAULT, so
    // this insert would fail on NOT NULL. It must be `.defaultRandom()`.
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query(
        `INSERT INTO exercises (name, muscle_group) VALUES ($1, 'chest') RETURNING id`,
        [`test-default-${crypto.randomUUID()}`],
      )
      expect(result.rows[0].id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      )
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })

  it('prevents duplicate built-in exercises despite user_id being NULL', async () => {
    const name = `test-dup-${crypto.randomUUID()}`
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`INSERT INTO exercises (name, muscle_group) VALUES ($1, 'chest')`, [name])
      await expect(
        client.query(`INSERT INTO exercises (name, muscle_group) VALUES ($1, 'chest')`, [name]),
      ).rejects.toThrow(/exercises_global_name_uq/)
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })

  it('lets a soft-deleted exercise name be reused', async () => {
    // Regression: without `AND deleted_at IS NULL` in the partial unique index, deleting a
    // custom exercise would reserve its name forever.
    const name = `test-tomb-${crypto.randomUUID()}`
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`INSERT INTO exercises (name, muscle_group) VALUES ($1, 'chest')`, [name])
      await client.query(`UPDATE exercises SET deleted_at = now() WHERE name = $1`, [name])
      const result = await client.query(
        `INSERT INTO exercises (name, muscle_group) VALUES ($1, 'chest') RETURNING id`,
        [name],
      )
      expect(result.rows[0].id).toBeDefined()
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @workouty/api test`
Expected: FAIL — the tables do not exist yet. (If it instead fails to *connect*, the
databases from Step 2 are not up.)

- [ ] **Step 6: Apply the migration**

```bash
pnpm --filter @workouty/api db:migrate
```

Expected: drizzle-kit reports the migration applied.

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @workouty/api test`
Expected: PASS, including the duplicate-built-in-exercise rejection.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml apps/api pnpm-lock.yaml
git commit -m "feat(infra): add source and bucket-storage Postgres, verify migrations apply"
```

---

### Task 7: Create the replication publication

The publication defines what leaves the app database. Sync rules run *later*, inside
PowerSync — so anything published is already out of the app database's control.

**Files:**
- Create: `infra/postgres/publication.sql`

- [ ] **Step 1: Write the publication**

`infra/postgres/publication.sql`:

```sql
-- PowerSync replicates only what this publication exposes.
--
-- `users` is deliberately absent. It holds password_hash, and replication happens BEFORE
-- sync rules are evaluated, so publishing it would copy credential material into the sync
-- engine's storage database. Nothing about the client needs it.
--
-- Do NOT switch this to FOR ALL TABLES. The explicit list IS the security boundary: secret
-- tables (`users` now, `refresh_tokens` and `password_reset_tokens` in Milestone 2) must
-- never be auto-published. New app tables are opt-in here, by design.
--
-- Wrapped in a transaction on purpose. DROP and CREATE as separate statements leave a
-- window in which the publication does not exist, and any write committed during it is
-- silently dropped from the replication stream. Postgres has transactional DDL, so the
-- swap below is atomic.
--
-- Safe to re-run against a live PowerSync slot: replication slots are independent of
-- publications, so the slot survives and streaming continues.
BEGIN;

DROP PUBLICATION IF EXISTS powersync;

CREATE PUBLICATION powersync FOR TABLE
  exercises,
  templates,
  template_exercises,
  sessions,
  session_exercises,
  sets;

COMMIT;
```

- [ ] **Step 2: Apply it**

```bash
docker compose exec -T postgres psql -U workouty -d workouty < infra/postgres/publication.sql
```

Expected: `CREATE PUBLICATION`.

- [ ] **Step 3: Verify `users` is not published**

```bash
docker compose exec postgres psql -U workouty -d workouty \
  -c "SELECT tablename FROM pg_publication_tables WHERE pubname = 'powersync' ORDER BY tablename;"
```

Expected: exactly six rows — `exercises`, `session_exercises`, `sessions`, `sets`,
`template_exercises`, `templates`. **`users` must not appear.** If it does, the publication
was created `FOR ALL TABLES`; drop and recreate it.

- [ ] **Step 4: Assert the published set, so a mistake fails loudly**

Both failure modes here are silent. Publish nothing for a new synced table and the client
simply never receives that data — no error anywhere. Publish `users` by accident and nothing
complains either. An exact-set assertion turns both into a red test.

Append to the `describe('migrations')` block in `apps/api/src/db/migrate.test.ts` (this test
belongs to Task 7, not Task 6 — the publication does not exist until now):

```ts
  it('publishes exactly the six synced tables, and never users', async () => {
    // Asserting the EXACT set is the point. A new synced table that nobody published, or a
    // secret table that somebody did, both fail loudly here instead of silently.
    const result = await db.execute(sql`
      SELECT tablename FROM pg_publication_tables
      WHERE pubname = 'powersync' ORDER BY tablename
    `)
    const published = result.rows.map((r) => (r as { tablename: string }).tablename)
    expect(published).toEqual([
      'exercises',
      'session_exercises',
      'sessions',
      'sets',
      'template_exercises',
      'templates',
    ])
    expect(published).not.toContain('users')
  })
```

Run `pnpm --filter @workouty/api test` — 20 passing.

- [ ] **Step 5: Commit**

```bash
git add infra/postgres/publication.sql apps/api/src/db/migrate.test.ts
git commit -m "feat(infra): publish the six app tables, deliberately excluding users"
```

---

### Task 8: Configure and start the PowerSync Service

**Files:**
- Create: `infra/powersync/powersync.yaml`
- Create: `infra/powersync/sync_rules.yaml`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Write the sync rules**

`infra/powersync/sync_rules.yaml`:

```yaml
# Rows are never hard-deleted in Postgres — the server keeps its audit trail. But a
# soft-deleted row must leave the bucket, so PowerSync emits a REMOVE op and clients drop
# their local copy. Without `AND deleted_at IS NULL`, a soft-delete is just another PUT and
# every client accumulates tombstones forever.
#
# This mirrors the schema's partial unique indexes, which already treat a soft-deleted row
# as not-live.

bucket_definitions:
  # No `parameters` key => a global bucket, synced to every authenticated client.
  # This is the built-in exercise library (rows where user_id IS NULL).
  global_exercises:
    data:
      - SELECT * FROM exercises WHERE user_id IS NULL AND deleted_at IS NULL

  # `request.user_id()` reads the `sub` claim of the verified JWT.
  user_data:
    parameters: SELECT request.user_id() as user_id
    data:
      - SELECT * FROM exercises WHERE user_id = bucket.user_id AND deleted_at IS NULL
      - SELECT * FROM templates WHERE user_id = bucket.user_id AND deleted_at IS NULL
      - SELECT * FROM template_exercises WHERE user_id = bucket.user_id AND deleted_at IS NULL
      - SELECT * FROM sessions WHERE user_id = bucket.user_id AND deleted_at IS NULL
      - SELECT * FROM session_exercises WHERE user_id = bucket.user_id AND deleted_at IS NULL
      - SELECT * FROM sets WHERE user_id = bucket.user_id AND deleted_at IS NULL
```

**Two layers, not one.** "Never hard-DELETE at the source" is a statement about the Postgres
table: the row and its audit trail stay. Filtering `deleted_at` in the *sync rules* is a
different decision — the row stops matching the data query, PowerSync emits a REMOVE, and
the client drops its local copy. The server still has the row. An earlier draft of this plan
conflated the two and shipped sync rules with no `deleted_at` filter, which turned every
soft-delete into another PUT and left tombstones on every client forever.

- [ ] **Step 2: Write the service config**

`infra/powersync/powersync.yaml`. Note that **only `PS_*` environment variables can be
substituted** — everything else must be a literal.

```yaml
replication:
  connections:
    - type: postgresql
      uri: !env PS_DATA_SOURCE_URI
      sslmode: disable

# The bucket-storage database is a different database from the source. PowerSync creates
# and owns a `powersync` schema inside it.
storage:
  type: postgresql
  uri: !env PS_STORAGE_SOURCE_URI
  sslmode: disable

port: 8080

sync_config:
  path: /config/sync_rules.yaml

# The API that serves this JWKS endpoint arrives in Milestone 2. Until then no client
# authenticates, which does not prevent replication from running. See Step 5.
client_auth:
  jwks_uri: !env PS_JWKS_URL
  audience: ['workouty']

system:
  logging:
    level: info
    format: text

# Self-hosted means self-hosted. Left at its default, the service ships anonymous metrics
# to pulse.journeyapps.com.
telemetry:
  disable_telemetry_sharing: true
```

- [ ] **Step 3: Add the service to `docker-compose.yml`**

Insert before the `volumes:` block:

```yaml
  powersync:
    image: journeyapps/powersync-service:latest
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
      pg-storage:
        condition: service_healthy
    command: ["start", "-r", "unified"]
    # Not loopback-bound: a phone on the LAN must reach this in Milestone 4. Safe — client
    # auth fails closed (401) without a resolvable JWKS endpoint.
    ports:
      - "8080:8080"
    # Without a healthcheck, Task 10's cold start races the slot acquisition.
    healthcheck:
      test: ["CMD-SHELL", "node -e \"fetch('http://localhost:8080/probes/readiness').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval: 5s
      timeout: 5s
      retries: 12
    volumes:
      - ./infra/powersync:/config:ro
    environment:
      POWERSYNC_CONFIG_PATH: /config/powersync.yaml
      NODE_OPTIONS: --max-old-space-size=1000
      PS_DATA_SOURCE_URI: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      PS_STORAGE_SOURCE_URI: postgresql://${PG_STORAGE_USER}:${PG_STORAGE_PASSWORD}@pg-storage:5432/${PG_STORAGE_DB}
      PS_JWKS_URL: http://api:3000/.well-known/jwks.json
```

- [ ] **Step 4: Start it**

```bash
docker compose up -d powersync
docker compose logs -f powersync
```

- [ ] **Step 5: Handle the JWKS chicken-and-egg**

`api` is not a Compose service until Milestone 2, so `PS_JWKS_URL` resolves to an
unreachable host.

- **Expected:** PowerSync starts and begins replicating. JWKS is fetched lazily, when a
  client first authenticates. Continue.
- **If instead it exits at startup with a JWKS/auth error:** comment out the entire
  `client_auth:` block in `infra/powersync/powersync.yaml`, restart, and add a
  `# TODO(milestone-3): restore client_auth once the API serves JWKS` marker.
  No client connects before Milestone 3, so this is safe.

Record which branch you took in the commit message.

- [ ] **Step 6: Verify replication is genuinely running**

This is the real test of this milestone. A container that is merely "up" proves nothing.

```bash
docker compose exec postgres psql -U workouty -d workouty \
  -c "SELECT slot_name, plugin, active FROM pg_replication_slots;"
```

Expected: at least one slot, `active` = `t`. An inactive slot means PowerSync connected once
and then failed — read `docker compose logs powersync`.

- [ ] **Step 7: Verify the storage schema was created**

```bash
docker compose exec pg-storage psql -U powersync_storage -d powersync_storage -c "\dn"
```

Expected: a `powersync` schema. Its absence means bucket storage never initialised, and the
`storage:` block is misconfigured.

- [ ] **Step 8: Pin the image version**

`latest` is not reproducible. Read the running version and pin it:

```bash
docker inspect --format '{{index .Config.Image}}' $(docker compose ps -q powersync)
docker compose logs powersync | head -20   # the version is printed on startup
```

Replace `journeyapps/powersync-service:latest` in `docker-compose.yml` with the concrete
version tag, then `docker compose up -d powersync` and re-run Step 6.

**The pinned version must be >= 1.3.8.** That is the release that introduced Postgres bucket
storage. An older tag will fail to parse `storage: { type: postgresql }`, and the failure
will look like a config error rather than a version problem.

- [ ] **Step 9: Commit**

```bash
git add infra/powersync docker-compose.yml
git commit -m "feat(infra): self-hosted PowerSync on Postgres bucket storage"
```

---

### Task 9: Add Mailpit

Needed by Milestone 2's password-reset flow. Added here so the stack is complete and comes
up in one command.

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add the service**

```yaml
  mailpit:
    image: axllent/mailpit:latest
    restart: unless-stopped
    ports:
      - "1025:1025"  # SMTP, for the API
      - "8025:8025"  # web inbox, for you
```

- [ ] **Step 2: Start and verify the inbox**

```bash
docker compose up -d mailpit
curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:8025
```

Expected: `200`.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(infra): add Mailpit as the local SMTP sink"
```

---

### Task 10: Verify the whole stack from cold

A stack that only works because of the order you happened to start it in is not working.

- [ ] **Step 1: Tear everything down, including volumes**

```bash
docker compose down -v
```

- [ ] **Step 2: Bring the whole stack up with one command**

`--wait` blocks until every service with a healthcheck reports healthy — all four have one,
which is why they were added. It removes the race where verification runs before PowerSync
has finished booting.

```bash
docker compose up -d --wait
docker compose ps
```

Expected: `postgres`, `pg-storage`, `powersync`, `mailpit` all `(healthy)`. On this fresh
volume PowerSync comes up against an empty database — no tables, no publication yet. It is
healthy because the readiness probe reports the service is serving, not that replication has
data. The tables and publication arrive in Step 3.

- [ ] **Step 3: Re-apply schema and publication to the fresh volumes**

The order matters: the publication names tables, so they must exist first, and PowerSync
must restart to notice the publication.

```bash
pnpm --filter @workouty/api db:migrate
docker compose exec -T postgres psql -U workouty -d workouty < infra/postgres/publication.sql
docker compose restart powersync
docker compose up -d --wait powersync   # block until it is healthy again before verifying
```

- [ ] **Step 4: Confirm the replication slot is active again**

```bash
docker compose exec postgres psql -U workouty -d workouty \
  -c "SELECT slot_name, active FROM pg_replication_slots;"
```

Expected: exactly one slot, `active = t`. The slot *name* is assigned by PowerSync and is
not stable across a cold start — assert on `active`, never on a specific name.

- [ ] **Step 5: Run the full test suite**

```bash
pnpm test
```

Expected: `@workouty/shared` and `@workouty/api` tests all pass. The stack must be up —
`migrate.test.ts` is an integration test.

`pnpm -r test` skips packages with no `test` script, so `@workouty/mobile` is silently
passed over. Once it gains one (Milestone 4), check that the root `pnpm test` does not start
requiring an emulator.

- [ ] **Step 6: Write the runbook**

Steps 1–5 are the developer onboarding path and will be forgotten within a week. Capture
them in `README.md` under a `## Local development` heading: prerequisites (Docker, pnpm,
Node 22), `cp .env.example .env`, `docker compose up -d`,
`pnpm --filter @workouty/api db:migrate`, applying the publication, and how to reach the
Mailpit inbox at <http://localhost:8025>.

Two things a newcomer cannot infer and will otherwise lose an hour to:

- **The ordering constraint:** the publication can only be created after the migration has
  created the tables, and PowerSync must be restarted afterwards to pick it up.
- **`pnpm test` requires the stack to be running,** because `migrate.test.ts` is an
  integration test. A connection refusal is a missing `docker compose up`, not a broken test.

- [ ] **Step 7: Commit**

```bash
git add README.md
git commit -m "docs: add local development runbook"
```

---

## Definition of done

- [ ] `docker compose down -v && docker compose up -d` yields four running services from cold.
- [ ] `SHOW wal_level` returns `logical`.
- [ ] `pg_replication_slots` shows an **active** PowerSync slot.
- [ ] The `powersync` schema exists in the bucket-storage database.
- [ ] `pg_publication_tables` lists exactly six tables, and **`users` is not among them**.
- [ ] `pnpm test` passes, including the migration integration test.
- [ ] `packages/shared` has **zero runtime dependencies** (check its `package.json`).
- [ ] The PowerSync image is pinned to a concrete version, not `latest`.
- [ ] `README.md` documents the local development path.
- [ ] `.env` is untracked; `.env.example` is committed.

## Handoff to Milestone 2

The next plan turns `apps/api` into a NestJS application. It inherits from this one:

- `apps/api` already owns the schema, contracts, and migrations. NestJS is added *around*
  them; do not move them.
- **Decide the module system before installing NestJS.** Run `npm view @nestjs/core version`.
  - If it is still **11.x**, leave `apps/api` as CommonJS (no `"type": "module"`).
  - If **12.x has gone stable**, set `"type": "module"` and adopt ESM from the start. v12 is
    ESM-only across all official packages, and starting CommonJS then migrating is strictly
    more work than starting ESM.

  Nothing else in this plan depends on the choice: `drizzle.config.ts` avoids `import.meta`
  and `__dirname`, and `dotenv-cli` injects the environment from the package script, so both
  module systems work unchanged.

- **`packages/shared` exports raw TypeScript** (`"main": "./src/index.ts"`), and this is
  independent of the ESM/CommonJS question. Metro transpiles it for the Expo app. A
  `tsc`-compiled NestJS app will not: it emits a runtime `require("@workouty/shared")` that
  resolves to a `.ts` file, which Node cannot load without type-stripping, and a production
  `dist` will not contain `shared/src` at all. `require(esm)` does **not** help — it loads
  ESM JavaScript, not TypeScript.

  So **before `apps/api` first imports `@workouty/shared`, Milestone 2 must prove the import
  resolves at runtime**, not merely typechecks. Options: give `shared` a build step emitting
  JS, bundle it into the API, or use TypeScript project references. Verify by running the
  built API, not the test runner — vitest transpiles TS and will hide the problem.

  It does not bite in Milestone 1, where `shared` is consumed only by its own tests.
- The API must serve `GET /.well-known/jwks.json` at the address in `PS_JWKS_URL`
  (`http://api:3000/...` on the Compose network), and be added as a Compose service.
  `client_auth` did **not** need commenting out: PowerSync 1.23.3 resolves JWKS lazily, at
  first client auth, so it starts and replicates happily with an unreachable `PS_JWKS_URL`.
  Verified: client auth currently fails closed with `401 PSYNC_S2204 "JWKS request failed"`.

- **The JWT's `sub` must be the user's UUID, and `aud` must include `workouty`.** Sync rules
  compare `request.user_id()` — which reads `sub` — against the `uuid` column
  `exercises.user_id`. If Milestone 2 puts an email, a session id, or anything else in `sub`,
  every `user_data` query silently returns **zero rows**. There is no error; the user just
  sees an empty app. The `kid` must also resolve in the served JWKS.

- **Sync rules use `SELECT *`.** That is not brittle — the PowerSync client schema maps by
  column name and ignores columns it doesn't declare. But it means any column Milestone 2
  adds is streamed to every client with no deliberate review. Consider explicit column lists
  when the schema next changes.
- The `users` table exists but has no refresh-token or reset-token tables yet. Milestone 2
  adds them, and they must **not** be added to the publication. The exact-set test in
  `migrate.test.ts` will fail if they are, which is the intent.

- **Consider folding `publication.sql` into the Drizzle migration chain.** It is hand-applied
  today because it names tables and so cannot run from `docker-entrypoint-initdb.d`, and
  forgetting to run it fails silently (a slot that replicates nothing useful). The exact-set
  test converts that into a red suite, which is the cheap mitigation. The real fix is a
  custom SQL migration using `ALTER PUBLICATION ... SET TABLE ...`, which collapses
  `db:migrate` + `psql < publication.sql` into one step and removes the ordering footgun the
  runbook has to warn about. Deferred rather than reworked mid-milestone.

- **The Zod contracts are shape validation, not authorization.** `createInsertSchema`
  includes every insertable column, so `insertSetSchema` accepts a client-supplied `userId`,
  `id`, `createdAt`, `updatedAt` and `deletedAt`. The obvious upload-endpoint code —
  `insertSetSchema.parse(clientRow)` then insert — trusts all of them, which §4.6 of the
  spec forbids. Milestone 2 must derive `userId` from the verified JWT and let the server
  stamp `updatedAt`, since `updatedAt` decides last-write-wins and `$onUpdate` is overridden
  by any explicitly supplied value. Decide there whether to `.omit()` those columns into a
  dedicated upload contract; it was left undone here rather than guessing at the upsert shape.
- `packages/shared` stays free of database dependencies. Anything needing `drizzle-orm` or
  `pg` belongs in `apps/api`.
