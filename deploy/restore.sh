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
#
# From the second location the files end in .gpg (BACKUP_ENCRYPTION_PASSPHRASE,
# DEPLOY.md §S5): they are decrypted into a temporary folder first, with the
# same passphrase, which must be in deploy/.env.

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

# An encrypted copy is decrypted first, and the restore stops if it does not.
work=""
decrypted=""
decrypt() {
  if [ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
    echo "$1 is encrypted: set BACKUP_ENCRYPTION_PASSPHRASE in deploy/.env to the passphrase it was made with" >&2
    exit 1
  fi
  if [ -z "$work" ]; then
    work="$(mktemp -d)"
    trap 'rm -rf "$work"' EXIT
    mkdir -m 700 "$work/gnupg"
  fi
  decrypted="$work/$(basename "$1" .gpg)"
  if ! printf '%s' "$BACKUP_ENCRYPTION_PASSPHRASE" | GNUPGHOME="$work/gnupg" \
    gpg --batch --quiet --yes --no-tty --pinentry-mode loopback --passphrase-fd 0 \
    --output "$decrypted" --decrypt "$1"; then
    echo "$1 could not be decrypted: is it the passphrase it was made with?" >&2
    exit 1
  fi
}
case "$dump" in *.gpg) decrypt "$dump"; dump="$decrypted" ;; esac
case "$files" in *.gpg) decrypt "$files"; files="$decrypted" ;; esac

echo "restoring $dump into $PGDATABASE on $PGHOST"

# The dump grants to two roles that are the server's, not the database's: the
# government reader (migration 0026) and the role the API connects as
# (`pnpm db:role`). On a server that has run this stack they exist. On a new
# machine — the disk died, which is the day a restore matters — they do not,
# and a grant to a role that is not there stops the restore. Made here without
# a login; the next `up` gives the API's role its password and its limits.
ensure_role() {
  psql -d postgres -v ON_ERROR_STOP=1 -q -v role="$1" <<'SQL'
SELECT format('CREATE ROLE %I NOLOGIN', :'role')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role') \gexec
SQL
}
ensure_role gov_reader
if [ -n "${API_DB_USER:-}" ]; then
  ensure_role "$API_DB_USER"
fi

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
