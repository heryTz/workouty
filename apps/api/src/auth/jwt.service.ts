import { Injectable } from '@nestjs/common'
import { SignJWT } from 'jose'
import { getKid, getPrivateKey } from '../crypto/keys'

const ISSUER = 'workouty-api'
const AUDIENCE = 'workouty'
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60 // PowerSync rejects tokens whose iat is >60 min old; keep this short.

// Named AccessTokenService (rather than JwtService) to avoid clashing with
// @nestjs/jwt's JwtService, which this app does not use — tokens are signed
// directly with jose against the RS256 keypair from ../crypto/keys.
@Injectable()
export class AccessTokenService {
  async signAccessToken(userId: string): Promise<string> {
    const [privateKey, kid] = await Promise.all([getPrivateKey(), getKid()])
    const now = Math.floor(Date.now() / 1000)

    return new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid })
      .setSubject(userId)
      .setAudience(AUDIENCE)
      .setIssuer(ISSUER)
      .setIssuedAt(now)
      .setExpirationTime(now + ACCESS_TOKEN_TTL_SECONDS)
      .sign(privateKey)
  }
}
