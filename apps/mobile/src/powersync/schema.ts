import { column, Schema, Table } from '@powersync/common'

// Client SQLite mirror of the six synced Postgres tables. Column names are the snake_case
// Postgres names (PowerSync maps by column name). `id` (uuid) is auto-created by PowerSync
// and must NOT be declared. SQLite types: uuid/text -> text, integer -> integer,
// double precision -> real, boolean -> integer (0/1), timestamptz -> text (ISO).

const exercises = new Table(
  {
    user_id: column.text,
    name: column.text,
    muscle_group: column.text,
    default_rest_seconds: column.integer,
    is_custom: column.integer,
    created_at: column.text,
    updated_at: column.text,
    deleted_at: column.text,
  },
  { indexes: { user: ['user_id'] } },
)

const templates = new Table(
  {
    user_id: column.text,
    name: column.text,
    created_at: column.text,
    updated_at: column.text,
    deleted_at: column.text,
  },
  { indexes: { user: ['user_id'] } },
)

const template_exercises = new Table(
  {
    user_id: column.text,
    template_id: column.text,
    exercise_id: column.text,
    position: column.integer,
    default_rest_seconds: column.integer,
    created_at: column.text,
    updated_at: column.text,
    deleted_at: column.text,
  },
  { indexes: { user: ['user_id'], template: ['template_id'] } },
)

const sessions = new Table(
  {
    user_id: column.text,
    template_id: column.text,
    started_at: column.text,
    ended_at: column.text,
    created_at: column.text,
    updated_at: column.text,
    deleted_at: column.text,
  },
  { indexes: { user: ['user_id'] } },
)

const session_exercises = new Table(
  {
    user_id: column.text,
    session_id: column.text,
    exercise_id: column.text,
    position: column.integer,
    created_at: column.text,
    updated_at: column.text,
    deleted_at: column.text,
  },
  { indexes: { user: ['user_id'], session: ['session_id'] } },
)

const sets = new Table(
  {
    user_id: column.text,
    session_exercise_id: column.text,
    set_index: column.integer,
    reps: column.integer,
    weight_kg: column.real,
    actual_rest_seconds: column.integer,
    performed_at: column.text,
    created_at: column.text,
    updated_at: column.text,
    deleted_at: column.text,
  },
  { indexes: { user: ['user_id'], session_exercise: ['session_exercise_id'] } },
)

const exercise_rest_prefs = new Table(
  {
    user_id: column.text,
    exercise_id: column.text,
    rest_seconds: column.integer,
    created_at: column.text,
    updated_at: column.text,
    deleted_at: column.text,
  },
  { indexes: { user: ['user_id'], exercise: ['exercise_id'] } },
)

export const AppSchema = new Schema({
  exercises,
  templates,
  template_exercises,
  sessions,
  session_exercises,
  sets,
  exercise_rest_prefs,
})
