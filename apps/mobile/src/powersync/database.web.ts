// Instantiates the web PowerSync SQLite database (wa-sqlite/WASM-backed, via @powersync/web) —
// this is how Milestone 4 is verified end-to-end (no Android device available; see the M4 plan).
//
// PLATFORM SELECTION: Metro resolves this file for the web platform and database.native.ts for
// ios/android; database.ts is a types-only bridge that only tsc resolves (tsc doesn't understand
// Metro's .native/.web extension convention) — see that file's header comment.
//
// WEB IMPORT: this file is the only place @powersync/web / @journeyapps/wa-sqlite may be
// imported. schema.ts/connector.ts/token-store.ts stay Node-safe so the 92 pure unit tests
// (vitest, plain Node) keep passing without a browser/WASM environment. Do not import this file
// from any *.test.ts.
//
// WASM/WORKER WIRING: @powersync/web offloads SQLite (and, per `sync.worker` below, the sync
// stream) to a Web Worker that owns the wa-sqlite WASM module — required because Metro (unlike
// Vite/webpack) can't rewrite `new Worker(new URL(...), import.meta.url)`, so @powersync/web's
// default self-bundling worker throws under Metro. Instead we point both workers at a *prebuilt*
// worker script (Rollup-bundled by the SDK, wasm co-located next to it) that the browser loads
// directly as a real ES module Worker — Metro never touches it, so it never needs to understand
// wasm or import.meta.url itself. That script is copied from node_modules into apps/mobile/public
// (served verbatim by `expo export --platform web` at /@powersync/*) by the `postinstall` script
// in package.json (`powersync-web copy-assets`) — see metro.config.js for the matching Metro
// resolver change (@powersync/web needs the "react-native-web" export condition, which Expo's
// default Metro config strips for web). Reference:
// https://docs.powersync.com/client-sdks/frameworks/react-native-web-support
import { createConsoleLogger, type AbstractPowerSyncDatabase } from '@powersync/common'
import { PowerSyncDatabase, WASQLiteOpenFactory } from '@powersync/web'
import { AppSchema } from './schema'

// One physical database file per device, shared by every signed-in session (disconnectAndClear
// on sign-out wipes its contents, not the file itself — see PowerSyncProvider.signOut). Matches
// database.native.ts's filename (the two are never open at once — one platform per app).
const DB_FILENAME = 'workouty.db'

// The prebuilt worker script `powersync-web copy-assets` places at apps/mobile/public/@powersync
// (see package.json's `postinstall` script), served at this path by the Expo web export/dev
// server. The same script handles both the SQLite worker and the sync-stream worker (dispatched
// internally by a `service` tag), so both options below point at it.
const WORKER_PATH = '/@powersync/worker.js'

export function createDatabase(): AbstractPowerSyncDatabase {
  const logger = createConsoleLogger()

  // WASQLiteOpenFactory (not a plain `{ dbFilename }` options object) is required here so we can
  // set `open.worker` — passed as `factory:` below (not `database:`) so PowerSync uses this
  // already-configured factory as-is instead of building its own default one.
  const factory = new WASQLiteOpenFactory({
    logger,
    open: {
      dbFilename: DB_FILENAME,
      worker: WORKER_PATH,
    },
  })

  return new PowerSyncDatabase({
    schema: AppSchema,
    factory,
    sync: {
      worker: WORKER_PATH,
    },
    logger,
  })
}
