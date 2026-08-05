# Workouty

## Local development

### Prerequisites

- Docker, with Compose v2 (`docker compose`, not the old `docker-compose`)
- pnpm
- Node 22

### First-time setup

```bash
pnpm install
cp .env.example .env
docker compose up -d --wait --build
pnpm test
pnpm --filter @workouty/api test:int
```

That is the whole sequence, from an empty machine or after `docker compose down -v`. The
stack bootstraps itself in dependency order, and all of it happens inside the `api` container's
entrypoint (`apps/api/docker-entrypoint.sh`): drizzle migrations first, then the publication,
the `powersync_role` grants, and the exercise-library seed, and only then does the server start
listening. `powersync` waits on `api` reporting healthy, which by construction means every one
of those steps already succeeded.

`--build` matters on the first run and after any change under `apps/api` or `apps/powersync`:
Compose reuses cached images otherwise, and nothing in this stack is bind-mounted from the
working tree any more — the bootstrap SQL and the sync rules are both baked into images.

This brings up five long-running Compose services, all with healthchecks
(`docker compose up -d --wait` blocks until every one of them reports healthy):

- `db` — the app's source of truth (127.0.0.1:6103), running with `wal_level=logical`
  so PowerSync can replicate from it.
- `ps-storage` — PowerSync's own bucket storage database (127.0.0.1:6104). Unrelated to the
  app schema; PowerSync manages its own `powersync` schema here.
- `powersync` — the self-hosted PowerSync sync service (0.0.0.0:6101).
- `api` — the NestJS backend (127.0.0.1:6100), which migrates and bootstraps the schema on
  startup.
- `mailpit` — a local SMTP sink for outgoing email. Web inbox at http://localhost:6106.

Some things about this stack are not obvious and are easy to get wrong:

- **Editing anything under `apps/api/sql/` or `apps/powersync/` means rebuilding that image.**
  Both ship their config inside the image, so `docker compose up -d --build` is how you
  re-apply. The three SQL scripts are idempotent and re-run on every API start. PowerSync reads
  the publication only at startup, so follow a publication change with
  `docker compose restart powersync` too, or it keeps replicating against the old one.
  A sync-rules edit rebuilds in ~1s; an SQL edit costs a full API recompile (~40s), because
  `apps/api/sql/` sits inside the build stage's `COPY apps/api apps/api`. That is rarely a real
  cost — `apps/api/drizzle/` is inside the same COPY, so any schema change already pays it, and
  `publication.sql` edits almost always accompany a migration.
- **Ordering inside the entrypoint is load-bearing.** `publication.sql` names specific tables,
  so the migrations must run first. `powersync-role.sql` then grants `powersync_role` SELECT on
  whatever the publication ended up containing, so it comes second. That role holds SELECT on
  exactly the published tables and nothing else: `users` and the token tables stay unreadable
  to it, which is the point.
- **`test:int` requires the stack to be running, `pnpm test` does not.** The integration
  suites connect to the real `db` and `mailpit` containers (via `DATABASE_URL` and
  `SMTP_URL` in `.env`) — `migrate.int.test.ts` among them, which checks that the `powersync`
  publication contains exactly the seven expected tables. If the stack is down you'll see a
  connection-refused error, not a broken test; bring it up first.
- **The built-in exercise library is a server seed, not client data.** `apps/api/sql/
  seed-exercises.sql` inserts ~20 global exercises (`user_id IS NULL`) that sync to every
  client via the `global_exercises` bucket — the client can never create these itself (the
  upload service forces `user_id` from the JWT). The seed is idempotent (`ON CONFLICT`
  against the partial unique index on `name` where `user_id IS NULL`), so it's safe to re-run.

### Test layers

Tests are split by what infrastructure they need, because CI runs on a plain runner with no
Compose stack. A file's suffix decides which layer it belongs to, so a new test lands in the
right one by name alone:

| Command | Covers | Needs |
| --- | --- | --- |
| `pnpm test` (`pnpm -r test`) | everything without a suffix | nothing |
| `pnpm --filter @workouty/api test:int` | `*.int.test.ts` | `db`, `mailpit` |
| `pnpm --filter @workouty/api test:e2e` | `*.e2e.test.ts` — boots a Nest app | `db`, `mailpit` |
| `pnpm --filter @workouty/mobile test:sync` | `*.node.test.ts` — sync round-trip | the whole stack |

Only the first row runs in CI. The other three are yours to run locally before pushing
anything that touches the schema, the sync rules, or the upload service — nothing else will
catch a break in those.

## CI and releases

