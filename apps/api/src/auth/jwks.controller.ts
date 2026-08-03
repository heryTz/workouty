import { Controller, Get, Header } from '@nestjs/common'
import { getPublicJwk } from '../crypto/keys'

@Controller('.well-known')
export class JwksController {
  @Get('jwks.json')
  @Header('Cache-Control', 'public, max-age=3600')
  async jwks() {
    return { keys: [await getPublicJwk()] }
  }
}
