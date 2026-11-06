#!/usr/bin/env bash
# MedLiveBD on a hospital's server, from nothing, in one command
# (DEPLOY.md "Quick start"; FR-SEC-07).
#
#   sudo bash deploy/setup.sh
#
# On a fresh Ubuntu 22.04 or 24.04 server, from the repository's root. It:
#   1. installs Docker if it is not there;
#   2. asks a few questions in plain words (the web address, where the backup
#      copy goes, who the first administrators are) and writes deploy/.env,
#      generating every password and secret itself;
#   3. opens the firewall for the web (80, 443) and SSH only;
#   4. builds and starts everything and waits until it answers;
#   5. creates the platform administrator and the hospital's first
#      administrator, and prints their temporary passwords once.
#
# Run again, it changes nothing that exists: deploy/.env is never overwritten
# (its secrets open the database and the backups), and the administrators
# are created only the first time. A second run is how the stack is started
# again after the machine was rebuilt from the same deploy/.env.
#
# Every question can be answered beforehand in the environment, for an
# unattended run: MEDLIVEBD_DOMAIN, MEDLIVEBD_BACKUP_DIR, MEDLIVEBD_ALERT_URL,
# MEDLIVEBD_HOSPITAL_CODE, MEDLIVEBD_HOSPITAL_NAME_EN, MEDLIVEBD_HOSPITAL_NAME_BN,
# MEDLIVEBD_DIVISION, MEDLIVEBD_DISTRICT, MEDLIVEBD_ADMIN_NAME,
# MEDLIVEBD_ADMIN_EMAIL, MEDLIVEBD_PLATFORM_NAME, MEDLIVEBD_PLATFORM_EMAIL.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
ENV_FILE="$ROOT/deploy/.env"
DONE_MARK="$ROOT/deploy/.setup-done"
COMPOSE=(docker compose -f "$ROOT/deploy/docker-compose.yml" --env-file "$ENV_FILE")

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mSTOPPED: %s\033[0m\n' "$*" >&2; exit 1; }

# ask VAR "question" "default"  — the answer, or what the environment gave.
ask() {
  local var="$1" question="$2" default="${3:-}" answer
  if [ -n "${!var:-}" ]; then return 0; fi
  if [ ! -t 0 ]; then
    [ -n "$default" ] || fail "$var is needed and there is nobody to ask (set it in the environment)."
    printf -v "$var" '%s' "$default"
    return 0
  fi
  if [ -n "$default" ]; then
    read -r -p "$question [$default]: " answer
    answer="${answer:-$default}"
  else
    read -r -p "$question: " answer
  fi
  printf -v "$var" '%s' "$answer"
}

secret() { openssl rand -hex 32; }

# deploy/.env from deploy/.env.example, each KEY= line whose value is given
# in the environment as SET_KEY replaced by it. Read from the environment by
# awk, so no character in an answer means anything to the shell or to sed.
fill_env() {
  awk '
    match($0, /^[A-Z0-9_]+=/) {
      key = substr($0, 1, RLENGTH - 1)
      if (("SET_" key) in ENVIRON) { print key "=" ENVIRON["SET_" key]; next }
    }
    { print }
  ' "$1"
}

# MEDLIVEBD_SKIP_SYSTEM=1: the machine is the IT department's to manage. Docker
# is already installed and the firewall is theirs, so this script neither
# needs root nor touches either (also how it is rehearsed on a workstation).
SKIP_SYSTEM="${MEDLIVEBD_SKIP_SYSTEM:-}"
[ -n "$SKIP_SYSTEM" ] || [ "$(id -u)" -eq 0 ] || fail "run it with sudo: sudo bash deploy/setup.sh"
[ -f "$ROOT/deploy/docker-compose.yml" ] || fail "run it from the MedLiveBD folder (the one with deploy/ in it)."

# --- 1. Docker --------------------------------------------------------------

if ! docker compose version > /dev/null 2>&1; then
  say "Installing Docker (a few minutes)…"
  apt-get update -q
  # Ubuntu's own packages first; Docker's installer if this Ubuntu lacks them.
  if ! apt-get install -y -q docker.io docker-compose-v2 openssl curl; then
    curl -fsSL https://get.docker.com | sh
  fi
  systemctl enable --now docker
fi
docker compose version > /dev/null 2>&1 || fail "Docker did not install. Send the messages above to MedLiveBD."
command -v openssl > /dev/null || apt-get install -y -q openssl

# --- 2. The answers, and deploy/.env ----------------------------------------

if [ -f "$ENV_FILE" ]; then
  say "Using the existing deploy/.env (it is never overwritten)."
else
  say "A few questions. Press Enter to accept what is in [brackets]."
  ask MEDLIVEBD_DOMAIN "The hospital's web address this server will use, e.g. medlive.marksgroup.com.bd"
  MEDLIVEBD_DOMAIN="${MEDLIVEBD_DOMAIN#https://}"
  MEDLIVEBD_DOMAIN="${MEDLIVEBD_DOMAIN#http://}"
  MEDLIVEBD_DOMAIN="${MEDLIVEBD_DOMAIN%/}"
  [ -n "$MEDLIVEBD_DOMAIN" ] || fail "a web address is needed."

  echo
  echo "Backups: every night a full copy is made and checked. One more copy must go to"
  echo "ANOTHER disk (an external drive, or a share from another machine), mounted on this"
  echo "server, so the records survive this disk dying. Give its folder, e.g. /mnt/backup."
  ask MEDLIVEBD_BACKUP_DIR "Folder on the other disk (leave empty only to set it up later)" " "
  MEDLIVEBD_BACKUP_DIR="${MEDLIVEBD_BACKUP_DIR// /}"
  if [ -n "$MEDLIVEBD_BACKUP_DIR" ]; then
    mkdir -p "$MEDLIVEBD_BACKUP_DIR" || fail "cannot make $MEDLIVEBD_BACKUP_DIR"
    if [ "$(df -P "$MEDLIVEBD_BACKUP_DIR" | awk 'NR==2 {print $1}')" = "$(df -P "$ROOT" | awk 'NR==2 {print $1}')" ]; then
      echo "WARNING: $MEDLIVEBD_BACKUP_DIR is on the same disk as this server. That copy will not survive the disk."
    fi
  fi

  echo
  echo "Alerts: where the server should send a message when something needs a person"
  echo "(a Telegram bot link or an ntfy topic; DEPLOY.md S5a). Optional."
  ask MEDLIVEBD_ALERT_URL "Alert link (leave empty for none yet)" " "
  MEDLIVEBD_ALERT_URL="${MEDLIVEBD_ALERT_URL// /}"

  alert_format=json
  case "$MEDLIVEBD_ALERT_URL" in *ntfy*) alert_format=text ;; esac

  umask 077
  SET_APP_ORIGIN="https://app.$MEDLIVEBD_DOMAIN" \
  SET_CONSOLE_ORIGIN="https://console.$MEDLIVEBD_DOMAIN" \
  SET_API_ORIGIN="https://api.$MEDLIVEBD_DOMAIN" \
  SET_POSTGRES_PASSWORD="$(secret)" \
  SET_API_DB_PASSWORD="$(secret)" \
  SET_JWT_ACCESS_SECRET="$(secret)" \
  SET_JWT_REFRESH_SECRET="$(secret)" \
  SET_GUEST_LINK_SECRET="$(secret)" \
  SET_TOTP_ENCRYPTION_KEY="$(secret)" \
  SET_BACKUP_SECOND_DIR="$MEDLIVEBD_BACKUP_DIR" \
  SET_BACKUP_ENCRYPTION_PASSPHRASE="$(secret)" \
  SET_ALERT_WEBHOOK_URL="$MEDLIVEBD_ALERT_URL" \
  SET_ALERT_WEBHOOK_FORMAT="$alert_format" \
  SET_ALERT_SERVER_NAME="MedLiveBD $MEDLIVEBD_DOMAIN" \
    fill_env "$ROOT/deploy/.env.example" > "$ENV_FILE.partial"
  mv "$ENV_FILE.partial" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  umask 022
  say "Written: deploy/.env, with every password made here."
  echo "COPY deploy/.env SOMEWHERE SAFE OFF THIS SERVER NOW (a USB stick in the hospital's safe,"
  echo "or a password manager two people can open). Without it the backups cannot be opened."
