# Workouty Sync (PowerSync Client) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the PowerSync **client** into the app: a local SQLite schema mirroring the six synced tables, a backend connector (`fetchCredentials` → the API's tokens, `uploadData` → the authorised `/sync/upload` endpoint), and a proven offline→online round-trip — a local write reaches Postgres and a server change reaches the client — verified headlessly against the running Compose stack.

**Architecture:** The connector is written against `@powersync/common`'s platform-agnostic `PowerSyncBackendConnector` interface, so one implementation serves both the Expo app (`@powersync/react-native` + `@op-engineering/op-sqlite`) and a headless `@powersync/node` test. `fetchCredentials` calls the Milestone 2 API (`/auth/login` or `/auth/refresh`) and returns `{ endpoint: <PowerSync URL>, token: <access token> }`. `uploadData` drains `getCrudBatch()`, maps each `CrudEntry` to the `/sync/upload` wire contract, POSTs it with the bearer token, and completes the batch on a 2xx.

**Tech Stack:** `@powersync/common`, `@powersync/node` (headless proof), `@powersync/react-native` + `@op-engineering/op-sqlite` (Expo native), Expo 57, expo-secure-store, Vitest, the running Compose stack (api + powersync + postgres).

---

## Scope

This is **plan 3 of 6**, covering **Milestone 3 (Sync)** from §8 of
`docs/superpowers/specs/2026-07-09-workouty-design.md`. (Sync rules and JWKS validation were
delivered in Milestones 1–2; this milestone is the *client connection* and the round-trip
proof.)

**This plan is done when:** a PowerSync client, using our connector against the running stack,
(a) writes a row locally that reaches Postgres via `/sync/upload` owned by the authenticated
user, and (b) receives a server-side Postgres change into its local database — both proven by
an automated `@powersync/node` test; the client SQLite schema exists with a **drift test**
asserting it matches the Postgres schema; and the Expo app is wired to instantiate PowerSync
on a custom dev client (native module builds), even though the logging UI that exercises it is
Milestone 4.

**Deliberately NOT in this plan:** the app's screens/UI and the logging loop (Milestone 4);
templates (M5); dashboard (M6); a production email provider; OAuth. The round-trip proof is
headless — driving the *on-device* client through real UI is Milestone 4.

## Verified facts this plan depends on

Read from the PowerSync source/docs and the npm registry immediately before writing. Do not
re-derive; **re-verify at execution time** where noted (especially the Expo 57 client setup,
per `apps/mobile/AGENTS.md`).

- **`PowerSyncBackendConnector` interface** (from `@powersync/common` source):
  - `fetchCredentials(): Promise<PowerSyncCredentials | null>` — must fetch *fresh* creds (do
    not return cached values); return `null` if not signed in; **throw** on a network/temporary
    error (the SDK retries).
  - `uploadData(database): Promise<void>` — use `database.getCrudBatch()`; a thrown error
    triggers a retry after ~5s.
- **`PowerSyncCredentials`** = `{ endpoint: string; token: string; expiresAt?: Date }`.
- **`CrudEntry`** (from source) fields: `op` (`'PUT'|'PATCH'|'DELETE'`), `id` (string), `table`
  (string), `opData?` (Record — the changed columns), plus `transactionId`/`metadata`. PUT =
  all non-null columns; PATCH = id + changed columns; DELETE = id only. A `CrudBatch` from
  `getCrudBatch()` exposes `.crud` (the entries) and `.complete()`.
- **Our `/sync/upload` wire contract** (Milestone 2, Task E1): `{ batch: [{ op, table, id,
  data? }] }`. So the connector maps each entry → `{ op: e.op, table: e.table, id: e.id,
  data: e.opData }`. The endpoint returns `200 { rejected: [...] }`; a rejected op is a
  permission/validation failure the client must NOT retry forever.
- **Packages + versions:** `@powersync/common` 2.x, `@powersync/node` 0.20.x (headless proof),
  `@powersync/react-native` 2.x + `@op-engineering/op-sqlite` 17.x (Expo native). All share the
  `@powersync/common` connector/schema API.
- **Native SQLite requires a custom Expo dev client** — `@op-engineering/op-sqlite` is a native
  module; Expo Go will NOT work. (An `@powersync/adapter-sql-js` Expo Go fallback exists but we
  use the native adapter.)
