-- Built-in exercise library: 83 global rows (user_id IS NULL, is_custom = false), synced to
-- every authenticated client via the `global_exercises` bucket (see
-- apps/powersync/sync_rules.yaml). The client can never create these itself — the upload
-- service forces user_id from the caller's JWT (apps/api/src/sync/upload.service.ts) — so the
-- built-in library only ever comes from this server-side seed.

-- MERGE, and it runs before the rename below because it is what makes that rename possible: two
-- rows have to become one. 'Triceps pushdown (cable)' is the generic row, carrying every set
-- logged against it since the original 20-row seed; 'Overhand triceps pushdown (cable)' is the
-- grip-specific row added beside the underhand variant. With both grips spelled out the generic
-- row is redundant -- an unqualified pushdown IS the overhand one -- so it absorbs the newer row
-- and then takes its name.
--
-- The generic row's id is the one that survives, for the reason the 'Lat pulldown' absorb below
-- keeps a row rather than deleting it: `exercises.id` is what sets, template rows and rest prefs
-- all key on, and this is the id with the longer history behind it. The newer row's references
-- move onto it first, so nothing is left pointing at a row on its way out of the library.
--
-- Idempotent through the `keep` join: once the rename below has run, nothing is named 'Triceps
-- pushdown (cable)' any more, the CTE is empty and every UPDATE here touches zero rows. Without
-- that guard a re-run would find the RENAMED row under the name it is looking to retire and
-- soft-delete the library entry it had just produced.
--
-- Soft delete, not DELETE -- there are no hard deletes in this project (src/db/columns.ts). It
-- also frees the name: `exercises_global_name_uq` is partial on `deleted_at IS NULL`, so the
-- tombstone stops colliding with the rename that follows.
WITH merged AS (
  SELECT keep.id AS keep_id, dup.id AS drop_id
  FROM exercises AS keep
  JOIN exercises AS dup
    ON dup.name = 'Overhand triceps pushdown (cable)'
   AND dup.user_id IS NULL
   AND dup.deleted_at IS NULL
  WHERE keep.name = 'Triceps pushdown (cable)'
    AND keep.user_id IS NULL
    AND keep.deleted_at IS NULL
),
-- Tombstoned children move too, deliberately: they still hold a foreign key to a row leaving the
-- library, and an undeleted session should not come back pointing at it.
moved_template_rows AS (
  UPDATE template_exercises AS t
  SET exercise_id = m.keep_id,
      updated_at = now()
  FROM merged AS m
  WHERE t.exercise_id = m.drop_id
),
moved_session_rows AS (
  UPDATE session_exercises AS s
  SET exercise_id = m.keep_id,
      updated_at = now()
  FROM merged AS m
  WHERE s.exercise_id = m.drop_id
),
-- `exercise_rest_prefs_user_exercise_uq` allows one live pref per (user, exercise), so a user
-- holding a pref on BOTH rows cannot have them merged -- moving the second onto keep_id would
-- violate it. The pref already on the surviving row wins, and the other is tombstoned instead.
moved_prefs AS (
  UPDATE exercise_rest_prefs AS p
  SET exercise_id = m.keep_id,
      updated_at = now()
  FROM merged AS m
  WHERE p.exercise_id = m.drop_id
    AND p.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM exercise_rest_prefs AS kept
      WHERE kept.user_id = p.user_id
        AND kept.exercise_id = m.keep_id
        AND kept.deleted_at IS NULL
    )
),
-- Disjoint from `moved_prefs` by construction: both read the same snapshot and their NOT EXISTS /
-- EXISTS split it in two, so no pref row is written twice within the one statement -- which is
-- the case Postgres leaves undefined.
dropped_prefs AS (
  UPDATE exercise_rest_prefs AS p
  SET deleted_at = now(),
      updated_at = now()
  FROM merged AS m
  WHERE p.exercise_id = m.drop_id
    AND p.deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM exercise_rest_prefs AS kept
      WHERE kept.user_id = p.user_id
        AND kept.exercise_id = m.keep_id
        AND kept.deleted_at IS NULL
    )
)
UPDATE exercises AS e
SET deleted_at = now(),
    updated_at = now()
FROM merged AS m
WHERE e.id = m.drop_id;

