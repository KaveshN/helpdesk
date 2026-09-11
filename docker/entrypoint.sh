#!/bin/sh
# Dev entrypoint: bring the schema up to date, optionally seed, then hand off.
# Compose gates this on the db healthcheck, so Postgres is already accepting
# connections by the time we get here.
set -e

# The generated client lives in src/generated, which compose masks with an
# anonymous volume. Regenerating here keeps it in step with a schema edited on
# the host, instead of failing later with a confusing "unknown field" error.
echo "[entrypoint] generating prisma client"
npx prisma generate

echo "[entrypoint] applying migrations"
npx prisma migrate deploy

if [ "${HELPDESK_AUTO_SEED}" = "true" ]; then
  echo "[entrypoint] seeding (idempotent upserts)"
  npx tsx prisma/seed.ts
fi

echo "[entrypoint] starting: $*"
exec "$@"