- **Client schema API:** `import { Schema, Table, column } from '@powersync/common'` — columns
  are `text`/`integer`/`real`; PowerSync auto-creates the `id` (uuid text) primary key, so it
  is NOT declared. SQLite has no boolean/timestamp types — booleans are `integer` (0/1),
  timestamps are `text` (ISO).
- **PowerSync JWT (from Milestone 2, verified live):** the API issues RS256 tokens with
  `sub` = user UUID and `aud` = `workouty`; the running PowerSync service already accepts them
  and scopes `user_data["<sub>"]`. The PowerSync endpoint URL for the client is
  `http://<host>:8080`.

## Decision record (non-obvious choices, with reasons)

1. **The round-trip is proven headlessly with `@powersync/node`, not on a device.** A device
   or emulator in the CI loop is slow and flaky; `@powersync/node` runs the *same* connector
   against the *same* running PowerSync service, so it proves the sync contract (up and down)
   deterministically. The Expo native wiring is still built (Chunk D), but exercising it
   through real UI is Milestone 4.

2. **The client schema is defined against `@powersync/common`** (which `@powersync/react-native`
   and `@powersync/node` both re-export), so the *one* schema file imports cleanly in the Expo
   bundle AND in a Node/vitest drift test. Importing `@powersync/react-native` directly into a
   Node test would drag native modules in and fail.

