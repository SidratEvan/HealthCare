# Deploying the Django API

For the Python developer who will run it. The Django API is a drop-in for the
Node API: same address, same paths, same socket, same database, same
variables. Nothing here has been deployed; the Node API is still what every
environment runs (CLAUDE.md §4.6: no deployment without the owner's word).

## What runs where

| Piece | With the Django API |
|---|---|
| Database | Unchanged: PostgreSQL 16 + PostGIS, the schema of `database/migrations` |
| Schema changes | Unchanged: `pnpm db:migrate` (the SQL ledger) and `pnpm db:role` (the API's limited role), run by the `migrate` service from the Node image |
| API | `backend/django`, uvicorn on port 4000: HTTP and Socket.IO on one port, the background jobs in the same process |
| Web apps, web server, backups | Unchanged (`deploy/docker-compose.yml`, `deploy/Caddyfile`, `deploy/backup.sh`, `deploy/restore.sh`) |
| First administrator | `pnpm staff:create` from the Node image, through the `tools` service (below), not `exec api` as `DEPLOY.md` S3 says for the Node API: the Django container has no pnpm. Passwords and TOTP seals are the same format in both APIs, so an account made by either signs in to both |

Run **one** API process with `RUN_BACKGROUND_JOBS=true` (the default). A second
process beside it sets it to `false`, or the schedules and the message sender
would run twice. The rate limiter is per process, as in Node.

## Local development

```bash
docker start healthcare-db                     # the local PostGIS container
cd backend/django
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.lock.txt    # bin/ on Linux
cp .env.example .env                           # local values; edit DATABASE_URL
.venv/Scripts/python -m uvicorn medlive.asgi:application --port 4000 --no-proxy-headers
```

The web apps (`pnpm dev:console`, `pnpm dev:patient`) need no change: they talk
to whatever answers on port 4000.

## Tests

```bash
cd backend/django && .venv/Scripts/python -m pytest      # 220 tests, ~30 s
pnpm exec vitest run -c vitest.django.config.ts            # the Node suite against Django, ~18 min
pnpm exec playwright test -c playwright.django.config.ts   # the browser suites against Django
```

One at a time: the first two share `healthcare_django_api_test`, the third
holds ports 3000, 3100 and 4000.

## On a server

The self-hosted stack (`DEPLOY.md` Part S) with one more file:

```bash
cp deploy/.env.example deploy/.env      # once, then fill it in (DEPLOY.md S2)
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.django.yml \
  --env-file deploy/.env up -d --build
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.django.yml ps
```

`deploy/docker-compose.django.yml` replaces the `api` service's image with
`backend/django/Dockerfile`; every other service is the one in
`deploy/docker-compose.yml`. The `migrate` service still builds the Node image,
because the schema tool is part of it.

### The operator's commands

`DEPLOY.md` S3 runs `pnpm staff:create`, `pnpm doctor:verify` and
`pnpm staff:reset-2fa` with `exec api`. With the Django API they run in the
`tools` service of `deploy/docker-compose.django.yml` instead (the Node image,
the API's variables and database role, started only when asked for):

```bash
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.django.yml \
  --env-file deploy/.env run --rm tools \
  pnpm staff:create --hospital-code MARKS --email admin@hospital.com.bd --name "Full Name" \
  --hospital-name-bn "…" --hospital-name-en "…" --kind hospital --division Dhaka --district Dhaka
```

### Trying it on one machine

Origins without a port (`http://app.localhost`, `http://console.localhost`,
`http://api.localhost`) and `HTTP_PORT=80`. Caddy listens on the port an
origin names, inside its container, while compose publishes the container's
80 and 443, so an origin such as `http://app.localhost:8080` is served on a
port nothing publishes. A real server uses 80 and 443 and is not affected.
From Git Bash on Windows, set `MSYS_NO_PATHCONV=1` before a command that names
a path inside a container (`/deploy/backup.sh`), or Git Bash rewrites it.

### Health checks

- `GET /healthz`: the process is up.
- `GET /readyz`: 200 when the database answers as the API's role, with its
  latency and schema version; 503 (`degraded`) when it does not. Its
  `signals` report, without failing the probe, the last backup against
  `BACKUP_MAX_AGE_HOURS`, the messages waiting to be sent, and the
  background jobs' last runs. The container's health check asks this, and
  the web apps and web server wait for it.

### Logs

One JSON line per request and per event on standard output, the same fields
as the Node API's pino lines (`medlive/core/logging.py`). Docker keeps 50 MB
per container (`x-logging` in the compose file). No patient identifier, OTP,
token or payment reference is written (CLAUDE.md §7; `tests/api/test_sms_redaction.py`).

```bash
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.django.yml logs -f api
```

### Backups and restore

Unchanged: the `backup` service dumps the database and the files every night,
proves the dump restores, and copies it to a second location; `restore.sh`
puts one back (`DEPLOY.md` S5). The API does not take part, so they are the
same for either API.

## Rollback

The two APIs share the database, the schema and the variables, and neither
changes the schema, so going back is starting the Node API instead:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build api
```

No data is migrated either way. Sign-ins survive the switch (the tokens are
interchangeable), and a queue mid-session carries on from its event log.
Clients reconnect their sockets on their own.

## Troubleshooting

| Symptom | Look at |
|---|---|
| The container exits at start with `Environment is not valid` | The listed variables. The refusals are the Node API's: short secrets, a non-local database outside production, `SMS_PROVIDER=http` without its URL, and so on |
| `/readyz` answers 503 | The database is not answering as the API's role: is `migrate` finished, is `API_DB_PASSWORD` the one in `deploy/.env`. The reason is in the API's log (`readiness probe failed`), never in the answer |
| `/readyz` is 200 but `signals` warn | A backup older than `BACKUP_MAX_AGE_HOURS`, messages stuck waiting, or a background job that has stopped reporting |
| `couldn't get a connection after 5.00 sec` in the log | The connection pool (`DATABASE_POOL_MAX`, 20 on a server) is exhausted. Every request, socket task and job tick returns its connection when done (`medlive/urls.py`, `realtime/server.py`, `services/jobs.py`); a new worker thread that touches the database must do the same |
| Patients' screens stop updating while the console works | The socket: the web server must pass `/socket.io/` upgrades to port 4000 (`deploy/Caddyfile` does). `INFO: connection open` lines in the API log show sockets arriving |
| Messages or schedules happen twice | Two API processes with `RUN_BACKGROUND_JOBS=true` |
| A Windows development machine logs `ConnectionResetError: [WinError 10054]` | Harmless: the asyncio event loop on Windows reporting a client that closed its socket |
