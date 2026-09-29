#!/bin/sh
# The nightly backup (pilot step 26, DEPLOY.md §S5).
#
#   backup.sh         every day at BACKUP_AT_UTC_HOUR (20 UTC = 02:00 Dhaka)
#   backup.sh once    one backup now, then exit:
#                     docker compose -f deploy/docker-compose.yml --env-file deploy/.env run --rm backup once
#
# Each run writes two files to /backups (deploy/backups on the host):
#   db-<stamp>.dump        the whole database, pg_dump's custom format
#   files-<stamp>.tar.gz   the uploaded files (lab reports)
# and removes both kinds older than BACKUP_KEEP_DAYS. A file is written under a
# temporary name and renamed when complete, so a copy taken mid-run never picks
# up half a dump.
#
# Backups hold patient data (FR-SEC-08): copy them to a second machine the
# hospital controls, never to a service outside Bangladesh without the
# hospital's agreement (FR-SEC-07).

set -eu

KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
AT_HOUR="${BACKUP_AT_UTC_HOUR:-20}"

backup_once() {
  stamp="$(date -u +%Y%m%d-%H%M%S)"
  pg_dump --format=custom --no-owner --file="/backups/.db-$stamp.partial"
  mv "/backups/.db-$stamp.partial" "/backups/db-$stamp.dump"
  tar -czf "/backups/.files-$stamp.partial" -C /data/files .
  mv "/backups/.files-$stamp.partial" "/backups/files-$stamp.tar.gz"
  find /backups -maxdepth 1 -name 'db-*.dump' -mtime +"$KEEP_DAYS" -delete
  find /backups -maxdepth 1 -name 'files-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
  echo "backup $stamp written"
}

if [ "${1:-}" = "once" ]; then
  backup_once
  exit 0
fi

while true; do
  now="$(date -u +%s)"
  next="$(date -u -d "today $AT_HOUR:00" +%s)"
  if [ "$next" -le "$now" ]; then
    next="$(date -u -d "tomorrow $AT_HOUR:00" +%s)"
  fi
  sleep "$((next - now))"
  backup_once || echo "backup failed; trying again at the next run" >&2
done
