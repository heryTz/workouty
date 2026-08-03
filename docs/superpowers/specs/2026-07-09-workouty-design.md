# Workouty — Design

**Date:** 2026-07-09
**Status:** Approved design, pending implementation plan

## 1. Purpose

Workouty replaces a paper/notes workout log with a mobile and web app built around the
real training loop: **log a set → rest with a timer → repeat**. Logged data feeds a
dashboard that shows whether the user is getting stronger.

The app is local-first. After a one-time login, it works fully offline; data syncs to the
user's own server in the background.

## 2. Target platforms

- **Android** (native, via Expo)
- **Web** (browser)

iOS is out of scope. This removes the App Store requirement for Sign in with Apple.

## 3. Features

### 3.1 The logging loop

The core interaction during a workout:

1. The user starts a session — freestyle, or loaded from a saved template.
2. The user picks an exercise.
3. The user performs a set and records **reps + weight** for it.
4. The rest timer **auto-starts** at that exercise's default duration.
5. The user may adjust rest mid-rest (stop the running timer, start a new duration).
6. The user hits **Stop rest**, which ends the timer and marks the start of the next set.
   The actual rest taken is recorded.
7. Repeat from step 3.

The logging unit is the **set**: one exercise has many sets, each set is `reps + weight`.

### 3.2 Exercise selection

- A **built-in exercise library**, searchable by name, grouped by muscle group.
- The user may **add a custom exercise** at any time; custom exercises are saved and reused.
- The user's **most recently used exercises appear first**, so a normal workout is one or
  two taps per exercise.

### 3.3 Rest timer

- Auto-starts when a set is recorded, using the exercise's **default rest duration**.
- Adjustable during rest by stopping the current timer and starting a new duration.
- A **Stop rest** control ends rest; that instant is the start of the next set.
- The **actual** rest taken is stored per set, not just the planned duration. It is recorded
  on the set that *preceded* the rest — i.e. `sets.actual_rest_seconds` is the rest taken
  **after** that set, measured from when the set was recorded until Stop rest was pressed.
  The final set of an exercise therefore has a null `actual_rest_seconds`.

**Alarm behaviour differs by platform:**

- **Android:** the alarm must fire with the app backgrounded, the screen off, or the phone
  locked. Implemented as a **scheduled local notification with sound**, so it fires even if
  the app process is killed.
- **Web:** no background alarm. The timer runs and sounds **in-app while the tab is open**.
  Browsers throttle background timers and restrict audio in inactive tabs; this limitation
  is accepted rather than worked around. No service worker, no Web Push.

### 3.4 Session elapsed timer

The active session displays a running total workout duration. It is **derived from the
session's `started_at` timestamp**, not an incrementing counter, so backgrounding the app
or sleeping the screen never desynchronises it. Once the session ends, its duration is
likewise derived from `started_at` and `ended_at` rather than stored as its own column.

### 3.5 Templates

- A template is **captured from a real session** rather than authored abstractly.
- A template stores only **the ordered list of exercises and their default rest times**.
  It never stores reps or weights — those are session data.
- Loading a template pre-fills the session's exercises with empty numbers.
- On finishing a session that started from a template, if the exercise list diverged
  (added, removed, or swapped exercises), the app asks:
  **Update template / Don't update / Save as new template.**
  Templates are never modified silently.

### 3.6 Dashboard

Three things, in priority order:

1. **Per-exercise progression chart** — select an exercise, see top weight and estimated
   one-rep-max over time.
2. **Personal records** — automatically detected when the user beats a previous best.
   Surfaced immediately ("New PR!") and listed on the dashboard.
3. **Last-time reference during logging** — while recording a set, the app shows the
   previous session's performance for that exercise (e.g. "Last time: 60 kg × 8"), so the
   user knows what to beat. This lives in the logging screen, not the dashboard.

Estimated one-rep-max uses the Epley formula: `weight × (1 + reps / 30)`.

