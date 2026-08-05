-- PowerSync replicates only what this publication exposes.
--
-- `users` is deliberately absent. It holds password_hash, and replication happens BEFORE
-- sync rules are evaluated, so publishing it would copy credential material into the sync
-- engine's storage database. Nothing about the client needs it.
--
-- Do NOT switch this to FOR ALL TABLES. The explicit list IS the security boundary: secret
-- tables (`users` now, `refresh_tokens` and `password_reset_tokens` in Milestone 2) must
-- never be auto-published. New app tables are opt-in here, by design.
--
-- Wrapped in a transaction on purpose. DROP and CREATE as separate statements leave a
-- window in which the publication does not exist, and any write committed during it is
-- silently dropped from the replication stream. Postgres has transactional DDL, so the
-- swap below is atomic.
--
-- Safe to re-run against a live PowerSync slot: replication slots are independent of
-- publications, so the slot survives and streaming continues.
BEGIN;

DROP PUBLICATION IF EXISTS powersync;

CREATE PUBLICATION powersync FOR TABLE
  exercises,
  templates,
  template_exercises,
  sessions,
  session_exercises,
  sets,
  exercise_rest_prefs;

COMMIT;
