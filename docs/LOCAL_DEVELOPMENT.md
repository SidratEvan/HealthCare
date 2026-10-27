# Local development on master

All data must be synthetic (FR-SEC-08). This guide replaces the old split-worktree
preview workflow. All four services now run from this checkout.

## Windows launcher

Run `./run.ps1 -Background`. Stop with `./run.ps1 -Stop`. Default API: Django;
`-ApiBackend Node` selects the original API on the same database. Stop before
switching. No schema conversion or data copying is needed for rollback.

Requirements: Node 22.19+ (24 recommended), Corepack, Python 3.12+ and PostgreSQL
16 with PostGIS. pnpm and Python dependencies have committed lockfiles.
The launcher reuses a reachable configured local database first, otherwise chooses
Docker when available, then Ubuntu WSL. Options:

```powershell
.\run.ps1 -Background -DatabaseProvider Existing
.\run.ps1 -Background -ApiBackend Node
.\run.ps1 -SetupOnly
.\run.ps1 -Background -SkipInstall
.\run.ps1 -Background -DatabaseProvider WSL -WslDistribution Ubuntu-24.04
```

`Existing` leaves system services to the owner. On this machine the demo database
accepts the development credentials at **localhost:5433**, while 5432 belongs to
another PostgreSQL instance. The ignored `.env` was updated to 5433. Use Existing
here and keep that database running. Do not change the other instance's password.

The launcher creates `.env` from `.env.example` if absent and generates missing
local JWT/guest secrets and the limited API-role password. It refuses remote
databases, production mode and live payments/SMS. It applies SQL migrations, seeds
only an empty database, verifies invariants and starts the API as a limited role.
It does not reset existing demo data. `-SkipInstall` requires both dependency sets
already installed. Logs: `.local/{api,patient,console,site}.log` and `.error.log`.
Process ownership checks include PID, start time and command line.

## Addresses and demo access

| App | Address |
| --- | --- |
| Patient | http://localhost:3000 |
| Staff | http://localhost:3100 |
| Company site | http://localhost:3200/en or /bn |
| API readiness | http://localhost:4000/readyz |

With `DEMO_MODE=true`, use the console's demo access to choose a seeded hospital
and staff role. Use only the demo phone numbers advertised by the app, never real
patient details. Payments and SMS are stand-ins. Do not start the old
`.local/latest-app` preview on these ports simultaneously.

## Manual API startup

```powershell
corepack pnpm install --frozen-lockfile
python -m venv backend/django/.venv
backend/django/.venv/Scripts/python -m pip install -r backend/django/requirements.lock.txt
node scripts/setup-local.mjs --env-only
corepack pnpm db:migrate
corepack pnpm db:role
corepack pnpm db:verify
corepack pnpm dev:django
# Separate terminals: dev:patient, dev:console and dev:site
```

`dev:django` uses root `.env` and the limited database role. Direct uvicorn startup
in `django-migration/deployment.md` instead reads `backend/django/.env`: avoid
mixing these configurations. Node's `dev:api` remains available. Django does not
own tables; use `pnpm db:migrate`, never Django ORM migrations.

## Verification

```powershell
corepack pnpm verify
corepack pnpm build
$env:DATABASE_URL_DJANGO_TEST = 'postgresql://healthcare:healthcare@localhost:5433/healthcare_django_api_test'
corepack pnpm test:django
```

`verify` rebuilds separate local API/schema test databases from `DATABASE_URL_API_TEST`
and `DATABASE_URL_TEST` in `.env`. Django compatibility builds its own database.
Ten original Node cases spy on functions inside the Node process and cannot
observe Python; their Python equivalents are documented in
`django-migration/spy-tests.md`. Report those failures explicitly.

After the compatibility run builds its database, run Python safety and parity:

```powershell
$env:DATABASE_URL = 'postgresql://healthcare_api:test-only-api-role-not-a-real-credential@localhost:5433/healthcare_django_api_test'
Push-Location backend/django
.venv/Scripts/python -m pytest
Pop-Location
Remove-Item Env:DATABASE_URL
```

Browser suites require free ports 3000/3100/4000 and a **disposable local database**;
their global setup truncates and reseeds. Create a separate empty database as the
local development owner, then:

```powershell
.\run.ps1 -Stop
$env:E2E_DATABASE_URL = 'postgresql://healthcare:healthcare@localhost:5433/healthcare_master_e2e'
corepack pnpm test:e2e:django e2e/two-device-queue.spec.ts
# Full suites:
corepack pnpm test:e2e:django
corepack pnpm test:e2e:built
corepack pnpm test:e2e:prod:django
```

Do not target healthcare_dev when its current demo state must be preserved. The
built suite uses Node; the production Django suite builds the frontends too.
Full release gates are in CLAUDE.md. A successful local demo is not authorization
or readiness to serve real patients.

## Troubleshooting

- Occupied ports: stop the checkout that owns them. The launcher refuses to reuse
  unrelated listeners and only terminates its own service trees.
- Password failure: check the port and WSL distribution before changing credentials.
- API timeouts: check database availability and `.local/api.error.log`.
- Windows symlink access error: close project processes and retry installation.
- Missing styles on clean install: shared/ui now declares Tailwind directly;
  reinstall with the frozen lockfile.
- Failed startup: the launcher cleans up the app processes it created, retains
  database data and leaves logs for inspection.

Self-hosting, backups, restore and real-patient gates remain in DEPLOY.md and
django-migration/deployment.md.
