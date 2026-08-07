-- Built-in exercise library: ~20 global rows (user_id IS NULL, is_custom = false), synced to
-- every authenticated client via the `global_exercises` bucket (see
-- infra/powersync/sync_rules.yaml). The client can never create these itself — the upload
-- service forces user_id from the caller's JWT (apps/api/src/sync/upload.service.ts) — so the
-- built-in library only ever comes from this server-side seed.
--
-- Idempotent: `ON CONFLICT (name) WHERE user_id IS NULL AND deleted_at IS NULL DO NOTHING`
-- targets the partial unique index `exercises_global_name_uq` (db/schema.ts) exactly — a plain
-- `ON CONFLICT (name)` would fail to match a partial index, but naming the same columns *and*
-- the same WHERE predicate as the index definition works (verified against the live stack:
-- running this file twice inserts 20 rows the first time and 0 the second). Re-run freely.
INSERT INTO exercises (name, muscle_group, default_rest_seconds, load_type, measure, is_custom)
VALUES
  ('Bench press', 'chest', 150, 'external', 'reps', false),
  ('Incline bench press', 'chest', 150, 'external', 'reps', false),
  ('Push-up', 'chest', 60, 'bodyweight', 'reps', false),
  ('Overhead press', 'shoulders', 150, 'external', 'reps', false),
  ('Lateral raise', 'shoulders', 60, 'external', 'reps', false),
  ('Pull-up', 'back', 120, 'bodyweight', 'reps', false),
  ('Lat pulldown', 'back', 90, 'external', 'reps', false),
  ('Barbell row', 'back', 120, 'external', 'reps', false),
  ('Deadlift', 'back', 180, 'external', 'reps', false),
  ('Back squat', 'legs', 180, 'external', 'reps', false),
  ('Front squat', 'legs', 180, 'external', 'reps', false),
  ('Leg press', 'legs', 120, 'external', 'reps', false),
  ('Romanian deadlift', 'legs', 150, 'external', 'reps', false),
  ('Lunge', 'legs', 90, 'external', 'reps', false),
  ('Leg curl', 'legs', 90, 'external', 'reps', false),
  ('Calf raise', 'legs', 60, 'external', 'reps', false),
  ('Bicep curl', 'arms', 60, 'external', 'reps', false),
  ('Hammer curl', 'arms', 60, 'external', 'reps', false),
  ('Tricep pushdown', 'arms', 60, 'external', 'reps', false),
  ('Plank', 'core', 60, 'bodyweight', 'duration', false)
ON CONFLICT (name) WHERE user_id IS NULL AND deleted_at IS NULL DO NOTHING;

-- The INSERT above only reaches a FRESH database. `load_type`/`measure` arrived after this seed
-- first ran (drizzle/0003), so an already-seeded database has all 20 rows sitting at the column
-- defaults ('external', 'reps') and DO NOTHING will never correct them. This backfills the three
-- that differ.
--
-- `user_id IS NULL` is not optional: a user's custom exercise MAY share a name with a built-in
-- (see the two partial unique indexes in db/schema.ts). Without it this would reach into user
-- rows and overwrite choices they made.
--
-- The IS DISTINCT FROM guard makes a re-run a genuine no-op. Postgres does not skip an UPDATE
-- that writes identical values — it still writes a new row version, which logical replication
-- ships to PowerSync, which re-syncs these rows to every connected client. Without the guard
-- that would happen on every container start (docker-entrypoint.sh runs this file each boot).
UPDATE exercises AS e
SET load_type = v.load_type,
    measure = v.measure,
    updated_at = now()
FROM (VALUES
  ('Push-up', 'bodyweight', 'reps'),
  ('Pull-up', 'bodyweight', 'reps'),
  ('Plank', 'bodyweight', 'duration')
) AS v(name, load_type, measure)
WHERE e.name = v.name
  AND e.user_id IS NULL
  AND e.deleted_at IS NULL
  AND (e.load_type, e.measure) IS DISTINCT FROM (v.load_type, v.measure);
