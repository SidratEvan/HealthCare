#!/bin/sh
# Puts a backup back (pilot step 26, DEPLOY.md §S5). Replaces the database and
# the files entirely with the backup's — everything written since is gone.
#
# From the repository root:
#   docker compose -f deploy/docker-compose.yml --env-file deploy/.env stop api console patient
#   docker compose -f deploy/docker-compose.yml --env-file deploy/.env run --rm --entrypoint sh backup \
#     /deploy/restore.sh /backups/db-<stamp>.dump /backups/files-<stamp>.tar.gz
#   docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d
#
# The files archive is optional; without it only the database is restored.

set -eu

dump="${1:-}"
files="${2:-}"

if [ -z "$dump" ] || [ ! -f "$dump" ]; then
  echo "usage: restore.sh /backups/db-<stamp>.dump [/backups/files-<stamp>.tar.gz]" >&2
  exit 1
fi
if [ -n "$files" ] && [ ! -f "$files" ]; then
  echo "no such files archive: $files" >&2
  exit 1
fi

echo "restoring $dump into $PGDATABASE on $PGHOST"
# Nothing may hold the database open while it is replaced.
psql -d postgres -v ON_ERROR_STOP=1 -q -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$PGDATABASE' AND pid <> pg_backend_pid();" >/dev/null
dropdb --if-exists "$PGDATABASE"
createdb "$PGDATABASE"
pg_restore --no-owner --exit-on-error -d "$PGDATABASE" "$dump"

if [ -n "$files" ]; then
  echo "restoring files from $files"
  find /data/files -mindepth 1 -delete
  tar -xzf "$files" -C /data/files
fi

echo "restored"
