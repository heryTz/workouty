// Instantiates the native PowerSync SQLite database (op-sqlite-backed, via
// @powersync/react-native — see D1's op-sqlite install + expo prebuild validation).
//
// PLATFORM SELECTION: Metro resolves this file for ios/android (its "native" catch-all
// extension) and database.web.ts for web; database.ts is a types-only bridge that only tsc
// resolves (tsc doesn't understand Metro's .native/.web extension convention) — see that
// file's header comment.
//
// NATIVE IMPORT: this file is the only place @powersync/react-native may be imported.
// schema.ts/connector.ts/token-store.ts stay Node-safe so the 92 pure unit tests (vitest,
// plain Node) keep passing without a native module resolving. Do not import this file from
// any *.test.ts.
import type { AbstractPowerSyncDatabase } from '@powersync/common'
import { PowerSyncDatabase } from '@powersync/react-native'
import { AppSchema } from './schema'

// One physical database file per device, shared by every signed-in session (disconnectAndClear
// on sign-out wipes its contents, not the file itself — see PowerSyncProvider.signOut).
const DB_FILENAME = 'workouty.db'

export function createDatabase(): AbstractPowerSyncDatabase {
  return new PowerSyncDatabase({
    schema: AppSchema,
    database: {
      dbFilename: DB_FILENAME,
    },
  })
}
