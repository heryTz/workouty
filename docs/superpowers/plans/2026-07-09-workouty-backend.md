# Workouty Backend (Auth + Sync) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `apps/api` into a NestJS application that issues PowerSync-compatible JWTs from email+password auth, serves a JWKS endpoint, supports refresh-token rotation and password reset over email, and exposes an authorised upload endpoint — so a client can authenticate and write, with the server as the only authority on ownership.

**Architecture:** NestJS wraps the existing Drizzle layer in `apps/api` (schema/contracts/migrations are not moved). Auth is Passport-local + `@nestjs/jwt` + argon2, signing RS256 JWTs whose `sub` is the user UUID and `aud` includes `workouty`. The public key is published at `/.well-known/jwks.json`, which the already-running PowerSync service validates against. The upload endpoint derives ownership from the verified JWT, never from the client.

**Tech Stack:** NestJS 11 (CommonJS), Passport, `@nestjs/jwt`, `jose` (RS256 + JWKS), argon2, Drizzle, Zod, React Email, Nodemailer → Mailpit, Vitest + Supertest, Docker.

---

## Scope

This is **plan 2 of 6**, covering **Milestone 2 (Backend)** from §8 of
`docs/superpowers/specs/2026-07-09-workouty-design.md`.

**This plan is done when:** the `api` service runs in Compose, a user can register and log
in, the issued JWT is accepted by the running PowerSync service (401→200 on the auth path),
refresh rotation and password reset work end to end against Mailpit, and the upload endpoint
writes a client's rows to Postgres while rejecting any attempt to write another user's rows —
all under test, with Milestone 1's 31 tests still green.

**Deliberately NOT in this plan:** the PowerSync *client* connector and a full offline→online
round-trip (Milestone 3); anything in `apps/mobile` (Milestones 4–6); choosing a production
email provider (deferred behind an interface); OAuth (out of scope for v1).

## Verified facts this plan depends on

Read from the PowerSync docs and the npm registry immediately before writing. Do not
re-derive; **do re-verify at execution time** where noted.

- **`@nestjs/core@latest` is `11.1.28` (CommonJS).** `@nestjs/core@next` is `12.0.0-alpha.5`
  (ESM-only), still alpha. So `apps/api` **stays CommonJS** — do not add `"type": "module"`.
  **Re-verify at execution time** with `npm view @nestjs/core version`; if 12.x has gone
  stable, see the Decision Record before proceeding.
- **PowerSync JWT requirements** (custom auth): `sub` = the user id (maps to
  `request.user_id()` in sync rules); `aud` must match the configured
  `client_auth.audience` (`['workouty']`); both `iat` and `exp` required, max lifetime
  86400s. **A JWT whose `iat` is older than 60 minutes is rejected** — access tokens must be
  short-lived and refreshed. Asymmetric algorithms recommended: use **RS256**. The JWT
  header must carry a **`kid`** that resolves to a key in the JWKS.
- **JWKS shape:** `{ "keys": [ { "kty": "RSA", "alg": "RS256", "kid": "...", "n": "...",
  "e": "..." } ] }`.
- **Upload semantics:** the client upload queue emits three op types — **PUT** (new row, all
  non-null columns), **PATCH** (row id + changed columns only), **DELETE** (row id only).
  The upload endpoint must be **synchronous** (apply immediately, not queue). Return **5xx
  only for transient failures** (the client retries); return **2xx for validation/permission
  rejections** (the client discards the op rather than retrying forever). The exact wire
  shape of a `CrudEntry` is ours to define because we write the client connector in
  Milestone 3 — **verify the SDK's `getCrudBatch()` / `CrudEntry` field names against the
  current `@powersync/*` docs before finalising the DTO** (Chunk E, Task E1).
- `docker-compose.yml` already bakes `PS_JWKS_URL=http://api:3000/.well-known/jwks.json`.
  So the `api` service must be named `api`, listen on `3000`, and serve JWKS at that path.

## Decision record (non-obvious choices, with reasons)

1. **`apps/api` stays CommonJS.** Stable NestJS is 11.x/CJS. If execution-time
   `npm view @nestjs/core version` shows 12.x stable, switch `apps/api` to `"type":
   "module"` and use NestJS's ESM path *before* Chunk A — do not build half in CJS.

2. **`packages/shared` and `packages/emails` get a real build step (tsup → dist).** This is
   the first integration risk and Milestone 1's handoff calls it out: `apps/api` is
   `tsc`-compiled, so a runtime `require("@workouty/shared")` that resolves to raw `.ts`
   fails, and a production `dist` won't contain `shared/src`. `require(esm)` does not
   transpile TS. Fix: each package builds to `dist` (CJS + `.d.ts`) and points `main`/`types`
   there; `exports` keeps a `source` condition so Metro (Milestone 4) still sees TS. We
   **prove this by starting the compiled API and hitting an endpoint that calls shared code**
   — vitest transpiles TS and would hide the failure. (Task A3.)

3. **RS256 + `jose` for signing and JWKS.** Asymmetric so PowerSync verifies via the public
   JWKS while only the API holds the private key. `jose` generates the keypair, signs with a
   `kid`, and exports the public JWK. Key material is loaded from env/secret, generated once
   and persisted (a keypair regenerated per boot would invalidate every outstanding token
   and break JWKS caching). (Chunk C.)

