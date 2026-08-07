import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { AppModule } from '../app.module'

let app: INestApplication

const originalVersion = process.env.APP_VERSION
const originalReleaseDate = process.env.APP_RELEASE_DATE

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
})

afterEach(() => {
  if (originalVersion === undefined) delete process.env.APP_VERSION
  else process.env.APP_VERSION = originalVersion
  if (originalReleaseDate === undefined) delete process.env.APP_RELEASE_DATE
  else process.env.APP_RELEASE_DATE = originalReleaseDate
})

it('reports the build metadata baked into the image', async () => {
  process.env.APP_VERSION = '1.2.0'
  process.env.APP_RELEASE_DATE = '2026-08-07'

  const res = await request(app.getHttpServer()).get('/version').expect(200)

  expect(res.body).toEqual({ version: '1.2.0', releaseDate: '2026-08-07' })
})

it('falls back to dev when no build metadata was baked in', async () => {
  delete process.env.APP_VERSION
  delete process.env.APP_RELEASE_DATE

  const res = await request(app.getHttpServer()).get('/version').expect(200)

  expect(res.body).toEqual({ version: 'dev', releaseDate: null })
})

it('treats an empty build arg as absent', async () => {
  process.env.APP_VERSION = ''
  process.env.APP_RELEASE_DATE = ''

  const res = await request(app.getHttpServer()).get('/version').expect(200)

  expect(res.body).toEqual({ version: 'dev', releaseDate: null })
})
