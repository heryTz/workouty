import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as schema from '../db/schema'
import type { CrudOp } from './upload-contracts'
import { UploadService } from './upload.service'

// This suite writes to the database. Fail fast rather than mutate something real.
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required. Is the Compose stack up?')

const { hostname } = new URL(databaseUrl)
if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
  throw new Error(`Refusing to run write tests against a non-local database: ${hostname}`)
}

const pool = new Pool({ connectionString: databaseUrl })
const db = drizzle(pool, { schema })
const service = new UploadService(db)

let userAId: string
let userBId: string
const createdExerciseIds: string[] = []

beforeAll(async () => {
  const [a] = await db
    .insert(schema.users)
    .values({ email: `upload-service-a-${randomUUID()}@example.com`, passwordHash: 'not-a-real-hash' })
    .returning({ id: schema.users.id })
  const [b] = await db
    .insert(schema.users)
    .values({ email: `upload-service-b-${randomUUID()}@example.com`, passwordHash: 'not-a-real-hash' })
    .returning({ id: schema.users.id })
  if (!a || !b) throw new Error('failed to create test users')
  userAId = a.id
  userBId = b.id
})

afterEach(async () => {
  // Delete-by-id cleanup: no leaked rows even if the test above threw or rejected an op.
  while (createdExerciseIds.length > 0) {
    const id = createdExerciseIds.pop()
    await pool.query('DELETE FROM exercises WHERE id = $1', [id])
  }
})

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userAId, userBId]])
  await pool.end()
})

// Each row gets a unique id AND a unique name: exercises has a partial unique index on
// (user_id, name), and reusing a name across tests for the same owning user would collide.
function newExercise(): { id: string; name: string } {
  const id = randomUUID()
  createdExerciseIds.push(id)
  return { id, name: `Bench ${id}` }
}

async function getExercise(id: string) {
  const [row] = await db.select().from(schema.exercises).where(eq(schema.exercises.id, id))
  return row
}

function putExercise(id: string, name: string, extra: Record<string, unknown> = {}): CrudOp {
  return { op: 'PUT', table: 'exercises', id, data: { name, muscleGroup: 'chest', ...extra } }
}

describe('UploadService.apply', () => {
  it('PUT lands under the JWT user even if the body lies about userId', async () => {
    const { id, name } = newExercise()
    const { rejected } = await service.apply(userAId, [
      putExercise(id, name, { userId: userBId /* lie */ }),
    ])

    expect(rejected).toHaveLength(0)
    const row = await getExercise(id)
    expect(row?.userId).toBe(userAId)
    expect(row?.userId).not.toBe(userBId)
  })

  it('updated_at is server-stamped, not the client-supplied value', async () => {
    const { id, name } = newExercise()
    const farFuture = new Date('2999-01-01T00:00:00Z')
    const before = Date.now()

    const { rejected } = await service.apply(userAId, [
      putExercise(id, name, { updatedAt: farFuture /* lie */ }),
    ])

    expect(rejected).toHaveLength(0)
    const row = await getExercise(id)
    expect(row?.updatedAt.getTime()).not.toBe(farFuture.getTime())
    expect(row!.updatedAt.getTime()).toBeGreaterThanOrEqual(before - 1000)
    expect(row!.updatedAt.getTime()).toBeLessThan(farFuture.getTime())
  })

  it('PATCH on your own row applies the change and advances updated_at', async () => {
    const { id, name } = newExercise()
    await service.apply(userAId, [putExercise(id, name)])
    const original = await getExercise(id)

    await new Promise((r) => setTimeout(r, 5))
    const { rejected } = await service.apply(userAId, [
      { op: 'PATCH', table: 'exercises', id, data: { name: `${name} Incline` } },
    ])

    expect(rejected).toHaveLength(0)
    const row = await getExercise(id)
    expect(row?.name).toBe(`${name} Incline`)
    expect(row!.updatedAt.getTime()).toBeGreaterThan(original!.updatedAt.getTime())
  })

  it('PATCH on another user row is rejected and the row is left unchanged', async () => {
    const { id, name } = newExercise()
    await service.apply(userAId, [putExercise(id, name)])

    const { rejected } = await service.apply(userBId, [
      { op: 'PATCH', table: 'exercises', id, data: { name: 'hacked' } },
    ])

    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({ op: 'PATCH', table: 'exercises', id })

    const row = await getExercise(id)
    expect(row?.name).toBe(name)
    expect(row?.userId).toBe(userAId)
  })

  it('DELETE on your own row soft-deletes: the row still exists, deleted_at is set', async () => {
    const { id, name } = newExercise()
    await service.apply(userAId, [putExercise(id, name)])
    const original = await getExercise(id)

    await new Promise((r) => setTimeout(r, 5))
    const { rejected } = await service.apply(userAId, [{ op: 'DELETE', table: 'exercises', id }])

    expect(rejected).toHaveLength(0)
    const row = await getExercise(id)
    expect(row).toBeDefined()
    expect(row?.deletedAt).not.toBeNull()
    expect(row!.updatedAt.getTime()).toBeGreaterThan(original!.updatedAt.getTime())
  })

  it('DELETE on another user row is rejected and deleted_at stays null', async () => {
    const { id, name } = newExercise()
    await service.apply(userAId, [putExercise(id, name)])

    const { rejected } = await service.apply(userBId, [{ op: 'DELETE', table: 'exercises', id }])

    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({ op: 'DELETE', table: 'exercises', id })

    const row = await getExercise(id)
    expect(row?.deletedAt).toBeNull()
    expect(row?.userId).toBe(userAId)
  })

  it('PUT that would overwrite another user existing row is rejected, row unchanged', async () => {
    const { id, name } = newExercise()
    await service.apply(userAId, [putExercise(id, name)])

    const { rejected } = await service.apply(userBId, [
      putExercise(id, 'takeover-name-should-not-land'),
    ])

    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({ op: 'PUT', table: 'exercises', id })

    const row = await getExercise(id)
    expect(row?.name).toBe(name)
    expect(row?.userId).toBe(userAId)
  })

  it('PATCH cannot repoint a row id via the id field the partial schema still allows', async () => {
    const { id, name } = newExercise()
    await service.apply(userAId, [putExercise(id, name)])
    const other = randomUUID() // never inserted; must not become a live exercises.id

    const { rejected } = await service.apply(userAId, [
      { op: 'PATCH', table: 'exercises', id, data: { id: other, name: `${name} moved` } },
    ])

    expect(rejected).toHaveLength(0)
    const row = await getExercise(id)
    expect(row?.id).toBe(id)
    expect(row?.name).toBe(`${name} moved`)
    const moved = await getExercise(other)
    expect(moved).toBeUndefined()
  })

  it('rejects an op against an unknown table without throwing', async () => {
    const id = randomUUID()
    const { rejected } = await service.apply(userAId, [
      { op: 'PUT', table: 'not_a_real_table', id, data: { whatever: 1 } },
    ])

    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({ table: 'not_a_real_table', id, op: 'PUT' })
  })

  it('rejects invalid data (reps: 0) without throwing', async () => {
    const id = randomUUID()
    const { rejected } = await service.apply(userAId, [
      {
        op: 'PUT',
        table: 'sets',
        id,
        data: {
          sessionExerciseId: randomUUID(),
          setIndex: 0,
          reps: 0, // invalid: must be a positive int
          weightKg: 60,
          performedAt: new Date().toISOString(),
        },
      },
    ])

    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({ op: 'PUT', table: 'sets', id })
  })

  it('applies the good ops in a mixed batch and returns only the bad ones as rejected', async () => {
    const good1 = newExercise()
    const good2 = newExercise()
    const badTableId = randomUUID()
    const badDataId = randomUUID()

    const { rejected } = await service.apply(userAId, [
      putExercise(good1.id, good1.name),
      { op: 'PUT', table: 'nope', id: badTableId, data: {} },
      putExercise(good2.id, good2.name),
      { op: 'PUT', table: 'exercises', id: badDataId, data: { name: '' /* min(1) */, muscleGroup: 'x' } },
    ])

    expect(rejected).toHaveLength(2)
    expect(rejected.map((r) => r.id).sort()).toEqual([badDataId, badTableId].sort())

    expect((await getExercise(good1.id))?.name).toBe(good1.name)
    expect((await getExercise(good2.id))?.name).toBe(good2.name)
    expect(await getExercise(badDataId)).toBeUndefined()
  })
})

