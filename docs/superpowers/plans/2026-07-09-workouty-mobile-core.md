# Workouty Mobile Core Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core logging experience on top of the proven sync client: auth screens, a searchable exercise picker, the log-a-set → rest-timer → repeat loop, the rest-timer alarm (Android background notification; web in-app), and the session elapsed timer — all reading and writing the local PowerSync DB so changes sync automatically, and all verified running on **web** here.

**Architecture:** A platform-selected PowerSync database (`@powersync/web` + wa-sqlite on web; `@powersync/react-native` + op-sqlite on native) behind the existing `PowerSyncProvider`. Screens are expo-router routes. The UI reads the local DB **reactively** via `@powersync/react`'s `useQuery` (watched queries update on sync) and writes via the local DB (the Milestone 3 connector uploads them). All timers are **derived from timestamps**, never ticking counters. The rest alarm is a scheduled local notification cancelled when the user stops rest.

**Tech Stack:** Expo 57 / expo-router / React Native 0.86 / React 19, `@powersync/web` (wa-sqlite) + `@powersync/react-native` (op-sqlite), `@powersync/react` hooks, `expo-notifications`, `expo-secure-store`, the Milestone 2 API, the running Compose stack, Playwright (web verification).

---

## Scope

This is **plan 4 of 6**, covering **Milestone 4 (Mobile core)** from §8 of
`docs/superpowers/specs/2026-07-09-workouty-design.md`, and the features in §3.1–3.4 and §3.7.

**This plan is done when**, running the app on **web** against the live stack: a user can
register/log in (tokens stored, PowerSync connects), see and search the exercise library
(reactively from the synced local DB) and add a custom exercise, start a session, log sets
(reps + weight) that persist locally and **sync to Postgres**, have the rest timer auto-start
and count down (derived from a timestamp), press "Stop rest" to begin the next set, see the
session elapsed timer and the "last time: X" reference, and finish the session — with the
Android-native rest-timer **notification alarm** built (device run deferred) and web running
the in-app timer.

**Deliberately NOT in this plan:** templates (Milestone 5); the dashboard — progression
charts, PRs (Milestone 6); OAuth; iOS. The visual design should be clean and usable but this
is the core-loop milestone, not a design-polish pass.

## Verified facts this plan depends on

Read from the Expo 57 docs and the npm registry immediately before writing. **Re-read the
Expo 57 versioned docs at <https://docs.expo.dev/versions/v57.0.0/> before writing client
code** (per `apps/mobile/AGENTS.md`), especially expo-notifications and expo-router.

- **`expo-notifications` (Expo 57):** `scheduleNotificationAsync({ content: { title, sound },
  trigger: { type: DATE, date, channelId } })` schedules a **local** notification. On Android
  it **fires when backgrounded or killed** (system alarms). Sound needs a notification
  **channel** (`setNotificationChannelAsync('rest', { importance: HIGH, sound })`). Works in a
  **custom dev client** (which the app uses); only *remote push* needs a dev build on SDK 53+ —
  local notifications work everywhere. `cancelScheduledNotificationAsync(id)` cancels early
  (store the id to cancel on "Stop rest"). Request permission with `requestPermissionsAsync()`.
- **Web has no reliable background alarm** (spec §3.3) — the web build runs the countdown and
  sound **in-app while the tab is open**; do not attempt Web Push. `expo-notifications` is a
  no-op / unsupported on web — guard the scheduling call behind `Platform.OS !== 'web'`.
- **`@powersync/web` 2.0.0** (peer `@journeyapps/wa-sqlite ^1.5.0`) is the web SQLite adapter;
  `@powersync/react-native` 2.0.0 (op-sqlite, from Milestone 3) is native. A **platform database
  factory** picks the adapter. Both yield the same `AbstractPowerSyncDatabase` the connector and
  `@powersync/react` consume.
- **`@powersync/react` 2.0.0** provides `PowerSyncContext` + `useQuery`/`usePowerSync` hooks —
  **watched queries** that re-render when the local DB changes (from a local write OR a sync
  down). This is the reactive UI layer.
- **The connector, schema, token store are done (Milestone 3)** and platform-neutral. Writes go
  to the local DB; `uploadData` syncs them (with the snake→camel + boolean coercion mapping).
  The M3 handoff notes: a rejected write's optimistic row VANISHES (bucket ∪ queue) — the
  `onRejected` handler must re-surface it.
- **The API (Milestone 2):** `/auth/register`, `/auth/login`, `/auth/refresh`,
  `/auth/reset-request`, `/auth/reset`. Tokens: 15-min access + rotating refresh.
