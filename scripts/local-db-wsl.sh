#!/usr/bin/env bash
# Disposable local development only (FR-SEC-08). Ubuntu 24.04, PostgreSQL 16.
set -euo pipefail
if ! dpkg-query -W -f='${Status}' postgresql-16-postgis-3 2>/dev/null | grep -q 'install ok installed'; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql-16 postgresql-16-postgis-3 postgresql-contrib-16
fi
pg_ctlcluster 16 main start || pg_isready -h 127.0.0.1 -p 5432
cd /tmp
if ! runuser -u postgres -- psql -Atqc "SELECT 1 FROM pg_roles WHERE rolname='healthcare'" | grep -q 1; then
  # Extension creation and test DB rebuilds need a privileged DEVELOPMENT role.
  # This matches Docker's POSTGRES_USER. Never use it for production requests.
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "CREATE ROLE healthcare LOGIN SUPERUSER PASSWORD 'healthcare'"
fi
for database in healthcare_dev healthcare_test healthcare_api_test; do
  if ! runuser -u postgres -- psql -Atqc "SELECT 1 FROM pg_database WHERE datname='$database'" | grep -q 1; then
    runuser -u postgres -- createdb -O healthcare -T template0 --encoding=UTF8 --locale=C.UTF-8 "$database"
  fi
done
echo 'Local PostgreSQL 16 + PostGIS ready in Ubuntu WSL; existing databases preserved.'
