// TYPES-ONLY BRIDGE — never bundled at runtime.
//
// Metro resolves `./database` per platform: database.web.ts for web, database.native.ts for
// ios/android (its "native" catch-all extension) — see those files' header comments for the
// wa-sqlite/op-sqlite wiring. But `tsc` has no concept of Metro's platform-extension convention;
// asked to resolve `./database` it always picks *this* literal file. So this file exists purely
// so `tsc --noEmit` can typecheck every other caller of `createDatabase` (PowerSyncProvider.tsx)
// against a signature that matches both platform implementations — it has no runtime body and
// must never be imported by Metro (both platform files always exist, so Metro never falls back
// to this one) or by a test (no runtime export exists here to call).
import type { AbstractPowerSyncDatabase } from '@powersync/common'

export declare function createDatabase(): AbstractPowerSyncDatabase