- **Timestamp-derived timers (spec §3.3, §3.4):** the rest countdown and the session elapsed
  clock are computed as `now - startedAt` / `endsAt - now`, re-rendered on an interval for
  display only — so backgrounding never desynchronises them. Persist `started_at`/`ended_at`
  and the rest's `endsAt`, not a counter.

## Decision record (non-obvious choices, with reasons)

1. **Verify on web here; build native in parallel.** No Android device/emulator is available.
   The web build (`@powersync/web`) runs the full UI and real sync in the browser, so the
   logging loop, timers, reactive queries, and sync are verified end-to-end via Playwright.
   The Android-native adapter + the notification alarm are built and typecheck/bundle, but the
   on-device run (and the background-alarm firing) is deferred — the spec makes web a
   first-class target, and web has no background alarm by design, so this is honest coverage,
   not a shortcut. Milestone 3's deferred "on-device connect" is effectively delivered here as
   an **on-web connect** (a real PowerSync connection + round-trip through the UI).

2. **Platform database factory.** `database.ts` (from M3) becomes platform-split:
   `database.native.ts` (op-sqlite, M3's code) and `database.web.ts` (`@powersync/web` +
   wa-sqlite), resolved by Metro's platform extensions (`.web.ts`/`.native.ts`). The provider
   imports the neutral `./database`.
   **TypeScript does NOT follow Metro's platform extensions**, so `database.ts` must re-export a
   NEUTRAL type — `AbstractPowerSyncDatabase` from `@powersync/common` — and the provider's `db`
   must be typed as that, not the concrete `@powersync/react-native` `PowerSyncDatabase` it uses
   today, or `expo export --platform web` will fail to typecheck. The connector/schema are
   unchanged.

3. **Reactive reads, local writes.** Screens never call the API for app data — they `useQuery`
   the local PowerSync DB (which the connector keeps synced) and write to it locally. This is
   the local-first contract: instant, offline-capable, and the sync is invisible to the UI.

4. **The rest-timer alarm is a scheduled local notification, cancelled on stop.** On logging a
   set, schedule a notification for `now + defaultRest` (Android, via the 'rest' channel with
   sound), and store its id; "Stop rest" (or adjusting the duration) cancels it and schedules
   anew. On web, run an in-app countdown + a Web Audio beep when it elapses (tab-open only). The
   countdown display is timestamp-derived on both.

5. **`actual_rest_seconds` is recorded on the PRECEDING set** (M1 schema): when "Stop rest" is
   pressed, compute `now - restStartedAt` and write it to the set that was just logged. The
   final set of an exercise has a null `actual_rest_seconds` (no following rest).

6. **A design pass.** Invoke `frontend-design` (if available) for a clean, calibrated look
   before building screens — a fitness logger the user opens mid-workout needs large tap
   targets and a fast log→rest loop, not a template default. Keep it tasteful, not elaborate.

## Expo 57 gate (per `apps/mobile/AGENTS.md`)

Before writing screen/native code, **re-read <https://docs.expo.dev/versions/v57.0.0/>** for
expo-router (routes, layouts, navigation), expo-notifications (scheduling, channels,
permissions, dev-client), and the web build (`expo start --web` / `expo export --platform
web`). Re-verify `@powersync/web` + `@journeyapps/wa-sqlite` support the installed versions.

## File structure

```
apps/mobile/src/
  powersync/
    database.web.ts          (new)  @powersync/web + wa-sqlite factory
    database.native.ts       (rename of database.ts) op-sqlite factory
    database.ts              (edit) re-export the platform file (or delete; rely on .web/.native resolution)
    PowerSyncProvider.tsx    (edit) connect on web too; expose db to @powersync/react's PowerSyncContext
  auth/
    auth-api.ts              (new)  thin client for /auth/* (login/register/refresh/reset)
    useAuth.ts               (new)  auth state (signed-in?), login/register/signOut wiring the provider
  app/                       (expo-router)
    _layout.tsx              (edit) providers; redirect to /login when signed out
    login.tsx, register.tsx, forgot-password.tsx   (new)
    (app)/_layout.tsx        (new)  authed stack
    (app)/index.tsx          (new)  home / start-session
    (app)/session/[id].tsx   (new)  active session: log sets, rest timer, elapsed timer
    exercise-picker.tsx      (new)  searchable library + add custom
  session/
    timers.ts                (new)  pure timestamp-derived timer math (restRemaining, elapsed) + tests
    rest-notification.ts     (new)  schedule/cancel the Android rest alarm (guarded off web)
    last-time.ts             (new)  query previous performance for an exercise (unit-testable SQL)
  ui/                        (new)  shared components (Button, Input, NumberField, etc.)
```

