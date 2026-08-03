import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { AuthModule } from './auth/auth.module'
import { DrizzleModule } from './db/drizzle.module'
import { MailModule } from './mail/mail.module'
import { HealthController } from './health/health.controller'
import { JwksController } from './auth/jwks.controller'
import { SyncModule } from './sync/sync.module'

@Module({
  imports: [
    DrizzleModule,
    MailModule,
    // App-wide default; routes needing something tighter (e.g. /auth/login) override it
    // with their own @Throttle().
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    AuthModule,
    SyncModule,
  ],
  controllers: [HealthController, JwksController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