`.github/workflows/ci.yml` runs typecheck, build, and `pnpm test` on every PR to `main`. The
build step is not redundant with the tests: vitest never invokes `tsup`, `nest build` or
`expo export`, so a build that only breaks under the bundler would otherwise reach `main`
untested.

`.github/workflows/release.yml` runs the same checks on `main`, then hands to
[release-please](https://github.com/googleapis/release-please), which maintains a release PR
from the [Conventional Commits](https://www.conventionalcommits.org/) history. Merging that
PR bumps the version, writes `CHANGELOG.md`, tags, and cuts a GitHub Release; only then do
the release images build. Every other push to `main` publishes `:main` snapshots instead.

| Image | Release | Snapshot |
| --- | --- | --- |
| `herytz/workouty-api` | `:<version>`, `:latest` | `:main`, `:main-<sha>` |
| `herytz/workouty-web` | `:<version>`, `:latest` | `:main`, `:main-<sha>` |
| `herytz/workouty-powersync` | `:<version>`, `:latest` | `:main`, `:main-<sha>` |

`workouty-powersync` is `journeyapps/powersync-service` plus this repo's `powersync.yaml` and
`sync_rules.yaml` — see [Why nothing is mounted](#why-nothing-is-mounted). All three tags move
together, so `IMAGE_TAG` selects a matching set.

Repository settings the workflows expect:

- Secrets `DOCKER_USER` and `DOCKER_TOKEN` — a Docker Hub account with push rights to all three
  repositories. Without them, only the image jobs fail; the tag and Release still happen.
- Secrets `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_POWERSYNC_URL` — the URLs **the browser**
  will use. Expo inlines them into the bundle at build time, so the published web image is
  origin-specific and cannot be repointed with runtime environment variables. Leave them
  unset and the image is built against `localhost`, which is useful only for local runs.
  They are not secret in any real sense — they ship in a public JS bundle — so repository
  *variables* would fit better; secrets only mean Actions masks them in the build log.
- Allow GitHub Actions to create and approve pull requests (Settings → Actions → General),
  or release-please cannot open its release PR.

Because release-please derives the changelog from commit messages, a commit that isn't
`feat:`, `fix:`, or another conventional type contributes nothing to a release. Nothing
enforces this locally yet — walletko does it with husky + commitlint.

## Production stack

`compose.prod.yml` runs the whole product — the web app, the API, and every backing
service — from one command:

```bash
cp .env.prod.example .env.prod        # then fill in JWT_PRIVATE_KEY and the passwords
docker compose --env-file .env.prod -f compose.prod.yml up -d --pull always --wait
```

Nothing is built here, and nothing is mounted: `api`, `web`, and `powersync` are all pulled
from Docker Hub at `IMAGE_TAG`, which defaults to `latest`. Pin it to a released version for a
real deployment, and redeploy by changing it rather than by re-pulling a moving tag.
`compose.prod.yml` and a filled-in `.env.prod` are the only two files the host needs — no
repo checkout.

That's the entire setup, and it bootstraps the same way the dev stack does. The API applies
the drizzle migrations, the PowerSync publication, the `powersync_role` grants, and the global
exercise seed from its own entrypoint (`apps/api/docker-entrypoint.sh`) before the server
starts, so a container can never serve traffic against a schema it wasn't built for — and
`powersync`, gated on that healthcheck, can never replicate against a publication that doesn't
exist yet. `--wait` returns once every service reports healthy.

The bootstrap re-runs on every start, which is also how you rotate the replication password:
change `PS_REPLICATION_PASSWORD` in `.env.prod` and redeploy. Both halves move together —
the role's password and the URI PowerSync dials with come from the same variable.

### Why nothing is mounted

Both directories that used to be bind-mounted out of `infra/` held files whose correct contents
depend on the code version rather than on the deployment, which is what makes them code and not
config:

- `apps/api/sql/publication.sql` names tables a matching migration must already have created.
  A host checkout that drifted from `IMAGE_TAG` would fail outright — or worse, quietly publish
  the wrong set of tables.
- `apps/powersync/sync_rules.yaml` is a query definition against the same schema, down to the
  `user_id` and `deleted_at` columns. Drift here is the more dangerous of the two: it syncs the
  wrong columns while every health probe stays green.

Real per-deployment values live in `.env.prod` instead. `apps/powersync/powersync.yaml` holds
none of them — every varying value is `!env PS_*`, substituted at startup, so the image is
identical across environments. If you ever need a structurally different config (a second
replication connection, say), set `POWERSYNC_CONFIG_B64` to a base64-encoded config; it takes
precedence over the bundled file, no rebuild needed.

Note that `!env` has **no default-value syntax** — an undefined variable is a hard startup
error, not a fallback. Both compose files therefore supply every substituted variable, using
`${VAR:-default}` for the ones that have a sane default (`PS_DATA_SOURCE_SSLMODE`,
`PS_STORAGE_SOURCE_SSLMODE`, `PS_LOG_LEVEL`). Adding an `!env` to `powersync.yaml` means
adding it to both compose files in the same commit, or the service refuses to boot.

`sslmode` defaults to `disable` because both databases are siblings on a private Compose
network. **Point either URI at a managed Postgres and it must become `verify-full`** — that is
the whole reason it is a variable rather than a hardcoded line.

The migration entrypoint assumes a **single API instance**. Several replicas would race;
drizzle wraps each migration in a transaction so the loser exits rather than corrupting
anything, but scaling out wants a dedicated one-shot migration step first.

Exactly three ports are published: `WEB_PORT`, `API_PORT`, `POWERSYNC_PORT`. Neither
database is published at all — reach them with
`docker compose --env-file .env.prod -f compose.prod.yml exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"`.

### Checking on replication

**A healthy PowerSync container does not mean replication is working.** The probes report on
the process, not the WAL stream: drop the publication and `/probes/readiness` still answers
200 while every table silently stops syncing. Replication errors surface in exactly two
places — the container logs, and PowerSync's admin API, which `PS_ADMIN_TOKEN` unlocks:

```bash
curl -s -X POST http://localhost:6101/api/admin/v1/diagnostics \
  -H "Authorization: Bearer $PS_ADMIN_TOKEN" | python3 -m json.tool
```

The two `errors` arrays are the signal — one per connection, one per sync-rule table — plus
`replication_lag_bytes` and `initial_replication_done`. Empty arrays and `connected: true`
mean the stream is genuinely flowing. Poll this rather than the probes if you ever wire up
alerting; PowerSync's own production guidance names it the source of replication issues for
self-hosted instances.

The admin API shares the port with the sync API, so in production `/api/admin/` must not be
reachable from the internet. Block it at whatever terminates TLS — the token is the only
thing standing in front of it otherwise.

### The web image

`apps/mobile/Dockerfile` builds the Expo web target (`web.output: "static"`) into a static
site and serves it with Caddy — no Node at runtime. Caddy handles the two things a plain
file server gets wrong for this app: `try_files` maps extensionless routes onto Expo's
per-route `.html` files (and unknown paths onto the exported `+not-found` page, with a real
404 status), and `/session/<uuid>` is rewritten onto the literal `session/[id].html` that
Expo emits for the dynamic route, so a hard reload or a shared link works and not just
in-app navigation.

**The API and PowerSync URLs are baked into the JS bundle at build time.** Expo inlines
`EXPO_PUBLIC_*` during the export; there is no runtime override, so a container started with
different environment variables still talks to whatever was compiled in. Since the prod stack
pulls a prebuilt image, those URLs are fixed by the release workflow's `EXPO_PUBLIC_API_URL`
and `EXPO_PUBLIC_POWERSYNC_URL` secrets — one published web image serves exactly one origin.
Deploying to a different origin means setting those secrets and publishing again, or building
locally:

```bash
docker build -f apps/mobile/Dockerfile \
  --build-arg EXPO_PUBLIC_API_URL=https://api.example.com \
  --build-arg EXPO_PUBLIC_POWERSYNC_URL=https://sync.example.com \
  -t herytz/workouty-web:local .
```

Both must be reachable **from the user's browser**, not merely from inside the Compose
network — the web app is static JS that calls the API and opens the PowerSync stream
directly, so a Compose hostname like `http://api:3000` would never resolve.

### Before pointing this at the internet

- `SMTP_URL` is required and has no default — the prod stack runs no mail service, so it
  must point at an external relay reachable from the `api` container. Nodemailer builds the
  transport lazily, so a wrong value still starts and still reports healthy; it only fails
  when a mail is actually sent. Trigger a real password reset after deploying instead of
  trusting the healthcheck. (The dev stack keeps Mailpit as a local capture-only sink.)
- Password-reset emails link to `${PUBLIC_WEB_URL}/reset`, but the web app has no `/reset`
  route yet — those links 404 until that screen ships.
- TLS is not handled in the stack. Caddy serves plain HTTP on :80 on the assumption that
  something in front terminates TLS; if you'd rather Caddy do ACME itself, give it a real
  hostname in `apps/mobile/Caddyfile`.
- The API image is 367 MB, nearly all of it the `node:22-alpine` base. Trimming further
  means a distroless or single-binary runtime, which is a bigger change than it sounds — and
  would have to keep `psql`, which the bootstrap entrypoint needs.
