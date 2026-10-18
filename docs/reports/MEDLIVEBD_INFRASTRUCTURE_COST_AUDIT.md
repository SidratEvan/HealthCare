# MedLiveBD — Infrastructure, Architecture & Operating Cost Audit (October 2026)

**Prepared:** 9 October 2026, from the repository at commit `ca88c47` (branch `mvp`).
**Method:** read-only. I read the code, the deployment files and the project documents, and ran read-only size queries against the local development database, which holds only synthetic demo data. Nothing was changed, deployed or bought. No secret values were opened or copied. The only file written is this report.
**Readers:** the founder, and a technical advisor helping with infrastructure and cost decisions.

### How to read the labels

| Label | Meaning |
|---|---|
| **VERIFIED** | Seen directly in code, configuration or a measurement, with the file named |
| **DOCUMENTED** | Stated in the project's own documents and consistent with the code, but not something I could check independently (for example, what happened on a past deployment day) |
| **ASSUMPTION** | My working figure, used for an estimate. Change it and the estimate changes |
| **UNKNOWN** | Cannot be determined from the repository: account plans, billing, contracts, what a vendor will quote |

Three states of the product are kept apart throughout:

- **CURRENT DEMO**: what runs today on Supabase, Render and Vercel with synthetic data.
- **IMPLEMENTED (not yet production-verified)**: code that exists and passes its tests, but has never served a real hospital or run on real Bangladeshi hosting.
- **PLANNED / NOT IMPLEMENTED**: described in documents, absent from the code.

Passing automated tests is **not** treated here as proof of operational readiness.

---

## Contents

