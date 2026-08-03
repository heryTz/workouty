import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { afterAll, beforeAll, expect, it } from 'vitest'
import request from 'supertest'
import { AppModule } from '../app.module'
import { getPublicJwk } from '../crypto/keys'

let app: INestApplication

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
})

it('serves the JWKS with the public signing key and no private material', async () => {
  const res = await request(app.getHttpServer()).get('/.well-known/jwks.json').expect(200)
  expect(Array.isArray(res.body.keys)).toBe(true)
  expect(res.body.keys.length).toBe(1)
  const jwk = res.body.keys[0]
  const expected = await getPublicJwk()
  expect(jwk.kid).toBe(expected.kid)
  expect(jwk.kty).toBe('RSA')
  expect(jwk.alg).toBe('RS256')
  expect(jwk.use).toBe('sig')
  expect(jwk.n).toBeTruthy()
  expect(jwk.e).toBeTruthy()
  // MUST NOT leak any private field — this JWK is public to the world
  for (const priv of ['d', 'p', 'q', 'dp', 'dq', 'qi']) {
    expect(jwk[priv]).toBeUndefined()
  }
})
