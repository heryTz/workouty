// Milestone 3 Task C2 — the milestone gate: proves the PowerSync client round-trip against
// the RUNNING stack (api :6100, powersync :6101, postgres :6103), driven through our own
// WorkoutyConnector — not stubbed.
//
//   UP:   a local SQLite write on a @powersync/node client reaches Postgres
//         (local insert -> PowerSync CRUD queue -> connector.uploadData -> POST /sync/upload
//         -> Postgres row, owned by the authenticated user).
//   DOWN: a Postgres change reaches the client's local SQLite
//         (direct pg INSERT -> replication -> sync rules bucket -> PowerSync client sync ->
//         local row).
//   REJECTION: a colliding write (same (user_id, name) as an existing custom exercise) is
//         rejected by the server's per-op savepoint (Task C1) without aborting the batch or
//         looping — onRejected fires exactly once. (The row IS visible optimistically before
//         the round-trip resolves, but — verified by direct instrumentation, see the test
//         itself — disappears from the local view the moment the CRUD queue drains, since a
//         rejected write has no synced-bucket backing to fall back to. That's correct
//         PowerSync behavior, not a connector bug; see the in-test comment for detail.)
//
// Needs the Compose stack up. Run via `pnpm --filter @workouty/mobile test:sync`, NOT the
// plain `test` script (see vitest.config.ts's exclude / vitest.sync.config.ts's include) —
// the pure unit tests must stay runnable without Docker.
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { PowerSyncDatabase } from '@powersync/node'
import { Client as PgClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createConnector, type WorkoutyConnector } from './connector'
import { AppSchema } from './schema'
import { InMemoryTokenStore } from './token-store'

const API_URL = 'http://localhost:6100'
const POWERSYNC_URL = 'http://localhost:6101'
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL is required. Is the Compose stack up (see .env)?')

const runId = randomUUID()
const email = `roundtrip-${runId}@example.com`
const password = 'correct horse battery staple'
const dbFilename = path.join(os.tmpdir(), `workouty-roundtrip-${runId}.db`)

// Decodes a JWT's payload (no verification — same rationale as jwt.ts: we trust the token
// our own /auth/register just handed us) to pull out the `sub` claim (the user's uuid).
function decodeSub(token: string): string {
  const payloadB64 = token.split('.')[1]
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as { sub: string }
  return payload.sub
}

