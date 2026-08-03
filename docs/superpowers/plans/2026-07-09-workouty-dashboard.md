# Milestone 6 — Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the user whether they're getting stronger — a per-exercise progression chart (top weight + estimated 1RM over time), automatically-detected personal records listed on a dashboard, and a "New PR!" badge surfaced in the logging screen the moment a set beats a previous best.

**Architecture:** All dashboard data is **derived by query** from the synced local set history — there is no PR table and no new schema (spec §3.6). Isomorphic aggregation math (progression series, PR flags, per-exercise bests) lives in `@workouty/shared` as pure, unit-tested functions built on the existing `estimateOneRepMax` (Epley); the mobile side is thin reactive `useQuery` hooks that pull rows and feed them through those functions. The estimated-1RM must come from the canonical `estimateOneRepMax` (its reps=1 special-case can't be reproduced in SQL), so per-session/per-exercise maxima are computed in JS over pulled rows, not with SQL `MAX()`. The chart is rendered with plain React Native `View`s (no charting/native dependency) so it works identically on web and Android.

**Tech Stack:** TypeScript, `@workouty/shared` (vitest, zero runtime deps), Expo 57 / React Native 0.86 / React 19, expo-router, `@powersync/react` `useQuery`, the app's own `ui/` kit.

## Global Constraints

- **Expo has changed.** Read the versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any Expo/RN code.
- **Kilograms only.** Weight is `weight_kg` (a SQLite `REAL` / Postgres `doublePrecision`).
- **Targets: web + Android.** No iOS-specific code. Verify on **web** (the app runs fully in-browser via `@powersync/web` with real sync). On-device Android is deferred (documented in M3/M4).
- **No new schema, no PR table.** PRs and progression are derived by query from `sets` / `session_exercises` / `sessions`. Do **not** modify `apps/api`, `apps/api/src/db/schema.ts`, the sync rules, or `docker-compose`.
- **Estimated 1RM = Epley via `estimateOneRepMax(weightKg, reps)` from `@workouty/shared`.** Never re-implement it; never approximate it in SQL. A **PR** is a new maximum `weight_kg` **or** a new maximum estimated 1RM for an exercise (spec §3.6).
- **Exclude soft-deleted rows** (`deleted_at IS NULL`) in every query — locally-written soft-deletes land in the mirror before the server round-trip (same habit as `session/templates-queries.ts`).
- **Reuse the `ui/` kit** (`Screen`, `Heading`, `Text`, `Button`, `Field`, theme) — no ad-hoc styling systems.
- **Don't commit** `dist/` or `.env`. **Keep the existing 200 mobile unit tests green.** Both bundles (`expo export --platform web` and `--platform ios`) must pass.
- **Do not fake web verification.** Screenshots + observed reactive updates are the gate.

## Prior art already in place (do NOT rebuild)

- **Last-time reference (spec §3.6 item 3) shipped in Milestone 4** — `apps/mobile/src/session/last-time.ts` (`useLastTime`, `lastTimeTopSetSql`). M6 does not touch it.
- `estimateOneRepMax(weightKg, reps)` — `packages/shared/src/one-rep-max.ts`. Returns `weightKg` unchanged at `reps === 1`; throws `RangeError` on `reps < 1` / non-integer / negative weight. Exported from `packages/shared/src/index.ts`.
- Reactive-query pattern to mirror: `apps/mobile/src/session/templates-queries.ts` and `last-time.ts` (a pure SQL-builder function + a thin `useQuery` hook; unit-test the builder/mapper without a live DB).

## Data model reference (existing columns — read-only here)

- `sets`: `id`, `user_id`, `session_exercise_id`, `set_index`, `reps` (int, ≥1), `weight_kg` (real, ≥0), `performed_at` (ISO), `actual_rest_seconds`, `+base` (`created_at`/`updated_at`/`deleted_at`).
- `session_exercises`: `id`, `user_id`, `session_id`, `exercise_id`, `position`, `+base`.
- `sessions`: `id`, `user_id`, `template_id?`, `started_at` (ISO), `ended_at?`, `+base`.
- `exercises`: `id`, `name`, `default_rest_seconds`, `is_custom`, `+base`.

Join path for "all of an exercise's sets with their session date":
`sets s → session_exercises se (se.id = s.session_exercise_id) → sessions sess (sess.id = se.session_id)`, filter `se.exercise_id = ?`.

ISO timestamp strings sort lexicographically in chronological order — order by the string directly; no date parsing needed.

## File structure

**`packages/shared/src/` (new pure modules + tests):**
- `progression.ts` — `WorkoutSet`, `ProgressionPoint`, `computeProgression`.
- `progression.test.ts`.
- `personal-records.ts` — `RecordSet`, `RecordFlags`, `PersonalBest`, `markPersonalRecords`, `computePersonalBest`.
- `personal-records.test.ts`.
- `index.ts` — add `export * from './progression'` and `export * from './personal-records'`.

**`apps/mobile/`:**
- `package.json` — add `"@workouty/shared": "workspace:*"` to `dependencies`.
- `metro.config.js` — ensure Metro resolves the workspace package (watch the repo root / shared package) if it doesn't already.
- `src/dashboard/progression-query.ts` — `progressionSetsSql`, `useProgression(exerciseId)`.
- `src/dashboard/performed-exercises-query.ts` — `performedExercisesSql`, `usePerformedExercises()`.
- `src/dashboard/personal-records-query.ts` — `personalRecordsSql`, `usePersonalRecords()`.
- `src/dashboard/pr-set-ids-query.ts` — `prSetsSql`, `usePrSetIds(exerciseId)`.
- `src/dashboard/*.test.ts` — unit tests for the SQL builders + row→domain mappers.
- `src/dashboard/ProgressionChart.tsx` — dependency-free bar chart.
- `src/app/(app)/dashboard.tsx` — the dashboard screen.
- `src/app/(app)/index.tsx` — add a "Dashboard" nav link (modify).
- `src/app/(app)/session/[id].tsx` — badge PR sets via `usePrSetIds` (modify).

---

### Task A1: Shared progression math

**Files:**
- Create: `packages/shared/src/progression.ts`
- Test: `packages/shared/src/progression.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `estimateOneRepMax` from `./one-rep-max`.
- Produces:
  ```ts
  export interface WorkoutSet {
    sessionId: string
    sessionStartedAt: string // ISO; identical for every set in a session
    weightKg: number
    reps: number
  }
  export interface ProgressionPoint {
    sessionId: string
    date: string // ISO — the session's startedAt
    topWeightKg: number // max weight_kg among that session's sets for the exercise
    bestEstimatedOneRepMax: number // max estimateOneRepMax among that session's sets
  }
  export function computeProgression(sets: WorkoutSet[]): ProgressionPoint[]
  ```

- [ ] **Step 1: Write the failing test** — `packages/shared/src/progression.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeProgression } from './progression'

