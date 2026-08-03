# Workouty Templates Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user save a real session as a reusable template (its exercise list + default rests, never reps/weights), start a new session from a template (exercises pre-filled, numbers blank), and — on finishing a session that started from a template and diverged — be asked **Update template / Don't update / Save as new**, never silently. Verified running on web.

**Architecture:** Pure additions on the existing schema and the Milestone 4 surfaces — no schema/migration changes. Templates are `templates` + `template_exercises` rows (already synced tables); a session links to its origin template via `sessions.template_id` (already exists). All writes are local PowerSync writes that sync via the Milestone 3 connector; all reads are reactive `useQuery`. Divergence detection is a pure, unit-tested comparison of the session's exercise list against the template's.

**Tech Stack:** Expo 57 / expo-router / React 19, `@powersync/react` (`useQuery`), the existing `ui/` kit, the M4 session/exercise surfaces, the running Compose stack, Playwright (web verification).

---

## Scope

This is **plan 5 of 6**, covering **Milestone 5 (Templates)** from §8 of
`docs/superpowers/specs/2026-07-09-workouty-design.md`, feature §3.5.

**This plan is done when**, on web against the live stack: a user can save a finished (or
active) session as a named template; see a list of their templates; start a new session from a
template with its exercises pre-filled (no numbers); and, on finishing a template-based session
whose exercise list diverged, get the **Update / Don't update / Save as new** prompt — with the
chosen action correctly writing (or not writing) the template, and all of it syncing to
Postgres. Plus basic template management (rename/delete).

**Deliberately NOT in this plan:** the dashboard — progression charts, PRs (Milestone 6);
reordering exercises within a template as a dedicated editor (a template is *captured from a
session*, per the spec — editing happens by running it and updating on divergence); OAuth; iOS.

## Verified facts this plan depends on

- **The schema already supports templates — no migration.** `templates` (id, user_id, name +
  base columns), `template_exercises` (id, user_id, template_id, exercise_id, position,
  default_rest_seconds + base columns), and `sessions.template_id` (nullable) all exist and are
  in the six synced tables + the sync rules. They sync down/up already.
- **A template holds structure only** (spec §3.5): the ordered exercise list + each exercise's
  default rest. It NEVER stores reps/weights — those are session data.
- **Milestone 4 surfaces to build on:** the session screen `app/(app)/session/[id].tsx` (log
  loop, add-exercise via the picker), the exercise picker + `useExercises` (C1), the session
  write helpers `session/session-writes.ts` (startSession/addSessionExercise/logSet/endSession),
  and the `ui/` kit. `useAuth().userId`, `usePowerSyncApp().db`, `useQuery`.
- **Local-write-syncs + the M4 fixes apply:** writes go to the local DB and upload via the
  connector (snake→camel + boolean coercion in crud-mapping.ts; `z.coerce.date()` on timestamp
  columns from M4). `templates`/`template_exercises` have no client-set timestamp columns beyond
  the server-owned created/updated/deleted (omitted from the upload schema), so **no new contract
  issue is expected** — but the first template write should be verified to actually reach
  Postgres (the same gate that caught the M2 timestamp bug), not assumed.
- **Duplicate-name handling:** `templates` has no unique index on name (unlike exercises), so two
  templates can share a name — no rejection path to handle. (Confirm against the schema; if a
  name constraint exists, reuse the M4 rejection-by-op-id pattern.)

## Decision record (non-obvious choices, with reasons)

