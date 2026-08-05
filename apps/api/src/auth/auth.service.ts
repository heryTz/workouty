import { renderResetPassword } from '@workouty/emails'
import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { and, eq, isNull } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import { DRIZZLE, type Db } from '../db/drizzle.module'
import { passwordResetTokens, refreshTokens, users } from '../db/schema'
import { MAILER, type Mailer } from '../mail/mail.module'
import { AccessTokenService } from './jwt.service'
import { hashPassword, verifyPassword } from './password'

export interface AuthUser {
  id: string
  email: string
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

// Refresh tokens are opaque, not JWTs: `<refreshTokenRowId>.<secret>`. The row id is a
// lookup key (never secret — it's a UUID, and DB access is already required to read the
// row), and `secret` is 32 random bytes, base64url-encoded. Only argon2(secret) is ever
// stored, so a stolen DB dump does not hand out usable refresh tokens.
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000
// Same `<rowId>.<secret>` shape and rationale as refresh tokens, above.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Structural subset of `Db` shared by both the pool handle and a `db.transaction` callback's
// `tx` — just enough to issue a refresh token row from either.
type Inserter = Pick<Db, 'insert'>

// Pre-hashed once at module load, so `validate()` has a real argon2id hash to verify
// against on the "unknown email" path too. Without this, an unauthenticated attacker
// could tell "unknown email" (no hash work) apart from "wrong password" (one hash) by
// response time. Awaited lazily below rather than at import time.
const dummyHashPromise: Promise<string> = hashPassword('not-a-real-account-timing-safety')

function hasPgCode(err: unknown, code: string): boolean {
  return (
    typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === code
  )
}

// drizzle-orm's node-postgres driver wraps every failed query in a DrizzleQueryError,
// with the real `pg` error (the one carrying `.code`) on `.cause`.
function isUniqueViolation(err: unknown): boolean {
  return (
    hasPgCode(err, '23505') ||
    (err instanceof Error && hasPgCode(err.cause, '23505'))
  )
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly accessTokenService: AccessTokenService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  async register(email: string, password: string): Promise<AuthUser> {
    const passwordHash = await hashPassword(password)
    try {
      const [row] = await this.db
        .insert(users)
        .values({ email, passwordHash })
        .returning({ id: users.id, email: users.email })
      if (!row) throw new Error('insert returned no row')
      return row
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Email already registered')
      }
      throw err
    }
  }

  async validate(email: string, password: string): Promise<AuthUser | null> {
    const [row] = await this.db
      .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1)

    if (!row) {
      // Still do argon2 work so this path takes about as long as a real mismatch.
      await verifyPassword(await dummyHashPromise, password)
      return null
    }

