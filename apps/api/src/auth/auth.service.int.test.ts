import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import * as schema from '../db/schema'
import type { Mailer } from '../mail/mail.module'
import { AccessTokenService } from './jwt.service'
import { AuthService } from './auth.service'

// This suite doesn't exercise mail-sending (see auth.reset.test.ts for that); AuthService
// just needs something implementing Mailer to construct.
const noopMailer: Mailer = { send: async () => {} }

// This suite writes to the database. Fail fast rather than mutate something real.
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required. Is the Compose stack up?')

const { hostname } = new URL(databaseUrl)
if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
  throw new Error(`Refusing to run write tests against a non-local database: ${hostname}`)
}

const pool = new Pool({ connectionString: databaseUrl })
const db = drizzle(pool, { schema })
const service = new AuthService(db, new AccessTokenService(), noopMailer)

const createdEmails: string[] = []
function uniqueEmail(): string {
  const email = `test-auth-service-${crypto.randomUUID()}@example.com`
  createdEmails.push(email)
  return email
}

afterEach(async () => {
  // Delete-by-unique-email cleanup: no leaked rows even if the test above threw.
  // refresh_tokens has no ON DELETE CASCADE, so drop those first to satisfy the FK.
  while (createdEmails.length > 0) {
    const email = createdEmails.pop()!
    await pool.query(
      'DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email = $1)',
      [email],
    )
    await pool.query('DELETE FROM users WHERE email = $1', [email])
  }
})

afterAll(async () => {
  await pool.end()
})

describe('AuthService', () => {
  it('register creates a retrievable user', async () => {
    const email = uniqueEmail()
    const created = await service.register(email, 'correct horse battery staple')

    expect(created.id).toBeDefined()
    expect(created.email).toBe(email)

    const found = await service.validate(email, 'correct horse battery staple')
    expect(found?.id).toBe(created.id)
  })

  it('registering the same email twice throws ConflictException', async () => {
    const email = uniqueEmail()
    await service.register(email, 'correct horse battery staple')

    await expect(service.register(email, 'another password')).rejects.toThrow(
      /already registered/i,
    )
  })

  it('validate returns the user for correct credentials', async () => {
    const email = uniqueEmail()
    const created = await service.register(email, 'correct horse battery staple')

    const result = await service.validate(email, 'correct horse battery staple')
    expect(result).toEqual({ id: created.id, email })
  })

  it('validate returns null for a wrong password', async () => {
    const email = uniqueEmail()
    await service.register(email, 'correct horse battery staple')

    const result = await service.validate(email, 'wrong password')
    expect(result).toBeNull()
  })

  it('validate returns null (and does not throw) for an unknown email', async () => {
    await expect(
      service.validate('nobody-such-user@example.com', 'whatever'),
    ).resolves.toBeNull()
  })
})

describe('AuthService refresh tokens', () => {
  it('issueTokens returns a `<uuid>.<secret>` refresh token and stores only an argon2 hash', async () => {
    const email = uniqueEmail()
    const user = await service.register(email, 'correct horse battery staple')

    const pair = await service.issueTokens(user.id)
    expect(pair.accessToken).toEqual(expect.any(String))
    expect(pair.accessToken.length).toBeGreaterThan(0)

    const [rowId, secret] = pair.refreshToken.split('.')
    expect(rowId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(secret).toBeTruthy()

    const dbResult = await pool.query('SELECT token_hash, user_id FROM refresh_tokens WHERE id = $1', [
      rowId,
    ])
    expect(dbResult.rows).toHaveLength(1)
    const storedHash = dbResult.rows[0].token_hash as string
    expect(dbResult.rows[0].user_id).toBe(user.id)
    // The raw secret must never be stored — only its argon2id hash.
    expect(storedHash).not.toBe(secret)
    expect(storedHash.startsWith('$argon2id$')).toBe(true)
  })

  it('rotateRefresh returns a new pair, revokes the old row, and rejects reuse of the old token', async () => {
    const email = uniqueEmail()
    const user = await service.register(email, 'correct horse battery staple')
    const first = await service.issueTokens(user.id)

    const second = await service.rotateRefresh(first.refreshToken)
    expect(second.refreshToken).not.toBe(first.refreshToken)
    expect(second.accessToken).toEqual(expect.any(String))

    const [oldRowId] = first.refreshToken.split('.')
    const dbResult = await pool.query('SELECT revoked_at FROM refresh_tokens WHERE id = $1', [oldRowId])
    expect(dbResult.rows[0].revoked_at).not.toBeNull()

    // Reusing the now-revoked old token must fail.
    await expect(service.rotateRefresh(first.refreshToken)).rejects.toThrow()

    // The new token still works exactly once.
    const third = await service.rotateRefresh(second.refreshToken)
    expect(third.refreshToken).not.toBe(second.refreshToken)
  })

  it('rejects an expired refresh token', async () => {
    const email = uniqueEmail()
    const user = await service.register(email, 'correct horse battery staple')

    const [row] = await db
      .insert(schema.refreshTokens)
      .values({
        userId: user.id,
        tokenHash: '$argon2id$v=19$m=65536,t=3,p=4$notarealhash$notarealhash',
        expiresAt: new Date(Date.now() - 1000),
      })
      .returning({ id: schema.refreshTokens.id })

    await expect(service.rotateRefresh(`${row!.id}.whatever-secret`)).rejects.toThrow()
  })

  it('rejects malformed tokens without throwing a 500', async () => {
    const email = uniqueEmail()
    const user = await service.register(email, 'correct horse battery staple')
    const issued = await service.issueTokens(user.id)
    const [rowId] = issued.refreshToken.split('.')

    for (const bad of ['garbage', 'no-dot-here', `${rowId}.wrongsecret`, '.', 'a.', '.b']) {
      await expect(service.rotateRefresh(bad)).rejects.toThrow()
    }
  })

  it('rejects a well-formed but nonexistent row id', async () => {
    await expect(
      service.rotateRefresh('00000000-0000-4000-8000-000000000000.somesecret'),
    ).rejects.toThrow()
  })

  it('rejects a concurrent double-rotation — exactly one of two racing rotations wins', async () => {
    const email = uniqueEmail()
    const user = await service.register(email, 'correct horse battery staple')
    const { refreshToken } = await service.issueTokens(user.id)

    const results = await Promise.allSettled([
      service.rotateRefresh(refreshToken),
      service.rotateRefresh(refreshToken),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    // Only one new row was actually issued from the race — not two.
    const dbResult = await pool.query(
      'SELECT count(*) FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL',
      [user.id],
    )
    expect(Number(dbResult.rows[0].count)).toBe(1)
  })
})