-- Renames of built-in rows, and the reason this runs BEFORE the INSERT. A rename cannot be made
-- by editing a name in the INSERT alone: on an already-seeded database the new name conflicts
-- with nothing, DO NOTHING never fires, and the seed inserts a SECOND row while the old-named one
-- lives on — a duplicated library that no later run can untangle. Renaming first leaves every row
-- already carrying its current name, so the INSERT that follows matches them by name and skips
-- them, adding only the rows that are genuinely new.
--
-- It is also the only correct way to rename at all: an UPDATE preserves `exercises.id`, so the
-- sessions, template rows and rest prefs pointing at it follow the rename. Delete-and-reinsert
-- would orphan every one of them.
--
-- Naturally idempotent, no IS DISTINCT FROM guard needed (unlike the load_type backfill at the
-- bottom): once renamed, a row no longer matches `e.name = v.old_name`, so a re-run updates zero
-- rows and ships nothing to PowerSync. No new name here collides with another pair's old name,
-- so the VALUES order does not matter.
--
-- Two pairs DO share a new name -- both historical names of the triceps pushdown row land on
-- 'Overhand triceps pushdown (cable)' -- which is safe only because their old names cannot
-- coexist: the pair that retired 'Tricep pushdown' is what created 'Triceps pushdown (cable)'.
-- Were a database ever to hold both, this statement would try to give two rows one name and
-- `exercises_global_name_uq` would abort the boot.
--
-- The NOT EXISTS guard keeps a half-applied database (old and new name both present, e.g. from a
-- deploy that ran an older copy of this file) from violating `exercises_global_name_uq` — this
-- file runs on every container start under `set -e`, so an error here is a failed boot.
--
-- `user_id IS NULL`, as everywhere in this file: a user's custom exercise MAY share a name with a
-- built-in, and renaming one out from under them would be silent data loss.
--
-- A name here is also a foreign key held by the mobile app: apps/mobile/src/session/
-- exercise-illustrations.ts maps exercise NAMES to movement drawings, because these rows' ids are
-- gen_random_uuid() and so differ per deployment. Renaming a mapped exercise without updating
-- that map silently drops its illustration. Its sibling seed test catches a name that leaves this
-- file entirely, but NOT a rename — both names stay present right here in the VALUES below.
UPDATE exercises AS e
SET name = v.new_name,
    updated_at = now()
FROM (VALUES
  ('Bench press', 'Bench press (barbell)'),
  ('Incline bench press', 'Incline bench press (barbell)'),
  ('Overhead press', 'Overhead press (barbell)'),
  ('Lateral raise', 'Lateral raise (dumbbell)'),
  -- Not a cosmetic rename: the generic 'Lat pulldown' row was RETIRED in favour of four
  -- grip-specific ones, and this absorbs it into the wide-grip variant rather than deleting it.
  -- Soft-deleting it instead would be silent history loss — the sync rules drop deleted rows from
  -- every client (apps/powersync/sync_rules.yaml), and every consumer joins exercises with an
  -- INNER join (dashboard/performed-exercises-query.ts, session/[id].tsx), so every set ever
  -- logged against it would simply stop appearing, with no error. Wide-grip is the variant
  -- those sets almost certainly were: it is the default bar and the unqualified cue.
  ('Lat pulldown', 'Wide-grip lat pulldown (cable)'),
  -- Same absorb as 'Lat pulldown' above, and for the same reason: the generic barbell row was
  -- retired once the grip-specific variants existed, and overhand is the default grip those
  -- sets were done with.
  ('Barbell row', 'Overhand bent-over row (barbell)'),
  ('Deadlift', 'Deadlift (barbell)'),
  ('Back squat', 'Back squat (barbell)'),
  ('Front squat', 'Front squat (barbell)'),
  ('Leg press', 'Leg press (machine)'),
  ('Romanian deadlift', 'Romanian deadlift (barbell)'),
  ('Lunge', 'Lunge (dumbbell)'),
  ('Leg curl', 'Leg curl (machine)'),
  ('Calf raise', 'Calf raise (machine)'),
  ('Bicep curl', 'Bicep curl (dumbbell)'),
  ('Hammer curl', 'Hammer curl (dumbbell)'),
  -- Third name for one row, and the same absorb as 'Lat pulldown' above: the generic pushdown
  -- is redundant now that both grips have rows of their own. 'Tricep pushdown' is what a database
  -- seeded before the 73-row expansion still calls it, 'Triceps pushdown (cable)' what one seeded
  -- after it does. The MERGE at the top of this file is what freed the target name.
  ('Tricep pushdown', 'Overhand triceps pushdown (cable)'),
  ('Triceps pushdown (cable)', 'Overhand triceps pushdown (cable)')
) AS v(old_name, new_name)
WHERE e.name = v.old_name
  AND e.user_id IS NULL
  AND e.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM exercises AS taken
    WHERE taken.name = v.new_name AND taken.user_id IS NULL AND taken.deleted_at IS NULL
  );

