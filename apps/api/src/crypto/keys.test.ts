import { describe, expect, it } from 'vitest'
import { getKid, getPublicJwk } from './keys'

describe('crypto/keys', () => {
  it('getPublicJwk() returns a well-formed public RSA JWK with no private material', async () => {
    const jwk = await getPublicJwk()
    expect(jwk.kty).toBe('RSA')
    expect(jwk.alg).toBe('RS256')
    expect(jwk.use).toBe('sig')
    expect(typeof jwk.n).toBe('string')
    expect(jwk.n!.length).toBeGreaterThan(0)
    expect(typeof jwk.e).toBe('string')
    expect(jwk.e!.length).toBeGreaterThan(0)
    expect(typeof jwk.kid).toBe('string')
    expect(jwk.kid!.length).toBeGreaterThan(0)
    expect(jwk).not.toHaveProperty('d')
  })

  it('getKid() is stable across repeated calls', async () => {
    const a = await getKid()
    const b = await getKid()
    expect(a).toBe(b)
  })

  it('getKid() matches the kid embedded in the public JWK', async () => {
    const kid = await getKid()
    const jwk = await getPublicJwk()
    expect(jwk.kid).toBe(kid)
  })
})