    const ok = await verifyPassword(row.passwordHash, password)
    return ok ? { id: row.id, email: row.email } : null
  }

  /** Issues a fresh access + refresh token pair for `userId`. */
  async issueTokens(userId: string): Promise<TokenPair> {
    return this.issueTokensWith(this.db, userId)
  }

  private async issueTokensWith(db: Inserter, userId: string): Promise<TokenPair> {
    const secret = randomBytes(32).toString('base64url')
    const [accessToken, tokenHash] = await Promise.all([
      this.accessTokenService.signAccessToken(userId),
      hashPassword(secret),
    ])

    const [row] = await db
      .insert(refreshTokens)
      .values({
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      })
      .returning({ id: refreshTokens.id })
    if (!row) throw new Error('insert returned no row')

    return { accessToken, refreshToken: `${row.id}.${secret}` }
  }

  /**
   * Rotates a refresh token: validates it, revokes it (single-use), and issues a new
   * pair. Any failure — malformed input, unknown row, expired, already revoked, or a
   * secret that doesn't match the stored hash — rejects uniformly with
   * UnauthorizedException so a caller can't distinguish *why* a token was rejected.
   */
  async rotateRefresh(rawToken: string): Promise<TokenPair> {
    const dotIndex = rawToken.indexOf('.')
    const rowId = dotIndex > 0 ? rawToken.slice(0, dotIndex) : ''
    const secret = dotIndex > 0 ? rawToken.slice(dotIndex + 1) : ''

    // Reject shape before touching the DB: an id that isn't UUID-shaped would otherwise
    // make Postgres throw "invalid input syntax for type uuid", a 500, not a 401.
    if (!UUID_RE.test(rowId) || secret.length === 0) {
      throw new UnauthorizedException('Invalid refresh token')
    }

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.id, rowId))
        .limit(1)

      if (!row || row.expiresAt.getTime() <= Date.now()) {
        throw new UnauthorizedException('Invalid refresh token')
      }

      const ok = await verifyPassword(row.tokenHash, secret)
      if (!ok) throw new UnauthorizedException('Invalid refresh token')

      // Atomic gate against concurrent double-rotation: two racing calls with the same
      // token both pass the checks above (neither mutates state), so the SELECT alone
      // can't stop both from proceeding. The revoke itself must be the thing that picks
      // a single winner — an UPDATE ... WHERE revoked_at IS NULL. Postgres serializes
      // concurrent UPDATEs to the same row: the first commits with revoked_at set, and
      // under READ COMMITTED the second re-evaluates its WHERE clause against that
      // just-committed row, finds revoked_at no longer NULL, and matches zero rows.
      // Only the transaction whose UPDATE actually flipped the row gets to reissue.
      const revoked = await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.id, rowId), isNull(refreshTokens.revokedAt)))
        .returning({ id: refreshTokens.id })
      if (revoked.length !== 1) {
        throw new UnauthorizedException('Invalid refresh token')
      }

      return this.issueTokensWith(tx, row.userId)
    })
  }

  /**
   * Starts a password reset for `email`. Resolves the same way — void, no throw —
   * whether or not the address is registered. For an unknown email: no row is inserted
   * and no mail is sent.
   *
   * Deliberately not timing-equalized: an earlier version ran a dummy argon2 hash on the
   * unknown-email path to mask the cost difference, but that only narrowed the gap — the
   * known-email path still did a DB insert + email render + SMTP send that the unknown
   * path never did, leaving a reliably measurable latency oracle (~0.12s vs ~0.06s).
   * The actual fix lives in the caller: AuthController.resetRequest does not await this
   * method, so no amount of work done here is observable in the response latency. Keep it
   * that way — an awaited caller would reopen the timing side-channel regardless of what
   * this method does internally.
   */
  async requestReset(email: string): Promise<void> {
    const [row] = await this.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1)

    if (!row) {
      return
    }

    const secret = randomBytes(32).toString('base64url')
    const tokenHash = await hashPassword(secret)

    const [inserted] = await this.db
      .insert(passwordResetTokens)
      .values({
        userId: row.id,
        tokenHash,
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      })
      .returning({ id: passwordResetTokens.id })
    if (!inserted) throw new Error('insert returned no row')

    const base = process.env.APP_WEB_URL ?? 'https://app.workouty.local'
    const url = `${base}/reset?token=${inserted.id}.${secret}`
    const { html, text } = await renderResetPassword({ url })
    await this.mailer.send({ to: row.email, subject: 'Reset your Workouty password', html, text })
  }

  /**
   * Consumes a password-reset token: validates it, atomically marks it used (single-use,
   * see the concurrency note below), sets the new password, and — since a reset is a
   * security event — revokes every one of the user's live refresh tokens so any existing
   * sessions are logged out. All failures reject uniformly with UnauthorizedException so a
   * caller can't distinguish malformed / unknown / expired / used / wrong-secret.
   */
  async performReset(rawToken: string, newPassword: string): Promise<void> {
    const dotIndex = rawToken.indexOf('.')
    const rowId = dotIndex > 0 ? rawToken.slice(0, dotIndex) : ''
    const secret = dotIndex > 0 ? rawToken.slice(dotIndex + 1) : ''

    // Reject shape before touching the DB — see the identical guard in rotateRefresh.
    if (!UUID_RE.test(rowId) || secret.length === 0) {
      throw new UnauthorizedException('Invalid or expired reset token')
    }

    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.id, rowId))
        .limit(1)

      if (!row || row.usedAt !== null || row.expiresAt.getTime() <= Date.now()) {
        throw new UnauthorizedException('Invalid or expired reset token')
      }

      const ok = await verifyPassword(row.tokenHash, secret)
      if (!ok) throw new UnauthorizedException('Invalid or expired reset token')

      // Atomic single-use gate, same pattern (and the same D1 lesson) as rotateRefresh's
      // revoke above: two concurrent performReset calls for the same token both pass the
      // checks above (nothing above mutates state), so the SELECT can't stop both from
      // proceeding. The UPDATE itself must pick the one winner via `WHERE used_at IS
      // NULL` — only the transaction whose UPDATE actually flips the row continues.
      const consumed = await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResetTokens.id, rowId), isNull(passwordResetTokens.usedAt)))
        .returning({ id: passwordResetTokens.id })
      if (consumed.length !== 1) {
        throw new UnauthorizedException('Invalid or expired reset token')
      }

      const passwordHash = await hashPassword(newPassword)
      await tx.update(users).set({ passwordHash }).where(eq(users.id, row.userId))

      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, row.userId), isNull(refreshTokens.revokedAt)))
    })
  }
}
