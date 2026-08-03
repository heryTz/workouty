// Maps a PowerSync CrudEntry to the /sync/upload wire op. The endpoint (Milestone 2 Task E1)
// accepts { op, table, id, data? }. DELETE carries no data; PUT/PATCH carry opData.
//
// opData's keys are the CLIENT's local SQLite column names — snake_case, per
// powersync/schema.ts ("Column names are the snake_case Postgres names"). But the server's
// upload validation (upload-contracts.ts's uploadPutSchemas/uploadPatchSchemas) is derived
// via drizzle-zod from the Postgres table definitions, whose schema keys are the JS
// property names on the pgTable object — camelCase (e.g. `muscleGroup`, not `muscle_group`).
// Sending snake_case verbatim means every required camelCase field reads as "missing" and
// the op is rejected with "invalid data" (confirmed against the live stack). So: convert
// each data key from snake_case to camelCase here, at the wire boundary, before it leaves
// the client. Server-owned keys that happen to convert too (e.g. user_id -> userId) are
// harmless — the server's schema `.omit()`s them regardless of what the client sends.
function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/gu, (_, c: string) => c.toUpperCase())
}

function dataToCamelCase(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    out[snakeToCamel(key)] = value
  }
  return out
}

// SQLite has no boolean type, so the client's local schema (powersync/schema.ts) stores
// booleans as 0/1 integers — that's what shows up in a CrudEntry's opData. But the server's
// zod validation is derived (via drizzle-zod) from a real Postgres `boolean` column, and
// requires an actual JS boolean: confirmed against the live stack that `isCustom: 1` is
// rejected ("invalid data") while `isCustom: true` is accepted. `exercises.is_custom` /
// `isCustom` is the only boolean column across the six synced tables (db/schema.ts), so this
// stays a small, explicit per-table/per-field list rather than a heuristic — add to it if a
// future table gains another boolean column.
const BOOLEAN_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  exercises: new Set(['isCustom']),
}

function coerceBooleans(table: string, data: Record<string, unknown>): Record<string, unknown> {
  const fields = BOOLEAN_FIELDS[table]
  if (!fields) return data

  const out = { ...data }
  for (const field of fields) {
    if (typeof out[field] === 'number') out[field] = Boolean(out[field])
  }
  return out
}

export type UploadOp = {
  op: 'PUT' | 'PATCH' | 'DELETE'
  table: string
  id: string
  data?: Record<string, unknown>
}

// Minimal structural type of a PowerSync CrudEntry (we only read these fields).
export type CrudEntryLike = {
  op: 'PUT' | 'PATCH' | 'DELETE'
  id: string
  table: string
  opData?: Record<string, unknown> | null
}

export function toUploadOp(entry: CrudEntryLike): UploadOp {
  const base = { op: entry.op, table: entry.table, id: entry.id }
  if (entry.op === 'DELETE') return base
  const data = coerceBooleans(entry.table, dataToCamelCase(entry.opData ?? {}))
  return { ...base, data }
}
