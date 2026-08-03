import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { AppModule } from '../app.module'

let app: INestApplication

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
})

it('serves health and proves @workouty/shared is callable at runtime', async () => {
  const res = await request(app.getHttpServer()).get('/health').expect(200)
  expect(res.body.status).toBe('ok')
  expect(res.body.oneRepMaxProbe).toBeCloseTo(76, 10)
})
