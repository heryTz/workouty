import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password'

describe('password hashing', () => {
  it('verifies a correct password against its hash', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true)
  })
  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword(hash, 'Trubador&3')).toBe(false)
  })
  it('produces a different hash each time (salted)', async () => {
    const a = await hashPassword('same')
    const b = await hashPassword('same')
    expect(a).not.toBe(b)
    // both still verify
    expect(await verifyPassword(a, 'same')).toBe(true)
    expect(await verifyPassword(b, 'same')).toBe(true)
  })
  it('returns false (does not throw) on a malformed hash', async () => {
    expect(await verifyPassword('not-a-valid-argon2-hash', 'whatever')).toBe(false)
  })
  it('produces an argon2id hash', async () => {
    const hash = await hashPassword('x')
    expect(hash.startsWith('$argon2id$')).toBe(true)
  })
})