fi

value() { sed -n "s/^$1=//p" "$ENV_FILE" | head -n 1; }
APP="$(value APP_ORIGIN)"
CONSOLE="$(value CONSOLE_ORIGIN)"
API="$(value API_ORIGIN)"

# --- The web addresses must point here --------------------------------------

here="$(curl -fsS -4 --max-time 10 https://api.ipify.org 2>/dev/null || true)"
for origin in "$APP" "$CONSOLE" "$API"; do
  name="${origin#https://}"
  points="$(getent ahostsv4 "$name" | awk 'NR==1 {print $1}' || true)"
  if [ -z "$points" ]; then
    echo "WARNING: $name does not exist in DNS yet. Ask whoever runs the domain to point it at ${here:-the public address of this server}."
  elif [ -n "$here" ] && [ "$points" != "$here" ]; then
    echo "WARNING: $name points at $points, not at this server ($here)."
  fi
done

# --- 3. Firewall ------------------------------------------------------------

if [ -z "$SKIP_SYSTEM" ] && command -v ufw > /dev/null; then
  ufw allow OpenSSH > /dev/null
  ufw allow 80/tcp > /dev/null
  ufw allow 443/tcp > /dev/null
  ufw --force enable > /dev/null
  echo "Firewall: only SSH, 80 and 443 are open."
