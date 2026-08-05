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
INSERT INTO exercises (name, muscle_group, default_rest_seconds, is_custom)
VALUES
  ('Bench press', 'chest', 150, false),
  ('Incline bench press', 'chest', 150, false),
  ('Push-up', 'chest', 60, false),
  ('Overhead press', 'shoulders', 150, false),
  ('Lateral raise', 'shoulders', 60, false),
  ('Pull-up', 'back', 120, false),
  ('Lat pulldown', 'back', 90, false),
  ('Barbell row', 'back', 120, false),
  ('Deadlift', 'back', 180, false),
  ('Back squat', 'legs', 180, false),
  ('Front squat', 'legs', 180, false),
  ('Leg press', 'legs', 120, false),
  ('Romanian deadlift', 'legs', 150, false),
  ('Lunge', 'legs', 90, false),
  ('Leg curl', 'legs', 90, false),
  ('Calf raise', 'legs', 60, false),
  ('Bicep curl', 'arms', 60, false),
  ('Hammer curl', 'arms', 60, false),
  ('Tricep pushdown', 'arms', 60, false),
  ('Plank', 'core', 60, false)
ON CONFLICT (name) WHERE user_id IS NULL AND deleted_at IS NULL DO NOTHING;