A **PR** is a new maximum weight, or a new maximum estimated one-rep-max, for an exercise.

PRs are **derived by query** from the set history rather than stored in their own table.
This avoids a class of sync conflicts and keeps PRs correct if historical sets are edited.

### 3.7 Authentication

- **Email + password only.** No OAuth providers in v1.
- **Login is required on first launch.** This is the only moment that requires
  connectivity.
- **After login the app is fully offline.** Local reads and writes always work. Sync pauses
  when offline and resumes automatically when connectivity returns. An expired token pauses
  sync but never blocks logging.
- **Signing out clears the local synced database**, since it belongs to that user. Signing
  back in requires connectivity.
- **Password reset is supported.** The user requests a reset by email address; the backend
  sends a single-use, time-limited token by email; following that link lets the user set a
  new password. A successful reset revokes all existing refresh tokens.
- Because login precedes all data entry, every row is owned from creation. There is no
  anonymous mode and therefore **no data-claiming flow to build**.

Auth is implemented directly in the NestJS backend with **Passport (local strategy) +
`@nestjs/jwt` + argon2**, rather than an auth framework. With OAuth out of scope, an auth
framework would carry cost for features that were cut, and owning the token signing means
the JWT claims can be shaped exactly as PowerSync requires.

Passwords are hashed with **argon2**. Tokens are signed by the backend and verified by
PowerSync against a **JWKS endpoint the backend exposes**. The login and reset-request
endpoints are **rate-limited**. The reset-request endpoint returns an identical response
whether or not the address exists, so it cannot be used to enumerate accounts. Access tokens
are short-lived; **refresh tokens rotate on use and are revocable**, which the offline-first
client depends on when it reconnects and refreshes credentials.

## 4. Architecture

### 4.1 Shape

Postgres is the source of truth. Each device holds a **scoped local replica** in SQLite.
The app always reads and writes locally; sync happens in the background.

**Write path:** app writes to local SQLite → PowerSync queues the change → PowerSync's
`uploadData` connector posts the batch to the NestJS backend → backend validates and writes
to Postgres.

**Read path:** a Postgres change → PowerSync Service picks it up via **logical
replication** → applies **sync rules** to decide what this user may see → streams it into
that device's local SQLite → reactive queries update the UI.

### 4.2 Components

| Component | Choice | Role |
|---|---|---|
| Mobile/web client | Expo 57, React Native, expo-router | UI, local logging |
| Local database | PowerSync client + SQLite | Offline store, reactive queries |
| Sync engine | **Self-hosted** PowerSync Service (Docker) | Replication + sync rules |
| PowerSync internal storage | **Postgres** | Sync-bucket storage |
| Backend API | **NestJS** (TypeScript) | Auth, upload endpoint, business logic |
| Auth | **Passport + `@nestjs/jwt` + argon2**, in the backend | Email+password, issues JWTs |
| Transactional email | SMTP provider behind an interface | Delivery of password-reset mail |
| Email templates | **React Email** in `packages/emails` | Template markup, rendered to HTML |
| Application database | **Postgres** | Source of truth |
| ORM + migrations | **Drizzle**, in `apps/api` | Schema, migrations, typed queries |
| Validation | **Zod** (`drizzle-zod`) | Shared runtime contracts |

Everything runs on the user's own infrastructure. There is no managed third-party backend.

### 4.3 Why TypeScript end-to-end

There are necessarily **two** schema definitions: the Drizzle/Postgres schema on the server,
and the PowerSync client schema describing the local SQLite tables. PowerSync requires them
to correspond field-for-field. Keeping both in one language means that correspondence can be
asserted by a **drift test** rather than maintained by discipline.

The Postgres schema and its drizzle-zod contracts live in **`apps/api`**, not in a shared
package. They are runtime values built on `drizzle-orm/pg-core`; re-exporting them from a
package the Expo app imports would bundle Postgres driver code into the Android and web
clients. `packages/shared` therefore holds only **isomorphic** code — domain logic and
types, with no database dependency — which both the API and the client can import safely.

