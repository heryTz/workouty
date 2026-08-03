import { jwtVerify } from 'jose'
import { describe, expect, it } from 'vitest'
import { getKid, getPublicKey } from '../crypto/keys'
import { AccessTokenService } from './jwt.service'

const USER_ID = '11111111-1111-4111-8111-111111111111'

describe('AccessTokenService', () => {
  it('issues a PowerSync-compatible access token', async () => {
    const service = new AccessTokenService()
    const jwt = await service.signAccessToken(USER_ID)

    const { payload, protectedHeader } = await jwtVerify(jwt, await getPublicKey(), {
      audience: 'workouty',
    })

    expect(payload.sub).toBe(USER_ID)
    expect(payload.aud).toContain('workouty')
    expect(protectedHeader.kid).toBe(await getKid())
    expect(protectedHeader.alg).toBe('RS256')
    expect(payload.iat).toBeDefined()
    expect(payload.exp).toBeDefined()
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(900)
    expect(payload.exp! - payload.iat!).toBeGreaterThan(0)
  })

  it('rejects a token verified against the wrong audience', async () => {
    const service = new AccessTokenService()
    const jwt = await service.signAccessToken(USER_ID)

    await expect(
      jwtVerify(jwt, await getPublicKey(), { audience: 'someone-else' }),
    ).rejects.toThrow()
  })
})
