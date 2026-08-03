/**
 * Guards HTTP routes with the same RS256 access tokens PowerSync verifies via JWKS
 * (see jwks.controller.ts + crypto/keys.ts). Verification happens against the local
 * public key directly — no DI, no network round trip — which is why this guard is
 * self-contained rather than routed through AccessTokenService (that class only signs).
 *
 * On success it sets `request.userId` to the token's `sub`. That is the ONLY place a
 * userId may come from for guarded routes: handlers must never trust a body-supplied
 * userId, only this guard's output.
 */
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { jwtVerify } from 'jose'
import { getPublicKey } from '../crypto/keys'

const AUDIENCE = 'workouty'

// Not typed against express.Request: @types/express isn't a direct dependency here (Nest
// pulls express in transitively). This is the minimal shape the guard reads/writes.
export interface RequestWithUserId {
  headers: { authorization?: string }
  userId: string
}

function extractBearerToken(header: string | undefined): string {
  if (!header) throw new UnauthorizedException('Missing Authorization header')
  const [scheme, token] = header.split(' ')
  if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Malformed Authorization header')
  return token
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUserId>()
    const token = extractBearerToken(request.headers.authorization)

    let sub: unknown
    try {
      const { payload } = await jwtVerify(token, await getPublicKey(), {
        audience: AUDIENCE,
        algorithms: ['RS256'],
      })
      sub = payload.sub
    } catch {
      throw new UnauthorizedException('Invalid or expired token')
    }

    if (typeof sub !== 'string' || sub.length === 0) {
      throw new UnauthorizedException('Token missing subject')
    }

    request.userId = sub
    return true
  }
}