3. **The drift test** (Milestone 1's deferred deliverable) asserts the PowerSync client schema's
   table names and column names match the Drizzle/Postgres schema's synced tables — the thing
   that keeps the two schemas from silently diverging. It lives where both are importable
   (a workspace test that imports the client schema from `apps/mobile` and the Drizzle schema
   from `apps/api`). Type mapping is checked by rule (Postgres `uuid`/`text` → client `text`;
   `integer` → `integer`; `double precision` → `real`; `boolean` → `integer`; `timestamptz` →
   `text`), not identity.

4. **The connector lives in `apps/mobile`** (it's client code), written against
   `@powersync/common` types so it's platform-neutral and unit-testable with mocks and drivable
   by `@powersync/node`. `fetchCredentials` returns fresh creds by calling the API; token
   storage/refresh uses `expo-secure-store` on device, behind a small `TokenStore` interface so
   the Node test can supply an in-memory store.

5. **`uploadData` maps and completes correctly, and surfaces rejections.** It reads
   `getCrudBatch()`, maps entries to `{op,table,id,data}`, POSTs `{batch}` with the bearer
   token to `/sync/upload`. On a network/5xx error it **throws** (SDK retries). On a 2xx it
   inspects `rejected[]`: it still `.complete()`s the batch (so the client stops retrying the
   permanently-rejected ops), and records the rejections for the UI to surface later (the spec's
   "upload rejection surfaces to the user"). A rejected op is NOT a reason to throw — throwing
   would retry-loop forever.

6. **Close the Milestone 2 unique-collision retry loop (deferred there).** Now that the client
   generates writes, a unique-constraint collision (two offline devices create a custom exercise
   with the same `(user_id, name)`) must not 5xx-loop the batch. Fix the **server** upload
   service to apply each op in its own **savepoint** (`tx.transaction(...)` nested) so a
   constraint violation is caught and collected as a **rejected op** rather than aborting the
   batch. The **conflict policy** for the natural-key collision itself is a product decision —
   see the open question; the default is *reject the colliding op and surface it* (the losing
   device keeps its local row and shows a "couldn't sync: duplicate name" notice), which the
   savepoint fix delivers for free.

## Expo 57 gate (per `apps/mobile/AGENTS.md`)

**Before writing ANY `apps/mobile` client code (Chunk D), read the exact Expo 57 docs at
<https://docs.expo.dev/versions/v57.0.0/>** and confirm: the config-plugin / custom-dev-client
build flow for a native module, `expo-secure-store` API, and that `@powersync/react-native` +
`@op-engineering/op-sqlite` are compatible with Expo SDK 57 / React Native 0.86 (re-verify the
package versions with `npm view`). If op-sqlite has no Expo 57-compatible release, STOP and
report — do not force an incompatible native module.

## File structure

```
apps/mobile/
  src/powersync/
    schema.ts              (new)  PowerSync client Schema (6 synced tables), @powersync/common
    schema.test.ts         (new)  intra-schema sanity (table/column presence)
    connector.ts           (new)  WorkoutyConnector: fetchCredentials + uploadData
    connector.test.ts      (new)  unit: CrudEntry->wire mapping, complete-on-2xx, throw-on-5xx, rejected handling
    token-store.ts         (new)  TokenStore interface + expo-secure-store impl
    crud-mapping.ts         (new)  pure CrudEntry -> { op, table, id, data } mapper (unit-tested)
  app/                     (existing expo-router)  a PowerSyncProvider added in Chunk D
packages/shared/           (maybe) shared column-name constants if useful for the drift test
apps/api/
  src/sync/upload.service.ts  (edit, Chunk C)  savepoint-per-op so constraint violations are rejected, not 5xx
test/
  drift.test.ts            (new, workspace)  client schema names == Postgres synced-table names
  roundtrip.node.test.ts   (new)  @powersync/node: local write -> Postgres; Postgres change -> local
```

(Exact placement of the workspace-level tests is settled in the tasks; they may live under
`apps/mobile` or a small `packages/sync-verify` if cross-package imports are cleaner there.)

---

## Chunk A: Client schema + drift test

### Task A1: Define the PowerSync client schema

- [ ] Define `apps/mobile/src/powersync/schema.ts` using `Schema`, `Table`, `column` from
  `@powersync/common`, one `Table` per synced table (exercises, templates, template_exercises,
  sessions, session_exercises, sets) with columns mirroring the Postgres columns MINUS the
  auto-created `id`. Map types: uuid/text→`column.text`, integer→`column.integer`, double
  precision→`column.real`, boolean→`column.integer`, timestamptz→`column.text`.
  **Declare EVERY non-`id` Postgres column**, including `user_id`, `created_at`, `updated_at`,
  `deleted_at`. The only excluded column is the auto-created `id`. This makes the drift rule
  exact and unambiguous: **client columns == Postgres columns minus `id`** — no per-column
  judgement calls. Add indexes on `user_id` and the parent FKs the app queries by.
- [ ] `schema.test.ts`: assert the schema has exactly the six tables and that `sets` has
  `weight_kg`/`reps`/`user_id` etc. (a cheap guard that the file wasn't half-edited).
- [ ] Install: `pnpm --filter @workouty/mobile add @powersync/common` (the schema only needs
  common; the native/node packages come later). Confirm the schema file imports cleanly in a
  plain Node/vitest context (no native deps pulled).
- [ ] Commit.

### Task A2: The drift test (Milestone 1's deferred deliverable)

- [ ] A workspace test that imports the client schema (Task A1) and the Drizzle schema
  (`apps/api/src/db/schema.ts`) and asserts, for each of the six synced tables: the client
  table name equals the Postgres table name, and **the client column set equals the Postgres
  column set minus `id`** (the auto-created key). Encode the type-mapping RULE (pg type →
  client type) and assert each column conforms. A Postgres column with no client counterpart
  (other than `id`), or a client column with no Postgres counterpart, fails the test. This is
  the guard that a one-sided schema change is caught.
- [ ] **`apps/mobile` has no test tooling yet** — add vitest (a `test` script + config) as part
  of this task. The drift test deep-imports `@workouty/api/src/db/schema` (add `@workouty/api`
  as a dev-dependency of the test's package; it works because `@workouty/api` declares no
  restrictive `exports`, and importing `schema.ts` pulls only `drizzle-orm/pg-core` — **no DB
  connection**). Ensure the vitest environment does not import Expo/RN native modules (the
  `@powersync/common` schema and a guarded `token-store` keep native code out of the test
  path). Decide the test's home so both imports resolve (`apps/mobile` with the api dev-dep, or
  a tiny `packages/sync-verify`).
- [ ] Run it; make it pass by aligning the client schema to Postgres. Commit.

---

## Chunk B: The backend connector (unit-tested, platform-neutral)

### Task B1: The pure CrudEntry → wire mapper

- [ ] `crud-mapping.ts`: `toUploadOp(entry): { op, table, id, data? }` mapping
  `{ op: entry.op, table: entry.table, id: entry.id, data: entry.opData }`, DELETE omits data.
  Pure function.
- [ ] TDD `connector`/`crud-mapping` unit tests with fabricated CrudEntry-shaped objects: PUT
  carries data, PATCH carries partial data, DELETE carries no data; op/table/id preserved.
- [ ] Commit.

### Task B2: `fetchCredentials` + `TokenStore`

- [ ] `token-store.ts`: a `TokenStore` interface (`getAccessToken`/`getRefreshToken`/`setTokens`
  /`clear`) with an `expo-secure-store` implementation (guarded so it only imports the native
  module on device) and an in-memory implementation for tests/Node.
- [ ] `fetchCredentials` (in `connector.ts`): return `{ endpoint: POWERSYNC_URL, token,
  expiresAt }` where `token` is a *fresh* access token. If the stored access token is
  expired/absent, call `/auth/refresh` with the refresh token to get a new pair, store it, and
  return the new access token. If there's no refresh token → return `null` (not signed in). On
  a network error → throw. **Return `expiresAt`** (the access token's exp) so the SDK refreshes
  proactively rather than only reactively after a rejected token — decode it from the JWT or
  compute from the 15-min TTL. Unit-test: returns endpoint+token+expiresAt; refreshes when the
  access token is stale; returns null with no refresh token; throws on network failure. Mock
  fetch + an in-memory TokenStore.
- [ ] Commit.

### Task B3: `uploadData`

- [ ] `uploadData(database)`: `const batch = await database.getCrudBatch(); if (!batch) return;`
  map `batch.crud` via `toUploadOp`; POST `{ batch }` to `${API_URL}/sync/upload` with
  `Authorization: Bearer <fresh access token>`. On network error or 5xx → **throw** (SDK
  retries). On 2xx → read `{ rejected }`, record it (a callback/event for the UI later), then
  `await batch.complete()`. Unit-test with a mock database exposing `getCrudBatch()` and a mock
  fetch: (a) a normal batch maps+posts+completes; (b) a 5xx throws and does NOT complete (so it
  retries); (c) a 2xx with rejected[] still completes (no infinite retry) and surfaces the
  rejections; (d) an empty batch is a no-op.
- [ ] Commit.

---

## Chunk C: The headless round-trip proof + the server savepoint fix

### Task C1: Close the unique-collision retry loop (server savepoint-per-op)

- [ ] Edit `apps/api/src/sync/upload.service.ts`: apply each op inside its own nested
  transaction/savepoint (`tx.transaction(async (sp) => {...})`), so a thrown op does a
  `ROLLBACK TO SAVEPOINT` and the rest of the batch still commits.
  **The catch MUST be narrow — this is the correctness hinge of the chunk.** Catch ONLY a
  Postgres unique-violation (`code === '23505'`) and collect it as a **rejected** op (reason:
  "conflict"); **re-throw everything else** so a transient/infra error still becomes a 5xx the
  client retries. A broad catch would silently convert a temporary DB error into a permanent
  "rejected" op → client data loss. Drizzle wraps the pg error, so **unwrap `.cause` to read
  the `.code`** (same pattern the M2 auth code used for `23505` detection).
- [ ] Extend `upload.service.test.ts`: a batch where one op violates the `(user_id, name)`
  unique index → that op is in `rejected[]`, the OTHER ops committed, no throw. Add a test that
  a **non-23505 error still throws** (so the narrow-catch is proven — e.g. force a different DB
  error and assert it propagates, not silently rejected). **Re-run Milestone 2's adversarial
  upload e2e/security tests** and confirm all green — the savepoint refactor must not weaken the
  ownership checks (`setWhere` on PUT, `FOR UPDATE` on PATCH/DELETE), server-owned
  `user_id`/`updated_at`, or soft-delete.
- [ ] Rebuild the api container; keep it healthy. Commit.

### Task C2: The end-to-end round-trip with `@powersync/node`

- [ ] A `@powersync/node` test (`roundtrip.node.test.ts`) that, against the RUNNING stack:
  - registers a user via the API (`/auth/register`) and seeds the TokenStore with the returned
    tokens;
  - instantiates a `PowerSyncDatabase` (node) with the Task A1 schema + our connector, pointed
    at the API and the PowerSync endpoint (`http://localhost:8080`). **Confirm the node SDK's
    DB factory at execution** — `@powersync/node`'s `PowerSyncDatabase` constructor differs
    from React Native's (node ships its own SQLite/`dbFilename`; RN needs the op-sqlite
    factory). Read the node SDK's quickstart before wiring; the *connector* is shared, the DB
    instantiation is not.
  - **UP:** inserts a row locally (e.g. a custom exercise) via the PowerSync client's local DB;
    `connect()`s; asserts the row appears in **Postgres** owned by the user (poll a psql query
    or the API), proving `uploadData` → `/sync/upload` → Postgres works;
  - **DOWN:** makes a server-side change (insert a row in Postgres owned by the user, or via a
    second client) and asserts it arrives in the node client's local DB (watch/poll a local
    query), proving the read path (sync rules → client) works;
  - **rejection:** attempts a write that the server rejects (e.g. a duplicate custom-exercise
    name) and asserts the client surfaces the rejection and does not retry-loop (the batch
    completes). **Also assert the rejected row is RETAINED in the client's local DB** after the
    batch completes — `.complete()` clears only the upload-queue entry, not the local table, so
    the losing device keeps its row (Decision 6). This is the assertion that proves the
    intended "keep local, surface the conflict" behaviour rather than silent local data loss.
  - Clean up the user + rows.
- [ ] This is the milestone's gate. If the node client cannot connect or the round-trip fails,
  diagnose (token/endpoint/schema mismatch) and report; do NOT fake it. Commit.

---

## Chunk D: Expo native integration (custom dev client)

### Task D1: Read the Expo 57 docs, then wire the native SQLite adapter

- [ ] **Expo 57 gate:** read <https://docs.expo.dev/versions/v57.0.0/> for the config-plugin /
  dev-client build flow and `expo-secure-store`; re-verify `@powersync/react-native` +
  `@op-engineering/op-sqlite` support Expo 57 / RN 0.86 (`npm view`). If incompatible, STOP and
  report.
- [ ] `pnpm --filter @workouty/mobile add @powersync/react-native @op-engineering/op-sqlite
  @powersync/react expo-secure-store`; add any required config plugin to `app.json`.
- [ ] Build a custom dev client (document the command; this replaces Expo Go). Confirm the app
  builds with the native module — a `prebuild` / dev-client build that succeeds is the gate. If
  the environment can't build a dev client (no Android SDK), document the exact command for the
  user to run and verify as far as the toolchain allows (e.g. `expo prebuild` generating the
  native project without errors).

### Task D2: PowerSync provider + connect-on-login

- [ ] A `PowerSyncProvider` (React context) that instantiates `PowerSyncDatabase`
  (`@powersync/react-native`, op-sqlite) with the Task A1 schema, exposes it, and `connect()`s
  our connector once the user is authenticated (tokens in secure store). Sign-out disconnects
  and clears the local DB (spec §3.7: "signing out clears the local synced database").
- [ ] Since the logging UI is Milestone 4, prove wiring minimally: the app boots on the dev
  client, instantiates PowerSync without crashing, and (if a device/emulator is available)
  connects and pulls the global exercise bucket. If no device is available in this environment,
  the gate is that the dev-client build + the provider code typecheck and the app bundles;
  the on-device connect is confirmed in Milestone 4. Document what was and wasn't runnable here.
- [ ] Commit.

---

## Definition of done

- [ ] The client SQLite schema exists and the **drift test** passes (client names/types match
  the Postgres synced tables); a future one-sided schema change fails it.
- [ ] The connector's `fetchCredentials` returns fresh creds (refreshing when stale, null when
  signed out) and `uploadData` maps CrudEntries to `/sync/upload`, throws on 5xx (retry),
  completes on 2xx, and surfaces (without retry-looping) rejected ops — all unit-tested.