-- Naming convention for every row below, and for any row added later: `Movement (equipment)`.
--
-- The parentheses hold EQUIPMENT and nothing else. Every other modifier — angle, bar position,
-- stance — belongs in the movement name, where lifters actually say it: "Incline bench press",
-- "Romanian deadlift", "Front squat", not "Bench press (incline barbell)". Equipment is the one
-- axis pulled out because it is the one that most often splits a movement into histories that
-- cannot be compared.
--
-- Equipment goes LAST, never first: "Dumbbell bench press" would sort under D and scatter the
-- variants of one movement across the alphabet, so a search for "bench" reads as unrelated hits.
-- Trailing it keeps the group adjacent.
--
-- A variant earns a SEPARATE ROW, never a column on a shared one, whenever its numbers are not
-- comparable to its siblings' — `exercises.id` is the unit that sets, PRs, progression charts and
-- rest prefs all key on, and 80 kg of barbell bench says nothing about 2 × 30 kg of dumbbell
-- bench. One row with an equipment flag would interleave both into a single meaningless series.
--
-- Movements with no competing form leave the parentheses off entirely (Push-up, Pull-up, Plank).
-- Where one form is clearly the default it stays unmarked and only the others carry a modifier:
-- "Bench press (barbell)" is the flat one, "Incline bench press (barbell)" the exception.
--
-- Renames must go in the UPDATE above, NOT by editing a name in place here — see its comment.
--
-- Idempotent: `ON CONFLICT (name) WHERE user_id IS NULL AND deleted_at IS NULL DO NOTHING`
-- targets the partial unique index `exercises_global_name_uq` (db/schema.ts) exactly — a plain
-- `ON CONFLICT (name)` would fail to match a partial index, but naming the same columns *and*
-- the same WHERE predicate as the index definition works (verified against the live stack:
-- running this file twice inserts every row the first time and 0 the second). Re-run freely.
--
-- Growing the library later is just appending rows HERE: on an already-seeded database the
-- existing names conflict and are skipped, and only the new ones land. Unlike a rename, no
-- UPDATE is needed — a name that has never existed has no history to carry forward.
INSERT INTO exercises (name, muscle_group, default_rest_seconds, load_type, measure, is_custom)
VALUES
  ('Bench press (barbell)', 'chest', 150, 'external', 'reps', false),
  ('Bench press (dumbbell)', 'chest', 120, 'external', 'reps', false),
  ('Incline bench press (barbell)', 'chest', 150, 'external', 'reps', false),
  ('Incline bench press (dumbbell)', 'chest', 120, 'external', 'reps', false),
  ('Decline bench press (barbell)', 'chest', 150, 'external', 'reps', false),
  ('Decline bench press (dumbbell)', 'chest', 120, 'external', 'reps', false),
  ('Push-up', 'chest', 60, 'bodyweight', 'reps', false),
  ('Wide-grip push-up', 'chest', 60, 'bodyweight', 'reps', false),
  ('Close-grip push-up', 'chest', 60, 'bodyweight', 'reps', false),
  ('Diamond push-up', 'chest', 60, 'bodyweight', 'reps', false),
  ('Incline push-up', 'chest', 60, 'bodyweight', 'reps', false),
  ('Decline push-up', 'chest', 60, 'bodyweight', 'reps', false),
  ('Dip', 'chest', 90, 'bodyweight', 'reps', false),
  ('Mid chest fly (cable)', 'chest', 60, 'external', 'reps', false),
  ('High-to-low chest fly (cable)', 'chest', 60, 'external', 'reps', false),
  ('Low-to-high chest fly (cable)', 'chest', 60, 'external', 'reps', false),
  ('Overhead press (barbell)', 'shoulders', 150, 'external', 'reps', false),
  ('Overhead press (dumbbell)', 'shoulders', 120, 'external', 'reps', false),
  ('Overhead press (machine)', 'shoulders', 120, 'external', 'reps', false),
  ('Behind-the-neck press (barbell)', 'shoulders', 150, 'external', 'reps', false),
  ('Behind-the-neck press (dumbbell)', 'shoulders', 120, 'external', 'reps', false),
  ('Behind-the-neck press (machine)', 'shoulders', 120, 'external', 'reps', false),
  ('Lateral raise (dumbbell)', 'shoulders', 60, 'external', 'reps', false),
  ('Rear delt fly (dumbbell)', 'shoulders', 60, 'external', 'reps', false),
  ('Front raise (dumbbell)', 'shoulders', 60, 'external', 'reps', false),
  ('Pull-up', 'back', 120, 'bodyweight', 'reps', false),
  ('Wide-grip lat pulldown (cable)', 'back', 90, 'external', 'reps', false),
  ('Close-grip lat pulldown (cable)', 'back', 90, 'external', 'reps', false),
  ('Underhand lat pulldown (cable)', 'back', 90, 'external', 'reps', false),
  ('Behind-the-neck lat pulldown (cable)', 'back', 90, 'external', 'reps', false),
  ('Single-arm lat pulldown (cable)', 'back', 90, 'external', 'reps', false),
  ('Overhand bent-over row (barbell)', 'back', 120, 'external', 'reps', false),
  ('Underhand bent-over row (barbell)', 'back', 120, 'external', 'reps', false),
  ('Single-arm row (dumbbell)', 'back', 90, 'external', 'reps', false),
  ('Seated row (machine)', 'back', 90, 'external', 'reps', false),
  ('Seated row (cable)', 'back', 90, 'external', 'reps', false),
  ('Chest-supported row (dumbbell)', 'back', 90, 'external', 'reps', false),
  ('Chest-supported row (machine)', 'back', 90, 'external', 'reps', false),
  ('Chest-supported row (barbell)', 'back', 120, 'external', 'reps', false),
  ('Straight-arm pulldown (cable)', 'back', 60, 'external', 'reps', false),
  ('Straight-arm pulldown (dumbbell)', 'back', 60, 'external', 'reps', false),
  ('Pullover (dumbbell)', 'back', 60, 'external', 'reps', false),
  ('Deadlift (barbell)', 'back', 180, 'external', 'reps', false),
  ('Deadlift (dumbbell)', 'back', 150, 'external', 'reps', false),
  ('Back squat (barbell)', 'legs', 180, 'external', 'reps', false),
  ('Front squat (barbell)', 'legs', 180, 'external', 'reps', false),
  ('Squat (dumbbell)', 'legs', 90, 'external', 'reps', false),
  ('Goblet squat (dumbbell)', 'legs', 90, 'external', 'reps', false),
  ('Hack squat (machine)', 'legs', 120, 'external', 'reps', false),
  ('Bulgarian split squat (barbell)', 'legs', 120, 'external', 'reps', false),
  ('Bulgarian split squat (dumbbell)', 'legs', 90, 'external', 'reps', false),
  ('Front-foot elevated split squat (barbell)', 'legs', 120, 'external', 'reps', false),
  ('Front-foot elevated split squat (dumbbell)', 'legs', 90, 'external', 'reps', false),
  ('Leg press (machine)', 'legs', 120, 'external', 'reps', false),
  ('Romanian deadlift (barbell)', 'legs', 150, 'external', 'reps', false),
  ('Lunge (dumbbell)', 'legs', 90, 'external', 'reps', false),
  ('Leg curl (machine)', 'legs', 90, 'external', 'reps', false),
  ('Leg extension (machine)', 'legs', 90, 'external', 'reps', false),
  ('Calf raise (machine)', 'legs', 60, 'external', 'reps', false),
  ('Bicep curl (dumbbell)', 'arms', 60, 'external', 'reps', false),
  ('Bicep curl (barbell)', 'arms', 60, 'external', 'reps', false),
  ('Bicep curl (cable)', 'arms', 60, 'external', 'reps', false),
  ('Hammer curl (dumbbell)', 'arms', 60, 'external', 'reps', false),
  ('Hammer curl (cable)', 'arms', 60, 'external', 'reps', false),
  ('Overhand triceps pushdown (cable)', 'arms', 60, 'external', 'reps', false),
  ('Underhand triceps pushdown (cable)', 'arms', 60, 'external', 'reps', false),
  ('Overhead triceps extension (cable)', 'arms', 60, 'external', 'reps', false),
  ('Overhead triceps extension (dumbbell)', 'arms', 60, 'external', 'reps', false),
  ('Overhand skull crusher (barbell)', 'arms', 60, 'external', 'reps', false),
  ('Underhand skull crusher (barbell)', 'arms', 60, 'external', 'reps', false),
  ('Crunch', 'core', 60, 'bodyweight', 'reps', false),
  ('Reverse crunch', 'core', 60, 'bodyweight', 'reps', false),
  ('Sit-up', 'core', 60, 'bodyweight', 'reps', false),
  ('Leg raise', 'core', 60, 'bodyweight', 'reps', false),
  ('Knee raise', 'core', 60, 'bodyweight', 'reps', false),
  ('Hanging leg raise', 'core', 60, 'bodyweight', 'reps', false),
  ('Russian twist', 'core', 60, 'bodyweight', 'reps', false),
  ('Dead bug', 'core', 60, 'bodyweight', 'reps', false),
  ('Plank shoulder tap', 'core', 60, 'bodyweight', 'reps', false),
  ('Plank', 'core', 60, 'bodyweight', 'duration', false),
  ('Hollow body hold', 'core', 60, 'bodyweight', 'duration', false),
  ('Mountain climbers', 'core', 60, 'bodyweight', 'duration', false),
  ('Scissor kicks', 'core', 60, 'bodyweight', 'duration', false)
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