describe('UploadService.apply — per-op savepoint (unique collision rejected, not a batch abort)', () => {
  it('a same-name-different-id PUT collides on (user_id, name) and is rejected as a conflict; the rest of the batch still commits; the original row is untouched', async () => {
    const sharedName = `Bench savepoint ${randomUUID()}`
    const idX = randomUUID()
    createdExerciseIds.push(idX)
    const { rejected: seedRejected } = await service.apply(userAId, [putExercise(idX, sharedName)])
    expect(seedRejected).toHaveLength(0)
    const original = await getExercise(idX)

    const idY = randomUUID() // never lands: collides with idX on (user_id, name)
    createdExerciseIds.push(idY)
    const squat = newExercise()

    const { rejected } = await service.apply(userAId, [
      putExercise(idY, sharedName), // same owner + same name as idX, different id
      putExercise(squat.id, squat.name),
    ])

    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({ op: 'PUT', table: 'exercises', id: idY, reason: 'conflict' })

    // The colliding op never landed.
    expect(await getExercise(idY)).toBeUndefined()
    // The original row (idX) is completely unchanged by the failed collision.
    const afterX = await getExercise(idX)
    expect(afterX?.name).toBe(sharedName)
    expect(afterX?.updatedAt.getTime()).toBe(original!.updatedAt.getTime())
    // The other op in the same batch still committed — the savepoint only rolled back
    // the failing op, not the whole transaction.
    const rowSquat = await getExercise(squat.id)
    expect(rowSquat?.name).toBe(squat.name)
  })

  it('a non-unique-violation DB error (FK violation, 23503) still throws — the narrow catch does not swallow it as a rejection', async () => {
    const id = randomUUID()

    await expect(
      service.apply(userAId, [
        {
          op: 'PUT',
          table: 'session_exercises',
          id,
          data: {
            sessionId: randomUUID(), // references a session row that does not exist
            exerciseId: randomUUID(), // references an exercise row that does not exist
            position: 0,
          },
        },
      ]),
    ).rejects.toThrow()

    // Confirm nothing was left behind by the aborted insert.
    const rows = await db.select().from(schema.sessionExercises).where(eq(schema.sessionExercises.id, id))
    expect(rows).toHaveLength(0)
  })
})