- [ ] The `@powersync/node` round-trip test passes against the running stack: a local write
  reaches Postgres owned by the user, and a server change reaches the client.
- [ ] The server upload service applies ops per-savepoint: a unique-collision op is rejected
  (not a 5xx loop) while the rest of the batch commits; Milestone 2's security tests stay green.
- [ ] The Expo app wires PowerSync on a custom dev client (native module builds / prebuilds);
  the provider instantiates PowerSync and connects on login (on-device exercise deferred to M4
  if no device is available here — documented).
- [ ] Milestones 1–2 tests stay green.

## Open questions

- **Natural-key conflict policy.** Two offline devices creating a custom exercise with the same
  `(user_id, name)` collide on the partial unique index. The savepoint fix makes the second a
  *rejected* op (default: the losing device keeps its local row and surfaces "duplicate name,
  not synced"). Alternatives to weigh with the user: (a) drop the unique constraint for custom
  exercises (allow duplicate names — simplest, but fragments history, which M1 added the index
  to prevent); (b) server-side merge/dedupe to one row. Recommend the default (reject+surface)
  for v1 and revisit if it annoys in practice.
- **PowerSync endpoint URL config.** Dev uses `http://<LAN-ip>:8080` for a device and
  `http://localhost:8080` for the node test; decide the env-var wiring (`EXPO_PUBLIC_*`) in D1.

## Handoff to Milestone 4

- Milestone 4 builds the logging UI on this PowerSync client: auth screens (call the M2 API,
  store tokens, `PowerSyncProvider.connect`), the exercise picker (reads the synced
  `exercises`), and the log→rest→repeat loop (writes `sessions`/`session_exercises`/`sets`
  locally; the connector syncs them). The rest-timer notification (Android) and the
  timestamp-derived timers are M4.
- Surface the connector's recorded upload **rejections** to the user (the spec's "upload
  rejection surfaces to the user"). The provider captures the last rejection in `lastRejected`
  (a `TODO(milestone-4)`); wire it to UI.

### Learnings from execution that Milestone 4 inherits

- **Two client→server wire-format fixes live in `crud-mapping.ts`** and were essential — the
  headless round-trip failed until they were in place: (1) the client's SQLite columns are
  **snake_case** (`muscle_group`) but the server's drizzle-zod validation expects the Drizzle
  **camelCase** property names (`muscleGroup`), so the mapper camelCases keys; (2) SQLite has
  no boolean — `is_custom` arrives as `0/1`, but the server's zod (from a Postgres `boolean`)
  requires a real boolean, so the mapper coerces it. Both are proven load-bearing at the live
  endpoint (snake/int rejected, camel/bool accepted). Any new synced column M4 adds must
  respect this mapping (and a new boolean column needs a `BOOLEAN_FIELDS` entry).
- **A rejected write's optimistic local row does NOT linger.** The plan assumed it would; the
  round-trip test proved otherwise. PowerSync's local view is *committed bucket data ∪ pending
  CRUD queue*, so once a rejected op's queue entry drains (on `.complete()`), the row has no
  bucket backing and disappears. So M4's `onRejected` handler must not assume the row is still
  in SQLite — it must re-surface it to the user (e.g. re-open the "name taken" form with the
  values), because the optimistic row vanishes.
- **On-device connect/sync was not run here** (no Android SDK). The connector + round-trip are
  proven headlessly via `@powersync/node`; the native adapter builds (`expo prebuild`) and the
  app bundles (`expo export`, 1339 modules), but the FIRST thing M4 must do is run
  `expo run:android` on a device/emulator and confirm the provider connects and syncs live.
- **`apps/mobile/app.json`'s `android.package` is a prebuild-generated placeholder**
  (`com.ticodev974.workouty`) — set a deliberate id before any real build/store submission.
- **After any `pnpm add` in `apps/api` or `apps/mobile`, run a full `pnpm install` at the repo
  root** to re-dedupe `drizzle-orm` (op-sqlite is an optional peer of drizzle-orm; a split can
  briefly produce two instances that break a mobile typecheck).
- **Client URLs come from `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_POWERSYNC_URL`**
  (`apps/mobile/.env.example`) — a physical device needs the host **LAN IP**, not `localhost`.
- **The `@powersync/node` round-trip needs `better-sqlite3`** (pinned 13.0.1 to dedupe with the
  workspace) and runs via `pnpm --filter @workouty/mobile test:sync` (stack required); the pure
  unit tests run via `test` (no stack). Keep that split.
