#!/bin/sh
# The nightly backup (pilot step 26; checked and copied since plan 1.7).
# DEPLOY.md §S5.
#
#   backup.sh         every day at BACKUP_AT_UTC_HOUR (20 UTC = 02:00 Dhaka)
#   backup.sh once    one backup now, then exit with its result:
#                     docker compose -f deploy/docker-compose.yml --env-file deploy/.env run --rm backup once
#   backup.sh check   is the last backup good, and recent? One line, and exit 0
#                     or 1. This is the container's health check.
#
# Each run writes to BACKUP_DIR (/backups; deploy/backups on the host):
#   db-<stamp>.dump        the whole database, pg_dump's custom format
#   files-<stamp>.tar.gz   the uploaded files (lab reports)
#   sums-<stamp>.sha256    the checksums of both
# and removes all three kinds older than BACKUP_KEEP_DAYS. A file is written
# under a temporary name and renamed when complete, so a copy taken mid-run
# never picks up half a dump.
#
# A backup is not called good until three things are true:
#   1. the dump has been restored into a scratch database and that database
#      holds at least what the live one held when the dump began
#      (BACKUP_VERIFY_RESTORE=false skips the restore and only reads the
#      archive's table of contents — for a server too small to hold a copy);
#   2. the files archive reads back;
#   3. both have been copied to a second location and their checksums match
#      there. BACKUP_SECOND_DIR is that location inside this container; with
#      none configured the run is recorded as failed, because a backup on the
#      disk it is a backup of does not survive that disk.
#
# The result of every run is written to BACKUP_DIR/.status, which `check`
# reads. A failure is therefore visible in `docker compose ps` as an unhealthy
# container the next morning, not discovered on the day a restore is needed.
#
# Backups hold patient data (FR-SEC-08): the second location is a disk or a
# machine the hospital controls, never a service outside Bangladesh without
# the hospital's agreement (FR-SEC-07).

set -u

DIR="${BACKUP_DIR:-/backups}"
SECOND="${BACKUP_SECOND_DIR:-}"
FILES_DIR="${BACKUP_FILES_DIR:-/data/files}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
AT_HOUR="${BACKUP_AT_UTC_HOUR:-20}"
# A day, and two hours for the run itself and a slow night.
MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-26}"
VERIFY_RESTORE="${BACKUP_VERIFY_RESTORE:-true}"

STATUS="$DIR/.status"
SINCE="$DIR/.since"

# BACKUP_NOW exists for the script's own test, which cannot wait a day.
now() { echo "${BACKUP_NOW:-$(date -u +%s)}"; }

value_of() { sed -n "s/^$1=//p" "$STATUS" 2>/dev/null | head -n 1; }

# --- check -----------------------------------------------------------------

check() {
  at="$(now)"
  limit=$((MAX_AGE_HOURS * 3600))

  if [ ! -f "$STATUS" ]; then
    if [ ! -f "$SINCE" ]; then
      echo "backup FAILING: the backup service has never run here"
      return 1
    fi
    since="$(head -n 1 "$SINCE")"
    if [ $((at - since)) -le "$limit" ]; then
      echo "backup pending: none is due yet"
      return 0
    fi
    echo "backup FAILING: none has completed in $(((at - since) / 3600)) hours"
    return 1
  fi

  result="$(value_of result)"
  finished="$(value_of finished)"
  stamp="$(value_of stamp)"
  reason="$(value_of reason)"

  if [ "$result" != "ok" ]; then
    echo "backup FAILING: ${reason:-the last run did not finish}"
    return 1
  fi

  age=$((at - ${finished:-0}))
  if [ "$age" -gt "$limit" ]; then
    echo "backup FAILING: the last good one ($stamp) is $((age / 3600)) hours old"
    return 1
  fi

  echo "backup ok: $stamp, checked by $(value_of verified), copied to the second location, $((age / 3600)) hours ago"
  return 0
}

# --- one run ---------------------------------------------------------------

write_status() {
  # result, reason, stamp, verified
  {
    echo "result=$1"
    echo "reason=$2"
    echo "stamp=$3"
    echo "verified=$4"
    echo "finished=$(now)"
  } > "$STATUS.partial"
  mv "$STATUS.partial" "$STATUS"
  record_run "$1" "$2" "$3" "$4"
}

# The same result, in the database, where the API reads it for `/readyz`
# (plan I2, migration 0055): the API's container cannot see this volume. As
# the owner, which is who this container connects as. Values go in as psql
# variables, never pasted into the statement. Best effort: when the database
# is what failed, the row cannot be written, and `/readyz` then reports the
# age of the last good one, which is the truth.
record_run() {
  # result, reason, stamp, verified
  printf '%s\n' "INSERT INTO backup_runs (result, reason, stamp, verified)
    VALUES (:'result', NULLIF(left(:'reason', 300), ''), :'stamp', NULLIF(:'verified', ''));" \
    | psql -q -v ON_ERROR_STOP=1 -v result="$1" -v reason="$2" -v stamp="$3" -v verified="$4" > /dev/null 2>&1 \
    || echo "the result could not be recorded in the database; /readyz will report the last one it holds" >&2
}

