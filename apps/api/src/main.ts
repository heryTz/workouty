import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import helmet from 'helmet'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.use(helmet())

  // The API is a Bearer-token API (Authorization header), not cookie-based, so there's no
  // CSRF surface via credentialed CORS requests — allowing all origins (or a configured
  // allowlist) without `credentials: true` is safe. CORS_ORIGINS is a comma-separated list of
  // allowed web origins; unset means allow all (dev only). Production should set CORS_ORIGINS
  // to the real web origin(s).
  const corsOrigins = process.env.CORS_ORIGINS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  app.enableCors({
    origin: corsOrigins && corsOrigins.length ? corsOrigins : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  })

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  await app.listen(3000, '0.0.0.0')
}
void bootstrap()
