// Reactive queries for templates (Milestone 5 Task A2, consumed by the Task C1 templates list
// screen): the current user's live templates, and a given template's live exercises joined to
// their exercise names.
//
// Mirrors session/exercises.ts's useExercises pattern: no explicit user_id filter is needed
// (the local PowerSync mirror only ever contains rows this device is allowed to see — templates
// and template_exercises are both user_data-bucket-only, see apps/powersync/sync_rules.yaml,
// so a plain SELECT already lands scoped to the signed-in user). `deleted_at IS NULL` still
// matters locally though: PowerSync's sync rules already drop a soft-deleted row from the
// bucket, but a LOCAL soft-delete write (renameTemplate/deleteTemplate in template-writes.ts)
// updates this device's mirror directly, ahead of that round trip — see session/session-writes.ts
// and app/(app)/session/[id].tsx's own queries for the same "exclude soft-deleted defensively"
// habit.
//
// Both hooks are thin wrappers around @powersync/react's useQuery — re-run whenever the
// underlying tables change, whether from a local write or a row synced down from the server.
import { useQuery } from '@powersync/react'

export interface TemplateRow {
  id: string
  user_id: string
  name: string
  created_at: string
  updated_at: string
}

// Ordered most-recently-updated first, so a template just created or renamed floats to the top.
const TEMPLATES_QUERY = `
  SELECT
    id AS id,
    user_id AS user_id,
    name AS name,
    created_at AS created_at,
    updated_at AS updated_at
  FROM templates
  WHERE deleted_at IS NULL
  ORDER BY updated_at DESC
`

export interface UseTemplatesResult {
  data: TemplateRow[]
  isLoading: boolean
}

// The user's templates, reactive.
export function useTemplates(): UseTemplatesResult {
  const { data, isLoading } = useQuery<TemplateRow>(TEMPLATES_QUERY)
  return { data, isLoading }
}

export interface TemplateExerciseRow {
  id: string
  exercise_id: string
  position: number
  name: string
  default_rest_seconds: number
}

const TEMPLATE_EXERCISES_QUERY = `
  SELECT
    te.id AS id,
    te.exercise_id AS exercise_id,
    te.position AS position,
    e.name AS name,
    e.default_rest_seconds AS default_rest_seconds
  FROM template_exercises te
  JOIN exercises e ON e.id = te.exercise_id
  WHERE te.template_id = ? AND te.deleted_at IS NULL
  ORDER BY te.position ASC
`

export interface UseTemplateExercisesResult {
  data: TemplateExerciseRow[]
  isLoading: boolean
}

// A single template's (live) exercises in position order, joined to their names — reactive.
export function useTemplateExercises(templateId: string): UseTemplateExercisesResult {
  const { data, isLoading } = useQuery<TemplateExerciseRow>(TEMPLATE_EXERCISES_QUERY, [templateId])
  return { data, isLoading }
}
