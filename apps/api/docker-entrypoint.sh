#!/bin/sh
set -e

# Migrations run before the server, in the same container, so a deploy can never serve
# traffic against a schema it wasn't built for. `set -e` means a failed migration aborts
# startup rather than letting the API come up broken.
#
# This assumes a single API instance. Running several replicas would have them race here;
# drizzle's migrator wraps each migration in a transaction, so the loser fails and that
# container exits rather than corrupting anything — but you'd want a dedicated one-shot
# migration step before scaling out.
node /app/dist/migrate.mjs

exec "$@"
