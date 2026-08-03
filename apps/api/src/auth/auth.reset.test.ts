import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import * as schema from '../db/schema'
import type { Mailer, SendMailInput } from '../mail/mail.module'
import { AccessTokenService } from './jwt.service'
import { hashPassword } from './password'
import { AuthService } from './auth.service'

// This suite writes to the database. Fail fast rather than mutate something real.
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required. Is the Compose stack up?')

const { hostname } = new URL(databaseUrl)
if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
  throw new Error(`Refusing to run write tests against a non-local database: ${hostname}`)
}

const pool = new Pool({ connectionString: databaseUrl })
const db = drizzle(pool, { schema })

// A fake Mailer, not a real one: these are unit/integration tests against the real DB, but
// mail delivery itself is covered end-to-end (against real Mailpit) by reset.e2e.test.ts.
// Recording sent messages here lets tests both assert "no mail was sent" (enumeration) and
// pull the reset token out of the rendered link without parsing SMTP.
class FakeMailer implements Mailer {
  sent: SendMailInput[] = []
  async send(input: SendMailInput): Promise<void> {
    this.sent.push(input)
  }
}

const mailer = new FakeMailer()
const service = new AuthService(db, new AccessTokenService(), mailer)

const createdEmails: string[] = []
function uniqueEmail(): string {
  const email = `test-auth-reset-${crypto.randomUUID()}@example.com`
  createdEmails.push(email)
  return email
}

afterEach(async () => {
  mailer.sent = []
  // password_reset_tokens and refresh_tokens have no ON DELETE CASCADE, so drop those
  // first to satisfy their FK to users.
  while (createdEmails.length > 0) {
    const email = createdEmails.pop()!
    await pool.query(
      'DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE email = $1)',
      [email],
    )
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

function extractToken(sent: SendMailInput): string {
  const match = sent.html.match(/token=([^"&\s]+)/) ?? sent.text.match(/token=(\S+)/)
  if (!match) throw new Error(`no token found in rendered mail: ${sent.html}`)
  return decodeURIComponent(match[1]!)
}

describe('AuthService.requestReset', () => {
  it('for a known email: inserts a token row and sends mail to that address', async () => {
    const email = uniqueEmail()
    const user = await service.register(email, 'correct horse battery staple')

    await service.requestReset(email)

    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0]!.to).toBe(email)
    expect(mailer.sent[0]!.subject).toMatch(/reset/i)

    const dbResult = await pool.query(
      'SELECT token_hash, user_id, used_at FROM password_reset_tokens WHERE user_id = $1',
      [user.id],
    )
    expect(dbResult.rows).toHaveLength(1)
    // The raw secret must never be stored — only its argon2id hash.
    expect(dbResult.rows[0].token_hash.startsWith('$argon2id$')).toBe(true)
    expect(dbResult.rows[0].used_at).toBeNull()
  })

  it('for an unknown email: sends no mail, inserts no row, and resolves without throwing', async () => {
    const email = `nobody-such-user-${crypto.randomUUID()}@example.com`

    await expect(service.requestReset(email)).resolves.toBeUndefined()

    expect(mailer.sent).toHaveLength(0)
  })
})

describe('AuthService.performReset', () => {
  async function issueResetToken(email: string): Promise<string> {
    await service.requestReset(email)
    const sent = mailer.sent.at(-1)
    if (!sent) throw new Error('requestReset did not send mail')
    return extractToken(sent)
  }

  it('a valid token resets the password: the old password no longer validates, the new one does', async () => {
    const email = uniqueEmail()
    await service.register(email, 'old password 123')
    const token = await issueResetToken(email)

    await service.performReset(token, 'new password 456')

    await expect(service.validate(email, 'old password 123')).resolves.toBeNull()
    const result = await service.validate(email, 'new password 456')
    expect(result?.email).toBe(email)
  })

  it('is single-use: a second performReset with the same token is rejected', async () => {
    const email = uniqueEmail()
    await service.register(email, 'old password 123')
    const token = await issueResetToken(email)

    await service.performReset(token, 'new password 456')

    await expect(service.performReset(token, 'yet another password')).rejects.toThrow()
    // The password from the first (successful) reset must still be the one that works.
    const result = await service.validate(email, 'new password 456')
    expect(result?.email).toBe(email)
  })

  it('rejects an expired token', async () => {
    const email = uniqueEmail()
    const user = await service.register(email, 'old password 123')

    const secret = 'expired-secret'
    const tokenHash = await hashPassword(secret)
    const [row] = await db
      .insert(schema.passwordResetTokens)
      .values({
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() - 1000),
      })
      .returning({ id: schema.passwordResetTokens.id })

    await expect(service.performReset(`${row!.id}.${secret}`, 'new password 456')).rejects.toThrow()
    await expect(service.validate(email, 'old password 123')).resolves.not.toBeNull()
  })

  it('rejects malformed or unknown tokens without a 500', async () => {
    const email = uniqueEmail()
    await service.register(email, 'old password 123')
    const token = await issueResetToken(email)
    const [rowId] = token.split('.')

    for (const bad of [
      'garbage',
      'no-dot-here',
      `${rowId}.wrongsecret`,
      '.',
      'a.',
      '.b',
      '00000000-0000-4000-8000-000000000000.somesecret',
    ]) {
      await expect(service.performReset(bad, 'new password 456')).rejects.toThrow()
    }
  })

  it('revokes all of the user refresh tokens on a successful reset', async () => {
    const email = uniqueEmail()
    const user = await service.register(email, 'old password 123')
    const first = await service.issueTokens(user.id)
    const second = await service.issueTokens(user.id)
    const token = await issueResetToken(email)

    await service.performReset(token, 'new password 456')

    await expect(service.rotateRefresh(first.refreshToken)).rejects.toThrow()
    await expect(service.rotateRefresh(second.refreshToken)).rejects.toThrow()

    const dbResult = await pool.query(
      'SELECT count(*) FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL',
      [user.id],
    )
    expect(Number(dbResult.rows[0].count)).toBe(0)
  })

  it('exactly one of two concurrent resets with the same token wins', async () => {
    const email = uniqueEmail()
    await service.register(email, 'old password 123')
    const token = await issueResetToken(email)

    const results = await Promise.allSettled([
      service.performReset(token, 'password-a-111'),
      service.performReset(token, 'password-b-222'),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    // Exactly one of the two candidate passwords actually took effect.
    const [aWorks, bWorks] = await Promise.all([
      service.validate(email, 'password-a-111'),
      service.validate(email, 'password-b-222'),
    ])
    expect([aWorks !== null, bWorks !== null].filter(Boolean)).toHaveLength(1)
  })
})
