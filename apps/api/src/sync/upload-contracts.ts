/**
 * Wire contract for the sync upload endpoint (Milestone 2).
 *
 * PowerSync client `CrudEntry` shape (per PowerSync docs): `op` ('PUT'|'PATCH'|'DELETE'),
 * `table`, `id` (row uuid), `opData` (changed column values), plus transactionId/metadata
 * we don't need. PUT carries all non-null columns; PATCH carries only changed columns +
 * id; DELETE carries only the id.
 *
 * We define the wire contract here; the Milestone 3 client connector maps each CrudEntry
 * -> { op: e.op, table: e.table, id: e.id, data: e.opData }. Keep this mapping in sync
 * with `crudOpSchema` below.
 */
import { z } from 'zod'
import {
  insertExerciseRestPrefSchema,
  insertExerciseSchema,
  insertSessionExerciseSchema,
  insertSessionSchema,
  insertSetSchema,
  insertTemplateExerciseSchema,
  insertTemplateSchema,
} from '../db/contracts'

// Server-owned columns a client may never set on upload. userId is derived from the JWT;
// createdAt/updatedAt/deletedAt are server-stamped (updatedAt is the LWW tiebreaker).
const serverOwned = { userId: true, createdAt: true, updatedAt: true, deletedAt: true } as const

// Per-table PUT schema (full row minus server-owned columns; id kept - client UUID).
export const uploadPutSchemas = {
  exercises: insertExerciseSchema.omit(serverOwned),
  templates: insertTemplateSchema.omit(serverOwned),
  template_exercises: insertTemplateExerciseSchema.omit(serverOwned),
  sessions: insertSessionSchema.omit(serverOwned),
  session_exercises: insertSessionExerciseSchema.omit(serverOwned),
  sets: insertSetSchema.omit(serverOwned),
  exercise_rest_prefs: insertExerciseRestPrefSchema.omit(serverOwned),
} as const

// PATCH sends only changed columns -> partial variant.
export const uploadPatchSchemas = {
  exercises: uploadPutSchemas.exercises.partial(),
  templates: uploadPutSchemas.templates.partial(),
  template_exercises: uploadPutSchemas.template_exercises.partial(),
  sessions: uploadPutSchemas.sessions.partial(),
  session_exercises: uploadPutSchemas.session_exercises.partial(),
  sets: uploadPutSchemas.sets.partial(),
  exercise_rest_prefs: uploadPutSchemas.exercise_rest_prefs.partial(),
} as const

export const SYNCED_TABLES = Object.keys(uploadPutSchemas) as (keyof typeof uploadPutSchemas)[]
export type SyncedTable = keyof typeof uploadPutSchemas

// One CRUD op from the client upload queue. See module header for the CrudEntry mapping.
export const crudOpSchema = z.object({
  op: z.enum(['PUT', 'PATCH', 'DELETE']),
  table: z.string(),
  id: z.string().uuid(),
  data: z.record(z.string(), z.unknown()).optional(),
})
export type CrudOp = z.infer<typeof crudOpSchema>

export const uploadBatchSchema = z.object({
  batch: z.array(crudOpSchema).max(1000),
})
export type UploadBatch = z.infer<typeof uploadBatchSchema>
