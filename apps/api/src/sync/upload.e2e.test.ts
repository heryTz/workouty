import { randomUUID } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required. Is the Compose stack up?')

let app: INestApplication
const pool = new Pool({ connectionString: databaseUrl })

const emailA = `test-upload-e2e-a-${randomUUID()}@example.com`
const emailB = `test-upload-e2e-b-${randomUUID()}@example.com`
const password = 'correct horse battery staple'

let tokenA: string
let tokenB: string
let userAId: string
let userBId: string

const createdExerciseIds: string[] = []

function sharedExerciseId(): string {
  const id = createdExerciseIds[0]
  if (!id) throw new Error('the "applies a PUT" test must run first to seed this id')
  return id
}

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication()
  await app.init()

  const resA = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email: emailA, password })
    .expect(201)
  tokenA = resA.body.accessToken

  const resB = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email: emailB, password })
    .expect(201)
  tokenB = resB.body.accessToken

  const dbA = await pool.query('SELECT id FROM users WHERE email = $1', [emailA])
  const dbB = await pool.query('SELECT id FROM users WHERE email = $1', [emailB])
  userAId = dbA.rows[0]?.id
  userBId = dbB.rows[0]?.id
  if (!userAId || !userBId) throw new Error('failed to look up test users')
})

afterAll(async () => {
  if (createdExerciseIds.length > 0) {
    await pool.query('DELETE FROM exercises WHERE id = ANY($1::uuid[])', [createdExerciseIds])
  }
  await pool.query(
    'DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])',
    [[userAId, userBId].filter(Boolean)],
  )
  await pool.query('DELETE FROM users WHERE email = ANY($1::text[])', [[emailA, emailB]])
  await pool.end()
  await app.close()
})

async function getExercise(id: string) {
  const res = await pool.query('SELECT * FROM exercises WHERE id = $1', [id])
  return res.rows[0]
}

describe('POST /sync/upload', () => {
  it('rejects a request with no Authorization header with 401', async () => {
    await request(app.getHttpServer())
      .post('/sync/upload')
      .send({ batch: [] })
      .expect(401)
  })

  it('rejects a request with a garbage token with 401', async () => {
    await request(app.getHttpServer())
      .post('/sync/upload')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ batch: [] })
      .expect(401)
  })

  it('applies a PUT for userA and lands the row under the JWT user, ignoring a lying body userId', async () => {
    const id = randomUUID()
    createdExerciseIds.push(id)
    const before = Date.now()

    const res = await request(app.getHttpServer())
      .post('/sync/upload')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        batch: [
          {
            op: 'PUT',
            table: 'exercises',
            id,
            data: { name: `Bench ${id}`, muscleGroup: 'chest', userId: userBId /* lie */ },
          },
        ],
      })
      .expect(200)

    expect(res.body).toEqual({ rejected: [] })

    const row = await getExercise(id)
    expect(row).toBeDefined()
    expect(row.user_id).toBe(userAId)
    expect(row.user_id).not.toBe(userBId)
    expect(row.name).toBe(`Bench ${id}`)

    // updated_at is server-stamped, ~now — not a client-controlled value.
    const updatedAt = new Date(row.updated_at).getTime()
    expect(updatedAt).toBeGreaterThanOrEqual(before - 5000)
    expect(updatedAt).toBeLessThanOrEqual(Date.now() + 5000)
  })

  it('rejects userB PATCHing userA row over HTTP; DB row stays unchanged', async () => {
    const id = sharedExerciseId()
    const before = await getExercise(id)

    const res = await request(app.getHttpServer())
      .post('/sync/upload')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        batch: [{ op: 'PATCH', table: 'exercises', id, data: { name: 'hacked-by-b' } }],
      })
      .expect(200)

    expect(res.body.rejected).toHaveLength(1)
    expect(res.body.rejected[0]).toMatchObject({ op: 'PATCH', table: 'exercises', id })

    const after = await getExercise(id)
    expect(after.name).toBe(before.name)
    expect(after.user_id).toBe(userAId)
    expect(after.updated_at).toEqual(before.updated_at)
  })

  it('rejects userB DELETEing userA row over HTTP; deleted_at stays null', async () => {
    const id = sharedExerciseId()

    const res = await request(app.getHttpServer())
      .post('/sync/upload')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        batch: [{ op: 'DELETE', table: 'exercises', id }],
      })
      .expect(200)

    expect(res.body.rejected).toHaveLength(1)
    expect(res.body.rejected[0]).toMatchObject({ op: 'DELETE', table: 'exercises', id })

    const row = await getExercise(id)
    expect(row.deleted_at).toBeNull()
    expect(row.user_id).toBe(userAId)
  })

  it('userA soft-deletes her own row: row still exists, deleted_at is set', async () => {
    const id = sharedExerciseId()

    const res = await request(app.getHttpServer())
      .post('/sync/upload')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        batch: [{ op: 'DELETE', table: 'exercises', id }],
      })
      .expect(200)

    expect(res.body).toEqual({ rejected: [] })

    const row = await getExercise(id)
    expect(row).toBeDefined()
    expect(row.deleted_at).not.toBeNull()
    expect(row.user_id).toBe(userAId)
  })
})
