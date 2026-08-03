import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { jwtVerify } from 'jose'
import { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { getPublicKey } from '../crypto/keys'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required. Is the Compose stack up?')

let app: INestApplication
const pool = new Pool({ connectionString: databaseUrl })
const email = `test-auth-e2e-${crypto.randomUUID()}@example.com`
const password = 'correct horse battery staple'

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await pool.query(
    'DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email = $1)',
    [email],
  )
  await pool.query('DELETE FROM users WHERE email = $1', [email])
  await pool.end()
  await app.close()
})

function expectTokenPair(body: unknown): asserts body is { accessToken: string; refreshToken: string } {
  expect(body).toHaveProperty('accessToken')
  expect(body).toHaveProperty('refreshToken')
  expect(Object.keys(body as object).sort()).toEqual(['accessToken', 'refreshToken'])
  expect(typeof (body as { accessToken: unknown }).accessToken).toBe('string')
  expect((body as { accessToken: string }).accessToken.length).toBeGreaterThan(0)
  expect(typeof (body as { refreshToken: unknown }).refreshToken).toBe('string')
  expect((body as { refreshToken: string }).refreshToken.length).toBeGreaterThan(0)
}

describe('auth', () => {
  it('registers a new user and returns a verifiable access token bound to the DB row', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201)

    expectTokenPair(res.body)

    const dbResult = await pool.query('SELECT id FROM users WHERE email = $1', [email])
    const dbUserId = dbResult.rows[0]?.id
    expect(dbUserId).toBeDefined()

    const { payload } = await jwtVerify(res.body.accessToken, await getPublicKey(), {
      audience: 'workouty',
    })
    expect(payload.sub).toBe(dbUserId)
    expect(payload.aud).toContain('workouty')
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(900)
  })

  it('rejects registering the same email twice with 409', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(409)
  })

  it('logs in with correct credentials and returns a verifiable token for the same user', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200)

    expectTokenPair(res.body)

    const dbResult = await pool.query('SELECT id FROM users WHERE email = $1', [email])
    const dbUserId = dbResult.rows[0]?.id

    const { payload } = await jwtVerify(res.body.accessToken, await getPublicKey(), {
      audience: 'workouty',
    })
    expect(payload.sub).toBe(dbUserId)
  })

  it('rejects login with the wrong password with 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'totally wrong password' })
      .expect(401)
  })

  it('rejects login for an unknown email with 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: `nobody-${crypto.randomUUID()}@example.com`, password })
      .expect(401)
  })
})

describe('POST /auth/refresh', () => {
  it('rotates a refresh token, and the old one can no longer be used (single-use)', async () => {
    const refreshEmail = `test-auth-refresh-e2e-${crypto.randomUUID()}@example.com`

    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: refreshEmail, password })
      .expect(201)
    expectTokenPair(registerRes.body)
    const firstPair = registerRes.body as { accessToken: string; refreshToken: string }

    try {
      const secondRes = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: firstPair.refreshToken })
        .expect(200)
      expectTokenPair(secondRes.body)
      const secondPair = secondRes.body as { accessToken: string; refreshToken: string }
      expect(secondPair.refreshToken).not.toBe(firstPair.refreshToken)

      // The old (now-revoked) refresh token must be rejected.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: firstPair.refreshToken })
        .expect(401)

      // The new refresh token still works, exactly once.
      const thirdRes = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: secondPair.refreshToken })
        .expect(200)
      expectTokenPair(thirdRes.body)
      expect(thirdRes.body.refreshToken).not.toBe(secondPair.refreshToken)
    } finally {
      await pool.query(
        'DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email = $1)',
        [refreshEmail],
      )
      await pool.query('DELETE FROM users WHERE email = $1', [refreshEmail])
    }
  })

  it('rejects a malformed refresh token with 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: 'not-a-real-token' })
      .expect(401)
  })
})
