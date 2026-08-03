import { describe, expect, it } from 'vitest'
import { decodeJwtExpiry, decodeJwtSub } from './jwt'

// btoa (not Buffer) to avoid needing @types/node — mirrors connector.test.ts's makeToken.
function makeToken(payload: Record<string, unknown>): string {
  const header = { alg: 'RS256', typ: 'JWT' }
  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
  return `${b64url(header)}.${b64url(payload)}.signature`
}

describe('decodeJwtExpiry', () => {
  it('decodes a valid exp claim to a Date', () => {
    const expSeconds = 1_800_000_000
    const token = makeToken({ sub: 'user-1', exp: expSeconds })
    expect(decodeJwtExpiry(token)).toEqual(new Date(expSeconds * 1000))
  })

  it('returns null for a malformed token (wrong segment count)', () => {
    expect(decodeJwtExpiry('not-a-jwt')).toBeNull()
  })

  it('returns null when exp is missing', () => {
    expect(decodeJwtExpiry(makeToken({ sub: 'user-1' }))).toBeNull()
  })

  it('returns null when exp is not a finite number', () => {
    expect(decodeJwtExpiry(makeToken({ sub: 'user-1', exp: 'soon' }))).toBeNull()
  })
})

describe('decodeJwtSub', () => {
  it('decodes a valid sub claim', () => {
    const token = makeToken({ sub: '550e8400-e29b-41d4-a716-446655440000', exp: 1_800_000_000 })
    expect(decodeJwtSub(token)).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('returns null for a malformed token', () => {
    expect(decodeJwtSub('not-a-jwt')).toBeNull()
  })

  it('returns null when sub is missing', () => {
    expect(decodeJwtSub(makeToken({ exp: 1_800_000_000 }))).toBeNull()
  })

  it('returns null when sub is an empty string', () => {
    expect(decodeJwtSub(makeToken({ sub: '', exp: 1_800_000_000 }))).toBeNull()
  })

  it('returns null when sub is not a string', () => {
    expect(decodeJwtSub(makeToken({ sub: 12345, exp: 1_800_000_000 }))).toBeNull()
  })
})
