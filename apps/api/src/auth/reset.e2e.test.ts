import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required. Is the Compose stack up?')

const MAILPIT_API = 'http://localhost:6106/api/v1'

let app: INestApplication
const pool = new Pool({ connectionString: databaseUrl })
const email = `test-reset-e2e-${crypto.randomUUID()}@example.com`
const password = 'correct horse battery staple'

type MailpitMessage = { ID: string; To: { Address: string }[] }
type MailpitMessageDetail = { HTML: string; Text: string }

async function clearMailpitInbox(): Promise<void> {
  await fetch(`${MAILPIT_API}/messages`, { method: 'DELETE' })
}

async function findMessageTo(address: string): Promise<MailpitMessage | undefined> {
  const res = await fetch(`${MAILPIT_API}/messages`)
  const body = (await res.json()) as { messages: MailpitMessage[] }
  return body.messages.find((m) => m.To.some((t) => t.Address === address))
}

// Reset mail can take a moment to land in Mailpit; poll rather than assume it's instant.
async function waitForMessageTo(address: string, timeoutMs = 5000): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = await findMessageTo(address)
    if (found) return found
    if (Date.now() > deadline) throw new Error(`no message arrived for ${address} within ${timeoutMs}ms`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

async function extractResetToken(messageId: string): Promise<string> {
  const res = await fetch(`${MAILPIT_API}/message/${messageId}`)
  const body = (await res.json()) as MailpitMessageDetail
  const match = body.HTML.match(/token=([^"&\s]+)/) ?? body.Text.match(/token=(\S+)/)
  if (!match) throw new Error(`no token found in message body: ${body.HTML}`)
  return decodeURIComponent(match[1]!)
}

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication()
  await app.init()
})

beforeEach(async () => {
  await clearMailpitInbox()
})

afterAll(async () => {
  await pool.query(
    'DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE email = $1)',
    [email],
  )
  await pool.query(
    'DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email = $1)',
    [email],
  )
  await pool.query('DELETE FROM users WHERE email = $1', [email])
  await clearMailpitInbox()
  await pool.end()
  await app.close()
})

describe('password reset over Mailpit', () => {
  it('resets a real user\'s password via a token pulled from a real Mailpit message', async () => {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password }).expect(201)

    await request(app.getHttpServer()).post('/auth/reset-request').send({ email }).expect(202)

    const message = await waitForMessageTo(email)
    const token = await extractResetToken(message.ID)
    expect(token).toContain('.')

    await request(app.getHttpServer())
      .post('/auth/reset')
      .send({ token, password: 'a-new-password-123' })
      .expect(200)

    await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(401)

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'a-new-password-123' })
      .expect(200)

    // Single-use: the same token cannot be replayed. Same generic status as any other
    // invalid-token case (see AuthController.reset) — 401, matching /auth/refresh.
    await request(app.getHttpServer())
      .post('/auth/reset')
      .send({ token, password: 'yet-another-password-456' })
      .expect(401)
  })

  it('does not enumerate: an unknown email gets the identical 202 and sends no mail', async () => {
    const unknownEmail = `nobody-reset-e2e-${crypto.randomUUID()}@example.com`

    await request(app.getHttpServer())
      .post('/auth/reset-request')
      .send({ email: unknownEmail })
      .expect(202)

    // Give any (incorrectly) fired mail a moment to land, then assert none did.
    await new Promise((r) => setTimeout(r, 300))
    const found = await findMessageTo(unknownEmail)
    expect(found).toBeUndefined()
  })
})