### 4.4 Repository layout

The repo is already a pnpm workspace.

```
apps/
  mobile/         Expo app (existing)
  api/            NestJS backend; owns the Drizzle schema and migrations (new)
packages/
  shared/         Isomorphic domain logic and types; no database dependency (new)
  emails/         React Email templates (new)
docker-compose.yml
```

**`packages/shared`** holds what genuinely runs on both sides: the estimated-1RM
calculation, personal-record rules, template-divergence detection, and shared types. It has
no runtime database dependency, so the Expo app can import it without pulling Postgres
driver code into the bundle. Type-only imports from `apps/api` are erased at build time and
remain safe.

**`packages/emails`** holds transactional email templates built with **React Email**. It
exports a render function per template, returning HTML and a plain-text fallback. The
backend imports it and hands the output to the SMTP interface; it never writes markup
itself. Keeping templates in their own package means they can be previewed and iterated on
in React Email's dev server without running the backend.

### 4.5 Local development infrastructure

A single `docker-compose.yml` brings up the whole backend:

- **`postgres`** — the application database, configured with `wal_level=logical` (PowerSync
  requires logical replication).
- **`powersync`** — the self-hosted PowerSync Service, mounting its config and
  `sync_rules.yaml`, connected to `postgres`, validating JWTs against the JWKS endpoint
  exposed by `api`.
- **`powersync-storage`** — a Postgres instance for PowerSync's internal sync-bucket
  storage.
- **`api`** — the NestJS backend.
- **`mailpit`** — a local SMTP sink that captures outgoing mail and exposes a web inbox, so
  password-reset emails can be exercised locally without sending real mail or configuring a
  provider.

A shared network and named volumes so state survives restarts.

The Expo client is not part of Compose; it runs on a device, emulator, or browser and points
at the host machine's LAN IP for the API and PowerSync URLs.

Production deploys the same components to the user's own host.

### 4.6 Security

Two independent gates, both driven by the backend-issued JWT:

- **The backend upload endpoint** authorises writes. It derives `user_id` from the verified
  JWT and rejects any operation targeting a row the caller does not own. The client is never
  trusted to assert ownership.
- **PowerSync sync rules** authorise reads. Per-user buckets are keyed on `user_id`, so a
  device only ever downloads its owner's rows.

### 4.7 The built-in exercise library

The built-in library is stored in Postgres as **global rows** (`user_id IS NULL`) and synced
to every client through a **global, read-only sync bucket**. Custom exercises are per-user
rows in the user's own bucket.

This keeps referential integrity for sets that reference a built-in exercise, and lets the
library be updated server-side without shipping an app release.

## 5. Data model

All tables carry: a **client-generated UUID primary key**, `created_at`, `updated_at`, and a
soft-delete `deleted_at`. Rows are never hard-deleted — a physical `DELETE` cannot be
synced.

**Every user-owned table carries `user_id` directly, including child tables.** PowerSync
sync rules filter on columns present in the row being synced; they cannot join to a parent
to determine ownership. So `user_id` is denormalised onto `sets`, `session_exercises`, and
`template_exercises` even though it is derivable from their parent. This is a requirement of
the sync engine, not redundancy to be optimised away.

- **`exercises`** — `name`, `muscle_group`, `default_rest_seconds`, `is_custom`,
  `user_id` (NULL for built-in library rows).
- **`templates`** — `user_id`, `name`.
- **`template_exercises`** — `user_id`, `template_id`, `exercise_id`, `position`,
  `default_rest_seconds`.
- **`sessions`** — `user_id`, `template_id` (nullable), `started_at`, `ended_at`.
- **`session_exercises`** — `user_id`, `session_id`, `exercise_id`, `position`.
- **`sets`** — `user_id`, `session_exercise_id`, `set_index`, `reps`, `weight`,
  `actual_rest_seconds` (nullable), `performed_at`.

Personal records are derived by query and have no table.

