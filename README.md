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
docker compose up -d --wait
pnpm --filter @workouty/api db:migrate
docker compose exec -T postgres psql -U workouty -d workouty < infra/postgres/publication.sql
docker compose restart powersync
docker compose exec -T postgres psql -U workouty -d workouty < infra/postgres/seed-exercises.sql
pnpm test
pnpm --filter @workouty/api test:int
```

This brings up four Compose services, all with healthchecks (`docker compose up -d --wait`
blocks until every one of them reports healthy):

- `postgres` — the app's source of truth (127.0.0.1:5432), running with `wal_level=logical`
  so PowerSync can replicate from it.
- `ps-storage` — PowerSync's own bucket storage database (127.0.0.1:5433). Unrelated to the
  app schema; PowerSync manages its own `powersync` schema here.
- `powersync` — the self-hosted PowerSync sync service (0.0.0.0:8080).
- `mailpit` — a local SMTP sink for outgoing email. Web inbox at http://localhost:8025.

Two things about this sequence are not obvious and are easy to get wrong:

- **Ordering matters.** The publication (`infra/postgres/publication.sql`) names specific
  tables, so those tables must already exist — run `db:migrate` first. PowerSync only reads
  the publication when it starts, so after creating/replacing it you must
  `docker compose restart powersync` or it keeps replicating against the old (or absent)
  publication.
- **`test:int` requires the stack to be running, `pnpm test` does not.** The integration
  suites connect to the real `postgres` and `mailpit` containers (via `DATABASE_URL` and
  `SMTP_URL` in `.env`) — `migrate.int.test.ts` among them, which checks that the `powersync`
  publication contains exactly the seven expected tables. If the stack is down you'll see a
  connection-refused error, not a broken test; bring it up first.
- **The built-in exercise library is a server seed, not client data.** `infra/postgres/
  seed-exercises.sql` inserts ~20 global exercises (`user_id IS NULL`) that sync to every
  client via the `global_exercises` bucket — the client can never create these itself (the
  upload service forces `user_id` from the JWT). The seed is idempotent (`ON CONFLICT`
  against the partial unique index on `name` where `user_id IS NULL`), so it's safe to re-run;
  run it any time after the publication step.

### Test layers

Tests are split by what infrastructure they need, because CI runs on a plain runner with no
Compose stack. A file's suffix decides which layer it belongs to, so a new test lands in the
right one by name alone:

| Command | Covers | Needs |
| --- | --- | --- |
| `pnpm test` (`pnpm -r test`) | everything without a suffix | nothing |
| `pnpm --filter @workouty/api test:int` | `*.int.test.ts` | `postgres`, `mailpit` |
| `pnpm --filter @workouty/api test:e2e` | `*.e2e.test.ts` — boots a Nest app | `postgres`, `mailpit` |
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

Repository settings the workflows expect:

- Secrets `DOCKER_USER` and `DOCKER_TOKEN` — a Docker Hub account with push rights to both
  repositories. Without them, only the image jobs fail; the tag and Release still happen.
- Variables `PUBLIC_API_URL` and `PUBLIC_POWERSYNC_URL` — the URLs **the browser** will use.
  Expo inlines them into the bundle at build time, so the published web image is
  origin-specific and cannot be repointed with runtime environment variables. Leave them
  unset and the image is built against `localhost`, which is useful only for local runs.
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
docker compose --env-file .env.prod -f compose.prod.yml up -d --build --wait
```

That's the entire setup. Unlike the dev stack, there is no follow-up checklist. The API
applies drizzle migrations from its own entrypoint (`apps/api/docker-entrypoint.sh`) before
the server starts, so a container can never serve traffic against a schema it wasn't built
for. `db-bootstrap` then applies the PowerSync publication and the global exercise seed, and
`powersync` is gated on it completing — so the "restart PowerSync after changing the
publication" trap from the dev instructions above cannot happen here. `--wait` returns once
every long-running service reports healthy.

The migration entrypoint assumes a **single API instance**. Several replicas would race;
drizzle wraps each migration in a transaction so the loser exits rather than corrupting
anything, but scaling out wants a dedicated one-shot migration step first.

Exactly three ports are published: `WEB_PORT`, `API_PORT`, `POWERSYNC_PORT`. Neither
database is published at all — reach them with
`docker compose --env-file .env.prod -f compose.prod.yml exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"`.

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
different environment variables still talks to whatever was compiled in. `PUBLIC_API_URL`
and `PUBLIC_POWERSYNC_URL` in `.env.prod` are wired to Compose *build args*, which means
changing either requires a rebuild:

```bash
docker compose --env-file .env.prod -f compose.prod.yml up -d --build web
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
- The API image is 359 MB, nearly all of it the `node:22-alpine` base. Trimming further
  means a distroless or single-binary runtime, which is a bigger change than it sounds.