---

## Chunk A: Run on web with PowerSync (platform adapter) — deliver M3's deferred live connect

### Task A1: Platform database factory + web adapter
- [ ] Install `@powersync/web @journeyapps/wa-sqlite` (+ `@powersync/react` is already present).
  Re-verify versions support the app. Report.
- [ ] Split `database.ts` into `database.native.ts` (M3's op-sqlite `PowerSyncDatabase`) and
  `database.web.ts` (`@powersync/web`'s `PowerSyncDatabase` + the wa-sqlite factory — read the
  installed `@powersync/web` for the exact web DB options: dbFilename, the wasm/worker asset
  wiring Expo web needs). `database.ts` becomes a thin re-export resolved by Metro's
  `.web`/`.native` platform extensions. The connector and schema are unchanged.
- [ ] Wire the wasm/worker assets for Expo web (wa-sqlite ships a `.wasm`; Expo web/Metro must
  serve it — follow @powersync/web's web setup). This is the fiddly part; ground it in the docs.
- [ ] typecheck + `pnpm --filter @workouty/mobile test` (92 unit) still green; `expo export
  --platform web` bundles. Commit.

### Task A2: Prove a live PowerSync connection on web (the M3-deferred on-device connect)
- [ ] Run the web app (`expo start --web`) against the live stack; drive it with **Playwright**:
  register/log in via the API through the app, and assert (in the browser) that PowerSync
  connects and the global exercise bucket (or a seeded row) appears via a `useQuery`. This is
  the real live client connection Milestone 3 deferred — now on web.
- [ ] If the wasm/worker or connection fails on web, diagnose (asset serving, CORS to :8080,
  the endpoint URL from `EXPO_PUBLIC_*`) and report. This is Chunk A's gate: PowerSync connects
  and reactively queries in the browser. Commit (a small e2e/Playwright script or a documented
  manual verification).

## Chunk B: Auth screens

### Task B1: Auth API client + `useAuth`
- [ ] `auth-api.ts`: typed calls to `/auth/register|login|refresh|reset-request|reset` (uses the
  `EXPO_PUBLIC_API_URL`). `useAuth`: signed-in state (derived from the TokenStore), `login`/
  `register` (store tokens → `provider.connect()`), `signOut` (`provider.signOut()` →
  disconnectAndClear + clear tokens), `requestReset`/`performReset`. Unit-test the pure pieces
  (request shaping, token handling) with a mock fetch/store.
- [ ] Commit.

### Task B2: Login / Register / Forgot-password screens + routing guard
- [ ] expo-router screens using the `ui/` components: login (email+password), register, forgot-
  password (reset-request → "check your email" → reset with the token). The root `_layout`
  redirects to `/login` when signed out and into `(app)` when signed in. Show auth errors
  (wrong password → the API's 401; register duplicate → 409).
- [ ] Verify on web via Playwright: register a new user → lands in the app; sign out → back to
  login; log back in. Commit.

## Chunk C: Exercise library + picker

### Task C1: Exercise picker (reactive, searchable, recents, add-custom)
- [ ] A screen/component that `useQuery`s the synced `exercises` (built-in `user_id IS NULL` +
  the user's custom), searchable by name, grouped by `muscle_group`, with the user's **recent**
  exercises surfaced first (derive recents from recent `session_exercises`). "Add custom
  exercise" writes a new `exercises` row locally (is_custom=1, user_id=the user) → it appears
  immediately (optimistic) and syncs. Handle the `onRejected` duplicate-name case: the
  provider's `onRejected` fires at **batch** granularity, and by then the optimistic row has
  vanished (M3 handoff) — correlate a rejection back to the form by the op's **`id`** (the
  client UUID the insert used): keep a map of in-flight custom-exercise inserts by id, and when
  a rejection with that id arrives, re-open the "add custom" form pre-filled with the attempted
  values plus a "name already exists" message.
- [ ] Seed the built-in exercise library: since the library is global rows (`user_id IS NULL`)
  the SERVER owns, add a small seed (a SQL seed run against Postgres, or a documented seed
  script) of ~20 common exercises so the picker isn't empty. (This is app data, not schema —
  a seed file under `infra/` or an api seed command; keep it out of the migration.)
- [ ] Verify on web: the picker lists seeded exercises, search filters, adding a custom one
  shows it and it reaches Postgres. Commit.

## Chunk D: The logging loop

### Task D1: Session + set writes (the data operations)
- [ ] Pure-ish helpers to start a session (insert `sessions` with `started_at=now`,
  `user_id`), add an exercise to it (`session_exercises`), and log a set (`sets` with reps,
  weight_kg, set_index, performed_at, user_id, session_exercise_id). All local writes (synced
  by the connector). Unit-test the SQL/shape where feasible (a set has reps+weight; set_index
  increments; ownership fields set).
- [ ] Commit.

### Task D2: The active-session screen (log → next set flow)
- [ ] `(app)/session/[id].tsx`: shows the session's exercises and their sets (reactive), a form
  to log a set (reps + weight number fields), and the flow: log set → **rest timer auto-starts**
  → "Stop rest" begins the next set. Add/switch exercise via the picker. "Finish session" sets
  `ended_at`. Large tap targets, fast entry. The "last time: 60kg × 8" reference (Chunk E) shows
  by the input.
- [ ] Verify on web: start a session, log a couple of sets across two exercises, finish — assert
  the rows sync to Postgres (via a psql/API check) owned by the user. Commit.

## Chunk E: Timers, the rest alarm, and last-time reference

### Task E1: Timestamp-derived timer math (pure, unit-tested)
- [ ] `timers.ts`: pure functions `restRemaining(endsAt, now)` and `sessionElapsed(startedAt,
  now)` (+ formatting), computed from timestamps so backgrounding can't desync them. Thorough
  unit tests (elapsed across a simulated background gap equals wall-clock; remaining clamps at 0;
  formatting). This is the spec's §3.3/§3.4 "derived, not a ticking counter" made concrete.
- [ ] Commit.

### Task E2: Rest timer UI + the Android notification alarm (web in-app)
- [ ] `rest-notification.ts`: `scheduleRestAlarm(endsAt)` → schedules a local notification on the
  'rest' channel with sound at `endsAt` (Android), returns the id; `cancelRestAlarm(id)`.
  **Guarded: on `Platform.OS === 'web'` these are no-ops.** Request notification permission +
  create the channel on first use. (Add a rest-complete sound asset.)
- [ ] The rest timer UI: on logging a set, start rest at the exercise's `default_rest_seconds`
  → compute `endsAt` → (Android) `scheduleRestAlarm` + show the timestamp-derived countdown;
  (web) show the countdown and play a Web Audio beep when it hits 0 while the tab is open.
  "Stop rest" cancels the alarm, records `actual_rest_seconds` on the preceding set (M1 schema:
  rest recorded on the set it followed), and readies the next set. Adjusting rest cancels and
  reschedules.
- [ ] Verify on web: the in-app countdown runs and elapses; on Android the code paths build and
  the alarm-scheduling is exercised in a unit test with a mocked expo-notifications (the actual
  device fire is deferred — document it). Commit.

### Task E3: "Last time" reference + session elapsed timer
- [ ] `last-time.ts`: a query for a given exercise returning the user's most recent prior
  session's performance for it (e.g. top set: weight × reps), unit-testable against the schema.
  Show it by the set input on the session screen.
- [ ] The session elapsed timer (from E1's `sessionElapsed`) shown at the top of the active
  session, derived from `started_at`.
- [ ] Verify on web: after logging in a prior session, the reference shows last time's numbers.
  Commit.

## Definition of done

- [ ] The web app runs against the live stack: PowerSync connects and `useQuery` reactively
  shows synced data (Milestone 3's deferred live connect, delivered on web).
- [ ] Register / login / sign-out / forgot-password work; the router guards authed routes.
- [ ] The exercise picker lists the seeded library + custom exercises, searches, surfaces
  recents, and adding a custom one syncs (with the duplicate-name rejection handled).
- [ ] The logging loop works: log a set → rest auto-starts → stop rest → next set; sets/sessions
  reach Postgres owned by the user (verified).
- [ ] Timers are timestamp-derived (unit-proven to survive a background gap); the rest alarm
  schedules a local notification on Android (built + unit-tested; device fire documented as
  deferred) and runs in-app on web; `actual_rest_seconds` is recorded on the preceding set.
- [ ] "Last time: X" shows while logging; the session elapsed timer runs.
- [ ] Milestones 1–3 tests stay green; the app bundles for web and native (`expo export`).

## Open questions

- **Built-in exercise library seed — mechanism decided; list below.** The client cannot create
  global rows (the upload service forces `user_id` from the JWT), so the built-in library must
  be a **server-side seed**: an idempotent SQL file `infra/postgres/seed-exercises.sql`
  (`INSERT ... ON CONFLICT (name) WHERE user_id IS NULL DO NOTHING`, using the existing
  `exercises_global_name_uq` partial index) applied like `publication.sql` and added to the
  runbook. Seeded rows sync down via the `global_exercises` bucket. Starter list (~20, name /
  muscle_group / default_rest_seconds): Bench press·chest·150, Incline bench press·chest·150,
  Push-up·chest·60, Overhead press·shoulders·150, Lateral raise·shoulders·60, Pull-up·back·120,
  Lat pulldown·back·90, Barbell row·back·120, Deadlift·back·180, Back squat·legs·180, Front
  squat·legs·180, Leg press·legs·120, Romanian deadlift·legs·150, Lunge·legs·90, Leg
  curl·legs·90, Calf raise·legs·60, Bicep curl·arms·60, Hammer curl·arms·60, Tricep
  pushdown·arms·60, Plank·core·60. Confirm/adjust at execution.
- **On-device Android run.** Deferred (no SDK here). The native adapter + notification code are
  built and unit-tested; the first real device run (and the background-alarm firing) is a
  verification the user does with `expo run:android`, or a follow-up once a device is available.

## Handoff to Milestone 5 (Templates)

- Milestone 5 captures a session as a template (exercise list + default rests, no numbers),
  loads it into a new session, and prompts Update/No/Save-as-new on divergence — built on this
  milestone's session/exercise data model and the same local-write-syncs pattern.
- The exercise picker and the session screen are the reusable surfaces templates build on.

### Learnings from execution that Milestone 5 inherits

- **The web build is the live-verification path.** `@powersync/web` (wa-sqlite) runs the full
  app + real sync in the browser; every M4 flow was Playwright-verified on web. Two web-only
  bugs the M3 Node round-trip couldn't catch were fixed in M4: an **unbound `fetch`** (browsers
  enforce a Window-receiver check → `Illegal invocation`; fixed with `fetch.bind(globalThis)`
  in the connector and auth-api) and **`expo-secure-store` having no web impl** (added a
  `localStorage` fallback). Keep using web + Playwright for M5 UI verification.
- **A real Milestone 2 contract bug was found and fixed here:** the drizzle-zod upload
  contracts validated client-owned timestamp columns (`started_at`/`ended_at`/`performed_at`)
  as strict `z.date()`, which JSON can never satisfy — so **no timestamp column could ever
  sync**. Fixed with `z.coerce.date()` on those three fields (validation-only, commit
  `e77694b`). Verified live: valid ISO accepted, garbage rejected, epoch accepted. **Any new
  synced date/timestamp column (M5+) must use `z.coerce.date()`**, not `z.date()`. Minor known
  edge (not client-reachable): `z.coerce.date()` accepts an explicit `null` on a non-nullable
  field (coerces to epoch) — PowerSync PUT `opData` never carries nulls for non-null columns,
  so it can't be hit, but tighten if a code path ever sets one.
- **The API now has CORS** (`app.enableCors`, `CORS_ORIGINS` env, no credentials since it's a
  Bearer-token API) — the web client needs it. Production should set `CORS_ORIGINS` to the real
  web origin.
- **`useAuth`'s `isSignedIn`/`loading` is per-hook-instance state, not a shared context** — it
  works via explicit `router.replace` after login/sign-out, but M5 (more screens) would be more
  robust with a shared auth context. Consider promoting it.
- **The exercise-library seed** (`infra/postgres/seed-exercises.sql`, 20 global rows) is applied
  like `publication.sql` (in the runbook). Add M5's needs the same way if any.
- **On-device Android is still deferred.** The native adapter + the rest-timer notification
  alarm are built and unit-tested (mocked expo-notifications), but no device ran here — the
  background alarm firing (app killed) and a real `expo run:android` session are the outstanding
  device verifications, carried from M3. The `android.package` placeholder still needs setting.
- **Docker instability:** the Compose stack (esp. `api`/`powersync`) was found stopped/crash-
  looping several times mid-milestone and had to be brought back up (`docker compose up -d
  --wait`, or rebuild `api`); data survived in the named volumes each time. A fresh worktree
  also needs `pnpm -r build` (shared+emails `dist` is gitignored) before tests pass. Both are
  worth a line in the runbook.