describe('computeProgression', () => {
  it('returns [] for no sets', () => {
    expect(computeProgression([])).toEqual([])
  })

  it('collapses a session to its top weight and best estimated 1RM', () => {
    const points = computeProgression([
      { sessionId: 's1', sessionStartedAt: '2026-01-01T10:00:00.000Z', weightKg: 60, reps: 8 },
      { sessionId: 's1', sessionStartedAt: '2026-01-01T10:00:00.000Z', weightKg: 80, reps: 1 },
    ])
    expect(points).toHaveLength(1)
    // top weight = 80 (the single). best e1RM: 60×(1+8/30)=76 vs 80 (reps=1 ⇒ unchanged) ⇒ 80.
    expect(points[0].topWeightKg).toBe(80)
    expect(points[0].bestEstimatedOneRepMax).toBeCloseTo(80, 10)
    expect(points[0].date).toBe('2026-01-01T10:00:00.000Z')
    expect(points[0].sessionId).toBe('s1')
  })

  it('produces one chronological point per session, oldest first', () => {
    const points = computeProgression([
      { sessionId: 'b', sessionStartedAt: '2026-02-01T10:00:00.000Z', weightKg: 70, reps: 5 },
      { sessionId: 'a', sessionStartedAt: '2026-01-01T10:00:00.000Z', weightKg: 60, reps: 5 },
    ])
    expect(points.map((p) => p.sessionId)).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @workouty/shared test`
Expected: FAIL (`computeProgression` not defined / module not found).

- [ ] **Step 3: Implement** — `packages/shared/src/progression.ts`:

```ts
import { estimateOneRepMax } from './one-rep-max'

/**
 * One logged set, tagged with the session it belongs to and when that session started.
 * `sessionStartedAt` is identical across every set in a session (it's the session's timestamp,
 * not the set's) — it's what the chart plots the session against on the time axis.
 */
export interface WorkoutSet {
  sessionId: string
  sessionStartedAt: string
  weightKg: number
  reps: number
}

/** One point on the per-exercise progression chart: a single session collapsed to its bests. */
export interface ProgressionPoint {
  sessionId: string
  date: string
  topWeightKg: number
  bestEstimatedOneRepMax: number
}

/**
 * Collapse an exercise's set history into one point per session — the session's heaviest set and
 * its best estimated 1RM (Epley; the heaviest set and the best-1RM set need not be the same one,
 * e.g. a heavy single vs. a lighter high-rep set). Points come out oldest-first (ISO timestamps
 * sort chronologically). Input may span many sessions in any order.
 */
export function computeProgression(sets: WorkoutSet[]): ProgressionPoint[] {
  const bySession = new Map<string, ProgressionPoint>()
  for (const s of sets) {
    const e1rm = estimateOneRepMax(s.weightKg, s.reps)
    const existing = bySession.get(s.sessionId)
    if (!existing) {
      bySession.set(s.sessionId, {
        sessionId: s.sessionId,
        date: s.sessionStartedAt,
        topWeightKg: s.weightKg,
        bestEstimatedOneRepMax: e1rm,
      })
    } else {
      if (s.weightKg > existing.topWeightKg) existing.topWeightKg = s.weightKg
      if (e1rm > existing.bestEstimatedOneRepMax) existing.bestEstimatedOneRepMax = e1rm
    }
  }
  return [...bySession.values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0,
  )
}
```

- [ ] **Step 4: Export it** — append to `packages/shared/src/index.ts`:

```ts
export * from './progression'
```

- [ ] **Step 5: Run tests, verify pass**

Run: `pnpm --filter @workouty/shared test`
Expected: PASS (all progression cases + the existing one-rep-max suite).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/progression.ts packages/shared/src/progression.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): per-session progression series (top weight + best estimated 1RM)"
```

---

### Task A2: Shared personal-records math

**Files:**
- Create: `packages/shared/src/personal-records.ts`
- Test: `packages/shared/src/personal-records.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `estimateOneRepMax` from `./one-rep-max`.
- Produces:
  ```ts
  export interface RecordSet { id: string; performedAt: string; weightKg: number; reps: number }
  export interface RecordFlags { isWeightPr: boolean; isEstimatedOneRepMaxPr: boolean }
  export interface PersonalBest {
    bestWeightKg: number
    bestWeightReps: number
    bestWeightAt: string
    bestEstimatedOneRepMax: number
    bestEstimatedOneRepMaxAt: string
  }
  export function markPersonalRecords(sets: RecordSet[]): Array<RecordSet & RecordFlags>
  export function computePersonalBest(sets: RecordSet[]): PersonalBest | null
  ```

Semantics: `markPersonalRecords` walks the sets in `performedAt` order and flags each set that **strictly** beats the best weight (or best estimated 1RM) seen *before* it. The **first-ever set is not a PR** (no previous best to beat — matches the spec's "beats a previous best"); equalling a best is not a PR. `computePersonalBest` returns the current all-time best weight set and best estimated-1RM set, or `null` for empty history.

- [ ] **Step 1: Write the failing test** — `packages/shared/src/personal-records.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { markPersonalRecords, computePersonalBest } from './personal-records'

const S = (id: string, performedAt: string, weightKg: number, reps: number) => ({ id, performedAt, weightKg, reps })

describe('markPersonalRecords', () => {
  it('never flags the first set (nothing to beat)', () => {
    const [only] = markPersonalRecords([S('a', '2026-01-01T00:00:00.000Z', 60, 5)])
    expect(only.isWeightPr).toBe(false)
    expect(only.isEstimatedOneRepMaxPr).toBe(false)
  })

  it('flags a strictly heavier set as a weight PR', () => {
    const out = markPersonalRecords([
      S('a', '2026-01-01T00:00:00.000Z', 60, 5),
      S('b', '2026-01-08T00:00:00.000Z', 65, 5),
    ])
    expect(out.find((s) => s.id === 'b')!.isWeightPr).toBe(true)
  })

  it('does not flag equalling the previous best', () => {
    const out = markPersonalRecords([
      S('a', '2026-01-01T00:00:00.000Z', 60, 5),
      S('b', '2026-01-08T00:00:00.000Z', 60, 5),
    ])
    expect(out.find((s) => s.id === 'b')!.isWeightPr).toBe(false)
  })

  it('flags an estimated-1RM PR even when weight did not increase', () => {
    // a: 60×5 ⇒ e1RM 70. b: same 60 kg but 8 reps ⇒ e1RM 76 (> 70) ⇒ e1RM PR, not a weight PR.
    const out = markPersonalRecords([
      S('a', '2026-01-01T00:00:00.000Z', 60, 5),
      S('b', '2026-01-08T00:00:00.000Z', 60, 8),
    ])
    const b = out.find((s) => s.id === 'b')!
    expect(b.isWeightPr).toBe(false)
    expect(b.isEstimatedOneRepMaxPr).toBe(true)
  })

  it('processes chronologically regardless of input order', () => {
    const out = markPersonalRecords([
      S('b', '2026-01-08T00:00:00.000Z', 65, 5),
      S('a', '2026-01-01T00:00:00.000Z', 60, 5),
    ])
    expect(out.find((s) => s.id === 'a')!.isWeightPr).toBe(false) // earliest
    expect(out.find((s) => s.id === 'b')!.isWeightPr).toBe(true)
  })
})

describe('computePersonalBest', () => {
  it('returns null for empty history', () => {
    expect(computePersonalBest([])).toBeNull()
  })

  it('reports the best weight and best estimated 1RM with their timestamps', () => {
    const best = computePersonalBest([
      S('a', '2026-01-01T00:00:00.000Z', 60, 8), // e1RM 76
      S('b', '2026-01-08T00:00:00.000Z', 80, 1), // weight 80, e1RM 80
    ])!
    expect(best.bestWeightKg).toBe(80)
    expect(best.bestWeightAt).toBe('2026-01-08T00:00:00.000Z')
    expect(best.bestEstimatedOneRepMax).toBeCloseTo(80, 10)
    expect(best.bestEstimatedOneRepMaxAt).toBe('2026-01-08T00:00:00.000Z')
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @workouty/shared test`
Expected: FAIL (`markPersonalRecords` / `computePersonalBest` not defined).

- [ ] **Step 3: Implement** — `packages/shared/src/personal-records.ts`:

```ts
import { estimateOneRepMax } from './one-rep-max'

/** A logged set reduced to what PR detection needs. `performedAt` is ISO (chronological sort key). */
export interface RecordSet {
  id: string
  performedAt: string
  weightKg: number
  reps: number
}

export interface RecordFlags {
  isWeightPr: boolean
  isEstimatedOneRepMaxPr: boolean
}

/** The current all-time bests for a single exercise's history. */
export interface PersonalBest {
  bestWeightKg: number
  bestWeightReps: number
  bestWeightAt: string
  bestEstimatedOneRepMax: number
  bestEstimatedOneRepMaxAt: string
}

// ISO strings sort chronologically; tie-break on id for determinism.
function chronological(a: RecordSet, b: RecordSet): number {
  return a.performedAt < b.performedAt ? -1 : a.performedAt > b.performedAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Flag each set that STRICTLY beats the best weight (or best estimated 1RM) established by any
 * EARLIER set. The first set is never a PR (nothing preceded it); equalling a prior best is not a
 * PR. A "PR" for surfacing purposes is `isWeightPr || isEstimatedOneRepMaxPr`.
 */
export function markPersonalRecords(sets: RecordSet[]): Array<RecordSet & RecordFlags> {
  const ordered = [...sets].sort(chronological)
  let maxWeight: number | null = null
  let maxE1rm: number | null = null
  return ordered.map((s) => {
    const e1rm = estimateOneRepMax(s.weightKg, s.reps)
    const isWeightPr = maxWeight !== null && s.weightKg > maxWeight
    const isEstimatedOneRepMaxPr = maxE1rm !== null && e1rm > maxE1rm
    if (maxWeight === null || s.weightKg > maxWeight) maxWeight = s.weightKg
    if (maxE1rm === null || e1rm > maxE1rm) maxE1rm = e1rm
    return { ...s, isWeightPr, isEstimatedOneRepMaxPr }
  })
}

/** The current best weight set and best estimated-1RM set, or null for an empty history. */
export function computePersonalBest(sets: RecordSet[]): PersonalBest | null {
  if (sets.length === 0) return null
  let bw = sets[0]
  let be = sets[0]
  let beVal = estimateOneRepMax(sets[0].weightKg, sets[0].reps)
  for (const s of sets) {
    if (s.weightKg > bw.weightKg) bw = s
    const e = estimateOneRepMax(s.weightKg, s.reps)
    if (e > beVal) {
      be = s
      beVal = e
    }
  }
  return {
    bestWeightKg: bw.weightKg,
    bestWeightReps: bw.reps,
    bestWeightAt: bw.performedAt,
    bestEstimatedOneRepMax: beVal,
    bestEstimatedOneRepMaxAt: be.performedAt,
  }
}
```

- [ ] **Step 4: Export it** — append to `packages/shared/src/index.ts`:

```ts
export * from './personal-records'
```

- [ ] **Step 5: Run tests, verify pass**

Run: `pnpm --filter @workouty/shared test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/personal-records.ts packages/shared/src/personal-records.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): derive personal records (weight + estimated-1RM PRs, current bests)"
```

---

### Task B1: Wire `@workouty/shared` into mobile + dashboard reactive queries

This is the milestone's highest-risk plumbing: **M6 is the first mobile consumer of `@workouty/shared`.** Prove Metro + vitest resolve the workspace package before building UI on top of it.

**Files:**
- Modify: `apps/mobile/package.json` (add dep), `apps/mobile/metro.config.js` (workspace resolution, if needed)
- Create: `apps/mobile/src/dashboard/progression-query.ts`, `performed-exercises-query.ts`, `personal-records-query.ts`, `pr-set-ids-query.ts`
- Test: `apps/mobile/src/dashboard/progression-query.test.ts`, `performed-exercises-query.test.ts`, `personal-records-query.test.ts`, `pr-set-ids-query.test.ts`

**Interfaces:**
- Consumes: `computeProgression`, `WorkoutSet`, `ProgressionPoint`, `markPersonalRecords`, `computePersonalBest`, `PersonalBest` from `@workouty/shared`; `useQuery` from `@powersync/react`.
- Produces:
  ```ts
  // progression-query.ts
  export function progressionSetsSql(exerciseId: string): { sql: string; params: unknown[] }
  export function useProgression(exerciseId: string | null): ProgressionPoint[]
  // performed-exercises-query.ts
  export interface PerformedExercise { id: string; name: string }
  export const performedExercisesSql: string
  export function usePerformedExercises(): { data: PerformedExercise[]; isLoading: boolean }
  // personal-records-query.ts
  export interface ExerciseRecord { exerciseId: string; name: string; best: PersonalBest }
  export const personalRecordsSql: string
  export function usePersonalRecords(): { data: ExerciseRecord[]; isLoading: boolean }
  // pr-set-ids-query.ts
  export function prSetsSql(exerciseId: string): { sql: string; params: unknown[] }
  export function usePrSetIds(exerciseId: string | null): Set<string>
  ```

- [ ] **Step 1: Add the dependency.** In `apps/mobile/package.json`, add to `dependencies` (keep the block alphabetically consistent with the existing entries):

```json
"@workouty/shared": "workspace:*"
```

Then, from the repo root: `pnpm install` and `pnpm --filter @workouty/shared build` (the mobile side resolves `@workouty/shared`'s built `dist/`, which is gitignored — it must exist for vitest and Metro).

- [ ] **Step 2: Prove Metro resolution with a bundle smoke test.** Confirm Metro (a pnpm monorepo with symlinked workspace packages) resolves `@workouty/shared`. Add the shared package / repo root to `metro.config.js` `watchFolders` and ensure `resolver.nodeModulesPaths` includes the workspace root **if** the default config doesn't already pick it up. Verify by importing it somewhere reachable by the web bundle (e.g. temporarily in a query file you're about to write) and running `pnpm --filter @workouty/mobile exec expo export --platform web`. Expected: the bundle succeeds and does not error on `Unable to resolve "@workouty/shared"`. Remove the `dist/` output afterward. If resolution fails, fix `metro.config.js` before proceeding — do not work around it by copying the math into mobile.

- [ ] **Step 3: Write the failing tests** for the four SQL builders + mappers. These follow `last-time.ts`'s pattern — a pure builder/mapper tested without a live DB. Example `apps/mobile/src/dashboard/progression-query.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { progressionSetsSql, mapProgressionRows } from './progression-query'

describe('progressionSetsSql', () => {
  it('filters by exercise and excludes soft-deleted rows and sessions', () => {
    const { sql, params } = progressionSetsSql('ex-1')
    expect(sql).toMatch(/se\.exercise_id = \?/)
    expect(sql).toMatch(/se\.deleted_at IS NULL/)
    expect(sql).toMatch(/s\.deleted_at IS NULL/)
    expect(sql).toMatch(/sess\.deleted_at IS NULL/)
    expect(params).toEqual(['ex-1'])
  })
})

describe('mapProgressionRows', () => {
  it('maps rows to a chronological one-point-per-session series', () => {
    const points = mapProgressionRows([
      { session_id: 's1', started_at: '2026-01-01T10:00:00.000Z', weight_kg: 60, reps: 8 },
      { session_id: 's1', started_at: '2026-01-01T10:00:00.000Z', weight_kg: 80, reps: 1 },
    ])
    expect(points).toHaveLength(1)
    expect(points[0].topWeightKg).toBe(80)
    expect(points[0].bestEstimatedOneRepMax).toBeCloseTo(80, 10)
  })
})
```

Write analogous tests for `performed-exercises-query.test.ts` (SQL selects DISTINCT, excludes soft-deleted, orders by name), `personal-records-query.test.ts` (mapper groups rows by exercise → `computePersonalBest` each, drops exercises whose best is null), and `pr-set-ids-query.test.ts` (mapper runs `markPersonalRecords` and returns the id-set of `isWeightPr || isEstimatedOneRepMaxPr`, e.g. two sets 60×5 then 65×5 ⇒ set contains only the second id).

- [ ] **Step 4: Run tests, verify they fail**

Run: `pnpm --filter @workouty/mobile test -- src/dashboard`
Expected: FAIL (builders/mappers not defined).

- [ ] **Step 5: Implement the four query modules.**

`apps/mobile/src/dashboard/progression-query.ts`:

```ts
import { useQuery } from '@powersync/react'
import { computeProgression, type ProgressionPoint, type WorkoutSet } from '@workouty/shared'

interface ProgressionRow {
  session_id: string
  started_at: string
  weight_kg: number
  reps: number
}

// All live sets for `exerciseId`, tagged with their session id + start time. Soft-deleted sets,
// session_exercises, and sessions are all excluded (a locally-written soft-delete beats the sync
// round-trip to the mirror, so filter defensively — same habit as session/templates-queries.ts).
export function progressionSetsSql(exerciseId: string): { sql: string; params: unknown[] } {
  const sql = `
    SELECT se.session_id AS session_id, sess.started_at AS started_at,
           s.weight_kg AS weight_kg, s.reps AS reps
    FROM sets s
    JOIN session_exercises se ON se.id = s.session_exercise_id
    JOIN sessions sess ON sess.id = se.session_id
    WHERE se.exercise_id = ?
      AND se.deleted_at IS NULL
      AND s.deleted_at IS NULL
      AND sess.deleted_at IS NULL
  `
  return { sql, params: [exerciseId] }
}

export function mapProgressionRows(rows: ProgressionRow[]): ProgressionPoint[] {
  const sets: WorkoutSet[] = rows.map((r) => ({
    sessionId: r.session_id,
    sessionStartedAt: r.started_at,
    weightKg: r.weight_kg,
    reps: r.reps,
  }))
  return computeProgression(sets)
}

// exerciseId may be null (nothing selected yet) — fold into a query that can't match any row
// (empty string never equals a real uuid) so the hook still runs unconditionally.
export function useProgression(exerciseId: string | null): ProgressionPoint[] {
  const { sql, params } = progressionSetsSql(exerciseId ?? '')
  const { data } = useQuery<ProgressionRow>(sql, params)
  return mapProgressionRows(data)
}
```

`apps/mobile/src/dashboard/performed-exercises-query.ts`:

```ts
import { useQuery } from '@powersync/react'

export interface PerformedExercise { id: string; name: string }

// Distinct exercises the user has at least one live set for, alphabetically — the dashboard's
// exercise selector. No user_id filter needed (the local mirror only holds this user's rows).
export const performedExercisesSql = `
  SELECT DISTINCT e.id AS id, e.name AS name
  FROM sets s
  JOIN session_exercises se ON se.id = s.session_exercise_id
  JOIN exercises e ON e.id = se.exercise_id
  WHERE se.deleted_at IS NULL AND s.deleted_at IS NULL
  ORDER BY e.name ASC
`

export function usePerformedExercises(): { data: PerformedExercise[]; isLoading: boolean } {
  const { data, isLoading } = useQuery<PerformedExercise>(performedExercisesSql)
  return { data, isLoading }
}
```

`apps/mobile/src/dashboard/personal-records-query.ts`:

```ts
import { useQuery } from '@powersync/react'
import { computePersonalBest, type PersonalBest, type RecordSet } from '@workouty/shared'

export interface ExerciseRecord { exerciseId: string; name: string; best: PersonalBest }

interface RecordRow {
  exercise_id: string
  name: string
  id: string
  performed_at: string
  weight_kg: number
  reps: number
}

// Every live set joined to its exercise, ordered so rows group by exercise. Bests are computed in
// JS (estimateOneRepMax's reps=1 case can't be done in SQL), so pull rows and reduce per exercise.
export const personalRecordsSql = `
  SELECT e.id AS exercise_id, e.name AS name, s.id AS id, s.performed_at AS performed_at,
         s.weight_kg AS weight_kg, s.reps AS reps
  FROM sets s
  JOIN session_exercises se ON se.id = s.session_exercise_id
  JOIN exercises e ON e.id = se.exercise_id
  WHERE se.deleted_at IS NULL AND s.deleted_at IS NULL
  ORDER BY e.name ASC, s.performed_at ASC
`

export function mapPersonalRecordRows(rows: RecordRow[]): ExerciseRecord[] {
  const byExercise = new Map<string, { name: string; sets: RecordSet[] }>()
  for (const r of rows) {
    let entry = byExercise.get(r.exercise_id)
    if (!entry) {
      entry = { name: r.name, sets: [] }
      byExercise.set(r.exercise_id, entry)
    }
    entry.sets.push({ id: r.id, performedAt: r.performed_at, weightKg: r.weight_kg, reps: r.reps })
  }
  const out: ExerciseRecord[] = []
  for (const [exerciseId, { name, sets }] of byExercise) {
    const best = computePersonalBest(sets)
    if (best) out.push({ exerciseId, name, best })
  }
  return out
}

export function usePersonalRecords(): { data: ExerciseRecord[]; isLoading: boolean } {
  const { data, isLoading } = useQuery<RecordRow>(personalRecordsSql)
  return { data: mapPersonalRecordRows(data), isLoading }
}
```

`apps/mobile/src/dashboard/pr-set-ids-query.ts`:

```ts
import { useQuery } from '@powersync/react'
import { markPersonalRecords, type RecordSet } from '@workouty/shared'

interface PrRow { id: string; performed_at: string; weight_kg: number; reps: number }

// All live sets for `exerciseId`, chronologically — fed through markPersonalRecords to find which
// sets are PRs (weight OR estimated-1RM). Used to badge "New PR!" in the logging screen.
export function prSetsSql(exerciseId: string): { sql: string; params: unknown[] } {
  const sql = `
    SELECT s.id AS id, s.performed_at AS performed_at, s.weight_kg AS weight_kg, s.reps AS reps
    FROM sets s
    JOIN session_exercises se ON se.id = s.session_exercise_id
    WHERE se.exercise_id = ?
      AND se.deleted_at IS NULL
      AND s.deleted_at IS NULL
  `
  return { sql, params: [exerciseId] }
}

export function mapPrSetIds(rows: PrRow[]): Set<string> {
  const sets: RecordSet[] = rows.map((r) => ({
    id: r.id,
    performedAt: r.performed_at,
    weightKg: r.weight_kg,
    reps: r.reps,
  }))
  return new Set(
    markPersonalRecords(sets)
      .filter((s) => s.isWeightPr || s.isEstimatedOneRepMaxPr)
      .map((s) => s.id),
  )
}

export function usePrSetIds(exerciseId: string | null): Set<string> {
  const { sql, params } = prSetsSql(exerciseId ?? '')
  const { data } = useQuery<PrRow>(sql, params)
  return mapPrSetIds(data)
}
```

- [ ] **Step 6: Run tests, verify pass**

Run: `pnpm --filter @workouty/mobile test`
Expected: PASS (new dashboard tests + the existing 200 still green). Also run `pnpm --filter @workouty/mobile exec tsc --noEmit` — clean.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/package.json apps/mobile/metro.config.js apps/mobile/src/dashboard pnpm-lock.yaml
git commit -m "feat(mobile): wire @workouty/shared + dashboard reactive queries (progression, PRs, PR set-ids)"
```

---

### Task B2: Progression chart + dashboard screen + home nav

**Files:**
- Create: `apps/mobile/src/dashboard/ProgressionChart.tsx`, `apps/mobile/src/app/(app)/dashboard.tsx`
- Modify: `apps/mobile/src/app/(app)/index.tsx`

**Interfaces:**
- Consumes: `useProgression`, `usePerformedExercises`, `usePersonalRecords`, `ProgressionPoint`, `ExerciseRecord`; the `ui/` kit; `expo-router` `router`/`Link`.
- Produces: the `/dashboard` route + a nav entry from home. `ProgressionChart` props:
  ```ts
  interface ProgressionChartProps { points: ProgressionPoint[]; metric: 'weight' | 'e1rm' }
  ```

- [ ] **Step 1: Build `ProgressionChart.tsx`** — a dependency-free bar chart (one bar per session, height ∝ value normalized to the series max; the newest bar labelled with its value; horizontal scroll for long histories). No `react-native-svg`, no charting lib — plain `View`s so web and Android render identically.

```tsx
import { ScrollView, View } from 'react-native'
import { Text } from '../ui'
import { theme } from '../ui/theme'
import type { ProgressionPoint } from '@workouty/shared'

interface ProgressionChartProps {
  points: ProgressionPoint[]
  metric: 'weight' | 'e1rm'
}

const CHART_HEIGHT = 160

export function ProgressionChart({ points, metric }: ProgressionChartProps) {
  if (points.length === 0) {
    return <Text>No sets logged for this exercise yet.</Text>
  }
  const value = (p: ProgressionPoint) => (metric === 'weight' ? p.topWeightKg : p.bestEstimatedOneRepMax)
  const max = Math.max(...points.map(value))
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} testID="progression-chart">
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: CHART_HEIGHT, gap: 8 }}>
        {points.map((p, i) => {
          const v = value(p)
          const h = max > 0 ? Math.max(4, (v / max) * (CHART_HEIGHT - 24)) : 4
          const isLast = i === points.length - 1
          return (
            <View key={p.sessionId} style={{ alignItems: 'center', justifyContent: 'flex-end' }}>
              <Text style={{ fontSize: 11 }}>{isLast ? Math.round(v) : ''}</Text>
              <View
                testID={`bar-${i}`}
                style={{ width: 24, height: h, backgroundColor: theme.colors.accent, borderRadius: 4 }}
              />
            </View>
          )
        })}
      </View>
    </ScrollView>
  )
}
```

(Use the real accent color / `Text` import from the `ui/` kit — inspect `src/ui/` and match its exports. If the kit has no `accent`, pick an existing kit color.)

- [ ] **Step 2: Build `dashboard.tsx`** — the screen composes: a horizontal list of `usePerformedExercises()` as selectable chips (default-select the first); a `weight` / `e1rm` toggle; `<ProgressionChart points={useProgression(selectedId)} metric={metric} />`; and a **Personal records** section listing `usePersonalRecords()` (per exercise: name, best weight `X kg × N`, best est. 1RM `Y kg`). Empty state when `usePerformedExercises()` is empty ("Log some sets to see your progress."). Give the chips, toggle, and PR rows stable `testID`s for the web verification. Use `Screen`/`Heading`/`Text`/`Button` from `ui/`.

- [ ] **Step 3: Add the home nav link** — in `src/app/(app)/index.tsx`, add a "Dashboard" button/link (matching the existing Session/Templates nav) that routes to `/dashboard`.

- [ ] **Step 4: Web verification (Playwright).** Bring the stack up (`docker compose up -d --wait`), serve web, register + log in a fresh user. Seed history by logging real sets across **at least two sessions** for one exercise with an increasing top set (so the chart rises and a PR exists). Then:
  - Home → **Dashboard** navigates to `/dashboard`.
  - The exercise appears as a chip; selecting it renders the chart with one bar per session, ascending. Toggle weight/e1rm — bars rerender. Screenshot.
  - The **Personal records** section lists the exercise with the correct best weight and best est. 1RM (cross-check against the seeded numbers). Screenshot.
  - Log another, heavier set live → the chart gains/raises a bar and the PR best updates **reactively** (no reload). Screenshot.
  - Empty-state: a second fresh user with no sets shows the "Log some sets…" message.
  - Console clean. Clean up both test users + all their rows (sets, session_exercises, sessions, exercises-if-custom) via psql. Stop the server.

- [ ] **Step 5: Tests + bundles.** `pnpm --filter @workouty/mobile test` (200 + dashboard tests green), `tsc --noEmit` clean, `expo export --platform web` and `--platform ios` both succeed (remove `dist/`).

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/dashboard/ProgressionChart.tsx apps/mobile/src/app
git commit -m "feat(mobile): dashboard screen — progression chart + personal records, web-verified"
```

---

### Task C1: "New PR!" badge in the logging screen

**Files:**
- Modify: `apps/mobile/src/app/(app)/session/[id].tsx`

**Interfaces:**
- Consumes: `usePrSetIds(exerciseId)` from `../../../dashboard/pr-set-ids-query` (adjust the relative path to the file's actual depth).

- [ ] **Step 1: Wire the badge.** In the session screen, call `usePrSetIds(currentExerciseId)` (the current exercise's id — the same id already driving `useLastTime`). When rendering the current exercise's logged sets, badge any set whose `id` is in the returned `Set` with a **"New PR! 🏆"** indicator (use the `ui/` kit; give it `testID="pr-badge"`). Because the query is reactive, logging a set that beats a previous best flips its badge on immediately — no extra state.

- [ ] **Step 2: Web verification (Playwright).** Stack up, fresh user. In one exercise, log a set (e.g. 60 kg × 5) — no badge on the first ever set (nothing to beat). Log a heavier set (65 kg × 5) → **"New PR! 🏆"** appears on it immediately (reactive). Log an equal set (65 kg × 5) → no badge (equalling is not a PR). Log a same-weight-higher-reps set (65 kg × 8) → badge appears (estimated-1RM PR). Screenshot each transition. Verify the earlier dashboard PR list reflects the new best. Console clean. Clean up the test user + rows. Stop the server.

- [ ] **Step 3: Tests + bundles.** `pnpm --filter @workouty/mobile test` (all green), `tsc --noEmit` clean, both bundles succeed (remove `dist/`).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/app/(app)/session/[id].tsx
git commit -m "feat(mobile): surface New PR! on a set that beats a previous best, web-verified"
```

---

## Definition of done

- [x] **Per-exercise progression chart:** select an exercise on the dashboard, see top weight and estimated 1RM over time (one point per session, chronological), toggle between the two metrics.
- [x] **Personal records** are derived by query (no PR table), listed on the dashboard per exercise (best weight + best estimated 1RM), and update reactively as new sets sync in.
- [x] **"New PR!"** is surfaced in the logging screen the moment a logged set beats a previous best (weight or estimated 1RM); the first-ever set and an equalling set are not PRs.
- [x] Last-time reference already ships (M4) — unchanged.
- [x] Progression + PR math are pure, isomorphic, unit-tested functions in `@workouty/shared`.
- [x] Milestones 1–5 tests stay green (215); the app bundles web + native; all UI paths web-verified (Playwright), with test data cleaned up.

## Execution learnings (M6 — completed)

- **Metro resolved `@workouty/shared` with the DEFAULT config** — no `metro.config.js` change needed. The one front-loaded integration risk (first mobile consumer of the workspace package) was a non-issue; proven by a temporary reachable import + `expo export --platform web` bundling cleanly, then reverted.
- **`@workouty/shared` needs its `dist/` built** (`pnpm --filter @workouty/shared build`) before mobile vitest/Metro can resolve it — `dist/` is gitignored, so a fresh checkout must build it first. A2's `computePersonalBest` originally used `sets[0]` directly, which passed vitest but broke the `tsup` dts build under `noUncheckedIndexedAccess` once the package was actually consumed; folded a behavior-preserving `const first = sets[0]; if (!first) return null` fix into B1.
- **Per-task gates missed two whole-branch regressions** (both caught by the final review, fixed in a8cba2c): (1) the new **shared test files** tripped `noUncheckedIndexedAccess`, turning repo-wide `pnpm typecheck` red — per-task gates ran vitest for shared but never `@workouty/shared typecheck`; **run `pnpm typecheck` (repo-wide) as part of a task that adds typed test files.** (2) M6 is the first code to call `estimateOneRepMax` (which throws on non-integer reps) **on the render path**, so a decimal reps value — accepted by the old log-set guard and harmless before M6 — now crashes the dashboard/session render on web; tightened the guard with `Number.isInteger`.
- **Chart is dependency-free (plain `View`s)** — avoided a native rebuild and kept web verification clean; swapping in a richer renderer later touches only `ProgressionChart.tsx`.
- **PR list vs. badge intentionally differ:** the dashboard list = current all-time bests (`computePersonalBest`); the log badge = "was a PR when logged" (`markPersonalRecords`), so a past set stays badged after a heavier one supersedes it. Documented, expected semantics — not a contradiction.
- **Deferred (safe, non-blocking):** `computePersonalBest` tie-break is input-order-dependent; `performed-exercises`/`personal-records` queries don't filter `exercises.deleted_at` (inert — no exercise-delete path); `pr-set-ids`/`personal-records` queries don't exclude soft-deleted sessions (inert — no session-delete path, only `ended_at`); one-frame chart flicker before the default-exercise effect; static `pr-badge` testID.

## Self-review (author checklist — run before handing off)

1. **Spec §3.6 coverage:** item 1 (progression chart) → B2; item 2 (PR detection + list) → A2/B1/B2/C1; item 3 (last-time) → shipped in M4, noted. Epley e1RM → `estimateOneRepMax` reused everywhere. "PR = new max weight OR new max e1RM" → `markPersonalRecords`/`computePersonalBest`. "Derived by query, no table" → no schema change; hooks compute over pulled rows. ✅
2. **Placeholder scan:** every code step has real code; the one deliberate "inspect the `ui/` kit and match its exports" note in B2 Step 1 is a real instruction, not a stub. ✅
3. **Type consistency:** `ProgressionPoint` (`topWeightKg`, `bestEstimatedOneRepMax`, `date`, `sessionId`) is produced in A1 and consumed unchanged in B1/B2. `RecordSet`/`RecordFlags`/`PersonalBest` produced in A2, consumed in B1. `usePrSetIds` produced in B1, consumed in C1. Hook return shapes match their consumers. ✅

## Open questions / notes

- **First mobile consumer of `@workouty/shared`.** If Metro can't resolve the symlinked workspace `dist` (B1 Step 2), fix `metro.config.js` (watchFolders + nodeModulesPaths) — do not copy the math into mobile. This is the milestone's one real integration risk; it's front-loaded into B1 deliberately.
- **Chart is dependency-free by choice.** A future richer chart (`react-native-svg` + line/area) is deferred to avoid a native rebuild and keep web verification clean; the pure `computeProgression` series is chart-library-agnostic, so swapping the renderer later touches only `ProgressionChart.tsx`.
- **PR semantics:** strictly-greater, first-set-excluded, ties-excluded — matches the spec's "beats a previous best". If the user later wants the first-ever set flagged as a baseline PR, flip the `null` guards in `markPersonalRecords`.

## Handoff (post-milestone)

- On-device Android + the killed-app background-alarm fire remain deferred from M3/M4.
- With M6 done, all six milestones of the design spec are implemented; remaining work is the deferred on-device pass and any polish the user calls out.
