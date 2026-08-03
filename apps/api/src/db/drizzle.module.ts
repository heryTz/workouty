import { Global, Injectable, Module, type OnModuleDestroy } from '@nestjs/common'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

export const DRIZZLE = 'DRIZZLE'
export type Db = NodePgDatabase<typeof schema>

@Injectable()
class DrizzlePool implements OnModuleDestroy {
  readonly pool = new Pool({ connectionString: process.env.DATABASE_URL })
  readonly db: Db = drizzle(this.pool, { schema })

  async onModuleDestroy(): Promise<void> {
    await this.pool.end()
  }
}

@Global()
@Module({
  providers: [
    DrizzlePool,
    {
      provide: DRIZZLE,
      useFactory: (drizzlePool: DrizzlePool) => drizzlePool.db,
      inject: [DrizzlePool],
    },
  ],
  exports: [DRIZZLE],
})
export class DrizzleModule {}