1. **Templates are captured from sessions, not authored.** Per the spec, the create path is
   "save THIS session as a template" — copy the session's `session_exercises` (exercise_id +
   position) into `template_exercises`, taking each exercise's `default_rest_seconds` from the
   `exercises` row (or the session's per-exercise rest if we tracked one; we don't per-session,
   so use the exercise's default). No standalone template editor.

2. **Divergence = the ordered exercise-id list differs.** Compare the session's
   `session_exercises` (exercise_ids in position order) against the template's `template_exercises`
   (exercise_ids in position order). Added, removed, or reordered/swapped → diverged. Reps/weights
   are irrelevant (templates hold no numbers). This is a **pure function**, unit-tested.

3. **The prompt fires only on finishing a session that HAS a `template_id` AND diverged.** A
   freestyle session (no template_id) finishing never prompts. A template-based session that
   matches its template finishes silently. Only a diverged template-based session prompts
   **Update / Don't update / Save as new**. Never silent when diverged (spec §3.5).
   - **Update:** replace the template's `template_exercises` to match the session's current list
     (soft-delete the removed ones, insert the added ones, fix positions) — the template now
     reflects what you actually did.
     Keep `templates.name`.
   - **Save as new:** create a fresh template (new name) from the session's current list; leave
     the original untouched.
   - **Don't update:** no template writes.

3b. **`sessions.template_id` is set when a session starts from a template**, and stays null for
    freestyle. Starting-from-template pre-creates the `session_exercises` from the template (no
    sets). The user then logs numbers as normal (M4 loop).

4. **Everything is local-write + reactive-read**, verified on web (Playwright), exactly like M4.
   No new packages, no native concerns (no notifications), no schema change.

## File structure

```
apps/mobile/src/session/
  template-writes.ts        (new)  createTemplateFromSession, startSessionFromTemplate, updateTemplateFromSession, renameTemplate, deleteTemplate
  template-writes.test.ts   (new)
  divergence.ts             (new)  pure: exerciseListDiverged(sessionExerciseIds, templateExerciseIds) + a diff (added/removed/reordered)
  divergence.test.ts        (new)
  templates-queries.ts      (new)  useTemplates(), useTemplateExercises(templateId) (reactive)
apps/mobile/src/app/(app)/
  templates.tsx             (new)  list templates; start-from-template; rename/delete
  session/[id].tsx          (edit) "Save as template" action; on Finish, if template_id + diverged -> the prompt
  index.tsx                 (edit) home: "Start from template" -> templates list (alongside "Start session")
```

---

## Chunk A: Template data operations (pure/testable + reactive queries)

### Task A1: Template write helpers
- [ ] `template-writes.ts` (take a minimal `db` execute/getAll interface so it's unit-testable):
  - `createTemplateFromSession(db, { userId, sessionId, name }): Promise<string>` — read the
    session's `session_exercises` (exercise_id, position, ordered) + each exercise's
    `default_rest_seconds`; insert a `templates` row + `template_exercises` rows (position order,
    default_rest_seconds copied). Returns the new template id.
  - `startSessionFromTemplate(db, { userId, templateId }): Promise<string>` — insert a `sessions`
    row with `template_id = templateId`, started_at=now; then insert `session_exercises` from the
    template's `template_exercises` (exercise_id, position). Returns the new session id.
  - `updateTemplateFromSession(db, { templateId, sessionId }): Promise<void>` — make the template's
    `template_exercises` match the session's current `session_exercises` (soft-delete removed,
    insert added, update positions). Keep the name.
  - `renameTemplate(db, { templateId, name })`, `deleteTemplate(db, { templateId })` (soft delete
    the template + its `template_exercises`).
  - `removeSessionExercise(db, { sessionExerciseId })` — soft-delete a `session_exercise` **and
    its `sets`** (so a removed exercise leaves no orphaned sets). M4 only built *add*; this small
    addition lets the user drop an exercise mid-session AND makes remove-divergence producible
    end-to-end (the reviewer flagged that C2's "remove/swap" wasn't buildable without it).
  - Param binding, uuid ids, ISO timestamps, user_id from the caller — same conventions as
    `session-writes.ts`.
  - **`template_exercises.default_rest_seconds` is NOT NULL with no DB default** — every
    `template_exercises` insert MUST supply it (copied from the exercise). Don't omit it.
  - For `updateTemplateFromSession`, prefer the trivially-correct form: **soft-delete ALL the
    template's current `template_exercises`, then insert the session's current exercise list
    fresh** (positions 0..n). Since nothing on `template_exercises` is unique, this can't collide
    and avoids diff-logic bugs.
- [ ] TDD `template-writes.test.ts` with a mock db: createTemplate inserts a templates row + one
  template_exercise per session exercise (positions preserved, default_rest copied); startFrom
  inserts a session with template_id + session_exercises from the template; update reconciles
  (add/remove/reposition); rename/delete update the right rows; param binding asserted.
- [ ] Run mobile tests green; typecheck; both bundles. Commit.

### Task A2: Reactive template queries
- [ ] `templates-queries.ts`: `useTemplates()` (the user's templates, most-recent or alphabetical,
  reactive) and `useTemplateExercises(templateId)` (the template's exercises joined to names,
  ordered). Exclude soft-deleted. Keep the pure SQL-building unit-testable where feasible.
- [ ] Commit.

## Chunk B: Divergence detection (pure, unit-tested)

### Task B1: `divergence.ts`
- [ ] `exerciseListDiverged(sessionExerciseIds: string[], templateExerciseIds: string[]): boolean`
  — true if the ordered lists differ (added/removed/reordered). And a richer
  `diffExerciseLists(...)` returning `{ added, removed, reordered }` for a helpful prompt message.
  Pure, no DB. **The caller passes lists already filtered to `deleted_at IS NULL`** (both the
  session's `session_exercises` and the template's `template_exercises`) — divergence correctness
  hinges on this, so a tombstoned row never registers as a spurious "removed". The function
  itself is pure over the two id arrays.
- [ ] TDD `divergence.test.ts`: identical lists → not diverged; an added exercise → diverged
  (added lists it); a removed one → diverged; a reorder/swap → diverged; empty vs empty → not;
  the diff correctly categorizes. (Decide: does order matter? Per spec "added/removed/swapped" —
  yes, order matters; a swap is divergence.)
- [ ] Commit.

## Chunk C: UI — templates list, save-as-template, start-from-template, the divergence prompt

### Task C1: Templates list + start-from-template + management
- [ ] `app/(app)/templates.tsx`: `useTemplates()` list; each row shows the template name + its
  exercises (via `useTemplateExercises`); tapping "Start" → `startSessionFromTemplate` → navigate
  to the session screen with the new session id (exercises pre-filled, no sets). Rename (inline or
  a small form) + delete (with confirm). "New template" is captured from a session (see C2), so
  this screen is list+start+manage, not an editor.
- [ ] Home `index.tsx`: add "Start from template" → the templates list (alongside M4's "Start
  session" freestyle).
- [ ] Verify on web (Playwright): create a template (via C2 first, or seed one), see it listed,
  start a session from it → the session screen shows the template's exercises pre-filled with no
  sets. Rename + delete work. Screenshot. Commit.

### Task C2: Save-as-template + the divergence prompt on finish
- [ ] In `session/[id].tsx`: a "Save as template" action (name prompt) → `createTemplateFromSession`
  → the template appears in the list (reactive). Verify it reaches Postgres (templates +
  template_exercises rows owned by the user) — the gate that the write actually syncs.
- [ ] On **Finish session**: if the session has a `template_id` AND
  `exerciseListDiverged(sessionExerciseIds, templateExerciseIds)`, show a prompt (modal/dialog via
  the ui kit) with three choices:
  - **Update template** → `updateTemplateFromSession(db, { templateId, sessionId })`.
  - **Save as new** → name prompt → `createTemplateFromSession` (a fresh template), original
    untouched.
  - **Don't update** → nothing.
  Then `endSession` and navigate home. A freestyle session, or a matching template-based session,
  finishes without the prompt.
- [ ] Verify on web (Playwright) — the full loop:
  - Start a freestyle session, log a couple of exercises, "Save as template" (name it) → the
    template exists (list + Postgres). Finish (freestyle → no prompt).
  - Start a session FROM that template → exercises pre-filled. Log some sets. Finish WITHOUT
    diverging → no prompt (finishes silently).
  - Start from the template again, ADD an exercise (diverge). Finish → the prompt appears. Choose
    **Update** → the template now includes the added exercise (verify in the list + Postgres
    `template_exercises`). 
  - Start from the template again, **remove an exercise** (via the new `removeSessionExercise`
    control), Finish → prompt → **Save as new** → a second template exists (without the removed
    exercise); the first is unchanged.
  - Start from the template, diverge (add), Finish → prompt → **Don't update** → the template is
    unchanged.
  (The **add**-divergence case is the primary gate and fully exercises the prompt → all three
  actions; the remove case additionally exercises `removeSessionExercise`. Reordered-divergence
  is covered by `divergence.test.ts` since M4 has no reorder control.)
  Paste the psql confirmations for the Update and Save-as-new cases. Clean up the test user + rows.
- [ ] mobile tests green; typecheck; both bundles. Commit.

## Definition of done

- [x] Save a session as a named template (exercises + default rests, no numbers) — synced to
  Postgres.
- [x] Templates list; start a session from a template with exercises pre-filled and no sets.
- [x] Finishing a template-based session that diverged prompts **Update / Don't / Save as new**;
  a freestyle or matching session finishes silently. Each choice writes (or doesn't) correctly,
  verified in Postgres.
- [x] Divergence detection is a pure, unit-tested function (added/removed/reordered).
- [x] Rename/delete templates work.
- [x] Milestones 1–4 tests stay green; the app bundles web + native.

## Open questions

- **Default rest source for a captured template.** A session doesn't record a per-exercise rest,
  so a captured template takes each exercise's `default_rest_seconds` from the `exercises` row.
  Acceptable for v1; if the user tweaks rest per-session later (not in M4), revisit.
- **The template's stored rest is effectively write-only for now.** `startSessionFromTemplate`
  creates `session_exercises`, but the M4 session screen sources the rest countdown from
  `exercises.default_rest_seconds` (there's no per-session-exercise rest column). Since there's
  no template-rest editor, `template_exercises.default_rest_seconds` always equals
  `exercises.default_rest_seconds` (copied at capture), so nothing is lost — but a future
  "edit template rest" feature would need the session to read the template's rest. Note only.
- **Does exercise ORDER count as divergence?** The spec says "added, removed, or swapped", so yes
  — a reorder is divergence and the prompt fires. Confirm this matches the user's intent at
  execution; if reorder-only should be ignored, make `exerciseListDiverged` set-based instead of
  order-sensitive (documented toggle).

## Handoff to Milestone 6 (Dashboard)

- Milestone 6 reads the accumulated `sessions`/`session_exercises`/`sets` (now richer with
  template-based sessions) for per-exercise progression charts and automatic PRs — all reactive
  `useQuery` over the synced local DB, same pattern.
- The estimated-1RM helper already exists in `@workouty/shared` (`estimateOneRepMax`) for the
  progression/PR math.
- On-device Android + the background-alarm fire remain deferred from M3/M4 (documented there).

## Execution learnings (M5 — completed)

- **Client deletes MUST be a real SQL `DELETE`, never `UPDATE ... SET deleted_at`.** The upload
  contract (`upload-contracts.ts`) treats `deleted_at` as server-owned and strips it from PUT/PATCH
  ops, so a client-side `UPDATE deleted_at` uploads as a no-op and the row reappears on the next
  sync. A PowerSync `DELETE` op is what reaches the M2 upload service's soft-delete path (which sets
  `deleted_at` server-side, preserving the row in Postgres — the never-hard-delete invariant holds).
  Caught in C1 when a mocked A1 test couldn't see it; fixed across `deleteTemplate`,
  `updateTemplateFromSession`, and `removeSessionExercise`. **General rule for the whole app: local
  delete = SQL `DELETE` → server soft-delete.** Applies to any future client-side deletion (M6+).
- The DELETE-semantics fix was re-verified end-to-end in C2's `updateTemplateFromSession` (Update
  action): the old `template_exercises` carry `deleted_at` and remain in Postgres; the reinserted
  rows are live. `template_exercises` has no unique constraint, so DELETE-all-then-reinsert with a
  repeated `exercise_id` never collides.
- Divergence is order-sensitive (`exerciseListDiverged`), matching the spec's "swapped" — a reorder
  fires the prompt. M4 has no reorder control, so reorder-divergence is covered by unit tests only.
- All four finish paths (freestyle-silent, matching-silent, add→Update, remove→Save-as-new,
  diverge→Don't) were Playwright + psql verified on web with a fresh user, then the test data was
  cleaned up. A2's reactive queries were folded into C1 (not a separate commit).