4. **Access token ≤ 15 min; refresh token opaque, rotated, hashed at rest.** PowerSync
   rejects JWTs older than 60 min, so access tokens are short. Refresh tokens are random
   opaque strings (not JWTs), stored **argon2-hashed** in `refresh_tokens`, rotated on every
   use (old one revoked, new one issued), and all of a user's refresh tokens are revoked on
   password reset. The client refreshes via PowerSync's `fetchCredentials` on reconnect
   (Milestone 3 wires that). (Chunk D.)

5. **Reset tokens: single-use, time-limited, hashed at rest; reset-request never reveals
   account existence.** `password_reset_tokens` stores an argon2 hash of a random token with
   a short expiry and a `used_at`. `POST /auth/reset-request` returns the **same 202**
   whether or not the email exists (no enumeration). (Chunk D.)

6. **The upload endpoint never trusts client-asserted identity or ordering fields.** It
   derives `user_id` from the verified JWT and **overwrites** any client-supplied `user_id`;
   it **stamps `updated_at`/`created_at`** server-side (they decide last-write-wins, and
   Drizzle's `$onUpdate` is overridden by an explicit value); for PATCH/DELETE it loads the
   existing row and **rejects the op (2xx, not applied) if its `user_id` ≠ the caller**. A
   dedicated **`uploadRowSchema`** is built by `.omit()`-ing the server-owned columns from
   the insert contracts — Milestone 1 deferred this rather than guess at the shape. (Chunk E.)

7. **Client DELETE maps to a soft delete.** The design forbids physical deletes on
   replicated rows. A client DELETE op sets `deleted_at = now()` (an UPDATE), never a
   physical `DELETE`. A PATCH that sets `deleted_at` is the same thing and also allowed.
   (Chunk E.)

8. **`refresh_tokens` and `password_reset_tokens` are NOT published.** They hold secrets and
   must never enter the replication stream. The exact-set publication test in
   `apps/api/src/db/migrate.test.ts` already fails if any table beyond the six app tables is
   published — keep it green; do not touch `publication.sql`.

## Deviations from the spec

- The spec's §5 data model names no auth tables. This plan adds `refresh_tokens` and
  `password_reset_tokens` (foreshadowed by §3.7's "refresh tokens rotate… revocable" and
  "single-use, time-limited" reset tokens). They live in `apps/api`'s schema, carry the same
  `baseColumns`, and are excluded from the publication.

## Testing philosophy

- **Auth logic is unit-tested at the service layer** (hash+verify, token issuance claims,
  rotation, revocation, reset single-use/expiry) — pure and fast.
- **The JWT is tested against its real contract**, not just "a token was returned": assert
  `sub` == the user UUID, `aud` includes `workouty`, header `kid` resolves in the served
  JWKS, and `exp - iat ≤ 900`.
- **The security-critical endpoints get e2e tests** (Supertest against a booted Nest app on
  the Compose Postgres): register/login, refresh rotation, reset over Mailpit, and upload
  authorisation (a user cannot write another user's rows).
- **Runtime resolution of `@workouty/shared` is proven by running the compiled app**, not by
  a transpiling test runner.
- Milestone 1's 31 tests stay green; the publication exact-set test is the guard that auth
  tables never get published.

## File structure

```
packages/shared/
  tsup.config.ts              (new)  build to dist (cjs + d.ts); keep `source` export for Metro
  package.json                (edit) add build script; main/types → dist; exports map
packages/emails/              (new package)
  package.json                (new)
  tsconfig.json               (new)
  tsup.config.ts              (new)
  src/
    index.ts                  (new)  export render functions
    reset-password.tsx        (new)  React Email template
    reset-password.test.ts    (new)  render returns HTML + text, contains the URL
apps/api/
  package.json                (edit) NestJS deps + scripts (start/build/start:dev/test:e2e)
  nest-cli.json               (new)
  tsconfig.json               (edit) NestJS compiler options (decorators, CJS)
  tsconfig.build.json         (new)
  src/
    main.ts                   (new)  bootstrap on :3000, global ValidationPipe, helmet
    app.module.ts             (new)
    db/                        (existing: schema.ts, columns.ts, contracts.ts, *.test.ts)
      schema.ts               (edit) add refresh_tokens, password_reset_tokens
      auth-contracts.ts       (new)  Zod: register/login/reset DTOs; uploadRowSchema via .omit()
      drizzle.module.ts       (new)  provides a Drizzle db handle (pg Pool) as a Nest provider
    health/
      health.controller.ts    (new)  GET /health — also proves @workouty/shared resolves
    crypto/
      keys.ts                 (new)  load/generate RS256 keypair; export public JWK (kid)
      keys.test.ts            (new)
    auth/
      auth.module.ts          (new)
      auth.service.ts         (new)  register, validate, issueTokens, rotateRefresh, reset
      auth.service.test.ts    (new)
      auth.controller.ts      (new)  /auth/register /login /refresh /reset-request /reset
      jwks.controller.ts      (new)  GET /.well-known/jwks.json
      jwt.service.ts          (new)  sign RS256 access tokens with sub/aud/kid/exp
      jwt.service.test.ts     (new)
      throttler config             rate-limit login + reset-request
    mail/
      mail.module.ts          (new)
      mailer.ts               (new)  SMTP interface + Nodemailer impl (Mailpit in dev)
    sync/
      upload.controller.ts    (new)  POST /sync/upload — authorised CRUD apply
      upload.service.ts       (new)  map PUT/PATCH/DELETE → Postgres, ownership-checked
      upload.service.test.ts  (new)
      upload.e2e.test.ts      (new)
    auth/auth.e2e.test.ts     (new)
docker-compose.yml            (edit) add the `api` service
.env.example                  (edit) add JWT_PRIVATE_KEY / issuer / SMTP_URL / token TTLs
```

Exact NestJS module wiring is written per task below. Where a task shows partial code, the
**named behaviours and tests are the contract** — match them; adapt syntax to the installed
versions, never weaken a security rule to compile (same rule as Milestone 1).

---

## Chunk A: NestJS bootstrap + prove `@workouty/shared` resolves at runtime

### Task A1: Give `packages/shared` a build step

**Files:** `packages/shared/tsup.config.ts` (new), `packages/shared/package.json` (edit)

- [ ] **Step 1: Re-verify the NestJS version decision**

Run: `npm view @nestjs/core version`
If `11.x`: continue, `apps/api` stays CommonJS. If `12.x` stable: STOP and apply Decision
Record item 1 (set `"type": "module"` in apps/api and use NestJS's ESM path) before any
further task.

- [ ] **Step 2: Add tsup and a build**

```bash
pnpm --filter @workouty/shared add -D tsup
```

`packages/shared/tsup.config.ts`:
```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
})
```

- [ ] **Step 3: Point the package at `dist` for Node, keep `source` for Metro**

Edit `packages/shared/package.json` — replace the `main`/`types`/`exports` so Node consumers
get built JS while Metro (Milestone 4) can still resolve TS source. **Remove the existing
`"type": "module"` key.** With `"type": "module"` present, tsup emits its CJS bundle as
`dist/index.cjs` (so Node won't misread a `.js` as ESM), which would make `main:
"./dist/index.js"` point at a nonexistent file and break `require('@workouty/shared')`.
Dropping `"type": "module"` makes `dist/index.js` a plain CJS file; Metro still gets TS via
the `source` condition; vitest transpiles the `src` TS regardless of the `type` field, so
the 11 existing tests are unaffected.
```json
{
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "source": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```
After editing, confirm `"type": "module"` is gone: `grep '"type"' packages/shared/package.json`
returns nothing.

- [ ] **Step 4: Build and confirm the artifact exists**

Run: `pnpm --filter @workouty/shared build`
Expected: `packages/shared/dist/index.js` and `index.d.ts` exist. `node -e "require('./packages/shared/dist/index.js').estimateOneRepMax(60,8)"` prints nothing but exits 0 (require resolves).

- [ ] **Step 5: Shared's own tests still pass** (vitest runs on `src`, unaffected)

Run: `pnpm --filter @workouty/shared test` → 11 passing.

- [ ] **Step 6: Commit**
```bash
git add packages/shared
git commit -m "build(shared): emit dist so Node consumers can require it at runtime"
```

### Task A2: Scaffold the NestJS app in `apps/api`

**Files:** `apps/api/package.json` (edit), `nest-cli.json`, `tsconfig.json` (edit),
`tsconfig.build.json`, `src/main.ts`, `src/app.module.ts`

- [ ] **Step 1: Install NestJS**
```bash
pnpm --filter @workouty/api add @nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata rxjs helmet class-validator class-transformer
pnpm --filter @workouty/api add -D @nestjs/cli @nestjs/testing @nestjs/schematics supertest @types/supertest ts-node source-map-support
```
`class-validator` and `class-transformer` are runtime deps, not optional: `main.ts`
constructs a global `ValidationPipe`, whose constructor eagerly `loadPackage`s both and
crashes the process at boot if either is missing.

Also add `@workouty/shared` as a **runtime dependency** of `apps/api`:
`pnpm --filter @workouty/api add @workouty/shared@workspace:*`. The compiled app `require`s it
(Task A3), and pnpm's strict linking will not symlink an undeclared workspace package — an
omission here surfaces as `Cannot find module '@workouty/shared'` only when the built app
runs, which is precisely the failure A3 exists to catch.

- [ ] **Step 2: `apps/api/src/main.ts`** — boot on 3000 with global validation
```ts
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import helmet from 'helmet'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.use(helmet())
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  await app.listen(3000, '0.0.0.0')
}
void bootstrap()
```

- [ ] **Step 3: `apps/api/src/app.module.ts`** — empty for now; Task A3 registers the health
controller and later chunks add the auth/mail/sync modules. Keeping it empty here lets the
Step 5 build succeed before any controller file exists.
```ts
import { Module } from '@nestjs/common'

@Module({})
export class AppModule {}
```

- [ ] **Step 4: `nest-cli.json`, `tsconfig.build.json`, tsconfig edits** — CommonJS, decorators.
`apps/api/tsconfig.json` must set `experimentalDecorators`, `emitDecoratorMetadata`,
`module: "nodenext"`, `moduleResolution: "nodenext"`, `target: "ES2022"`, `outDir: "./dist"`,
`types: ["node"]`, and **not** set `"type": "module"` in package.json (so `nodenext` resolves
to CommonJS emit). This overrides the workspace base's `module: ESNext`/`noEmit` — NestJS
needs real emit; keep `noEmit` off here.

`nodenext` (not `node`) is deliberate: it reads package.json `"exports"`, which `jose` v5 and
several modern deps rely on for their type entrypoints. `moduleResolution: "node"` would fail
to resolve `jose`'s types. Verified: because `apps/api` has no `"type": "module"`, `nodenext`
resolves every file to **CommonJS** — `nest build` emits a CJS `dist/main.js`, and
extensionless relative imports (`./app.module`) resolve without change, because the
`.js`-extension rule applies only to files in ESM mode. If `nodenext` ever fights the
scaffolding, fall back to `module: "commonjs"` + `moduleResolution: "bundler"` (which also
reads `exports`) — never to plain `"node"`, which reintroduces the `jose` types failure.

Concrete `apps/api/tsconfig.json`:
```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "target": "ES2022",
    "outDir": "./dist",
    "noEmit": false,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "types": ["node"]
    // esModuleInterop, strict, skipLibCheck inherited from the base
  },
  "include": ["src", "drizzle.config.ts"]
}
```

`nest-cli.json`:
```json
{ "$schema": "https://json.schemastore.org/nest-cli", "collection": "@nestjs/schematics", "sourceRoot": "src", "compilerOptions": { "deleteOutDir": true } }
```

`apps/api/tsconfig.build.json` — **roots the build at `src` so emit lands at `dist/main.js`**,
not `dist/src/main.js`. Without `rootDir: "src"` + `include: ["src"]`, `drizzle.config.ts`
(at the package root, kept in the main tsconfig for typecheck) pulls the inferred rootDir up
to `apps/api/` and the entrypoint compiles to `dist/src/main.js` — breaking `node dist/main.js`
in the `start` script, the C2 Dockerfile, and A3's runtime proof.
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": "src" },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.e2e.test.ts"]
}
```

Add scripts to `apps/api/package.json`: `"build": "nest build"`, `"start": "node dist/main.js"`,
`"start:dev": "nest start --watch"`, keep `test`, and add
`"test:e2e": "dotenv -e ../../.env -- vitest run --config vitest.e2e.config.ts"`.

- [ ] **Step 5: Build the compiled app**

Run: `pnpm --filter @workouty/api build`. Confirm `nest build` produces `apps/api/dist/main.js`
with no error (the module is empty, so this is a pure toolchain check — no routes yet). The
`/health` route and the runtime-resolution proof are Task A3.

- [ ] **Step 6: Commit**
```bash
git add apps/api nest-cli.json
git commit -m "feat(api): scaffold NestJS app (CommonJS) on the existing Drizzle package"
```

### Task A3: Prove `@workouty/shared` resolves at runtime (health endpoint)

**Files:** `apps/api/src/health/health.controller.ts` (new), `apps/api/src/app.module.ts` (edit — register the controller)

This is the integration risk from Milestone 1's handoff. The health route calls a shared
function so that a broken workspace-resolution setup fails a running-app check, not just a
type-check.

- [ ] **Step 1: Write a failing e2e test** `apps/api/src/health/health.e2e.test.ts`
```ts
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { INestApplication } from '@nestjs/common'
import { AppModule } from '../app.module'

let app: INestApplication
beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication()
  await app.init()
})
afterAll(async () => { await app.close() })

it('serves health and proves @workouty/shared is callable at runtime', async () => {
  const res = await request(app.getHttpServer()).get('/health').expect(200)
  expect(res.body.status).toBe('ok')
  // 60kg x 8 via Epley = 76 — proves the shared package is imported and executes.
  expect(res.body.oneRepMaxProbe).toBeCloseTo(76, 10)
})
```
Add `apps/api/vitest.e2e.config.ts` loading the root `.env` (mirror the unit `vitest.config`),
with `include: ['src/**/*.e2e.test.ts']`. **Also add a unit `apps/api/vitest.config.ts`** that
loads the root `.env` and **excludes `**/*.e2e.test.ts`**, and simplify the unit `test` script
to `vitest run` (the config supplies the env, so `dotenv-cli` is no longer needed there).
Without this, vitest's default `**/*.test.ts` include sweeps every `.e2e.test.ts` into the
unit run — so e2e tests double-run and drag a booted Nest app + supertest into what should be
the fast unit suite. This split is a convention for the whole milestone: unit/integration
tests run under `test`, Nest e2e tests under `test:e2e`. `@workouty/api` also needs `dotenv` as
a devDependency (the config `import`s it, distinct from the `dotenv-cli` binary).

- [ ] **Step 2: Implement** `health.controller.ts`
```ts
import { Controller, Get } from '@nestjs/common'
import { estimateOneRepMax } from '@workouty/shared'

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { status: 'ok', oneRepMaxProbe: estimateOneRepMax(60, 8) }
  }
}
```

Then register it in `app.module.ts`:
```ts
import { Module } from '@nestjs/common'
import { HealthController } from './health/health.controller'

@Module({ controllers: [HealthController] })
export class AppModule {}
```

- [ ] **Step 3: THE critical verification — run the COMPILED app, not the test runner**

The e2e test uses vitest (which transpiles TS and would hide a resolution bug). So also:
```bash
pnpm --filter @workouty/shared build
pnpm --filter @workouty/api build
node apps/api/dist/main.js &
curl -fsS http://localhost:3000/health   # must return {"status":"ok","oneRepMaxProbe":76}
kill %1
```
If `node dist/main.js` throws `Cannot find module '@workouty/shared'` or `Unexpected token`
resolving a `.ts` file, the build wiring is wrong — fix Task A1's `exports`/`main` (or add a
build-order dependency) until the **compiled** app serves 76. Do not proceed on a green
vitest alone.

- [ ] **Step 4: Commit**
```bash
git add apps/api
git commit -m "feat(api): health endpoint proving @workouty/shared resolves in the built app"
```

---

## Chunk B: Auth core — tables, hashing, register/login, JWT issuance

### Task B1: Add `refresh_tokens` and `password_reset_tokens`, migrate, keep publication green

**Files:** `apps/api/src/db/schema.ts` (edit), generated migration, run against Compose DB

- [ ] **Step 1: Add the two tables** to `schema.ts` (append; do not touch existing tables):
```ts
export const refreshTokens = pgTable('refresh_tokens', {
  ...baseColumns,
  userId: uuid('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull(),        // argon2 hash of the opaque token
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (t) => [index('refresh_tokens_user_id_idx').on(t.userId)])

export const passwordResetTokens = pgTable('password_reset_tokens', {
  ...baseColumns,
  userId: uuid('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
}, (t) => [index('password_reset_tokens_user_id_idx').on(t.userId)])
```

- [ ] **Step 2: Generate + apply the migration**
```bash
pnpm --filter @workouty/api db:generate
pnpm --filter @workouty/api db:migrate
```
Read the generated SQL: both tables present, `token_hash` NOT NULL, `id` defaults
`gen_random_uuid()`.

- [ ] **Step 3: The publication guard must STILL be green** — the exact-set test asserts the
publication is exactly the six app tables. Run `pnpm --filter @workouty/api test`. If the new
tables somehow got published, that test goes red — they must not be in `publication.sql`
(don't touch it). Expected: still 20 passing (the two new tables add no published rows).

- [ ] **Step 4: Commit**
```bash
git add apps/api/src/db/schema.ts apps/api/drizzle
git commit -m "feat(api): add refresh_tokens and password_reset_tokens (never published)"
```

### Task B2: Drizzle provider + password hashing service (TDD)

**Files:** `db/drizzle.module.ts`, `auth/password.ts` + `password.test.ts`

- [ ] **Step 1: `pnpm --filter @workouty/api add argon2`**
- [ ] **Step 2: TDD `password.ts`** — `hashPassword`/`verifyPassword` using argon2id. Tests:
a hash verifies against its password; a wrong password fails; two hashes of the same password
differ (salted); `verifyPassword` returns false (not throws) on a malformed hash.
- [ ] **Step 3: `drizzle.module.ts`** — a Nest provider exposing a `db` handle built from a
`pg` Pool on `process.env.DATABASE_URL`, closable on module destroy.
- [ ] **Step 4:** `pnpm --filter @workouty/api test` green. Commit.

### Task B3: JWT signing keys + `jwt.service.ts` (TDD, the load-bearing claims)

**Files:** `crypto/keys.ts` + `keys.test.ts`, `auth/jwt.service.ts` + `jwt.service.test.ts`

- [ ] **Step 1: `pnpm --filter @workouty/api add jose`**
- [ ] **Step 2: TDD `keys.ts`** — loads an RS256 private key from `process.env.JWT_PRIVATE_KEY`
(PKCS8 PEM) or, if unset in dev, generates one; derives the public JWK with a stable `kid`
(kid = base64url of a SHA-256 thumbprint). Export `getPrivateKey()`, `getPublicJwk()`, `KID`.
Test: the public JWK has `kty:"RSA"`, `alg:"RS256"`, an `n`/`e`, and a `kid`; the same env key
yields the same `kid` across two loads (stability).

- [ ] **Step 3: TDD `jwt.service.ts`** — `signAccessToken(userId)` returns an RS256 JWT.
**These assertions are the point of the milestone (Milestone 1 handoff constraint 4):**
```ts
it('issues a PowerSync-compatible access token', async () => {
  const jwt = await service.signAccessToken('11111111-1111-4111-8111-111111111111')
  const { payload, protectedHeader } = await jwtVerify(jwt, await getPublicKey(), { audience: 'workouty' })
  expect(payload.sub).toBe('11111111-1111-4111-8111-111111111111') // sub == user UUID
  expect(payload.aud).toContain('workouty')                        // aud includes workouty
  expect(protectedHeader.kid).toBe(KID)                            // kid resolves in JWKS
  expect(protectedHeader.alg).toBe('RS256')
  expect((payload.exp! - payload.iat!)).toBeLessThanOrEqual(900)   // <= 15 min (< PowerSync's 60)
})
```
Config: issuer + `aud: ['workouty']` + `expiresIn: '15m'`, `kid` in the header. Commit.

### Task B4: `auth.service.ts` register/validate + `auth.controller.ts` register/login (TDD + e2e)

**Files:** `auth/auth-contracts.ts`, `auth/auth.service.ts` (+test), `auth/auth.controller.ts`, `auth/auth.module.ts`, `auth/auth.e2e.test.ts`

- [ ] **Step 1: Zod DTOs** in `auth-contracts.ts`: `registerSchema` (email valid, password
min length), `loginSchema`. Use a Nest Zod validation pipe (or `nestjs-zod`).
- [ ] **Step 2: TDD `auth.service.ts`** — `register(email, password)` hashes + inserts a user
(unique email; a duplicate throws a 409-mapped error); `validate(email, password)` returns
the user on match, null otherwise (constant-ish: always run a hash even on unknown email to
blunt timing). Unit-test both.
- [ ] **Step 3: `auth.controller.ts`** — `POST /auth/register` (201) and `POST /auth/login`
(200), each returning `{ accessToken }` via Task B3's `signAccessToken`. **Access token only
for now** — refresh tokens require `issueTokens`, which arrives in Task D1; D1 extends these
two responses to `{ accessToken, refreshToken }`. Wire `ThrottlerModule` and put a tight rate
limit on `/auth/login`. (This keeps Chunk B self-contained: the only pre-D1 consumer is the
PowerSync auth proof in C2, which uses `.accessToken`.)
- [ ] **Step 4: e2e** `auth.e2e.test.ts` on the Compose DB: register → login → decode the
returned access token and assert the Task B3 claim-shape holds for a *real* registered user's
UUID. Clean up the user row (transaction-rollback pattern, like Milestone 1's migrate tests).
- [ ] **Step 5:** all tests green. Commit.

---

## Chunk C: JWKS endpoint + restore real PowerSync auth (401 → 200)

### Task C1: Serve `GET /.well-known/jwks.json`

**Files:** `auth/jwks.controller.ts`

- [ ] **Step 1: e2e test** — `GET /.well-known/jwks.json` returns `{ keys: [ { kid: KID,
  kty:"RSA", alg:"RS256", n, e } ] }`, `Cache-Control` sane, no private fields (`d`, `p`, `q`).
- [ ] **Step 2: Implement** returning `{ keys: [getPublicJwk()] }`.
- [ ] **Step 3: Commit.**

### Task C2: Add the `api` service to Compose and prove PowerSync accepts a real token

**Files:** `docker-compose.yml` (edit), `.env.example` (edit)

- [ ] **Step 1: Add the `api` service** (name MUST be `api`, port 3000): build from
`apps/api` (a `Dockerfile` that builds `packages/shared` + `apps/api` and runs
`node dist/main.js`), `depends_on: postgres healthy`, `environment` with `DATABASE_URL`
(pointing at `postgres:5432` on the Compose network, not loopback), `JWT_PRIVATE_KEY`,
`SMTP_URL=smtp://mailpit:1025`, a healthcheck hitting `/health`. Publish `3000` (loopback is
fine for dev; the phone in Milestone 4 talks to PowerSync's 8080 and the API via the host —
decide bind then). Add the new env keys to `.env.example`.

- [ ] **Step 2: Bring it up:** `docker compose up -d --wait api` → healthy.

- [ ] **Step 3: THE end-to-end auth proof.** Milestone 1 verified PowerSync currently fails
client auth **closed** with `401 PSYNC_S2204 "JWKS request failed"` (no api service). Now:
```bash
# register+login via the running api to get an access token, then hit PowerSync:
TOKEN=$(curl -sS -XPOST localhost:3000/auth/register -H 'content-type: application/json' \
  -d '{"email":"c2probe@x.test","password":"correct horse battery staple"}' | jq -r .accessToken)
curl -sS -o /dev/null -w '%{http_code}\n' -XPOST localhost:8080/sync/stream \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{}'
```
Expected: **no longer `PSYNC_S2204` (JWKS failed)**. A valid signed token should now pass
JWKS verification. It may still 4xx for an unrelated reason (empty body / stream params) —
what matters is that PowerSync **fetched the JWKS and verified the signature**. Capture the
exact response and confirm the failure mode CHANGED from "JWKS request failed". If it still
says JWKS failed, PowerSync can't reach `http://api:3000/.well-known/jwks.json` on the Compose
network — debug DNS/service name. Clean up the probe user.

- [ ] **Step 4: Commit**, noting in the body the before (`S2204`) → after response codes.

---

## Chunk D: Refresh rotation + password reset over email

### Task D1: Refresh-token issue + rotate + revoke (TDD + e2e)

**Files:** `auth.service.ts` (extend) + tests, `auth.controller.ts` (`POST /auth/refresh`)

- [ ] **Step 1: TDD the service.** `issueTokens(userId)` returns a short access token + a new
opaque refresh token (crypto-random), storing its **argon2 hash** + expiry in
`refresh_tokens`. `rotateRefresh(rawToken)`: find the matching non-revoked, non-expired row
(verify by hash), **revoke it**, issue a fresh pair; a reused/revoked/expired/unknown token
throws (maps to 401). Assert: rotation revokes the old row; a second use of the old token
fails; an expired token fails.

  **The revoke must be an atomic conditional UPDATE, not a SELECT-then-UPDATE.** A plain
  "SELECT the row, check `revoked_at` in JS, then UPDATE" under READ COMMITTED lets two
  concurrent rotations of the same token both see `revoked_at IS NULL` and both succeed —
  minting two token pairs from one refresh token (a reuse vulnerability, proven live during
  review). Verify the secret and expiry first (those don't race), then gate the revoke:
  `UPDATE refresh_tokens SET revoked_at = now() WHERE id = ? AND revoked_at IS NULL RETURNING id`,
  and only issue the new pair if exactly one row was affected; otherwise 401. Include a
  concurrency test: `Promise.all([rotate(t), rotate(t)])` must yield exactly one success.
- [ ] **Step 2: `POST /auth/refresh`** returns a new pair. **Also extend `/auth/register` and
`/auth/login` to return `{ accessToken, refreshToken }`** now that `issueTokens` exists —
update their e2e tests to assert both fields are present. e2e: login → refresh → old refresh
token rejected, new one works.
- [ ] **Step 3: Commit.**

### Task D2: `packages/emails` with the React Email reset template (TDD)

**Files:** whole new `packages/emails` package

- [ ] **Step 1: Scaffold** with `@react-email/components` + `@react-email/render`, tsup build
(same dist pattern as `packages/shared` — CJS output, **no `"type": "module"`**, `main` →
`dist/index.js`, `source` export → `src/index.ts` — so the CJS NestJS app can require it),
and a `react-email` dev script for previewing. Note: React Email components are `.tsx`; tsup
needs `esbuild`'s JSX handling (default) — set `entry: ['src/index.ts']` and let it pull the
`.tsx` templates in transitively.
- [ ] **Step 2: TDD `reset-password.tsx` + a `renderResetPassword({ url })` export** returning
`{ html, text }`. Test (vitest): the returned `html` contains the reset `url` and the `text`
fallback is non-empty and also contains the url. No backend needed.
- [ ] **Step 3: Build; confirm `require('@workouty/emails')` works from Node** (same runtime
proof as Task A3 — a compiled require, not just vitest).
- [ ] **Step 4: Commit.**

### Task D3: Mailer + reset-request/reset endpoints (TDD + e2e against Mailpit)

**Files:** `mail/mailer.ts` + module, `auth.service.ts` (reset methods) + tests, `auth.controller.ts` (`/auth/reset-request`, `/auth/reset`)

- [ ] **Step 1: `mailer.ts`** — a `Mailer` interface (`send({to, subject, html, text})`) with a
Nodemailer implementation reading `SMTP_URL` (`smtp://mailpit:1025` in Compose,
`smtp://localhost:1025` from host tests). The interface is the seam for the deferred prod
provider — do not pick one.
- [ ] **Step 2: TDD reset issuance/consumption.** `requestReset(email)`: if the user exists,
store an argon2-hashed random token + short expiry in `password_reset_tokens` and send the
email via `renderResetPassword`; **always return void/202 regardless** (no enumeration).
`performReset(rawToken, newPassword)`: find a matching unused, unexpired token (by hash), set
its `used_at`, update the password hash, and **revoke ALL of the user's refresh tokens**.
Tests: a token works once then is rejected (single-use); an expired token is rejected; a
successful reset revokes outstanding refresh tokens; `requestReset` for an unknown email
sends nothing but still returns success.
**Constant-time response, or the "no enumeration" guarantee is a lie.** Returning an
identical 202 body is not enough: if the known-email path awaits a DB insert + email render +
SMTP send while the unknown path returns immediately, the ~2x latency gap (measured live at
~65ms) lets an attacker enumerate accounts by timing. The controller must **not await** the
side effects — fire `requestReset(...)` and `.catch()`-log it, then return 202 immediately, so
both paths return in the same fast time. `requestReset` stays an awaitable async method so unit
tests can still assert "row inserted for known / nothing for unknown". Keep the `@Throttle`.

- [ ] **Step 3: Rate-limit `/auth/reset-request`.** e2e against Mailpit: POST reset-request →
assert a message arrived at `http://localhost:8025/api/v1/messages` and extract the token from
its body → POST /auth/reset with it → old password fails, new password logs in → the reset
endpoint's response is identical for a known and an unknown email. Clean up mail + rows.
- [ ] **Step 4: Commit.**

---

## Chunk E: The authorised upload endpoint

### Task E1: Verify the CrudEntry shape, then define the upload DTO + `uploadRowSchema`

**Files:** `sync/upload.dto.ts`, `db/auth-contracts.ts` (`uploadRowSchema`)

- [ ] **Step 1: VERIFY against current PowerSync docs** the exact `CrudEntry` fields the
client SDK's `getCrudBatch()` produces (op enum values, the table field name — `type` vs
`table`, the id field, and the changed-data field — `opData` vs `data`). Record what you
found. The DTO below is the *contract our endpoint accepts*; make it match what the client
connector (Milestone 3) will actually send.
- [ ] **Step 2: Define the request DTO** — `POST /sync/upload` body `{ batch: CrudOp[] }`,
each `{ op: 'PUT'|'PATCH'|'DELETE', type: string, id: string, data?: Record<string,unknown> }`.
Validate `type` is one of the six synced tables (reject unknown tables → 2xx, not applied).
- [ ] **Step 3: A per-table `uploadRowSchema` map** — one entry per synced table, since the
six tables have different columns. For each, start from the Milestone 1 insert contract and
**`.omit()` the server-owned columns** (`userId`, `createdAt`, `updatedAt`, `deletedAt`) so a
validated client payload cannot carry identity/ordering fields. **Keep `id`** — PowerSync
rows are client-UUID'd, and the server trusts the id (to locate the row) but never the
ownership. Export both the strict schema (for PUT) and a **`.partial()` variant per table**
(for PATCH, which sends only changed columns). Shape:
```ts
export const uploadRowSchemas = {
  exercises: insertExerciseSchema.omit({ userId: true, createdAt: true, updatedAt: true, deletedAt: true }),
  // …one per synced table…
} as const
export const uploadPatchSchemas = {
  exercises: uploadRowSchemas.exercises.partial(),
  // …
} as const
```
Unit-test: a client-supplied `userId` or `updatedAt` in a PUT body is stripped by the schema
(not present in the parsed result); a PATCH body validates against the partial schema and may
omit required columns.
- [ ] **Step 4: Commit.**

### Task E2: `upload.service.ts` — ownership-checked apply (TDD, the security core)

**Files:** `sync/upload.service.ts` + `upload.service.test.ts`

- [ ] **Step 1: TDD the apply logic.** `apply(userId, batch)` runs in a transaction:
  - **PUT:** validate via `uploadRowSchema`; set `user_id = userId` (server-owned),
    `updated_at = now()`; upsert by `id`. If a row with that `id` already exists **owned by a
    different user**, reject that op (do not apply).
  - **PATCH:** load the row by `id`; if missing or `row.user_id !== userId`, reject; else
    apply only the changed columns, force `updated_at = now()`, never let the client change
    `user_id`.
  - **DELETE:** load by `id`; if missing or not owned, reject; else **soft delete**
    (`deleted_at = now()`, `updated_at = now()`) — never a physical delete (Decision 7).
  - Rejections are collected and returned (they become a 2xx with a rejected-ops list, per
    PowerSync's "2xx for validation errors"), not thrown as 5xx.
  Tests (the point of the milestone): a user PUTting a row lands it with the JWT's user_id
  even if the body said a different user_id; PATCH/DELETE on another user's row is rejected
  and the row is unchanged; DELETE sets `deleted_at` and does not physically remove the row;
  `updated_at` is server-stamped even when the client sends an old timestamp.
- [ ] **Step 2: Commit.**

### Task E3: `POST /sync/upload` behind a JWT guard (e2e)

**Files:** `sync/upload.controller.ts`, a `JwtAuthGuard` (verify RS256 via local public key), `sync/upload.e2e.test.ts`

- [ ] **Step 1: `JwtAuthGuard`** — verify the bearer access token with the same RS256 public
key + `aud: 'workouty'`, put `userId = payload.sub` on the request. Reject missing/invalid →
401.
- [ ] **Step 2: `POST /sync/upload`** calls `upload.service.apply(req.userId, body.batch)`.
- [ ] **Step 3: e2e** on the Compose DB with TWO registered users. **These are the gating
assertions** (deterministic, Postgres-level):
  - User A uploads a set (PUT) → the row is in Postgres owned by A (its `user_id` = A's
    UUID), even if the request body carried a different `user_id`.
  - `updated_at` is server-stamped, not the client's value.
  - User B PATCHes and DELETEs A's row by id → both rejected (returned in the 2xx
    rejected-ops list), and A's row is **unchanged** in Postgres.
  - A DELETEs A's own row → `deleted_at` is set and the row still physically exists (soft
    delete, not a physical `DELETE`).

  **Best-effort (non-gating) signal:** after A's PUT, optionally check that the row reaches
  `powersync.bucket_data` under A's `user_data` bucket, and that A's DELETE produces a REMOVE
  op. PowerSync's internal storage is undocumented and the timing is racy, so treat a miss as
  inconclusive, not a failure — the Postgres assertions above are what prove the endpoint
  correct. (Milestone 1 verified an active slot, not bucket contents, so there is no ready-made
  check to reuse here.)

  Clean up all rows and users (transaction-rollback where possible).
- [ ] **Step 4: Full suite green (Milestone 1's 31 + all new). Commit.**

---

## Definition of done

- [ ] `docker compose up -d --wait` brings up five services (adds `api`), all healthy.
- [ ] The compiled `node dist/main.js` serves `/health` returning the shared-package probe
  (runtime resolution proven, not just typechecked).
- [ ] Register + login issue an RS256 JWT whose `sub` is the user UUID, `aud` includes
  `workouty`, header `kid` resolves in the served JWKS, and `exp - iat ≤ 900`.
- [ ] PowerSync's client-auth failure mode changed from `PSYNC_S2204 "JWKS request failed"` to
  a signature-verified path — a real issued token passes JWKS verification.
- [ ] Refresh tokens rotate (old revoked, reuse rejected); password reset works over Mailpit,
  is single-use, and revokes outstanding refresh tokens; reset-request does not reveal account
  existence; login and reset-request are rate-limited.
- [ ] The upload endpoint writes a caller's rows with the JWT-derived `user_id` and
  server-stamped `updated_at`, rejects writes to other users' rows, and soft-deletes on
  DELETE. Verified against the live replication stream.
- [ ] `refresh_tokens` and `password_reset_tokens` exist but are NOT published — the exact-set
  publication test is green.
- [ ] Milestone 1's 31 tests still pass.

## Handoff to Milestone 3

- The API issues tokens and serves JWKS; Milestone 3 writes the PowerSync **client**
  connector: `fetchCredentials` (call `/auth/login` or `/auth/refresh`, return
  `{ endpoint, token }`) and `uploadData` (drain `getCrudBatch()` and POST it to
  `/sync/upload` in the exact shape Task E1 pinned). The connector must call `.complete()`
  only on a 2xx.
- The access token lives ≤15 min; `fetchCredentials` must refresh via the refresh token when
  PowerSync asks for credentials. Store the refresh token in the client secure store
  (Milestone 4).
- The upload endpoint returns rejected-op details on 2xx — Milestone 3/4 should surface those
  (the spec's "upload rejection surfaces to the user").

- **A unique-constraint collision in an upload batch currently throws 5xx and rolls back the
  whole batch** — it is not collected like a validation/permission rejection. This is safe
  (atomic, no corruption) but has a real failure mode: if two devices create a custom
  exercise with the same name offline, the partial unique index `(user_id, name)` rejects the
  second on upload, the batch 5xxs, and PowerSync retries it forever — sync gets stuck for
  that client. Closing this needs a **conflict policy for two different ids with the same
  natural key** (the spec's last-write-wins covers the same *row*, not this case), plus
  applying each op in its own savepoint (`tx.transaction(...)`) so a constraint failure is
  collected as a rejected op rather than aborting the batch. Decide this in Milestone 3
  alongside how the client surfaces rejected ops — it is a design decision, not an
  apply-service bug. The security guarantees are unaffected and were proven by adversarial
  review (no cross-user write, no client-set user_id/updated_at/deleted_at, no physical
  delete, sensitive tables unreachable).
- If NestJS 12 went stable and `apps/api` moved to ESM, re-check that `@workouty/shared` and
  `@workouty/emails` still resolve in the built app.

- **Harden the API Dockerfile before production.** The Milestone 2 image copies the entire
  build stage (`COPY --from=build /repo /repo`) into the runtime stage — dev dependencies and
  build tooling included. That was fine for proving the stack works, but a production image
  should do a pruned prod install (`pnpm install --prod` / `pnpm deploy`) and copy only the
  built `dist` + production `node_modules`. Verified working end to end regardless: a real
  API-issued token passed PowerSync's JWKS/signature stage (HTTP 200) and its `sub` scoped the
  `user_data` bucket, confirming the JWT contract against the live sync engine.