1. [What exactly have we built?](#part-1--what-exactly-have-we-built)
2. [Current hosting and deployment](#part-2--current-hosting-and-deployment)
3. [Database architecture](#part-3--database-architecture)
4. [Authentication and security](#part-4--authentication-and-security)
5. [Bangladesh production hosting](#part-5--bangladesh-production-hosting)
6. [External services and hidden costs](#part-6--external-services-and-hidden-costs)
7. [Multi-hospital scalability](#part-7--multi-hospital-scalability)
8. [Production readiness and operations](#part-8--production-readiness-and-operations)
9. [Financial and infrastructure planning](#part-9--financial-and-infrastructure-planning)
10. [Founder-friendly executive report](#part-10--founder-friendly-executive-report)
11. [Evidence appendix](#evidence-appendix)

---

## Part 1 — What exactly have we built?

### 1.1 The pieces

MedLiveBD is one code repository (a "monorepo") holding several programs that share code. **VERIFIED** (`pnpm-workspace.yaml`, each `package.json`).

| Piece | Folder | What it is, in plain words | State |
|---|---|---|---|
| **Patient app** | `frontend/patient` | The website patients use on their phones: search hospitals and doctors, book a serial, watch the live queue. It can be "installed" on a phone home screen like an app (a PWA, Progressive Web App). Built with Next.js 16 / React 19. Bangla first | IMPLEMENTED |
| **Hospital console** | `frontend/console` | The website hospital staff use: reception, doctor, ward, emergency, lab, pharmacy, hospital admin, and the platform administrator screen. Designed to keep working briefly when the internet drops (offline-first) | IMPLEMENTED |
| **Marketing site** | `frontend/site` | A README and a `package.json` only. No pages | NOT IMPLEMENTED |
| **API server** | `backend/api` | The central program. Every screen talks to it. It holds the business rules, writes to the database, pushes live updates, sends messages and runs the timed jobs. Express 5 + Socket.IO on Node.js | IMPLEMENTED |
| **Workers** | `backend/workers` | Intended home for background jobs. Currently an empty placeholder (`export {}`). The jobs that exist run **inside the API server** instead | PLACEHOLDER |
| **Shared "brain"** | `shared/domain` | The queue rules (the "reducer"), estimates, validation. Used unchanged by both the API and the console, so they cannot disagree about a queue | IMPLEMENTED |
| **Shared client** | `shared/client` | Code the web apps use to call the API, receive live updates, and store unsent actions on the device (IndexedDB via the Dexie library) | IMPLEMENTED |
| **Design system, translations** | `shared/ui`, `shared/i18n` | Buttons, colours, Bangla/English text | IMPLEMENTED |
| **Database package** | `database` | 61 migration files (numbered to 0063), demo seed data, schema checks, the script that creates the API's limited database account | IMPLEMENTED |
| **Self-host bundle** | `Dockerfile`, `deploy/` | Container definitions to run everything on one Linux server: database, API, two web apps, web server with automatic HTTPS, nightly backup | IMPLEMENTED, never run on a real hospital or Bangladeshi server (DOCUMENTED, `docs/STATUS.md` *Pilot readiness*) |

### 1.2 What runs all the time, and what runs only when triggered

**Must run continuously (VERIFIED, `deploy/docker-compose.yml`, `backend/api/src/server.ts`):**

| Process | Why it must stay up |
|---|---|
| PostgreSQL database | All data |
| API server | Every screen depends on it. It also runs these timers in the same process: |
| — message sender | every 5 seconds: sends due SMS, retries failures (`notificationSender.service.ts`) |
| — offer timer | every 30 seconds: expires unanswered "a slot opened, do you want it?" offers (`queueTimers.service.ts`) |
| — payment hold timer | every 30 seconds: releases serials whose online payment never completed (`paymentHolds.service.ts`) |
| — hourly jobs | creates the next 8 days of doctor chambers from weekly schedules; deletes imported raw rows after 30 days; deletes SMS text after 90 days (`jobs.service.ts`) |
| Patient app server | Pages are rendered by a Node server on every request (`export const dynamic = 'force-dynamic'` in both layouts, required by the per-request security nonce). **They cannot be hosted as plain static files** |
| Console app server | Same |
| Web server (Caddy) | Self-host only: HTTPS certificates and routing for the three addresses |
| Backup container | Self-host only: sleeps until 02:00 Dhaka, then backs up |

**Run only when triggered (VERIFIED):**

| Process | Trigger |
|---|---|
| `migrate` (schema changes + limited DB account) | Every time the self-hosted stack is started or updated |
| `pnpm staff:create`, `doctor:verify`, `staff:reset-2fa` | An operator types it on the server |
| `pnpm mapping:try` | An operator testing the optional AI import helper |
| `pnpm db:reset` (demo data rebuild) | Demo only. Refuses to run when `NODE_ENV=production` |
| **Daily demo refresh** | A Windows Task Scheduler job **on the founder's own PC** (`database/scripts/demo-refresh.ps1`) that rebuilds the public demo's data daily. DOCUMENTED as re-enabled on 9 October |

### 1.3 How the patient app and the hospital console talk

They **never talk to each other directly**. Both talk only to the API. **VERIFIED.**

1. **Ordinary requests** (book, search, sign in, tap "next patient"): HTTPS calls to `https://<api>/api/v1/...`.
2. **Live updates**: a long-lived Socket.IO connection to the same API address (WebSocket, falling back to repeated HTTP "polling" where a mobile network blocks WebSockets: `transports: ['websocket', 'polling']` in `realtime/server.ts`).
3. When reception taps **next**, the API writes an event to the `queue_events` table, recalculates the queue, and after the database commit broadcasts a `queue.updated` message to everyone in that chamber's "room". Staff get the full queue; patients get a copy with every name and ID replaced by an anonymous ticket (`BACKEND.md` §6).
4. The project's target is under 2 seconds from tap to patient phone (`PRD.md` NFR-01). A browser test (`e2e/two-device-queue.spec.ts`) enforces it, and the 9 October smoke test on the deployed demo measured 1,276 ms and 464 ms (DOCUMENTED, `docs/DEPLOY.md` §7).

**Rooms** (VERIFIED, `BACKEND.md` §6): one per chamber for staff, one per chamber for patients, one per patient, and per hospital for beds, emergency, lab and admin.

### 1.4 Background work, notifications, uploads, scheduled tasks

- **No separate job system.** `pg-boss` (a Postgres-backed job queue) is named in the design but **not installed** (`render.yaml` comment; `backend/workers/src/index.ts` is empty). Timers run inside the API process. The message sender claims rows with `FOR UPDATE SKIP LOCKED`, so two API processes would not double-send. VERIFIED.
- **Notifications are SMS only.** Push notifications are designed but the adapter only ever records "skipped" (`adapters/push.ts`). No email is sent anywhere in the code (I found no mail library or SMTP usage). VERIFIED.
- **SMS** goes through a swappable "adapter": `log` (writes a line to the log, sends nothing: the demo and the current self-host default), `http` (a generic aggregator over HTTPS, built against a stand-in and never against a real company), `local` (refuses everything). VERIFIED, `adapters/sms.ts`, `adapters/smsHttp.ts`.
- **File uploads** (lab reports up to 10 MB, patient documents up to 8 MB; VERIFIED in `shared/domain`): stored by a storage adapter. `mock` keeps files **in the API's memory** (lost on restart; this is what the demo uses). `local` writes them to the server's disk (self-host). A `supabase` option appears in the settings list but **has no implementation**: choosing it makes every upload fail (`adapters/storage.ts`, `UnconfiguredStorageAdapter`). VERIFIED.
- **Files are only reachable through signed links that expire** (15 minutes by default). VERIFIED.

### 1.5 Hidden dependencies on outside platforms

| Dependency | When it matters | Notes |
|---|---|---|
| **GitHub** | Source code, CI tests (GitHub Actions, `.github/workflows/ci.yml`), and the trigger for Render and Vercel deploys | Self-host deploys with `git clone` / `git pull`, so GitHub must be reachable from the server |
| **npm registry** | Every install and image build | Needed at build time, not at run time |
| **Google Fonts** | At **build** time only: `next/font/google` downloads Anek Bangla and Tiro Bangla and bundles them into the app (`frontend/*/src/app/fonts.ts`) | A server building the apps needs internet access to Google. Patients' phones never contact Google for fonts |
| **Docker Hub** | Self-host: pulls `node:24-bookworm-slim`, `postgis/postgis:16-3.4`, `caddy:2` | Anonymous pull limits may apply |
| **Let's Encrypt** | Self-host: free HTTPS certificates through Caddy | Needs ports 80/443 reachable from the internet and public DNS names |
| **The founder's Windows PC** | Demo only: the daily data refresh, and the pre-release backup file in `%LOCALAPPDATA%` | If that PC is off, the demo's "today" goes stale |
| **Anthropic API** | Only if `MAPPING_PROVIDER=claude` is switched on (off by default) | Sends column headings and column profiles of an import file to a server outside Bangladesh. Never a patient row (`FR-IMP-17`) |
| **Google Maps** | A plain link (`google.com/maps/dir/?...`) that opens directions on the patient's phone (`frontend/patient/src/lib/emergency.ts`) | No API key, no billing |
| **Supabase, Render, Vercel** | Demo only | See Part 2 |

Not used despite appearing in settings or design documents: **Supabase Auth, Supabase Storage, Supabase Realtime, Sentry, Web Push, Redis, pg-boss, a maps/routing API, any email service.** VERIFIED by code search.

### 1.6 Architecture diagram

**Current demo**

```
  Patient phone (browser/PWA)            Staff browser (console)
          |  HTTPS + Socket.IO                 |  HTTPS + Socket.IO
          v                                    v
  +------------------+                 +------------------+
  | Vercel           |                 | Vercel           |
  | patient app      |                 | console app      |
  | (Next.js server) |                 | (Next.js server) |
  +------------------+                 +------------------+
          \  pages only; data calls go straight to the API  /
           \                                               /
            v                                             v
           +-----------------------------------------------+
           | Render (Singapore), free plan                 |
           | API: Express + Socket.IO + timers             |
           | SMS = log only, payments = mock, files = RAM  |
           +-----------------------------------------------+
                               |  Postgres (session pooler)
                               v
           +-----------------------------------------------+
           | Supabase (Singapore): PostgreSQL 17 only      |
           +-----------------------------------------------+
                               ^
                               |  daily reset of demo data
           +-----------------------------------------------+
           | Founder's Windows PC (Task Scheduler)         |
           +-----------------------------------------------+
```

**Self-hosted / production design (one Linux server)**

```
   Internet (patients, staff)
          |  ports 80/443
          v
  +--------------------------------------------------------------+
  |  ONE LINUX SERVER (Docker Compose, deploy/docker-compose.yml) |
  |                                                              |
  |  [web] Caddy: HTTPS for app.*, console.*, api.*              |
  |     |               |                 |                      |
  |     v               v                 v                      |
  |  [patient]:3000  [console]:3100    [api]:4000 ---- timers    |
  |  Next.js         Next.js           Express+Socket.IO         |
  |                                     |   files volume         |
  |                                     v                        |
  |                                  [db] PostGIS 16             |
  |                                     ^                        |
  |  [migrate] runs once per start -----+                        |
  |  [backup] nightly: dump + files -> ./backups                 |
  |                     \-> BACKUP_SECOND_DIR (another disk)     |
  +--------------------------------------------------------------+
          |  (optional, when switched on)
          v
   SMS aggregator over HTTPS    bKash / Nagad    Anthropic API (headings only)
```

---

## Part 2 — Current hosting and deployment

### 2.1 Where each piece runs today (the public demo)

| Component | Host | Evidence | Plan / cost |
|---|---|---|---|
| Database | **Supabase**, region ap-southeast-1 (Singapore), PostgreSQL 17.6 | `docs/DEPLOY.md` §1, §7; `docs/STATUS.md` *Environments* | **Free plan**, DOCUMENTED ("On Supabase's free plan there is no point-in-time recovery", `DEPLOY.md` §7.3). Billing itself UNKNOWN |
| API | **Render**, Singapore, web service | `render.yaml` (`plan: free`) | **Free**, consistent with the documented cold starts ("the first request after fifteen minutes idle takes thirty seconds", `DEPLOY.md` §2.2). Note `DEPLOY.md` says the live service was set up by hand and does not read every line of `render.yaml`, so the dashboard plan is UNKNOWN |
| Patient app | **Vercel** | `frontend/patient/vercel.json`; live URL `healthcare-patient-zeta.vercel.app` (DOCUMENTED) | Plan UNKNOWN |
| Console | **Vercel** | `frontend/console/vercel.json`; `healthcare-console.vercel.app` | Plan UNKNOWN |
| Domain / DNS | None. Uses free `*.vercel.app` and `*.onrender.com` names | `PLATFORM_DOMAIN` empty; `docs/PLATFORM_PLAN.md` X3 | **Free** (no domain owned) |
| CDN / static files | Vercel's built-in network for the two apps | Default Vercel behaviour | Included in Vercel plan (UNKNOWN which) |
| File storage | **API memory** (`STORAGE_PROVIDER` unset → `mock`) | `env.ts` default; `render.yaml` sets nothing | Free, and every uploaded file disappears when Render restarts or sleeps the service |
| Background workers | Inside the Render API process | `server.ts` | No extra service |
| WebSockets | Socket.IO on the Render API | `realtime/server.ts` | Included |
| Logging | Render's log viewer (whatever it retains) | Pino logs to stdout | Render's retention on the free plan UNKNOWN |
| Monitoring / error tracking | None | `SENTRY_DSN` unused; no alerting configured | — |
| CI | GitHub Actions: 3 jobs on every push to `main`/`mvp` | `.github/workflows/ci.yml` | Account plan and minutes UNKNOWN |
| Demo data refresh | Founder's Windows PC | `database/scripts/demo-refresh.ps1` | Free; depends on that PC |
| Backups | Supabase's own (plan-dependent) + one manual `pg_dump` kept on the founder's PC | `DEPLOY.md` §7.3 | — |

**What the demo is configured as (VERIFIED, `render.yaml`):** `NODE_ENV=development` on purpose (the code refuses to start with demo mode under `production`), `DEMO_MODE=true`, `SMS_PROVIDER=log`, `PAYMENT_PROVIDER=mock`, `TRAVEL_TIME_MODE=static`. Anyone with the console link can enter any console, platform administrator included, without a password. The screen says so, and `DEPLOY.md` §6 states it plainly.

**The demo's API connects to Supabase as the database owner** (DOCUMENTED, `DEPLOY.md` §7.2 and §7.5). Hospital-separation rules in the database therefore **do not apply on the demo**. The application's own checks still do. That is acceptable for synthetic data. Moving the demo to the limited account is written up as optional (`DEPLOY.md` §7.5) and not done.

### 2.2 What is needed for the demo versus for production

| Need | Demo | Production (real patients) |
|---|---|---|
| Supabase | Yes (database) | **No.** Real patient data must be in Bangladesh (`PRD.md` FR-SEC-07). Supabase's nearest region used is Singapore |
| Render | Yes (API) | **No** (Singapore; same reason) |
| Vercel | Yes (web apps) | **No** under the current design: the apps are served from the Bangladeshi server by Caddy. Vercel holds no patient data itself, but the apps are configured to call one API address, and the self-host bundle includes them |
| A Bangladeshi server | No | **Yes** |
| A domain + DNS | No | **Yes** (three names at minimum) |
| SMS aggregator | No | **Yes for the patient app.** Optional only for a counter-only pilot (see Part 4) |
| bKash / Nagad | No | Only if online payment is wanted; `PAYMENT_PROVIDER=off` (pay at the hospital) is supported |
| GitHub | Yes (deploy trigger) | Yes for updates (the server pulls code), unless images are built elsewhere |

---

## Part 3 — Database architecture

### 3.1 Engine and version

- **PostgreSQL with the PostGIS extension.** Self-host and local development use the image `postgis/postgis:16-3.4` (PostgreSQL 16, PostGIS 3.4). The demo runs on Supabase's PostgreSQL 17.6. VERIFIED (`deploy/docker-compose.yml`, `docker-compose.yml`, `DEPLOY.md` §7).
- Migration 0062 uses `ALTER TYPE … ADD VALUE` inside a transaction, which needs PostgreSQL 12 or later (DOCUMENTED, `DEPLOY.md` §7.2). Practical floor: **PostgreSQL 16 with PostGIS**, the version everything is tested on.

### 3.2 Extensions used

VERIFIED (`database/migrations/0001_extensions.sql`), all installed into a schema named `extensions`:

| Extension | Purpose |
|---|---|
| `pgcrypto` | Random UUIDs, hashing |
| `uuid-ossp` | UUID helpers |
| `postgis` | Hospital locations, emergency "nearest hospital" search |
| `cube` + `earthdistance` | Distance maths |

All are standard, free and open source, and shipped in the `postgis/postgis` image.

### 3.3 Does it need Supabase?

**No.** VERIFIED:

- The migrations contain **no** Supabase-specific SQL: no `auth.uid()`, no `auth.users`, no `storage.objects`, no `pg_cron`, no `pg_net`, no Supabase realtime. (Searched all 61 files.)
- The API connects with an ordinary Postgres connection string through the `pg` driver (`config/db.ts`).
- Supabase is used **only as a hosted PostgreSQL** for the demo.
- Hospital separation uses the project's own session settings (`app.scope`, `app.hospital_id`), not Supabase's login system (`DATABASE.md` §5.2). The older table at the top of `DATABASE.md` §5 still mentions `auth.uid()`; the document itself says that was the original intent and §5.2 onward is what is built.
- **It already runs on ordinary PostgreSQL**: the local container, CI and the self-host bundle all use plain `postgis/postgis`.

One Supabase-specific detail exists only in configuration: the demo must use Supabase's **session pooler (port 5432)**, not its transaction pooler (6543), because the schema relies on a per-connection search path (`render.yaml`, `.env.example`).

### 3.4 Migrations

- 61 SQL files, numbered 0001–0063 (0014 and 0015 do not exist). Applied in order by `pnpm db:migrate`, each in its own transaction, **forward-only** (no automatic "undo"). VERIFIED (`database/scripts/migrate.ts`, `DATABASE.md` §7).
- Self-host runs migrations automatically on every `docker compose up` (the `migrate` service). The API waits for it.
- Known gap: `db:verify` does not detect **missing** migrations (DOCUMENTED lesson, `DEPLOY.md` §7).

### 3.5 Connection pooling

- The API keeps its own pool: default 10 connections (`DATABASE_POOL_MAX`), 20 in the self-host compose file. Every query is capped at 15 seconds; a connection that cannot be obtained in 5 seconds fails rather than queues. VERIFIED (`config/db.ts`, `deploy/docker-compose.yml`).
- No external pooler (such as PgBouncer) in the self-host stack. Postgres's default is 100 connections. For one API process that is ample.

### 3.6 Backups and restore

| Where | What exists | State |
|---|---|---|
| Demo (Supabase) | Supabase's plan-dependent backups (free plan: no point-in-time recovery). One manual dump taken 9 October, stored on the founder's PC, restored into a scratch database and checked | DOCUMENTED |
| Self-host | Nightly at 02:00 Dhaka (`BACKUP_AT_UTC_HOUR=20`): full `pg_dump` + a tar.gz of **all** uploaded files + checksums. Each night the dump is **restored into a scratch database** to prove it works, then both are copied to `BACKUP_SECOND_DIR` and checksums re-checked. Kept 14 days by default in both places. Result is the backup container's health status and is also reported by the API's `/readyz` endpoint | IMPLEMENTED (`deploy/backup.sh`); never run on a real hospital's server |
| Self-host restore | `deploy/restore.sh` replaces the database and files with a chosen backup; also recreates the needed database roles on a fresh machine | IMPLEMENTED; rehearsal on target hardware not done |

Important limits (VERIFIED from the scripts):

- **Up to 24 hours of data can be lost.** Backups are nightly snapshots. There is no continuous archiving (no WAL archiving, no replica). A disk failure at 01:59 loses almost a full day.
- **The files backup is a full copy every night, not incremental.** With 14 days kept in two places, backup storage is about **28 × the size of all uploaded files** (see 3.10). This becomes the biggest disk consumer.
- The script refuses to call a backup good without a second location, but **cannot tell whether that folder is really on another disk** (stated in `DEPLOY.md` S5). Mounting a genuinely separate disk or machine is the operator's job.
- Nothing copies backups off the premises automatically (for example to another city). A fire or theft that takes both disks loses everything.
- Backups are **not encrypted** by the script. The second location holds readable patient data.

### 3.7 File storage versus database storage

- Structured data (bookings, queue events, visits, prescriptions, audit) lives in PostgreSQL.
- Uploaded files (lab reports, patient documents, hospital logos via `hospital_logos`) live outside the database: in memory (demo) or on a disk volume (`files`) on the self-host server. Logos are a database table (0045). VERIFIED.
- No cloud object storage (S3-style) is implemented.

### 3.8 Isolation between hospitals

- **One shared database for all hospitals is the design and is built.** Every hospital is a "workspace" identified by `hospital_id`. VERIFIED.
- **Row-level security (RLS)**, rules enforced by the database itself, keeps hospitals apart: every connection first declares who it works for (`app.scope`, `app.hospital_id`, `app.person_id`), and database policies hide every other hospital's rows. Migration 0043 (hospitals), 0044 (one patient's clinical record from another), 0056 (bookings, payments, messages). VERIFIED in code; tested by `database/tests/tenancy.test.ts`, `backend/api/src/__tests__/tenantMatrix.test.ts` and `tenantScope.test.ts`, and every browser test runs as the limited account (DOCUMENTED).
- **This only protects a deployment where the API connects as its own limited account** (`API_DB_USER`, created by `pnpm db:role`), not as the owner. The self-host bundle does this automatically. The current demo does not (see 2.1).
- A **platform administrator** sees organisations but no patient data (`national` scope). A government viewer reads only aggregate views through a separate role (`gov_reader`).

### 3.9 One database per hospital?

**Not needed, and not the design.** One database serves many hospitals with database-enforced separation (`FR-SEC-11`, `CLAUDE.md` §1.2). Running a separate copy of the whole stack per hospital is **possible** (the same bundle on another server), but there is no tooling for managing many separate copies, and the cross-hospital patient search ("which hospitals have a burn unit now") only works when hospitals share one deployment.

### 3.10 Growth estimate

**Measured (VERIFIED):** on the local synthetic database (28 MB in total, 6 hospitals, 2,015 bookings), average stored size per row including indexes:

| Table | Rows | Bytes per row (incl. indexes) |
|---|---|---|
| bookings | 2,015 | ~1,030 |
| queue_events | 1,551 | ~650 |
| visits | 500 | ~1,080 |
| payments | 1,240 | ~535 |
| notifications | 118 | ~1,180 |
| audit_log | 68 | ~1,450 |

Small tables overstate per-row size because of fixed overheads, so these figures lean high, which is the safe side for planning.

**Workload assumptions (ASSUMPTION — replace with real hospital figures):**

- An average participating hospital handles **500 patient visits a day** through MedLiveBD. A small clinic or chamber: **100**.
- Each visit produces about **10 KB** of database rows in total: one booking, ~5 queue events, ~4 messages, a payment row, a share of visits/prescriptions/orders, audit rows.
- **5% of visits** produce an uploaded file averaging **0.5 MB** (a lab report PDF, a scanned document). That averages 25 KB of files per visit.
- Backups: 14 nightly copies kept, each = compressed database dump (~30% of live database size) + a full copy of all files.

Per hospital per year at 500 visits/day: 182,500 visits → **database ~1.8 GB**, **files ~4.6 GB**.

| Hospitals | Live data, end of year 1 (DB + files) | Live data, end of year 3 | Backup storage per location, end of year 1 | Backup storage per location, end of year 3 |
|---|---|---|---|---|
| 1 (small clinic, 100/day) | ~1.3 GB | ~4 GB | ~15 GB | ~44 GB |
| 1 | ~6.4 GB | ~19 GB | ~72 GB | ~215 GB |
| 5 | ~32 GB | ~96 GB | ~360 GB | ~1.1 TB |
| 10 | ~64 GB | ~190 GB | ~720 GB | ~2.2 TB |
| 50 | ~320 GB | ~960 GB | ~3.6 TB | ~10.8 TB |

How sensitive this is: **files and the way they are backed up dominate.** If only 1% of visits upload a 0.3 MB file, one hospital's files fall from 4.6 GB to about 0.55 GB a year, and year-1 backups from ~72 GB to ~15 GB. If backups kept only the database nightly and copied files incrementally (not built), backup storage would shrink by roughly 10×. `DEPLOY.md` S1's figure of "roughly a gigabyte a year" for one hospital matches the database part only; it leaves out files and backups.

**Consequence for the documented server size** (`DEPLOY.md` S1: 100 GB disk for one hospital): at 500 visits/day with 5% uploads, the live data, the local backup copies (which sit on the same disk as well as the second location), the restore-check scratch copy and the operating system reach roughly **95 GB within the first year**. Either the disk must be larger, `BACKUP_KEEP_DAYS` shorter, or the upload rate much lower than assumed.

### 3.11 What happens if the database server fails

- **Self-host:** there is one database on one server. If it stops, the API reports not ready, the patient app cannot load data, and the reception console keeps working **on the queue already on screen** for a while (offline mode; new walk-ins need the server, stated in `STATUS.md` *Pilot readiness*). Recovery means restarting it or, if the disk is lost, restoring last night's backup on a new machine (`DEPLOY.md` S5). No automatic failover, no replica. **Recovery-point: up to 24 hours. Recovery-time: as long as it takes a person to get a machine and run the restore** (not measured).
- **Demo:** depends on Supabase's free plan. Nothing in the repository measures it.

---

## Part 4 — Authentication and security

### 4.1 Overview

**MedLiveBD uses its own authentication, built into the API. Supabase Auth is not used anywhere** (VERIFIED: no Supabase auth library, no `auth.*` SQL; `BACKEND.md` §0 records the switch away from Supabase Auth on 28 September because real deployments must run in Bangladesh).

| Topic | How it works | Evidence | State |
|---|---|---|---|
| **Staff sign-in** | Email + password → `POST /staff/login`. Account locks after 5 wrong attempts for 15 minutes. First sign-in forces a new password. Minimum 10 characters | `staffAuth.service.ts`, `env.ts` (`STAFF_LOCKOUT_*`), `config/password.ts` | IMPLEMENTED |
| **Password hashing** | scrypt (built into Node.js) at OWASP's minimum settings: N=2^17, r=8, p=1. **About 128 MB of memory and a few hundred milliseconds per sign-in** | `config/password.ts` | IMPLEMENTED |
| **Tokens** | JWT access token valid **15 minutes**, refresh token valid **30 days**. Refreshing revokes the old refresh token and issues a new one (`sessions_auth` table). Three separate secrets for access, refresh and patient tracking links; production refuses to start if any two match | `config/jwt.ts`, `env.ts` | IMPLEMENTED |
| **Where sessions are kept** | Console: browser `sessionStorage` (cleared when the tab closes). Patient app: browser `localStorage` (stays), with the refresh token bound to that browser | `frontend/console/src/lib/demo.ts`, `staffAuth.ts`; `frontend/patient/src/lib/account.ts` | IMPLEMENTED |
| **Two-factor (2FA)** | Authenticator-app codes (TOTP), **required for hospital and platform administrators**, optional for other staff. 10 single-use recovery codes. The secret is encrypted (AES-256-GCM) with `TOTP_ENCRYPTION_KEY` | `config/totp.ts`, `BACKEND.md` §0 | IMPLEMENTED. No SMS 2FA, so no SMS cost here |
| **Patient sign-in** | Phone number + 6-digit code sent **by SMS** (`POST /auth/otp`, `/auth/verify`). Code lives 5 minutes, max 5 codes per number per hour, locked after 5 wrong tries | `patientAuth.service.ts`, `env.ts` | IMPLEMENTED, but **depends entirely on a working SMS provider** |
| **Guest booking** | No account needed. In production, **a guest must prove the phone with an SMS code before booking** (on by default whenever demo mode is off). The booking then gives a signed tracking link | `patientAuth.service.ts` line 311 (`GUEST_BOOKING_OTP ?? !DEMO_MODE`) | IMPLEMENTED |
| **Demo picker** | Under `DEMO_MODE=true` the console lets anyone choose any hospital and role without a password. Off in production | `demo.controller.ts`, `env.ts` | IMPLEMENTED |
| **Hospital-level authorisation** | Roles per staff member (`staff_roles`), route checks (`requireRole`, `requireHospitalScope`), and database row-level security (Part 3.8) | `middleware/`, migrations 0043/0044/0056 | IMPLEMENTED |
| **Audit log** | `audit_log` table: insert-only for the API's account, readable by the hospital's admin. Record views by consent are logged | `DATABASE.md` §2.7, §5.1 | IMPLEMENTED |
| **Encryption in transit** | HTTPS via Caddy (self-host) or Vercel/Render (demo). Strict security headers on the API and both apps | `middleware/securityHeaders.ts`, `next.config.mjs` | IMPLEMENTED |
| **Encryption at rest** | Only the 2FA secrets are encrypted by the application. Patient data, files and backups are **not** encrypted by MedLiveBD. Disk encryption depends on the server provider | Code search: only `config/totp.ts` uses encryption | UNKNOWN / host-dependent |
| **Secret management** | Secrets live in a plain file `deploy/.env` on the server (excluded from git). No secret vault. `DEPLOY.md` S2 says to keep a copy off the machine, and that a restore needs the same `TOTP_ENCRYPTION_KEY` | `deploy/.env.example` | IMPLEMENTED (manual) |
| **Logging hygiene** | Phone numbers, SMS text, codes and tracking links are never written to logs; SMS text is deleted from the database after 90 days | `adapters/sms.ts`, `jobs.service.ts` | IMPLEMENTED |
| **Rate limiting** | Per-address and per-number limits, held **in the API's memory** | `middleware/rateLimit.ts` | IMPLEMENTED (single-server assumption) |

### 4.2 The one thing to understand about patient login

**Without a real SMS provider, patients cannot use the patient app in production.** They cannot sign in (no code arrives) and cannot book as a guest (a code is required unless demo mode is on). VERIFIED in code and stated in `STATUS.md` ("Nobody can book on it without SMS"). A pilot can still run **at the reception counter**: staff register walk-ins, and the queue works. That is the "reception pilot" shape `DEPLOY.md` S8 describes.

### 4.3 External authentication services and their costs

| Service | Used? | Cost driver |
|---|---|---|
| Supabase Auth | No | — |
| Any identity provider (Google, Auth0, Firebase…) | No | — |
| SMS for patient codes | Yes, required for patient login and guest booking in production | Per SMS (see Part 6) |
| Authenticator apps for staff 2FA | Yes (Google Authenticator, Microsoft Authenticator, etc.) | Free for the user |
| Email (password reset, invitations) | **Not implemented.** Temporary passwords are shown once on screen; a lost password is reset by an administrator | — |

### 4.4 Operational responsibilities self-hosted authentication brings

Running your own login means you, not a vendor, own: keeping the four secrets safe and backed up (losing `TOTP_ENCRYPTION_KEY` locks every administrator out of 2FA; `pnpm staff:reset-2fa` recovers each one); resetting locked-out staff; making sure the server's clock is right (2FA codes are time-based); watching for brute-force attempts (nothing alerts on them); and handling password resets by hand (no email reset flow).

The scrypt memory cost matters for sizing: **ten staff signing in at the same moment need about 1.3 GB of memory briefly.** On a 2–4 GB server at shift change this could crowd out the database. Measured nowhere; derived from the parameters in `config/password.ts`.

---

## Part 5 — Bangladesh production hosting

### 5.1 Is Docker Compose deployment implemented?

**Yes.** VERIFIED: `Dockerfile` (multi-stage, non-root containers, compiled API), `deploy/docker-compose.yml`, `deploy/Caddyfile`, `deploy/backup.sh`, `deploy/restore.sh`, `deploy/.env.example`, runbook `DEPLOY.md` Part S. One command starts it:

```
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

| Container | Image | Role |
|---|---|---|
| `db` | `postgis/postgis:16-3.4` | Database |
| `migrate` | built from repo | Applies migrations, creates/refreshes the API's limited DB account, then exits |
| `api` | built from repo | API, live updates, timers. Runs as limited DB account |
| `console` | built from repo | Staff console (Next.js) |
| `patient` | built from repo | Patient app (Next.js) |
| `web` | `caddy:2` | HTTPS (Let's Encrypt) and routing |
| `backup` | `postgis/postgis:16-3.4` | Nightly backup, restore check, copy to second location |

**Production configuration is enforced at start-up** (VERIFIED, `env.ts`): with `NODE_ENV=production` the API refuses to start with demo mode on, mock payments, in-memory file storage, matching secrets, or a missing 2FA key. Demo seeding and reset refuse to run.

### 5.2 Server requirements

| Item | Documented | My view (ASSUMPTION) |
|---|---|---|
| OS | Ubuntu 24.04 LTS with Docker Engine + compose plugin (`DEPLOY.md` S1) | Same |
| CPU / RAM | "4 CPU cores, 8 GB of memory … comfortable for one hospital" (S1) | Reasonable starting point. Not load-tested (no load test exists in the repository). Building the two Next.js apps **on the server** also needs memory; a 2 GB server will likely struggle to build |
| Disk | 100 GB for one hospital | **Too small within a year** at moderate upload volumes (Part 3.10). Plan 200–300 GB for one medium hospital, or shorten backup retention |
| Bandwidth | Not stated | Small (Part 7). Typical Bangladeshi VPS bundles of 1 TB+/month are far above need |
| Network | Ports 80 and 443 open to the internet, three public DNS names | **Mandatory as built.** A hospital-network-only (LAN) setup is **not built** (`PLATFORM_PLAN.md` P5, deferred) |
| Second backup location | Another disk or machine, mounted as `BACKUP_SECOND_DIR` | Mandatory; the backup reports failure without it |

**Can everything run on one server?** Yes. That is exactly what the bundle does. VERIFIED.

### 5.3 Shared platform versus one server per hospital

- **Shared multi-hospital deployment: technically supported and the stated default** (`CLAUDE.md` §1.2, `PRD.md` FR-SEC-07 as amended 5 October). Hospitals are workspaces created from the platform screen (`S-B-12`) or by a self-service application form, and approved by a platform administrator.
- **One server per hospital: also possible** (same bundle), and it is how the earlier reception-pilot plan was written (`DEPLOY.md` S8). Not required.

### 5.4 Hospital-specific domains and branded apps

- **Branding** (name, logo, colours, enabled modules) is data in the shared database. VERIFIED (migrations 0036, 0045–0047).
- **A hospital's own portal address** comes in two forms (VERIFIED, `deploy/Caddyfile` comments, `env.ts` `PLATFORM_DOMAIN`):
  1. `<code>.<platform-domain>` (for example `padma.medlivebd.example`): needs a **wildcard DNS record and a wildcard certificate**. Caddy can only get a wildcard certificate through a DNS challenge, which needs **a custom Caddy build with the DNS provider's plugin**. The bundle uses the standard `caddy:2` image, so this is **not set up**.
  2. The hospital's own domain (for example `portal.hospital.com.bd`): the hospital points DNS at the server, an operator **hand-edits the Caddyfile** to add a site, and a platform admin records the domain on `S-B-12`.
- `NEXT_PUBLIC_PLATFORM_DOMAIN` is baked into the patient app **when it is built**, so changing the platform domain means rebuilding.
- Until a domain exists, a hospital's branded view opens as `?scope=<code>` on the shared app. VERIFIED.
- **Store apps** (Google Play / Apple): not built; the PWA is the launch format (`PLATFORM_PLAN.md` X4).

### 5.5 HTTPS

Caddy obtains and renews Let's Encrypt certificates automatically for each named address. Free. Requires public DNS and port 80 reachable. VERIFIED (`deploy/Caddyfile`). The console's offline features only work over HTTPS that every counter PC trusts (`DEPLOY.md` S1).

### 5.6 Backups (self-host)

Covered in Part 3.6. Scheduled nightly by the `backup` container itself (a sleep loop, not cron). Stored in `deploy/backups/` on the server **and** in `BACKUP_SECOND_DIR`. **Off-server only if the operator mounts a genuinely separate disk or machine there.** No off-site or cloud copy is built.

### 5.7 Software updates

`git pull` on the server, then the same `docker compose … up -d --build` (`DEPLOY.md` S4). Migrations run automatically. Take a backup first; migrations cannot be undone automatically.

- The images are **built on the production server** (10–15 minutes the first time, DOCUMENTED). No image registry or pre-built images.
- **There is downtime during an update** while containers are rebuilt and restarted. No zero-downtime (blue/green) deployment.
- **Rollback** = check out the previous commit and rebuild, **only if the database schema is still compatible**; otherwise restore a backup (losing newer data).

### 5.8 Failures, downtime and disaster recovery: what actually exists

| Capability | Exists? |
|---|---|
| Containers restart if they crash (`restart: unless-stopped`) | Yes |
| Health status visible in `docker compose ps` and `/readyz` (backup age, unsent messages, late timers) | Yes |
| **Alert sent to a person** when something fails | **No.** "Somebody has to look each morning" (`DEPLOY.md` S5) |
| Error tracking service | No (logs only, 5 × 10 MB per container, rotated) |
| Second server / automatic failover | No |
| Continuous database archiving | No (nightly only) |
| Off-site backup copy | No (only "a second location" the operator provides) |
| Tested restore on target hardware | No (instruction exists, `DEPLOY.md` S5/S8 step 9) |
| Graceful shutdown that finishes in-flight queue taps | Yes (`server.ts`) |
| Reception keeps working briefly through an outage | Partly: the queue already on screen; actions sync later |

### 5.9 Production items that remain incomplete or unverified

1. **Never run on a real Bangladeshi server or a hospital's network.** The 12-step dry run (`DEPLOY.md` S8) has not been done.
2. **The compose file does not pass the live SMS and payment settings to the API.** VERIFIED: `deploy/docker-compose.yml` forwards `SMS_PROVIDER`, `SMS_API_KEY` and `SMS_SENDER_ID`, but **not** `SMS_API_URL` or `SMS_DLR_SECRET`, and **none** of the `BKASH_*` or `NAGAD_*` settings; it has no `env_file`. Consequences: switching to `SMS_PROVIDER=http` as `DEPLOY.md` describes would make the API **refuse to start** in production (those two keys are required). With `PAYMENT_PROVIDER=live`, no bKash or Nagad method would ever be offered. A small configuration fix, but a real blocker the day SMS or payments are switched on. (Not fixed here; this was a read-only audit.)
3. Wildcard certificates for `*.platform-domain` need a custom Caddy build (5.4).
4. LAN-only hospital networks are not supported (5.2).
5. No alerting, no off-site backup, no encryption of backups.
6. No load or capacity test (Part 7).
7. Disk sizing guidance does not include files and backups (3.10).
8. Which commit to deploy: `DEPLOY.md` S8 names `fb1d1d8` (a single-hospital reception pilot from 5 October, **before** database-level hospital separation was built). The shared multi-hospital platform needs the later code. A founder decision (Part 8).

---

## Part 6 — External services and hidden costs

Prices quoted below are **indicative public list prices found on 9 October 2026**, from the sources linked, not quotes. Verify before budgeting. Where I found nothing credible, I give the billing unit only.

| # | Service | What it does | Used now? | Mandatory for production? | Free / open-source alternative | What sets the monthly cost | Fixed or usage | Who logically pays |
|---|---|---|---|---|---|---|---|---|
| 1 | **Server hosting (Bangladesh)** | Runs everything | No (demo uses Render/Vercel/Supabase) | **Yes** | Hospital's own machine | vCPU, RAM, disk size, bandwidth bundle | Fixed per month | MedLiveBD (shared) or the hospital (dedicated) |
| 2 | PostgreSQL | Database | Yes (Supabase, demo) | Yes | **Self-hosted Postgres in the bundle is free** | Disk and RAM of the server | Fixed (part of #1) | Same as #1 |
| 3 | Backup storage | Second copy of nightly backups | Demo: Supabase + founder PC | **Yes** | An external drive or a second machine | Size of backups (Part 3.10), number of days kept | Grows with data | Same as #1 |
| 4 | File storage | Lab reports, documents | Demo: API memory | Yes (on the server disk) | Server disk (built) | Disk GB | Grows with uploads | Same as #1 |
| 5 | **SMS** | Booking confirmations, live updates, patient login codes | No (log only) | **Yes for the patient app**; no for a counter-only pilot | None that reaches ordinary phones for free | Number of message segments × price per segment. Bangla text uses 70 characters per segment; most queue messages are written to fit one (`shared/i18n/src/__tests__/templates.test.ts`), the confirmation with its link is longer. Branded "masking" sender names cost more than numeric senders | **Usage** | Logically the hospital (its patients, its volume); a per-hospital monthly SMS cap exists (`FR-NOT-06`, set in hospital settings; empty means no cap) |
| 6 | Email | — | No (not implemented) | No | — | — | — | — |
| 7 | Push notifications | Phone notifications | No (adapter records "skipped") | No | Web Push is free (VAPID keys) | — | — | — |
| 8 | **Domain** | `medlivebd…` and subdomains | No | **Yes** | None | Yearly fee per domain | Fixed yearly | MedLiveBD (platform domain); hospital (its own domain) |
| 9 | SSL certificates | HTTPS | Included by Vercel/Render | Yes | **Let's Encrypt, built in, free** | — (wildcard needs DNS-provider API access) | — | — |
| 10 | DNS | Name → server | No | Yes | Many registrars/DNS hosts include it free | Some charge for API access needed by wildcard certificates | Usually free/low | MedLiveBD |
| 11 | CDN | Faster static files | Vercel's, demo only | No | Caddy serves directly; gzip on | — | — | — |
| 12 | Uptime monitoring / alerts | Tell a person when it breaks | No | **Effectively yes** (nothing alerts today) | Free tiers of external uptime checkers can poll `/readyz` | Number of checks, interval, SMS/phone alerts | Fixed tier | MedLiveBD |
| 13 | Error tracking | Collect crashes | No (`SENTRY_DSN` unused) | No (logs exist) | Self-hosted options exist; none wired | Events per month | Usage | MedLiveBD |
| 14 | Log storage | Keep history of logs | Container logs only (50 MB per container) | Recommended for incident investigation | Keep on server | GB stored / retention | Usage | MedLiveBD |
| 15 | **Payment gateways (bKash, Nagad)** | Online fees | No (mock in demo; `off` in self-host) | **No** (pay at the hospital is supported) | Pay at counter | A percentage per transaction (merchant discount rate) set by each provider's merchant agreement. Not researched here | Usage | Whoever holds the merchant account. **Undecided**: one account for the platform vs. one per hospital (`STATUS.md` question 17) |
| 16 | Maps / geolocation | Directions | Plain Google Maps link; built-in distance table | No | Built (no API) | — | — | — |
| 17 | AI import helper (Anthropic API) | Suggests column mapping for a hospital's export | No (`MAPPING_PROVIDER=off`) | **No** (rules + manual mapping work) | Leave off | Tokens per request; one short request per **new** export format, remembered after confirmation | Usage, tiny | MedLiveBD (onboarding cost) |
| 18 | Security testing | Independent penetration test | No (`PLATFORM_PLAN.md` X8) | Strongly recommended before scale; not required by the code | — | Vendor quote per engagement | One-time | MedLiveBD |
| 19 | Data import / onboarding | Bringing a hospital's data in | Built in (CSV/XLSX, `S-B-14`) | No external service | Built | Staff time | — | — |
| 20 | **GitHub** | Code, CI, deploy trigger | Yes | Yes for the current update process | — | Plan and CI minutes | Fixed/usage | MedLiveBD. **UNKNOWN** current plan |
| 21 | Vercel | Demo web apps | Yes | No | — | Plan | Fixed | MedLiveBD. **UNKNOWN** plan. Check whether its free tier's terms allow commercial use if the demo continues there |
| 22 | Render | Demo API | Yes | No | — | Instance size; free plan sleeps after idle | Fixed | MedLiveBD |
| 23 | Supabase | Demo database | Yes | No | — | Plan; free projects may be paused after inactivity (check the current terms; the daily refresh keeps it active) | Fixed | MedLiveBD |
| 24 | Docker Hub / npm / Google Fonts | Build-time downloads | Yes | Yes (at build) | — | Free; anonymous pull limits possible | — | — |
| 25 | People | Server care, backups checked each morning, restores, updates, support | — | **Yes** | — | Hours per month | Fixed + per incident | MedLiveBD (shared) or hospital IT (dedicated) |
| 26 | Store developer accounts | Play / App Store | No | No (PWA) | PWA | Yearly/one-time fee | Fixed | MedLiveBD or hospital (branded app) |

**Indicative Bangladeshi price points found (verify before use):**

| Item | Indicative price | Source |
|---|---|---|
| Bulk SMS, non-masking (numeric sender) | ~BDT 0.31–0.40 per SMS by package; some advertise from ~BDT 0.16–0.24 | [sms.net.bd pricing](https://sms.net.bd/Pricing), [Automas](https://sms.automas.com.bd/) |
| Bulk SMS, masking (brand-name sender) | ~BDT 0.56–0.64 per SMS | [sms.net.bd pricing](https://sms.net.bd/Pricing), [sms.net.bd masking](https://sms.net.bd/Masking_SMS) |
| VPS in Bangladesh, ~4 vCPU / 8 GB RAM | ~BDT 3,500–9,000 per month in public listings (disk 80–160 GB, bandwidth 1–20 TB) | [Alpha Net unmanaged VPS](https://www.alpha.net.bd/VPS/Unmanaged/), [Host Might via WHTop](https://www.whtop.com/plans/hostmight.com/41870), [Dhaka Web Host via WHTop](https://www.whtop.com/plans/dhakawebhost.com/50086), [Diana Host via WHTop](https://www.whtop.com/plans/dianahost.com/149139) |
| `.com.bd` domain | BDT 700 registration / BDT 1,020 renewal per year (BTCL reduced price announced January 2026, "for a limited period") | [The Financial Express](https://thefinancialexpress.com.bd/trade/price-of-bd-domain-cut-by-36pc), [MEA TechWatch](https://meatechwatch.com/2026/01/14/btcl-reduces-bd-domain-price/) |

The code's own figure of **35 poisha per SMS segment** (`adapters/sms.ts`, `POISHA_PER_SEGMENT`) is explicitly a **placeholder** used for budget reporting until an aggregator quotes a price. It is not a quote. Check with the chosen aggregator whether Bangla (Unicode) messages are billed per 70-character segment.

**Pricing research still needed:** an actual SMS aggregator quote (masking and non-masking, Unicode segment billing, sender-ID registration fee and regulator requirements); 2–3 Bangladeshi data-centre VPS quotes with **disk upgrade prices** and whether a **second VPS or storage box** for backups is offered; whether the provider offers disk encryption and snapshots; bKash/Nagad merchant rates and settlement terms; GitHub, Vercel, Render and Supabase current plan status from the founder's account pages; an uptime-alert service; a penetration test quote.

---

## Part 7 — Multi-hospital scalability

### 7.1 What the code does when hospitals are added

**Adding a hospital is configuration, not new infrastructure**, up to the point where one server runs out. VERIFIED: a hospital is a row plus its settings, created on `S-B-12`; its chambers appear from schedules hourly; it is isolated by row-level security.

### 7.2 Hard limits found in the code (VERIFIED)

| Constraint | Why it matters |
|---|---|
| **Live updates assume one API process.** Socket.IO has no shared "adapter" (no Redis or Postgres adapter installed). A broadcast reaches only phones connected to the same process that handled the tap | You **cannot** simply run two API copies behind a load balancer: patients connected to copy B would miss taps handled by copy A. Scaling out needs a Socket.IO adapter plus "sticky sessions". Not built |
| Rate limits are kept in process memory (`rateLimit.ts`) | With several API copies each would count separately (the file says so) |
| Message sending, offer and payment timers use database locking | These are already safe with several copies |
| Session-creation job is idempotent | Safe with several copies |
| One write per chamber at a time (row lock on the session) | Correct, and only serialises taps within one chamber |
| Database connection pool: 20 in self-host; Postgres default 100 connections | Fine for one API process |
| 15-second cap on every query | Protects against runaway queries |
| Files on the API server's local disk (`STORAGE_PROVIDER=local`) | A second API server could not see the first one's files. Shared or object storage not built |
| No load test exists in the repository | **No verified capacity figure exists.** The largest automated test drives about 150 simulated patients on one machine (DOCUMENTED, `env.ts` comment on `ADDRESS_RATE_LIMIT_FACTOR`) |

Requirement targets (from `PRD.md`, not measured): tap-to-phone ≤ 2 s (NFR-01), ≥ 50 concurrent live sessions per hospital (NFR-08), 99.5% uptime for a pilot (NFR-07).

### 7.3 Load per scenario (ASSUMPTION-based estimates, not measurements)

Working assumptions: 500 visits/day per hospital (100 for a small clinic); 10 staff consoles open per hospital (reception counters, doctors, lab, admin) at peak, 20 for a large one; 40% of patients follow their serial live on a phone at some point, with ~20 phones connected per busy hospital at any moment; ~6 SMS segments per patient who gets messages, and 60% of visits get messages; 5% of visits upload a 0.5 MB file.

| | 1 hospital | 5 | 10 | 50 | 100 |
|---|---|---|---|---|---|
| Visits / day | 500 | 2,500 | 5,000 | 25,000 | 50,000 |
| Peak open live connections (staff + phones) | ~30 | ~150 | ~300 | ~1,500 | ~3,000 |
| Queue taps / day (call, done, late…) | ~1,500 | ~7,500 | ~15,000 | ~75,000 | ~150,000 |
| SMS segments / month | ~54,000 | ~270,000 | ~540,000 | ~2.7 M | ~5.4 M |
| File uploads / day | ~25 (12 MB) | ~125 | ~250 | ~1,250 (~0.6 GB) | ~2,500 (~1.2 GB) |
| Database growth / year | ~1.8 GB | ~9 GB | ~18 GB | ~90 GB | ~180 GB |
| Bandwidth / month (pages + live updates) | ~10–30 GB | ~50–150 GB | ~0.1–0.3 TB | ~0.5–1.5 TB | ~1–3 TB |
| Likely infrastructure | One 4 vCPU / 8 GB server, larger disk | One 8 vCPU / 16 GB server, 0.5–1 TB disk + backup box | Database on its own server; API + web on another; dedicated backup storage | Database server with replica; **API scale-out work needed** (Socket.IO adapter, shared file storage); monitoring and on-call | Several API servers behind a load balancer; managed or replicated Postgres; object storage; partitioning of the event and audit tables (`DATABASE.md` §6 says partition at ~50 M rows) |
| Main bottleneck | Disk (backups), people's time | Disk, backup window | Single server = single point of failure | One API process; nightly full-file backups become impractical | Everything single-instance in the design |

Bandwidth reasoning (ASSUMPTION): the patient app's first load is roughly 1–2 MB (code + bundled fonts), then cached by the service worker; each `queue.updated` sent to a phone carries the whole anonymised queue (estimate 5–10 KB for a 50-patient chamber). Bandwidth is unlikely to be a cost driver on Bangladeshi VPS bundles.

### 7.4 Does adding hospitals require more servers?

- **1–10 hospitals:** probably a **larger** server and **more disk**, not more servers. Moving the database to its own server around 5–10 hospitals is prudent for reliability and backup windows, not because the code needs it.
- **Beyond one API process** (likely somewhere between 10 and 50 busy hospitals; unverified without a load test): **code work is required first** (Socket.IO adapter, shared file storage, shared rate-limit store). Not just configuration.
- **Separate databases per hospital: never required by the code.**
- **SMS cost grows linearly with patients**, and at every scale it will likely exceed server costs (Part 9).

---

## Part 8 — Production readiness and operations

What must be true before the first hospital uses MedLiveBD with real patient data.

### 8.1 Already implemented and verified (by tests, not by production use)

- Production start-up guard refuses unsafe settings (`env.ts`).
- Staff accounts, lockout, forced password change, administrator 2FA, recovery codes.
- Database-enforced hospital separation and per-patient separation, tested hospital-against-hospital on every route (`tenantMatrix.test.ts`) and in every browser test as the limited DB account.
- Limited database account for the API (cannot change schema, delete audit rows, or truncate).
- Audit log; SMS text purged after 90 days; imported raw rows purged after 30 days.
- Reception works through short network loss, with exactly-once replay (`offline-console.spec.ts`).
- The live-queue canary (two devices, under 2 seconds) in CI, including against the production configuration (`pnpm test:e2e:prod`).
- Nightly backup with automatic restore check and second copy (script tested, `backup.sh`).
- Non-root containers, rotated logs, security headers, script nonce policy.

### 8.2 Implemented but not production-verified

| Item | Why unverified |
|---|---|
| The whole self-host stack | Never started on a real Bangladeshi server or hospital network; 12-step dry run (`DEPLOY.md` S8) not done |
| Backup restore | Never rehearsed on target hardware |
| SMS aggregator adapter (`smsHttp.ts`) | Built against a stand-in; **no real aggregator's format** is known; and the compose file does not pass two of its settings (5.9 item 2) |
| bKash and Nagad adapters | Built against stand-ins of the published APIs; never run on the providers' sandboxes; compose file does not pass their settings |
| AI import helper | Never run against the live Anthropic service (no key) |
| Capacity (NFR-08, ≥ 50 live sessions per hospital) | No load test |
| HTTPS on counter PCs | Depends on the hospital's network |
| Uptime 99.5% (NFR-07) | Single server, no alerting; not measured |

### 8.3 Missing (no code or configuration exists)

- **Alerting** to a person (only status pages to read).
- **Off-site, encrypted backups**; continuous (point-in-time) database archiving.
- Encryption of data at rest by the application (relies on the host's disk, if any).
- A load test and a capacity figure.
- Email (password reset, invitations, notices).
- Push notifications.
- LAN-only HTTPS for hospitals whose server is not reachable from the internet.
- Wildcard certificate setup for hospital subdomains.
- Horizontal scaling of the API (Socket.IO adapter, shared files).
- Pre-built container images / a release pipeline (images are built on the production server).
- A written incident-response procedure, on-call rota and support process (only the morning check and the S7 troubleshooting table exist).
- Automated data-retention enforcement beyond SMS text and import rows (for example 24-month anonymisation of unclaimed guest records in `DATABASE.md` §8 is documented, not built as a job).

### 8.4 Requires a hosting provider or external vendor

| Need | Blocks |
|---|---|
| Company registration in Bangladesh (`PLATFORM_PLAN.md` X0) | Every account below |
| Bangladeshi server or data-centre account (X7) | Any real patient data |
| Domain + DNS (X3) | HTTPS, portal addresses |
| A second storage location for backups | A backup the system calls "good" |
| SMS aggregator account, sender ID, regulator approval for masking (X1, X9) | Patient app (login and guest booking) |
| bKash / Nagad merchant approval and sandbox checklist (X2, X9) | Online payment only |
| Uptime/alert service | Knowing about outages |
| Independent security test (X8) | Recommended before scale |

### 8.5 Requires a hospital or founder decision

1. **Shared platform from day one, or the single-hospital reception pilot from `fb1d1d8`?** The pilot commit predates database-level hospital separation; it is fine alone on one hospital's server, not on a shared one.
2. **Who owns and pays for the server**: MedLiveBD (shared) or the hospital (dedicated).
3. **Where the second backup copy lives**, and who checks backups every morning (`DEPLOY.md` S8 step 10 needs a named person).
4. **Merchant account model** for payments (`STATUS.md` question 17), or pay-at-counter only.
5. **Whether the patient app is offered at the first hospital** (it needs SMS; otherwise counter-only).
6. **SMS budget per hospital** (the cap setting) and who pays for SMS.
7. **Data protection and legal**: who is responsible for the data (hospital vs MedLiveBD), retention periods, deletion requests, written agreement on importing patient data (`FR-IMP-11`, `FR-IMP-12` require the hospital's legal adviser's agreement).
8. **Hospital IT's answer**: can the server be reached by public HTTPS names, or only inside the hospital (`DEPLOY.md` S1)?
9. **Support responsibilities**: who answers the phone when reception says "it's not updating", and in what hours.
10. **The owner's release restrictions** (`CLAUDE.md` §4.6) still apply: nothing is deployed without the owner's word.

### 8.6 Priority order of genuine blockers (not cosmetic)

1. A Bangladeshi server + domain + second backup disk, and the S8 dry run passed on it, including a real restore.
2. Decide the deployment shape and commit (8.5 items 1–2).
3. Someone named to watch backups and readiness daily, and an external uptime alert on `/readyz`.
4. If patients will use the app: an SMS aggregator, **and** the compose-file fix so its settings reach the API (5.9 item 2), then a real SMS test.
5. Disk sizing that accounts for files and 14 nights of full backups.
6. Legal/data agreements with the hospital before importing any patient data.
7. Penetration test before adding the second real hospital or scaling.

---

## Part 9 — Financial and infrastructure planning

All amounts are **planning estimates built from the indicative prices in Part 6 and the assumptions in Parts 3 and 7**. They are not quotes. Formulas are given so real quotes can replace them.

### 9.1 The cost formula

```
Monthly cost =
    servers (fixed, per month)
  + backup storage (grows: ~14 × nightly backup size × 2 locations, Part 3.10)
  + domain(s) / 12
  + SMS = hospitals × visits/day × share of visits messaged × segments per visit × 30 × price per segment
  + payment gateway fees (a % of online payments; usually borne by the merchant-account holder)
  + monitoring/alerting tier (often free at small scale)
  + people time (server care, updates, morning checks, support)
One-time: domain registration, server setup, dry run, sender-ID registration, security test.
```

**SMS example** (ASSUMPTION: 60% of visits messaged, 6 segments each): one hospital at 500 visits/day = 1,800 segments/day ≈ **54,000 segments/month**. At BDT 0.31–0.40 (non-masking) ≈ **BDT 16,700–21,600/month**; at BDT 0.56–0.64 (masking) ≈ **BDT 30,000–34,600/month**. A small clinic at 100/day: ≈ 10,800 segments ≈ BDT 3,300–4,300 (non-masking). **For a busy hospital, SMS is likely to cost more every month than the server.** Fewer messages per visit (for example only confirmation and "you are next") cut this sharply; the per-hospital cap bounds it.

### 9.2 Scenarios

| | A. Current public demo | B. One small clinic / chamber | C. One medium hospital | D. Five hospitals | E. Ten hospitals | F. Fifty hospitals |
|---|---|---|---|---|---|---|
| **Infrastructure** | Supabase + Render + Vercel free tiers; founder PC refresh | Shared platform server (marginal cost ~0) **or** small dedicated VPS | One 4 vCPU / 8 GB VPS, 200–300 GB disk + backup disk/box | One 8 vCPU / 16 GB server, ~1 TB disk + backup server | DB server + app server + backup storage | Several servers, DB replica, API scale-out (code work first), object storage, monitoring |
| **Fixed recurring (indicative)** | BDT 0 as configured (account billing UNKNOWN) | Shared: ~0 extra. Dedicated: ~BDT 3,500–9,000 VPS + backup storage | ~BDT 3,500–9,000 VPS + backup storage (price research) + domain ~BDT 85/month | Larger server(s) + ~0.5–1 TB backup storage (quote) | 2–3 servers + ~1–2 TB backup storage (quote) | Quote-driven; multiple servers and several TB of backup storage |
| **Variable (usage)** | None (SMS logged, payments mock) | SMS ~BDT 3,300–4,300/month (non-masking, at 100 visits/day) | SMS ~BDT 16,700–34,600/month | SMS ~5× scenario C | SMS ~10× C | SMS ~50× C |
| **One-time** | — | Setup + dry run; domain; sender ID | Same + legal/data agreement; data import | Same per hospital onboarding (mostly staff time) | + migration to multi-server | + scale-out engineering, security test |
| **Storage (year 1, Part 3.10)** | Demo ~28 MB-scale | ~1.3 GB live, ~15 GB backups | ~6.4 GB live, ~72 GB backups per location | ~32 GB live, ~360 GB backups | ~64 GB, ~720 GB | ~320 GB, ~3.6 TB |
| **Bandwidth** | Within free tiers (UNKNOWN limits) | Negligible | ~10–30 GB/month | ~50–150 GB | ~0.1–0.3 TB | ~0.5–1.5 TB |
| **SMS volume** | 0 sent | ~10,800 segments/month | ~54,000 | ~270,000 | ~540,000 | ~2.7 M |
| **Backup needs** | Supabase + manual dump | Second disk, 14 days | Second disk/box off the server; restore rehearsal | Dedicated backup server; consider off-site | Off-site copy; consider continuous archiving | Point-in-time recovery, replica, off-site |
| **Technical maintenance** | Founder PC refresh; occasional reset | Morning check (5 min/day), monthly updates | Same + support calls | A part-time operator | A dedicated operator, on-call | A small ops team |
| **Shared** | Everything | Server, DB, code, monitoring | — | Server, DB, backups, monitoring, platform domain | Same | Same |
| **Hospital-specific** | — | Its SMS volume, its own domain (optional) | Its SMS, its domain, its data agreement, its counter PCs and network | Same per hospital | Same | Same |

### 9.3 Three deployment approaches compared

| | 1. One shared Bangladesh platform | 2. One dedicated server per hospital | 3. Hybrid (shared platform + dedicated where a hospital insists) |
|---|---|---|---|
| **Supported by the code?** | **Yes, the stated default** (`FR-SEC-07` amended, `CLAUDE.md` §1.2) | Yes (same bundle on each server) | Yes in principle; no tooling to manage many separate installs |
| **Patient network search across hospitals** | Works | **Does not work across servers** (each server sees only its hospital) | Works for shared hospitals only |
| **Hospital isolation** | Database row-level security (tested) | Physical separation | Mixed |
| **Cost** | Lowest per hospital; one server, one backup set, one monitor | Highest; one server + backup + domain + maintenance per hospital, but each hospital can pay its own | Between the two |
| **Operational complexity** | Lowest: one place to update, back up, watch | High: N updates, N backups, N servers to watch, version drift | Highest: two operating models at once |
| **Risk** | One outage affects every hospital; one mistake (e.g. API connecting as DB owner) would weaken isolation for all | An outage affects one hospital | Both kinds |
| **Scaling** | Hits the single-API-process limit first (Part 7) | Each hospital small; scaling rarely needed | — |
| **Fits** | Network-wide patient app, many small/medium hospitals | A large hospital with strict IT/policy demands that pays for its own | When one anchor hospital requires on-premises hosting |
| **Key cost drivers** | SMS, disk/backups, operator time | Servers × hospitals, operator time × hospitals | Both |

No final recommendation is made here. The trade-off is mainly **cost and simplicity (shared)** versus **blast radius and hospital-controlled infrastructure (dedicated)**.

---

## Part 10 — Founder-friendly executive report

**What we built:** one platform with two websites (a patient app and a hospital console), one central API server that runs the live queue, and one PostgreSQL database shared by all hospitals, with the database itself keeping hospitals apart. A complete self-hosting kit runs all of it on a single Linux server with automatic HTTPS and nightly checked backups. It has never yet run on a real Bangladeshi server or a hospital's network.

**1. What am I currently paying for, if anything verifiable?**
Nothing verifiable from the repository. The demo is configured for free tiers: Render `plan: free`, Supabase free plan (per `DEPLOY.md`), no domain. Vercel's and GitHub's plans are not recorded anywhere I could read. Check the billing pages of Supabase, Render, Vercel and GitHub to confirm.

**2. Which services are currently free?**
Supabase (demo database), Render (demo API, which sleeps when idle), the `vercel.app` / `onrender.com` addresses, Let's Encrypt (built into the self-host kit), PostgreSQL/PostGIS, Caddy, Docker, the Google Fonts used at build time, and the Google Maps directions link. SMS and payments cost nothing because they are simulated.

**3. What will stop being free when real hospitals start?**
A server in Bangladesh, a second disk or machine for backups, a domain, and **SMS, which is likely the largest monthly bill**. Also your or an operator's time every day. Later: payment gateway fees (a percentage of online payments), a security test, monitoring if you outgrow free tiers.

**4. Do I still need Supabase?**
Only for the public demo. Real patient data cannot go there (must stay in Bangladesh), and the product does not depend on any Supabase feature. It is used purely as a hosted PostgreSQL.

**5. Do I need Supabase Auth?**
No. MedLiveBD has its own login for staff (password + authenticator-app 2FA) and patients (SMS code). Supabase Auth is not used anywhere.

**6. Can PostgreSQL run on my own Bangladesh server?**
Yes. The self-host kit already does it (PostGIS 16 in Docker), with migrations, a limited API account and nightly backups.

**7. Do I need one database for every hospital?**
No. One shared database is the design, and hospital separation is enforced by the database itself (provided the API connects with its limited account, which the kit sets up automatically).

**8. Do I need one server for every hospital?**
No. One server can host many hospitals. A dedicated server is an option for a hospital that requires it, but it breaks the cross-hospital patient search for that hospital and multiplies your maintenance.

**9. Minimum infrastructure for the first real deployment?**
One Bangladeshi Linux server (start at 4 vCPU / 8 GB RAM and **200+ GB disk**, more than the documented 100 GB, because backups of uploaded files grow fast), a second disk or machine for backups, a domain with three addresses, and a named person checking backups and status every morning plus a free uptime alert. For a counter-only reception pilot, no SMS is needed. For the patient app, an SMS aggregator is mandatory, and a small fix is needed first so the server actually receives the SMS settings.

**10. What costs increase as patient traffic increases?**
SMS (directly proportional), disk and backup storage (especially from uploaded files, multiplied by 14 nightly copies in two places), and eventually server size. Bandwidth grows but is unlikely to matter on Bangladeshi hosting bundles.

**11. What costs increase as hospitals are added?**
SMS (per hospital's volume), storage and backups, operator and support time, and at some point (unmeasured, perhaps 10–50 busy hospitals) a move to several servers, which first needs engineering work so live updates work across more than one API server.

**12. What expenses could be charged directly to hospitals?**
Their SMS volume (the per-hospital SMS cap and monthly count already exist), their own domain if they want a branded address, a dedicated server if they insist on one, payment gateway fees if they hold the merchant account, and their own counter PCs and internet. (Pricing terms are deliberately kept out of the repository.)

**13. Highest operational risks?**
(a) A single server with nightly backups only: a disk failure can lose up to a day and take every hospital offline until someone restores. (b) Nobody is alerted when something breaks. (c) Backups that are not truly off the machine, or never rehearsed. (d) The disk filling up from file backups. (e) Losing the server secrets file, especially the 2FA key. (f) SMS not set up correctly on day one: patients cannot log in or book online. (g) Capacity never load-tested.

**14. Cheapest technically responsible way to launch?**
One shared Bangladeshi VPS (indicatively BDT 3,500–9,000/month for 4 vCPU / 8 GB in public listings) with a larger disk, a second small storage location for backups, a `.com.bd` domain (about BDT 700 first year), Let's Encrypt, a free uptime checker on `/readyz`, and a **counter-only reception pilot first** (no SMS, pay at the hospital). Rehearse a restore before the first patient. Add SMS when the hospital wants the patient app, with a cap per hospital. This is a framework, not a recommendation of one vendor; trade-offs are in 9.3.

**15. What is still missing before a reliable monthly budget?**
Real visit volumes from the first hospital(s); how many SMS per visit you actually want to send; an SMS aggregator quote (and whether Bangla is billed per 70 characters); two or three Bangladeshi VPS and backup-storage quotes, including disk upgrades; whether the hospital or MedLiveBD pays for servers, SMS and payment fees; the hospital's upload volume (lab reports); current Vercel, GitHub, Render and Supabase plan status; payment gateway rates if online payment is wanted; a penetration test quote; and a load test to know when one server stops being enough.

---

## Evidence appendix

Paths are relative to the repository root.

**Architecture and processes**
- `pnpm-workspace.yaml`, `package.json`, each app's `package.json` — packages and scripts
- `backend/api/src/server.ts` — process start, timers, shutdown
- `backend/api/src/services/jobs.service.ts` — hourly jobs
- `backend/api/src/services/notificationSender.service.ts`, `queueTimers.service.ts`, `paymentHolds.service.ts` — in-process timers
- `backend/workers/src/index.ts` — empty placeholder
- `backend/api/src/realtime/server.ts`, `emit.ts`, `rooms.ts` — Socket.IO, single-process emitter, transports
- `frontend/site/README.md` — marketing site not built
- `frontend/patient/src/app/fonts.ts` — Google Fonts at build time
- `frontend/patient/public/sw.js`, `frontend/console/public/sw.js` — service workers
- `frontend/*/src/app/layout.tsx` — `dynamic = 'force-dynamic'`
- `frontend/patient/src/lib/emergency.ts` — Google Maps link
- `shared/client/src/offline/store.dexie.ts` — offline storage
- `docs/BACKEND.md` §0, §6, §8, §12, §12b

**Hosting and deployment**
- `render.yaml` — Render free plan, Singapore, demo settings
- `frontend/patient/vercel.json`, `frontend/console/vercel.json`
- `docs/DEPLOY.md` §1–7 (demo), §7.9 (pilot prerequisites), Part S (self-host)
- `docs/STATUS.md` *Environments*, *Pilot readiness*, *The demo API sleeps*
- `database/scripts/demo-refresh.ps1` — founder-PC refresh
- `.github/workflows/ci.yml` — CI
- `Dockerfile`, `deploy/docker-compose.yml`, `deploy/Caddyfile`, `deploy/.env.example`
- `deploy/backup.sh`, `deploy/restore.sh`

**Configuration and adapters**
- `backend/api/src/env.ts` — every setting, production refusals
- `.env.example` — settings template
- `backend/api/src/adapters/sms.ts` (log adapter, `POISHA_PER_SEGMENT` placeholder), `smsHttp.ts`
- `backend/api/src/adapters/storage.ts` — mock, local, unconfigured (no Supabase implementation)
- `backend/api/src/adapters/push.ts` — push not implemented
- `backend/api/src/adapters/traveltime.ts` — static estimate
- `backend/api/src/adapters/mapping.ts` — optional Anthropic call
- `backend/api/src/adapters/payments/bkash.ts`, `nagad.ts`, `index.ts`
- `backend/api/src/middleware/rateLimit.ts` — in-memory limiter
- `shared/i18n/src/templates.ts`, `shared/i18n/src/__tests__/templates.test.ts` — SMS texts and segment test
- `shared/domain/src/schemas/lab.schema.ts` (`REPORT_MAX_BYTES` 10 MB), `shared/domain/src/clinical/documents.ts` (8 MB)

**Database**
- `database/migrations/0001_extensions.sql` — extensions
- `database/migrations/0043_tenant_policies.sql`, `0044_patient_policies.sql`, `0056_person_policies.sql` — row-level security
- `database/migrations/0055_backup_runs.sql` — backup results table
- `database/scripts/lib/role.ts`, `database/scripts/api_role.ts` — limited API account
- `backend/api/src/config/db.ts`, `config/dbScope.ts` — pool, timeouts, scope
- `docs/DATABASE.md` §5–§8
- `docker-compose.yml` (root) — local PostGIS 16
- Local measurement: read-only `pg_stat_user_tables` / `pg_total_relation_size` queries on the synthetic `healthcare_dev` database (PostgreSQL 16.4)

**Authentication and security**
- `backend/api/src/config/password.ts` — scrypt parameters
- `backend/api/src/config/jwt.ts`, `config/totp.ts`
- `backend/api/src/services/staffAuth.service.ts`, `patientAuth.service.ts`
- `backend/api/src/middleware/auth.ts`, `requireRole.ts`, `securityHeaders.ts`, `cors.ts`
- `frontend/console/src/lib/staffAuth.ts`, `lib/demo.ts`; `frontend/patient/src/lib/account.ts`
- `docs/PRD.md` FR-SEC-07, FR-SEC-10, FR-SEC-11, NFR-01–10

**Plans and open items**
- `docs/PLATFORM_PLAN.md` §2 (X0–X10 external dependencies), §7 (decisions)
- `CLAUDE.md` §1.1, §1.2, §4.6

**Web sources for indicative prices (accessed 9 October 2026)**
- [sms.net.bd — SMS packages and prices](https://sms.net.bd/Pricing)
- [sms.net.bd — masking SMS](https://sms.net.bd/Masking_SMS)
- [Automas bulk SMS](https://sms.automas.com.bd/)
- [Alpha Net — self-managed VPS in Bangladesh](https://www.alpha.net.bd/VPS/Unmanaged/)
- [WHTop — Host Might Ultimate VPS](https://www.whtop.com/plans/hostmight.com/41870)
- [WHTop — Dhaka Web Host VPS-CPX31](https://www.whtop.com/plans/dhakawebhost.com/50086)
- [WHTop — Diana Host BDIX NVMe VPS 4](https://www.whtop.com/plans/dianahost.com/149139)
- [The Financial Express — price of .bd domain cut by 36%](https://thefinancialexpress.com.bd/trade/price-of-bd-domain-cut-by-36pc)
- [MEA TechWatch — BTCL reduces .bd domain price](https://meatechwatch.com/2026/01/14/btcl-reduces-bd-domain-price/)
