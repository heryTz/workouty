-- PowerSync's own login role: REPLICATION plus SELECT on exactly the published tables.
-- Replication used to run as the app owner, which handed the sync service write access to
-- every table it only ever reads — including the ones publication.sql deliberately withholds.
--
-- PowerSync's documented recipe is `GRANT SELECT ON ALL TABLES`, but that pairs with its
-- `CREATE PUBLICATION FOR ALL TABLES`. Since publication.sql treats the table list as a
-- security boundary (`users` holds password_hash), the grants are derived from the publication
-- instead: one source of truth, and a table added there is granted here on the next run.
--
-- So this must run AFTER publication.sql, which must in turn run after migrations. The REVOKE
-- makes it a re-sync rather than an accumulation: a table dropped from the publication loses
-- its grant. There is deliberately no ALTER DEFAULT PRIVILEGES — that would grant SELECT on
-- every future table, secret ones included, which is the whole thing being avoided.
--
-- Re-running rotates the password rather than failing on an existing role. The env vars are
-- read here rather than passed with -v so callers keep psql's exec-form entrypoint (no shell
-- to expand them).

\getenv ps_user PS_REPLICATION_USER
\getenv ps_password PS_REPLICATION_PASSWORD

SELECT format(
  '%s %I WITH REPLICATION BYPASSRLS LOGIN PASSWORD %L',
  CASE WHEN EXISTS (SELECT FROM pg_roles WHERE rolname = :'ps_user')
       THEN 'ALTER ROLE' ELSE 'CREATE ROLE' END,
  :'ps_user',
  :'ps_password'
)
\gexec

SELECT format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', :'ps_user')
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'ps_user')
\gexec

SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'ps_user')
\gexec

SELECT format('GRANT SELECT ON TABLE %I.%I TO %I', schemaname, tablename, :'ps_user')
FROM pg_publication_tables
WHERE pubname = 'powersync'
\gexec