# `set -e` is switched off inside a function called on the left of `||`, so a
# failed pg_dump used to be followed by "backup written". Every step here says
# what failed and stops the run itself.
backup_once() {
  stamp="$(date -u +%Y%m%d-%H%M%S)"
  dump="$DIR/db-$stamp.dump"
  files="$DIR/files-$stamp.tar.gz"
  sums="$DIR/sums-$stamp.sha256"
  verified="list"

  failed() {
    echo "backup $stamp FAILED: $1" >&2
    rm -f "$DIR/.db-$stamp.partial" "$DIR/.files-$stamp.partial"
    write_status failed "$1" "$stamp" "$verified"
    return 1
  }

  # What the live database held as the dump began. The restored copy must hold
  # at least this much: both only ever grow.
  migrations_before="$(psql -At -c 'SELECT count(*) FROM schema_migrations')" \
    || { failed "the database could not be read"; return 1; }
  events_before="$(psql -At -c 'SELECT count(*) FROM queue_events')" \
    || { failed "the database could not be read"; return 1; }

  pg_dump --format=custom --no-owner --file="$DIR/.db-$stamp.partial" \
    || { failed "pg_dump did not complete"; return 1; }
  mv "$DIR/.db-$stamp.partial" "$dump" || { failed "the dump could not be written"; return 1; }

  tar -czf "$DIR/.files-$stamp.partial" -C "$FILES_DIR" . \
    || { failed "the files could not be archived"; return 1; }
  mv "$DIR/.files-$stamp.partial" "$files" || { failed "the files archive could not be written"; return 1; }

  # 1. The dump restores.
  pg_restore --list "$dump" > /dev/null || { failed "the dump cannot be read back"; return 1; }
  if [ "$VERIFY_RESTORE" = "true" ]; then
    scratch="${PGDATABASE}_backup_check"
    dropdb --if-exists "$scratch" || { failed "the scratch database could not be cleared"; return 1; }
    createdb "$scratch" || { failed "the scratch database could not be made"; return 1; }
    if ! pg_restore --no-owner --exit-on-error -d "$scratch" "$dump" > /dev/null; then
      dropdb --if-exists "$scratch"
      failed "the dump does not restore"
      return 1
    fi
    migrations_after="$(psql -At -d "$scratch" -c 'SELECT count(*) FROM schema_migrations')"
    events_after="$(psql -At -d "$scratch" -c 'SELECT count(*) FROM queue_events')"
    dropdb --if-exists "$scratch"
    if [ "${migrations_after:-0}" -lt "$migrations_before" ] || [ "${events_after:-0}" -lt "$events_before" ]; then
      failed "the restored copy holds less than the database did ($events_after of $events_before queue events)"
      return 1
    fi
    verified="restore"
  fi

  # 2. The files archive reads back.
  tar -tzf "$files" > /dev/null || { failed "the files archive cannot be read back"; return 1; }

  (cd "$DIR" && sha256sum "db-$stamp.dump" "files-$stamp.tar.gz" > "sums-$stamp.sha256") \
    || { failed "the checksums could not be written"; return 1; }

  find "$DIR" -maxdepth 1 -name 'db-*.dump' -mtime +"$KEEP_DAYS" -delete
  find "$DIR" -maxdepth 1 -name 'files-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
  find "$DIR" -maxdepth 1 -name 'sums-*.sha256' -mtime +"$KEEP_DAYS" -delete

  # 3. And it is somewhere else as well.
  if [ -z "$SECOND" ]; then
    failed "written and checked, but only on this disk: no second location is configured (BACKUP_SECOND_DIR)"
    return 1
  fi
  if [ ! -d "$SECOND" ] || [ ! -w "$SECOND" ]; then
    failed "the second location cannot be written to"
    return 1
  fi
  for name in "db-$stamp.dump" "files-$stamp.tar.gz"; do
    cp "$DIR/$name" "$SECOND/.$name.partial" && mv "$SECOND/.$name.partial" "$SECOND/$name" \
      || { failed "the copy to the second location did not complete"; return 1; }
  done
  cp "$sums" "$SECOND/sums-$stamp.sha256" \
    || { failed "the copy to the second location did not complete"; return 1; }
  (cd "$SECOND" && sha256sum -c "sums-$stamp.sha256" > /dev/null) \
    || { failed "the copy in the second location does not match"; return 1; }

  find "$SECOND" -maxdepth 1 -name 'db-*.dump' -mtime +"$KEEP_DAYS" -delete
  find "$SECOND" -maxdepth 1 -name 'files-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
  find "$SECOND" -maxdepth 1 -name 'sums-*.sha256' -mtime +"$KEEP_DAYS" -delete

  write_status ok "" "$stamp" "$verified"
  echo "backup $stamp written, checked by $verified, and copied"
  return 0
}

# --- entry -----------------------------------------------------------------

case "${1:-}" in
  check)
    check
    exit $?
    ;;
  once)
    backup_once
    exit $?
    ;;
esac

# When the service first started on this folder: `check` allows a day from
# here before it calls the absence of a backup a failure.
[ -f "$SINCE" ] || now > "$SINCE"

if [ -z "$SECOND" ]; then
  echo "WARNING: no second location is configured (BACKUP_SECOND_DIR). Backups will be written to this disk only, and reported as failing." >&2
fi

while true; do
  at="$(date -u +%s)"
  next="$(date -u -d "today $AT_HOUR:00" +%s)"
  if [ "$next" -le "$at" ]; then
    next="$(date -u -d "tomorrow $AT_HOUR:00" +%s)"
  fi
  sleep "$((next - at))"
  backup_once || echo "the backup failed; trying again at the next run" >&2
done