**Weights are stored and displayed in kilograms** as a numeric value. There is no unit
switcher; imperial units are out of scope.

Conflict resolution is **last-write-wins by `updated_at`**. For a single-user workout log,
concurrent conflicting edits are rare and this is sufficient.

## 6. Error handling

- **Offline writes** queue locally and upload with retry/backoff when connectivity returns.
- **Token expiry while offline** pauses sync only. Logging continues; the token refreshes on
  reconnect.
- **Upload rejection** (validation or authorisation failure) surfaces to the user and the
  operation is not silently dropped.
- **Notification permission denied on Android** falls back to an in-app sound and prompts the
  user to grant permission, since the background alarm is a core feature.
- **Web** has no background alarm by design; the UI states this rather than failing silently.

## 7. Testing strategy

- **Shared package:** unit tests for the estimated-1RM calculation and the other isomorphic
  domain rules.
- **Backend:** unit tests for the Zod contracts and for upload authorisation (a user cannot
  write another user's rows); auth tests covering password hashing and verification,
  single-use and expiry of reset tokens, refresh-token rotation and revocation, and that a
  reset revokes outstanding refresh tokens; integration tests against a Compose Postgres
  asserting the migration applies and its constraints hold.
- **Schema drift:** a test asserting the Postgres schema and the PowerSync client schema
  agree on table and column names. Added once the client schema exists.
- **Client:** unit tests for timer logic (verifying durations are derived from timestamps and
  survive backgrounding), PR detection, and template-divergence detection.
- **End-to-end:** a sync round-trip — write while offline, reconnect, assert the row reaches
  Postgres and syncs down to a second client.

## 8. Implementation sequence

This is two subsystems. The work should be sequenced into milestones rather than one plan:

1. **Foundation** — monorepo wiring, `packages/shared` with the isomorphic domain logic,
   `apps/api`'s database layer (Drizzle schema, Zod contracts, migrations), and the Compose
   infra (Postgres, PowerSync Service, Mailpit).
2. **Backend** — NestJS on top of that database layer; email+password auth (Passport,
   `@nestjs/jwt`, argon2) with a JWKS endpoint, refresh-token rotation, and password reset
   over email; `packages/emails` with the React Email reset template; the PowerSync upload
   endpoint with authorisation.
3. **Sync** — sync rules, JWKS validation, client connection; prove an end-to-end round-trip
   on one table.
4. **Mobile core** — auth screens, exercise library and picker, session and set logging,
   rest timer with the Android notification alarm, session elapsed timer.
5. **Templates** — capture, load, and the divergence prompt.
6. **Dashboard** — progression chart, PR detection, last-time reference.

## 9. Out of scope for v1

iOS; OAuth providers (Google, Apple); volume-over-time and consistency/streak charts;
social features; prebuilt training programmes; AI coaching; nutrition tracking; wearable
integration; web background alarms; imperial weight units.

## 10. Open questions and implementation notes

These must be resolved during implementation, not assumed:

- **Transactional email provider for production.** Local development uses Mailpit. A real
  provider (Resend, SES, or plain SMTP) must be chosen before password reset ships. The
  backend addresses it behind an interface, so the choice is deferrable and swappable.
- **PowerSync self-hosted storage on Postgres.** PowerSync's internal bucket storage uses
  Postgres. This is a hard requirement: the stack runs a single database engine and MongoDB
  is not an acceptable fallback. The exact configuration must be read from the current
  PowerSync self-hosting documentation before writing the Compose file.
- **Expo APIs.** Per `apps/mobile/AGENTS.md`, the exact Expo 57 APIs must be read from
  <https://docs.expo.dev/versions/v57.0.0/> before writing client code.
- **Android requires a custom Expo dev client**, because the PowerSync SQLite binding is a
  native module. Expo Go will not work.
- **Web persistence** uses a WASM SQLite build with OPFS storage; multi-tab behaviour needs
  verification against current PowerSync web guidance.