fi

# --- 4. Start ---------------------------------------------------------------

say "Building and starting MedLiveBD (the first time takes 10–20 minutes)…"
"${COMPOSE[@]}" up -d --build

say "Waiting for it to answer…"
for _ in $(seq 1 90); do
  if "${COMPOSE[@]}" exec -T api node -e "fetch('http://127.0.0.1:4000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2> /dev/null; then
    ready=yes
    break
  fi
  sleep 5
done
[ "${ready:-}" = yes ] || fail "it did not become ready. Send the output of: ${COMPOSE[*]} logs --tail 100 migrate api"
echo "Ready."

# --- 5. The first administrators --------------------------------------------

if [ ! -f "$DONE_MARK" ]; then
  say "Now the people who will run it."
  ask MEDLIVEBD_PLATFORM_NAME "Name of the MedLiveBD platform administrator (approves hospitals)"
  ask MEDLIVEBD_PLATFORM_EMAIL "Their email"
  ask MEDLIVEBD_HOSPITAL_CODE "A short code for the hospital, capitals, e.g. MARKS" "MARKS"
  ask MEDLIVEBD_HOSPITAL_NAME_EN "The hospital's name in English"
  ask MEDLIVEBD_HOSPITAL_NAME_BN "The hospital's name in Bangla (Enter to use the English name)" "$MEDLIVEBD_HOSPITAL_NAME_EN"
  ask MEDLIVEBD_DIVISION "Division" "Dhaka"
  ask MEDLIVEBD_DISTRICT "District" "Dhaka"
  ask MEDLIVEBD_ADMIN_NAME "Name of the hospital's administrator (sets up doctors and staff)"
  ask MEDLIVEBD_ADMIN_EMAIL "Their email"

  platform_out="$("${COMPOSE[@]}" exec -T api pnpm --silent staff:create --platform \
    --email "$MEDLIVEBD_PLATFORM_EMAIL" --name "$MEDLIVEBD_PLATFORM_NAME")" \
    || fail "the platform administrator could not be created (is that email already used?)."
  hospital_out="$("${COMPOSE[@]}" exec -T api pnpm --silent staff:create \
    --hospital-code "$MEDLIVEBD_HOSPITAL_CODE" --email "$MEDLIVEBD_ADMIN_EMAIL" --name "$MEDLIVEBD_ADMIN_NAME" \
    --hospital-name-bn "$MEDLIVEBD_HOSPITAL_NAME_BN" --hospital-name-en "$MEDLIVEBD_HOSPITAL_NAME_EN" \
    --kind hospital --division "$MEDLIVEBD_DIVISION" --district "$MEDLIVEBD_DISTRICT")" \
    || fail "the hospital's administrator could not be created."

  # The laboratory starts switched off (pilot-readiness F-08): its orders are
  # priced from the demonstration list until the hospital's own catalogue is
  # loaded. The platform administrator switches it on in the platform's
  # workspace screen (S-B-12) when that is done.
  printf '%s\n' "UPDATE hospital_settings SET modules_off = ARRAY['lab'], updated_at = now()
     WHERE hospital_id = (SELECT id FROM hospitals WHERE code = upper(:'code') AND deleted_at IS NULL);" \
    | "${COMPOSE[@]}" exec -T db sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v code="$0"' "$MEDLIVEBD_HOSPITAL_CODE" \
    || echo "NOTE: the laboratory could not be switched off here; switch it off on the platform screen."
  date -u +%Y-%m-%dT%H:%MZ > "$DONE_MARK"

  say "Done. Write these down now; the passwords are shown only this once."
  echo "$platform_out"
  echo
  echo "$hospital_out"
fi

say "MedLiveBD is running."
echo "  Staff console:  $CONSOLE   (reception, doctors, administration)"
echo "  Patient app:    $APP"
echo "  Health check:   $API/readyz"
echo
echo "Next: sign in at the staff console with the hospital administrator's email and"
echo "temporary password. It asks for a new password and sets up two-step verification"
echo "on their phone. Then Settings: departments, doctors, schedules, counters and staff."
echo "The guide for each step is docs/MARKS_START_HERE.md."
[ -n "$(value BACKUP_SECOND_DIR)" ] || echo "STILL TO DO: a backup disk. Until BACKUP_SECOND_DIR is set in deploy/.env the backup reports itself failing."
[ -n "$(value ALERT_WEBHOOK_URL)" ] || echo "STILL TO DO: alerts. Until ALERT_WEBHOOK_URL is set, somebody must check the server each morning."