async function waitFor<T>(
  fn: () => Promise<T | undefined | null>,
  { timeoutMs, intervalMs = 400, label }: { timeoutMs: number; intervalMs?: number; label: string },
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const result = await fn()
    if (result) return result
    if (Date.now() > deadline) throw new Error(`waitFor timed out after ${timeoutMs}ms: ${label}`)
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

let sub: string
let pg: PgClient
let db: InstanceType<typeof PowerSyncDatabase>
let connector: WorkoutyConnector
const rejectedCalls: unknown[][] = []

describe('PowerSync round-trip against the live stack (Task C2)', () => {
  beforeAll(async () => {
    // 1. Register a user and seed the token store.
    const registerRes = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!registerRes.ok) {
      throw new Error(`register failed: ${registerRes.status} ${await registerRes.text()}`)
    }
    const tokens = (await registerRes.json()) as { accessToken: string; refreshToken: string }
    sub = decodeSub(tokens.accessToken)

    const tokenStore = new InMemoryTokenStore()
    await tokenStore.setTokens(tokens)

    // 2. A direct pg connection for asserting on / seeding Postgres state.
    pg = new PgClient({ connectionString: DATABASE_URL })
    await pg.connect()

    // 3. Instantiate the node PowerSync client + our connector, and connect.
    connector = createConnector({
      apiUrl: API_URL,
      powersyncUrl: POWERSYNC_URL,
      tokenStore,
      onRejected: (rejected) => rejectedCalls.push(rejected),
    })

    db = new PowerSyncDatabase({ schema: AppSchema, database: { dbFilename } })
    await db.connect(connector)
    await db.waitForFirstSync({ signal: AbortSignal.timeout(30_000) })

    if (!db.currentStatus.hasSynced) {
      throw new Error(
        `first sync did not complete within budget. currentStatus=${JSON.stringify(db.currentStatus)}`,
      )
    }
  })

  afterAll(async () => {
    await db?.disconnect()
    await db?.close()
    await fs.rm(dbFilename, { force: true })
    await fs.rm(`${dbFilename}-wal`, { force: true })
    await fs.rm(`${dbFilename}-shm`, { force: true })

    if (pg) {
      await pg.query('DELETE FROM exercises WHERE user_id = $1', [sub])
      await pg.query('DELETE FROM refresh_tokens WHERE user_id = $1', [sub])
      await pg.query('DELETE FROM users WHERE id = $1', [sub])
      await pg.end()
    }
  })

  it('UP: a local write reaches Postgres, owned by the authenticated user', async () => {
    const id = randomUUID()
    const name = `RT Bench ${runId}`
    const nowISO = new Date().toISOString()

    await db.execute(
      'INSERT INTO exercises (id, user_id, name, muscle_group, is_custom, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
      [id, sub, name, 'chest', nowISO, nowISO],
    )

    const row = await waitFor(
      async () => {
        const res = await pg.query('SELECT * FROM exercises WHERE id = $1', [id])
        return res.rows[0]
      },
      { timeoutMs: 20_000, label: 'local write landing in Postgres' },
    )

    expect(row.user_id).toBe(sub)
    expect(row.name).toBe(name)
    expect(row.muscle_group).toBe('chest')
    expect(row.is_custom).toBe(true)
  })

  it('DOWN: a Postgres-side change reaches the client local DB', async () => {
    const id = randomUUID()
    const name = `RT Squat ${runId}`
    await pg.query(
      'INSERT INTO exercises (id, user_id, name, muscle_group, is_custom, created_at, updated_at) VALUES ($1, $2, $3, $4, true, now(), now())',
      [id, sub, name, 'legs'],
    )

    const rows = await waitFor(
      async () => {
        const found = await db.getAll<{ id: string; name: string; user_id: string }>(
          'SELECT * FROM exercises WHERE id = ?',
          [id],
        )
        return found.length > 0 ? found : undefined
      },
      { timeoutMs: 20_000, label: 'Postgres write syncing down to the client' },
    )

    expect(rows[0].name).toBe(name)
    expect(rows[0].user_id).toBe(sub)
  })

  it('REJECTION: a colliding write is visible optimistically, then rejected with no retry-loop', async () => {
    // Collide on (user_id, name) with the exercise the UP test already landed in Postgres.
    const collidingName = `RT Bench ${runId}`
    const collidingId = randomUUID()
    const nowISO = new Date().toISOString()

    await db.execute(
      'INSERT INTO exercises (id, user_id, name, muscle_group, is_custom, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
      [collidingId, sub, collidingName, 'chest', nowISO, nowISO],
    )

    // Before the upload/rejection round-trip completes, PowerSync shows the write optimistically
    // (the local view = synced bucket data UNION the pending CRUD queue) — confirmed by direct
    // instrumentation of getCrudBatch()/getAll() immediately after this insert, across several
    // runs: the row and its queue entry are both present right away.
    const optimisticRows = await db.getAll<{ id: string }>('SELECT * FROM exercises WHERE id = ?', [
      collidingId,
    ])
    expect(optimisticRows).toHaveLength(1)

    await waitFor(async () => (rejectedCalls.length > 0 ? rejectedCalls : undefined), {
      timeoutMs: 20_000,
      label: 'onRejected firing for the colliding op',
    })

    const rejectedOps = rejectedCalls.flat() as { id: string; table: string }[]
    expect(rejectedOps.some((op) => op.id === collidingId && op.table === 'exercises')).toBe(true)

    // IMPORTANT, and contrary to what an initial reading of the connector's contract might
    // suggest: once the CRUD queue entry is drained (uploadData's `batch.complete()`), the
    // optimistic local row disappears too — in the SAME tick as onRejected fires and
    // getCrudBatch() goes back to null. Instrumented this directly (polling getAll/getCrudBatch
    // every 200ms around the rejection): both flip together, not "row stays, only the queue
    // clears" as one might expect. That's correct PowerSync behavior, not a bug in our
    // connector/crud-mapping: the local materialized view for a row is "committed bucket data"
    // UNION "pending (not yet resolved) CRUD queue entries" — a REJECTED write was never
    // persisted server-side, so it has no bucket backing, and once its queue entry is gone
    // there is nothing left to union in. (An ACCEPTED write doesn't hit this: it gets a bucket
    // entry from the very next sync download, so the row never actually disappears from the
    // user's point of view.) Net effect: the app-level takeaway is that a rejected write's
    // optimistic UI state needs to be handled by the caller of onRejected (e.g. re-surface the
    // local edit, don't just silently trust the SQLite view) — worth flagging for whoever builds
    // the UI on top of this (Task D2). Assert on the actual, verified behavior here.
    await waitFor(
      async () => {
        const rows = await db.getAll<{ id: string }>('SELECT * FROM exercises WHERE id = ?', [collidingId])
        return rows.length === 0 ? true : undefined
      },
      { timeoutMs: 5_000, label: 'the rejected row leaving the local optimistic view' },
    )

    // No retry-loop: wait a further ~5s and confirm onRejected didn't fire again. The
    // rejection is permanent — PowerSync must not keep re-uploading the same op.
    const callsAfterRejection = rejectedCalls.length
    await new Promise((r) => setTimeout(r, 5_000))
    expect(rejectedCalls.length).toBe(callsAfterRejection)

    // And the colliding row was never actually applied server-side under a different id.
    const serverRow = await pg.query('SELECT * FROM exercises WHERE id = $1', [collidingId])
    expect(serverRow.rows).toHaveLength(0)
  })
})
